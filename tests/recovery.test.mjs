import test from 'node:test';
import assert from 'node:assert/strict';
import { Sekai64AvatarRecoveryController } from '../dist/sekai64/index.js';

function fakeEngine({ failures = 0 } = {}) {
  let diagnostic;
  const calls = [];
  let attempts = 0;
  return {
    calls,
    capabilities: { backend: 'webgpu' },
    renderer: { async recover() { calls.push('renderer'); attempts++; if (attempts <= failures) throw new Error('lost'); } },
    on(type, listener) { assert.equal(type, 'diagnostic'); diagnostic = listener; return () => { diagnostic = undefined; }; },
    async recoverModules(context) { calls.push(`modules:${context.attempt}`); },
    resizeToDisplaySize() { calls.push('resize'); },
    emit(value) { diagnostic?.(value); },
  };
}

test('recovery recreates renderer, recovers modules, refreshes presentation, then resumes', async () => {
  const engine = fakeEngine();
  const controller = new Sekai64AvatarRecoveryController(engine, {
    suspend: () => engine.calls.push('suspend'), resume: () => engine.calls.push('resume'), refresh: () => engine.calls.push('refresh'),
  });
  await controller.recover(new Error('device lost'));
  assert.deepEqual(engine.calls, ['suspend', 'renderer', 'modules:1', 'resize', 'refresh', 'resume']);
  assert.equal(controller.getSnapshot().status, 'ready');
  controller.dispose();
});

test('recovery retries and exposes terminal failure state', async () => {
  const engine = fakeEngine({ failures: 3 });
  const controller = new Sekai64AvatarRecoveryController(engine, { maxAttempts: 2, suspend() {}, resume() {}, refresh() {} });
  await assert.rejects(controller.recover(), /failed after 2 attempts/);
  assert.equal(controller.getSnapshot().status, 'failed');
  assert.equal(controller.getSnapshot().attempt, 2);
  controller.dispose();
});

test('WebGPU loss diagnostic suspends immediately and starts automatic recovery', async () => {
  const engine = fakeEngine(); let suspended = 0, resumed = 0;
  const controller = new Sekai64AvatarRecoveryController(engine, { suspend: () => { suspended++; }, resume: () => { resumed++; }, refresh() {} });
  engine.emit({ severity: 'error', code: 'SEKAI64_WEBGPU_DEVICE_LOST', message: 'lost' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(suspended >= 1); assert.equal(resumed, 1); assert.equal(controller.getSnapshot().status, 'ready');
  controller.dispose();
});
