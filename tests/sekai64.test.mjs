import { fixture } from './fixtures.mjs';
import { binaryFixture } from '../scripts/generate-test-assets.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene, Node, Mesh } from '@blcklab/sekai64';
import { AnimationClip, AnimationTrack, createAnimationRendererModule, SkinnedGeometry } from '@blcklab/sekai64/animation';
import { createAvatarViewer } from '../dist/index.js';
import { createSekai64Backend } from '../dist/sekai64/index.js';
import { Playback } from '../dist/sekai64/Playback.js';

function animation(id, target, from, to, duration = 1) {
  return new AnimationClip({ id, tracks: [new AnimationTrack({ target, path: 'translation', times: new Float32Array([0, duration]), values: new Float32Array([from, 0, 0, to, 0, 0]) })] });
}
test('real mixer crossfade receives positive incoming weight and completes', () => {
  const root = new Node({ id: 'root' }), bone = new Node({ id: 'bone' }); root.add(bone);
  const playback = new Playback(root, () => bone.position.set(0, 0, 0));
  const a = animation('a', 'bone', 0, 0), b = animation('b', 'bone', 10, 10);
  playback.play(a, {}); playback.play(b, { fade: 1 }); playback.update(0.5);
  assert.ok(Math.abs(bone.position.x - 5) < 0.001);
  playback.pause(); playback.update(0.5); assert.equal(bone.position.x, 5);
  playback.resume(); playback.update(0.5); assert.equal(bone.position.x, 10);
  assert.equal(playback.mixer.actions.length, 1); playback.dispose(); root.dispose(); a.dispose(); b.dispose();
});
test('once clips start at zero, seek while paused, complete and hold the last pose', () => {
  const root = new Node({ id: 'root' }), bone = new Node({ id: 'bone' }); root.add(bone);
  const playback = new Playback(root, () => bone.position.set(0, 0, 0)), clip = animation('walk', 'bone', 0, 10);
  playback.play(clip, { loop: 'once' }); assert.equal(playback.getSnapshot().status, 'playing');
  playback.update(0.2); playback.pause(); playback.seek(0.8); assert.ok(Math.abs(bone.position.x - 8) < 0.001);
  playback.update(1); assert.ok(Math.abs(bone.position.x - 8) < 0.001);
  playback.resume(); playback.update(0.3); assert.equal(playback.getSnapshot().status, 'completed'); assert.equal(bone.position.x, 10);
  playback.update(5); assert.equal(bone.position.x, 10); playback.seek(0); assert.equal(bone.position.x, 0);
  assert.equal(playback.getSnapshot().status, 'paused'); playback.stop(); assert.equal(bone.position.x, 0);
  playback.dispose(); root.dispose(); clip.dispose();
});
test('zero speed freezes playback without completing a once clip', () => {
  const root = new Node({ id: 'bone' }), clip = animation('a', 'bone', 0, 1), playback = new Playback(root, () => {});
  playback.play(clip, { loop: 'once', speed: 0 }); playback.update(1);
  assert.equal(playback.getSnapshot().status, 'playing'); assert.equal(playback.getSnapshot().time, 0);
  playback.dispose(); root.dispose(); clip.dispose();
});

function environment(importers) {
  const scene = createScene(), module = createAnimationRendererModule();
  const backend = createSekai64Backend({ scene, animationModule: module, importers });
  const viewer = createAvatarViewer({ backend });
  return { scene, module, viewer, async dispose() { await viewer.dispose(); module.update(0); assert.equal(module.bindings.size, 0); module.dispose(); scene.dispose(); } };
}
const modelSource = (options = {}) => ({ url: fixture(options), format: 'gltf' });
test('VRM metadata and skin load once, external glTF animates a model with no embedded mixer', async () => {
  const env = environment(); await env.viewer.loadModel(modelSource());
  assert.equal(env.module.mixers.size, 0); assert.equal(env.viewer.getSnapshot().clips.length, 0);
  await env.viewer.loadAnimation({ url: fixture({ embedded: true }), format: 'gltf' });
  const id = env.viewer.getSnapshot().clips[0].id; env.viewer.play(id, { loop: 'once' });
  for (let i = 0; i < 5; i++) env.viewer.update(0.1);
  env.module.update(0);
  let bone, body; env.scene.traverse(node => { if (node.name === 'Hips') bone = node; if (node.name === 'Body') body = node; });
  assert.ok(Math.abs(bone.position.x - 0.5) < 0.001);
  assert.ok(body instanceof Mesh && body.geometry instanceof SkinnedGeometry);
  assert.ok(body.geometry.positions[0] > 0, 'CPU skin deformation must move the triangle');
  await env.dispose();
});
test('embedded clip binds after GltfModelNode reparents the loaded scene', async () => {
  const env = environment(); await env.viewer.loadModel(modelSource({ embedded: true }));
  env.viewer.play('embedded:0'); env.viewer.update(0.1);
  let hips; env.scene.traverse(node => { if (node.name === 'Hips') hips = node; });
  assert.ok(Math.abs(hips.position.x - 0.1) < 0.001); await env.dispose();
});
test('incompatible external rigs fail atomically; clip IDs remain unique across imports', async () => {
  const env = environment(); await env.viewer.loadModel(modelSource({ embedded: true }));
  for (const options of [{ offset: 2 }, { name: 'Unknown' }, { extraParent: true }]) {
    await assert.rejects(env.viewer.loadAnimation({ url: fixture({ embedded: true, ...options }), format: 'gltf' }), /Rest pose|matches|Hierarchy|Extra/);
    assert.equal(env.viewer.getSnapshot().clips.length, 1);
  }
  for (let i = 0; i < 2; i++) await env.viewer.loadAnimation({ url: fixture({ embedded: true }), format: 'gltf' });
  assert.equal(new Set(env.viewer.getSnapshot().clips.map(c => c.id)).size, 3);
  await assert.rejects(env.viewer.loadAnimation({ url: 'idle.fbx', format: 'fbx' }), /Unsupported animation format/);
  await env.dispose();
});
test('bad custom importer cannot install missing target tracks', async () => {
  let clip;
  const env = environment([{ formats: ['custom'], async load() { clip = animation('bad', 'missing-node', 0, 1); return [clip]; } }]);
  await env.viewer.loadModel(modelSource());
  await assert.rejects(env.viewer.loadAnimation({ url: 'custom', format: 'custom' }), /missing node/);
  assert.equal(clip.disposed, true); assert.equal(env.viewer.getSnapshot().clips.length, 0); await env.dispose();
});
test('binary VRM and external GLB load from blob URLs with no filename extension', async () => {
  const env = environment();
  const model = URL.createObjectURL(new Blob([binaryFixture()]));
  const animation = URL.createObjectURL(new Blob([binaryFixture({ embedded: true })]));
  try {
    await env.viewer.loadModel({ url: model, format: 'vrm' });
    await env.viewer.loadAnimation({ url: animation, format: 'glb' });
    assert.equal(env.viewer.getSnapshot().clips.length, 1);
    env.viewer.play(env.viewer.getSnapshot().clips[0].id); env.viewer.update(0.1);
    assert.equal(env.viewer.getSnapshot().time, 0.1);
  } finally { URL.revokeObjectURL(model); URL.revokeObjectURL(animation); await env.dispose(); }
});

