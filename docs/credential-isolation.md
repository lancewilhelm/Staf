# Credential isolation

Agent host execution and file actions fail closed unless the experimental Linux
host boundary is explicitly configured and its checks succeed. The host boundary
has not been executed or verified on Linux. A separate Docker scratch backend
also remains unverified on Linux. Environment filtering, same-user file modes,
and output redaction do not establish a boundary.

## Linux scratch backend

The service requires an owner-configured Docker executable, local Unix socket,
and pinned image ID, and the existing separate permissions and exact-command
approval. The owner must trust the daemon, executable, image, host kernel, and
their administrators. Staf does not expose the Docker socket or a host bind to
the command. It requests a private PID, IPC, network and cgroup view, a bounded
tmpfs workspace, read-only root, UID/GID 65534, no capabilities, no new
privileges, and Docker's built-in seccomp profile. It checks the daemon's Linux
and seccomp reports and inspects the resulting container settings before start.
An entry wrapper checks seccomp, no-new-privileges, and zero effective, permitted
and bounding capabilities in `/proc/self/status` before executing the command.
The observed configuration must also disable daemon logging and restart, so
Docker does not retain output in its normal log driver or replay the command.
Any failed or unavailable check blocks execution. This is isolated scratch, not
access to existing host files or an interactive terminal. Previously launched
detached processes and unrelated same-user software remain outside this gate.

