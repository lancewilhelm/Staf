import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeShellSandbox, reconcileShellSandbox } from '../dist/shell-sandbox.js';

const dockerBinary = process.env.STAF_TEST_DOCKER_BINARY;
const dockerSocket = process.env.STAF_TEST_DOCKER_SOCKET;
const imageId = process.env.STAF_TEST_DOCKER_IMAGE;
const enabled = Boolean(dockerBinary && dockerSocket && imageId);

test('rejects invalid configuration before execution', async () => {
  await assert.rejects(executeShellSandbox({ executionId: randomUUID(), dockerBinary: 'docker', dockerSocket: '/x', imageId: 'busybox',
    workspace: '/', command: 'true', timeoutMs: 10, maxOutputBytes: 10, signal: new AbortController().signal }), /Invalid/);
});

test('isolated Docker lifecycle and detached descendants', { skip: !enabled, timeout: 30000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'staf-shell-test-'));
  await chmod(workspace, 0o777);
  const request = { dockerBinary, dockerSocket, imageId, workspace, timeoutMs: 4000, maxOutputBytes: 1024,
    signal: new AbortController().signal };
  const execute = (values) => executeShellSandbox({ ...values, executionId: randomUUID() });
  try {
    const result = await execute({ ...request, command: 'id -u && test ! -S /var/run/docker.sock && test ! -e /host-secret && test ! -e /sys/class/net/eth0 && echo isolated' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.outputComplete, true);
    assert.match(result.output, /65534\s+isolated/);
    const failure = await execute({ ...request, command: 'echo failed; exit 7' });
    assert.equal(failure.exitCode, 7);
    assert.equal(failure.stopped, 'completed');
    assert.equal(failure.outputComplete, false);
    const absent = await reconcileShellSandbox({ dockerBinary, dockerSocket, executionId: randomUUID() });
    assert.equal(absent, 'absent-at-observation');
    process.env.STAF_SYNTHETIC_SANDBOX_SECRET = 'synthetic-only';
    try {
      const environment = await execute({ ...request, command: 'env | sort' });
      assert.equal(environment.exitCode, 0);
      assert.deepEqual(environment.output.trim().split('\n'), [
        'HOME=/nonexistent', 'HOSTNAME=staf-sandbox', 'PATH=/usr/bin:/bin',
        'PWD=/workspace', 'SHLVL=1',
      ]);
    } finally {
      delete process.env.STAF_SYNTHETIC_SANDBOX_SECRET;
    }
    const limited = await execute({ ...request, command: 'yes x', maxOutputBytes: 100 });
    assert.equal(limited.stopped, 'output-limit');
    assert.equal(limited.outputComplete, false);
    assert.ok(Buffer.byteLength(limited.output) <= 100);
    const fast = await execute({ ...request, command: 'head -c 2097152 /dev/zero', maxOutputBytes: 100 });
    assert.equal(fast.stopped, 'output-limit');
    assert.ok(Buffer.byteLength(fast.output) <= 100);
    const abortController = new AbortController();
    const aborting = execute({ ...request, signal: abortController.signal, command: 'sleep 30' });
    setTimeout(() => abortController.abort(), 100);
    try {
      const aborted = await aborting;
      assert.equal(aborted.stopped, 'aborted');
    } catch (error) {
      assert.match(error.message, /aborted before execution/);
    }
    const stopped = await execute({ ...request, timeoutMs: 500,
      command: "setsid sh -c 'sleep 2; echo escaped > /workspace/escaped' </dev/null >/dev/null 2>&1 & sleep 30" });
    assert.equal(stopped.stopped, 'timeout');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await assert.rejects(readFile(join(workspace, 'escaped')), { code: 'ENOENT' });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

const forbiddenImage = process.env.STAF_TEST_DOCKER_FORBIDDEN_IMAGE;
test('rejects a synthetic image with forbidden configuration', { skip: !enabled || !forbiddenImage }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'staf-shell-image-'));
  try {
    await assert.rejects(executeShellSandbox({ executionId: randomUUID(), dockerBinary, dockerSocket, imageId: forbiddenImage, workspace,
      command: 'true', timeoutMs: 1000, maxOutputBytes: 100, signal: new AbortController().signal }),
    /not allowlisted|volumes and healthchecks are forbidden/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('rejects scratch limits that could be unlimited or out of bounds before Docker', async () => {
  const base = { executionId: randomUUID(), dockerBinary: '/bin/false', dockerSocket: '/missing-socket',
    imageId: `sha256:${'a'.repeat(64)}`, command: 'true', timeoutMs: 1000, maxOutputBytes: 100,
    signal: new AbortController().signal };
  for (const workspace of [
    { kind: 'scratch', sizeBytes: 0, maxInodes: 32 },
    { kind: 'scratch', sizeBytes: 1048576, maxInodes: 0 },
    { kind: 'scratch', sizeBytes: 67108865, maxInodes: 32 },
    { kind: 'scratch', sizeBytes: 1048576, maxInodes: 65537 },
    { kind: 'scratch', sizeBytes: 1048576, maxInodes: 32, mount: '/host' },
  ]) await assert.rejects(executeShellSandbox({ ...base, workspace }), /scratch workspace limits/);
});

test('tmpfs scratch is private, bounded and discarded between executions', { skip: !enabled, timeout: 30000 }, async () => {
  const request = { dockerBinary, dockerSocket, imageId, workspace: { kind: 'scratch', sizeBytes: 1048576, maxInodes: 32 },
    timeoutMs: 8000, maxOutputBytes: 1024, signal: new AbortController().signal };
  const execute = command => executeShellSandbox({ ...request, executionId: randomUUID(), command });
  const first = await execute("test \"$(id -u)\" = 65534 && test \"$(stat -c '%u:%g:%a' /workspace)\" = 65534:65534:700 && mountline=$(grep ' /workspace ' /proc/self/mountinfo) && echo \"$mountline\" | grep -q ' - tmpfs ' && echo \"$mountline\" | grep -q nosuid && echo \"$mountline\" | grep -q nodev && echo \"$mountline\" | grep -q noexec && test ! -S /var/run/docker.sock && test ! -e /sys/class/net/eth0 && test -w /workspace && touch /workspace/marker && echo scratch-ready");
  assert.equal(first.exitCode, 0); assert.match(first.output, /scratch-ready/);
  const second = await execute('test ! -e /workspace/marker && echo empty');
  assert.equal(second.exitCode, 0); assert.match(second.output, /empty/);
  const bytes = await execute("touch /workspace/preflight && rm /workspace/preflight && if dd if=/dev/zero of=/workspace/fill bs=4096 count=512 >/dev/null 2>&1; then exit 1; else echo bytes-limited; fi");
  assert.equal(bytes.exitCode, 0); assert.match(bytes.output, /bytes-limited/);
  const inodes = await execute("touch /workspace/preflight && rm /workspace/preflight && { i=0; while [ \"$i\" -lt 100 ] && touch /workspace/f$i 2>/dev/null; do i=$((i+1)); done; test \"$i\" -lt 100 && echo inodes-limited; }");
  assert.equal(inodes.exitCode, 0); assert.match(inodes.output, /inodes-limited/);
});