import { PerspectiveCamera } from '@blcklab/sekai64';
import { dataUrl, avatarDocument } from './vrma-fixtures.mjs';
import { Sekai64AvatarCameraController } from '../dist/sekai64/index.js';

test('VRM sessions expose weighted direct expressions, bounds, and additive look-at', async () => {
  const env = environment();
  await env.viewer.loadModel({ url: dataUrl(avatarDocument({ blinkWeight: 0.5 })), format: 'vrm' });
  assert.ok(env.viewer.getBounds()?.height > 0);
  assert.ok(env.viewer.getSnapshot().expressions.available.includes('blink'));
  const stableBefore = env.viewer.getSnapshot(); env.viewer.update(0); assert.equal(env.viewer.getSnapshot(), stableBefore, 'idle viewer snapshot must stay stable');
  let body, head;
  env.scene.traverse(node => { if (node.name === 'Body') body = node; if (node.name === 'Head') head = node; });
  assert.ok(body instanceof Mesh && body.geometry instanceof SkinnedGeometry);
  assert.equal(env.viewer.setExpression('blink', 0.8), true);
  assert.ok(Math.abs(body.geometry.morphWeights[0] - 0.4) < 0.001, 'VRM bind weight must be preserved');
  assert.equal(env.viewer.clearExpression('blink'), true);
  assert.ok(Math.abs(body.geometry.morphWeights[0]) < 0.001);
  const before = [head.rotation.x, head.rotation.y];
  env.viewer.setLookAt([10, 2, -10], { space: 'world', head: true, eyes: false, neck: false, smoothing: 0 });
  env.viewer.update(0);
  assert.notDeepEqual([head.rotation.x, head.rotation.y], before);
  env.viewer.clearLookAt(); env.viewer.update(0);
  assert.ok(Math.abs(head.rotation.x - before[0]) < 0.001 && Math.abs(head.rotation.y - before[1]) < 0.001);
  await env.dispose();
});

test('Sekai64 camera controller provides fit, focus, zoom, rotate, pan, and authored reset', async () => {
  const env = environment(); await env.viewer.loadModel(modelSource());
  const model = env.scene.children.find(node => node.asset);
  assert.ok(model);
  model.rotation.set(0.1, 0.2, 0.3);
  const camera = new PerspectiveCamera({ fieldOfView: 42, near: 0.01, far: 10000, autoAspect: true });
  camera.position.set(3.4, 2.15, 4.2);
  const controls = new Sekai64AvatarCameraController({ camera, autoFit: true });
  controls.attachModel(model);
  const fitted = controls.getSnapshot();
  assert.equal(controls.getSnapshot(), fitted, 'camera snapshots must be stable for framework external stores');
  let cameraChanges = 0;
  const unsubscribeCamera = controls.subscribe(() => { cameraChanges += 1; });
  assert.ok(fitted.bounds?.height > 0 && fitted.distance > 0);
  const distance = fitted.distance; controls.zoomIn(); assert.ok(controls.getSnapshot().distance < distance);
  const beforeRotate = [...controls.getSnapshot().position]; controls.rotateRight(); assert.notDeepEqual(controls.getSnapshot().position, beforeRotate);
  const beforePan = controls.getFocusTarget(); controls.panBy(20, -10); assert.notDeepEqual(controls.getFocusTarget(), beforePan);
  const changesBeforeFocus = cameraChanges;
  controls.focus('face'); assert.ok(controls.getFocusTarget()[1] > fitted.bounds.min[1]);
  assert.ok(cameraChanges > changesBeforeFocus, 'programmatic focus must notify camera subscribers');
  controls.focus('eyes'); controls.focusHeight(0.5); controls.focusUp(); controls.focusDown();
  controls.setAutoRotate(true); controls.setAutoRotateSpeed(0.5); controls.update(1); assert.notEqual(model.rotation.y, 0.2);
  controls.resetView(); assert.ok(Math.abs(model.rotation.y - 0.2) < 0.0001);
  unsubscribeCamera(); controls.dispose(); camera.dispose(); await env.dispose();
});
