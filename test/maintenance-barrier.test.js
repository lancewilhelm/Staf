import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Instance } from '../dist/instance.js';
import { startInstance } from '../dist/instance-service.js';

test('an interrupted dataset replacement blocks direct and service startup before initialization', () => {
  const root = mkdtempSync(join(tmpdir(), 'staf-barrier-'));
  const path = join(root, 'instance.sqlite');
  try {
    writeFileSync(path + '.maintenance.json', '{}');
    assert.throws(() => new Instance(path), /maintenance|recover/i);
    assert.throws(() => startInstance(path), /maintenance|recover/i);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(join(root, 'agents')), false);
  } finally { rmSync(root, {recursive:true, force:true}); }
});
