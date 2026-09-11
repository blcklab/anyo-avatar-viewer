import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarViewer } from '../dist/index.js';

const source = name => ({ url: name, format: 'vrm' });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function session() {
  let playback = { status: 'stopped', clip: null, time: 0, duration: 1, speed: 1 };
  return {
    clips: [{ id: 'idle', name: 'Idle', duration: 1 }], disposed: 0, mounted: false, updates: [],
    mount() { this.mounted = true; }, dispose() { this.disposed++; },
    prepareAnimations: async () => ({ dispose() {} }), installAnimations() {},
    getPlayback: () => playback,
    play(clip, options) { playback = { ...playback, clip, status: 'playing', speed: options.speed ?? 1 }; },
    pause() { playback = { ...playback, status: 'paused' }; }, resume() { playback = { ...playback, status: 'playing' }; },
    stop() { playback = { ...playback, status: 'stopped', clip: null }; }, seek(time) { playback = { ...playback, time }; },
    setSpeed(speed) { playback = { ...playback, speed }; }, update(dt) { this.updates.push(dt); },
  };
}
test('latest model wins even if a loader ignores cancellation', async () => {
  const a = deferred(), b = deferred(); const first = session(), second = session();
  const viewer = createAvatarViewer({ backend: { loadModel: s => s.url === 'a' ? a.promise : b.promise, dispose() {} } });
  const loadingA = viewer.loadModel(source('a')); const rejection = assert.rejects(loadingA, { name: 'AbortError' });
  const loadingB = viewer.loadModel(source('b')); b.resolve(second); await loadingB;
  a.resolve(first); await rejection;
  assert.equal(first.disposed, 1); assert.equal(first.mounted, false);
  assert.equal(viewer.getSnapshot().model.url, 'b'); assert.equal(second.mounted, true);
  await viewer.dispose(); assert.equal(second.disposed, 1);
});
test('failed replacement preserves model and playback', async () => {
  const model = session();
  const viewer = createAvatarViewer({ backend: { async loadModel(s) { if (s.url === 'bad') throw Error('decode failed'); return model; }, dispose() {} } });
  await viewer.loadModel(source('good')); viewer.play('idle');
  await assert.rejects(viewer.loadModel(source('bad')), /decode failed/);
  assert.equal(viewer.getSnapshot().phase, 'ready'); assert.equal(viewer.getSnapshot().model.url, 'good');
  assert.equal(viewer.getSnapshot().status, 'playing'); assert.equal(model.disposed, 0); await viewer.dispose();
});
test('animation results cannot cross model generations', async () => {
  const a = session(), b = session(), pending = deferred(); let disposedBank = 0, installed = 0;
  a.prepareAnimations = () => pending.promise; a.installAnimations = () => installed++;
  const viewer = createAvatarViewer({ backend: { async loadModel(s) { return s.url === 'a' ? a : b; }, dispose() {} } });
  await viewer.loadModel(source('a'));
  const load = viewer.loadAnimation({ url: 'idle.glb', format: 'glb' }); const rejection = assert.rejects(load, { name: 'AbortError' });
  await viewer.loadModel(source('b')); pending.resolve({ dispose() { disposedBank++; } }); await rejection;
  assert.equal(installed, 0); assert.equal(disposedBank, 1); assert.equal(viewer.getSnapshot().loadingAnimations, 0); await viewer.dispose();
});
test('dispose rejects late loads and disposes backend once', async () => {
  const pending = deferred(), late = session(); let count = 0;
  const viewer = createAvatarViewer({ backend: { loadModel: () => pending.promise, dispose() { count++; } } });
  const loading = viewer.loadModel(source('late')); const rejection = assert.rejects(loading, { name: 'AbortError' });
  const p = viewer.dispose(); assert.equal(viewer.dispose(), p); await p;
  pending.resolve(late); await rejection;
  assert.equal(late.disposed, 1); assert.equal(count, 1); assert.equal(viewer.getSnapshot().phase, 'disposed');
  assert.throws(() => viewer.play('idle'), /disposed/);
});
test('abort and unload reset pending state', async () => {
  const pending = deferred(), model = session(), abort = new AbortController();
  const viewer = createAvatarViewer({ backend: { loadModel: () => pending.promise, dispose() {} } });
  const loading = viewer.loadModel(source('a'), { signal: abort.signal }); const rejection = assert.rejects(loading, { name: 'AbortError' });
  abort.abort(); pending.resolve(model); await rejection;
  assert.equal(viewer.getSnapshot().phase, 'empty'); assert.equal(viewer.getSnapshot().error, null);
  viewer.unload(); await viewer.dispose();
});
test('snapshots are stable, immutable and observer exceptions do not affect loads', async () => {
  const model = session(); let errors = 0, calls = 0;
  const viewer = createAvatarViewer({ backend: { async loadModel() { return model; }, dispose() {} }, onListenerError() { errors++; } });
  const unsubscribe = viewer.subscribe(() => { calls++; throw Error('observer'); });
  await viewer.loadModel(source('a')); assert.equal(errors, 2);
  const state = viewer.getSnapshot(); assert.equal(viewer.getSnapshot(), state);
  assert.throws(() => state.clips.push({}), TypeError); assert.throws(() => { state.clips[0].name = 'other'; }, TypeError);
  viewer.update(0); assert.equal(viewer.getSnapshot(), state);
  unsubscribe(); viewer.play('idle'); assert.equal(calls, 2); await viewer.dispose();
});
test('invalid commands fail before mutating playback; large deltas are capped', async () => {
  const model = session(); const viewer = createAvatarViewer({ backend: { async loadModel() { return model; }, dispose() {} } });
  assert.throws(() => viewer.play('idle'), /Load a model/); await viewer.loadModel(source('a'));
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => viewer.setSpeed(value)); assert.throws(() => viewer.seek(value));
    assert.throws(() => viewer.play('idle', { fade: value })); assert.throws(() => viewer.update(value));
  }
  assert.throws(() => viewer.play('unknown'), /Unknown clip/); viewer.update(100); assert.deepEqual(model.updates, [0.1]);
  viewer.play('idle'); viewer.pause(); assert.equal(viewer.getSnapshot().status, 'paused'); viewer.resume(); viewer.stop();
  assert.equal(viewer.getSnapshot().status, 'stopped'); await viewer.dispose();
});
test('dispose remains idempotent when an observer re-enters it', async () => {
  let count = 0;
  const viewer = createAvatarViewer({ backend: { async loadModel() { return session(); }, dispose() { count++; } } });
  viewer.subscribe(() => { if (viewer.getSnapshot().phase === 'disposed') void viewer.dispose(); });
  await viewer.dispose(); assert.equal(count, 1);
});
