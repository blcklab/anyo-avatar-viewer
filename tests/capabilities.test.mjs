import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarViewer } from '../dist/index.js';

function capableSession() {
  let playback = { status: 'stopped', clip: null, time: 0, duration: 0, speed: 1 };
  const values = {};
  let lookAt = null;
  const bounds = Object.freeze({
    min: Object.freeze([-1, 0, -1]), max: Object.freeze([1, 2, 1]),
    center: Object.freeze([0, 1, 0]), size: Object.freeze([2, 2, 2]), radius: Math.sqrt(3), height: 2,
  });
  return {
    clips: [], mount() {}, dispose() {}, prepareAnimations: async () => ({ dispose() {} }), installAnimations() {},
    play() {}, pause() {}, resume() {}, stop() {}, seek() {}, setSpeed() {}, update() {}, getPlayback: () => playback,
    getBounds: () => bounds,
    getExpressions: () => Object.freeze({ available: Object.freeze(['happy']), values: Object.freeze({ ...values }) }),
    setExpression(name, weight) { if (name !== 'happy') return false; values[name] = weight; return true; },
    clearExpression(name) { if (name !== 'happy') return false; delete values[name]; return true; },
    resetExpressions() { for (const key of Object.keys(values)) delete values[key]; },
    setLookAt(target, options = {}) { lookAt = target ? Object.freeze({ target: Object.freeze([...target]), space: options.space ?? 'world', eyes: options.eyes ?? true, head: options.head ?? true, neck: options.neck ?? true, weight: options.weight ?? 1, smoothing: options.smoothing ?? 10, maxYaw: options.maxYaw ?? 60, maxPitch: options.maxPitch ?? 35 }) : null; },
    getLookAt: () => lookAt,
  };
}

test('root viewer exposes renderer-neutral bounds, expression, and look-at capabilities', async () => {
  const session = capableSession();
  const viewer = createAvatarViewer({ backend: { async loadModel() { return session; }, dispose() {} } });
  await viewer.loadModel({ url: 'hero.vrm', format: 'vrm' });
  assert.equal(viewer.getBounds().height, 2);
  assert.deepEqual(viewer.getSnapshot().expressions.available, ['happy']);
  assert.equal(viewer.setExpression('happy', 0.75), true);
  assert.equal(viewer.getSnapshot().expressions.values.happy, 0.75);
  assert.equal(viewer.setExpression('missing', 0.5), false);
  assert.equal(viewer.clearExpression('happy'), true);
  assert.equal(viewer.getSnapshot().expressions.values.happy, undefined);
  viewer.setLookAt([1, 2, 3], { space: 'world', smoothing: 0, weight: 0.8 });
  assert.deepEqual(viewer.getSnapshot().lookAt.target, [1, 2, 3]);
  assert.equal(viewer.getSnapshot().lookAt.weight, 0.8);
  assert.equal(viewer.getLookAt(), viewer.getSnapshot().lookAt);
  viewer.clearLookAt(); assert.equal(viewer.getSnapshot().lookAt, null);
  await viewer.dispose();
});

test('root capability inputs reject invalid values before reaching a backend', async () => {
  const viewer = createAvatarViewer({ backend: { async loadModel() { return capableSession(); }, dispose() {} } });
  await viewer.loadModel({ url: 'hero.vrm', format: 'vrm' });
  for (const value of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => viewer.setExpression('happy', value));
  assert.throws(() => viewer.setLookAt([0, NaN, 0]));
  assert.throws(() => viewer.setLookAt([0, 0, -1], { weight: 2 }));
  assert.throws(() => viewer.setLookAt([0, 0, -1], { maxYaw: -1 }));
  await viewer.dispose();
});