Docker's [container security documentation](https://docs.docker.com/engine/security/)
explains the role and limits of namespaces and daemon authority. Docker documents
[`seccomp=builtin`](https://docs.docker.com/reference/cli/docker/container/run/#optional-security-options---security-opt)
as selecting its built-in profile, and the Linux kernel documents
[no-new-privileges](https://docs.kernel.org/userspace-api/no_new_privs.html).
Container and kernel bugs, a malicious daemon or image, and compromised host
administration are outside this protection. Older Docker versions or platforms
that cannot establish the required settings fail closed.

## Experimental Linux host work

The service can select a fixed launcher for pipe, PTY and file work when started
with `STAF_LINUX_HOST_EXECUTION=1`. Without that exact setting, on non-Linux
systems, or when any setup check fails, the affected tools reject input before
execution. This implementation has **not been run on Linux** and must not be
considered an accepted credential boundary. Do not enable it for real secrets.

The service checks the root-owned policy, its parent directories and the fixed
executable paths at startup and again before each launch. It checks the service
and execution account IDs and groups, compares executable hashes, requires a
non-setuid bubblewrap without file capabilities, and requires a dedicated
workspace filesystem distinct from the runtime and the credential-store roots.
It rejects an extended or default ACL on the workspace root.
The launcher and file-worker hashes must also match the versions shipped with
this Staf build. The service passes only a small fixed environment and standard
streams to `sudo`. It sends the command only after the guard's exact readiness
message. File operations and write reconciliation use the same launcher. A
fixed helper opens each file with [`openat2`](https://man7.org/linux/man-pages/man2/openat2.2.html) beneath the workspace, refusing
symlinks and nested mounts, and passes its descriptor to the worker. Raw file
read context is checked in service memory before a page is returned.

The fixed launcher uses separate `staf-service` and `staf-exec` accounts and
binds `/srv/staf-workspace` as `/workspace`. A private PID, IPC, network and
mount view, dropped capabilities, `no_new_privs`, Landlock ABI 9 and a seccomp
filter are required by the launcher and guard. The filter allows Unix socket
families only. Network access, including localhost services and vsock, is not
available. Existing host files must be deliberately placed in the workspace;
normal file and terminal work uses the workspace as its default directory. The
terminal and file tools use `/workspace` for visible paths. They also accept the
equivalent `/srv/staf-workspace` host path. Both forms remain confined to the
approved workspace. All
agents using this boundary share that workspace; it is not per-agent isolation.
Scheduled and helper work retain their existing tool restrictions.

The guard requests and checks Linux child-subreaper status before accepting a
command, then waits for the command and its orphaned descendants. This is meant
to keep retained background work under the launcher's lifetime after its shell
exits. Signal and terminal behavior, including cancellation of those descendants,
still require the controlled Linux tests below; cross-compiling the guard does
not demonstrate them.

### Disposable Linux setup

Only an administrator of a disposable test system should prepare this
unverified candidate. No setup is performed automatically by Staf or the tests.

1. Create distinct locked-down `staf-service` and `staf-exec` accounts. The
   execution account needs its own non-root primary group, no supplementary
   groups, and no shared service groups. Run Staf as `staf-service`.
2. Provision `/srv/staf-workspace` as a separate filesystem, owned by root and
   the execution group with mode `0770`. Its parent directories must be
   root-owned and not group- or world-writable. Do not put credentials, FIFOs,
   or files consumed by privileged services in it. No nested mounts or extended
   or default ACLs on the workspace root are allowed. Other host processes and
   accounts must not use the execution UID or group.
3. Install a trusted system `sudo`, non-setuid `bubblewrap` without file
   capabilities, `getcap`, `getfacl` at `/usr/bin/getfacl`, Node.js 22.16 or newer at `/usr/bin/node`, and the
   seccomp development libraries. Compile `staf-exec-guard.c` with libseccomp
   and `staf-file-open.c` with the Linux headers. Install both compiled helpers,
   the exact `staf-exec-launch.example` as `/usr/lib/staf-exec/launch`, and
   `staf-file-worker.mjs` beside them. Each
   executable and every parent directory must be root-owned and not group- or
   world-writable. The launcher takes no arguments.

   From the checkout, a compiler with current Linux headers and libseccomp can
   build the guard with `cc -O2 -Wall -Wextra -Werror deploy/native-linux/staf-exec-guard.c -lseccomp -o staf-exec-guard`.
   Build the file opener with `cc -O2 -Wall -Wextra -Werror deploy/native-linux/staf-file-open.c -o staf-file-open`.
   Install the result only on the disposable test machine described here.
4. Configure sudoers so the service account can run **only** that launcher,
   without arguments, as `staf-exec:staf-exec`; do not grant a shell or a
   wildcard. Validate the entry with `visudo`. An example entry is:

   ```text
   staf-service ALL=(staf-exec:staf-exec) NOPASSWD: /usr/lib/staf-exec/launch ""
   ```

5. Create root-owned `/etc/staf-exec/host.json`, readable by the service and
   not writable by either account. Use the actual numeric IDs and lowercase
   SHA-256 hashes of the installed files in this exact structure:

   ```json
   {
     "version": 1,
     "workspace": "/srv/staf-workspace",
     "serviceUid": 1001,
     "executionUid": 1002,
     "executionGid": 1002,
     "launcherSha256": "<sha256-of-launch>",
     "guardSha256": "<sha256-of-staf-exec-guard>",
     "bwrapSha256": "<sha256-of-/usr/bin/bwrap>",
     "sudoSha256": "<sha256-of-/usr/bin/sudo>",
     "nodeSha256": "<sha256-of-/usr/bin/node>",
     "fileWorkerSha256": "<sha256-of-staf-file-worker.mjs>",
     "fileOpenSha256": "<sha256-of-staf-file-open>"
   }
   ```

   `sha256sum` computes these hashes. The launcher and worker must be byte-for-byte
   identical to the bundled files. Update policy after a trusted system binary
   changes, then restart Staf. A changed or missing file causes refusal.
6. Set `STAF_LINUX_HOST_EXECUTION=1` in the service's host environment and
   restart. The service requires Landlock ABI 9, unprivileged user namespaces,
   the listed paths and privileges, and successful per-launch guard checks.
   Missing or changed requirements reject work; they do not fall back to host
   execution. Linux support and this procedure remain unverified.

The launcher recursively binds `/usr` and the workspace. The guard rejects
nested mounts in either tree, but the administrator must ensure `/usr` contains
no readable credentials or privileged cooperating service endpoints. The
operator must also exclude host FIFOs from `/usr` and the workspace. The guard
blocks creating new device nodes and FIFOs in the sandbox, but it does not prove
that an existing FIFO has no external reader. The
separate workspace filesystem prevents hard links to the checked credential
roots; it does not make unsafe ACLs, shared services, privileged software, or
arbitrary operator changes safe. Root and system binaries remain trusted. See
[bubblewrap](https://github.com/containers/bubblewrap#security) and the Linux
[Landlock documentation](https://docs.kernel.org/userspace-api/landlock.html).

### Required Linux verification

`test/linux-host-guard.integration.test.js` exercises the candidate guard using
synthetic files, sockets, descriptors, pipe, PTY and background descendants,
including one whose shell has already exited.
On an operator-prepared disposable machine, set `STAF_TEST_LINUX_WORKSPACE` to
`/srv/staf-workspace` and run that test. Run
`test/linux-host-service.integration.test.js` as `staf-service` with
`STAF_TEST_LINUX_SERVICE=1` to exercise the service dispatch path. These tests
are skipped elsewhere and have not run in this change. They do not yet prove
all bypasses, recovery races, helper paths, or production security. Real
controlled Linux process tests remain required before claiming acceptance;
Linux VM and live-account checks are separate owner-led activities.
