import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene, Mesh, Quaternion } from '@blcklab/sekai64';
import { createAnimationRendererModule } from '@blcklab/sekai64/animation';
import { createAvatarViewer } from '../dist/index.js';
import { createSekai64Backend } from '../dist/sekai64/index.js';
import { avatarDocument, dataUrl, motionDocument } from './vrma-fixtures.mjs';
import { packDocument } from './vrma-fixtures.mjs';
import { createServer } from 'node:http';
const s = Math.SQRT1_2;
function env(options = {}) {
  const scene = createScene(), animationModule = createAnimationRendererModule(), diagnostics = [];
  const backend = createSekai64Backend({ scene, animationModule, ...options, onDiagnostic: message => diagnostics.push(message) });
  const viewer = createAvatarViewer({ backend });
  return { scene, animationModule, diagnostics, viewer,
    async model(doc = avatarDocument()) { await viewer.loadModel({ url: dataUrl(doc), format: 'vrm' }); },
    async motion(doc = motionDocument()) { await viewer.loadAnimation({ url: dataUrl(doc), format: 'vrma' }); },
    sample(time = 1) { viewer.play(viewer.getSnapshot().clips.at(-1).id, { loop: 'once' }); viewer.pause(); viewer.seek(time); },
    node(index) { let found; scene.traverse(node => { if (node.id.endsWith(`:node-${index}`)) found = node; }); assert.ok(found, `node ${index}`); return found; },
    async dispose() { await viewer.dispose(); assert.equal(animationModule.bindings.size, 0); animationModule.dispose(); scene.dispose(); },
  };
}
function close(actual, expected, epsilon = 0.0001) { assert.equal(actual.length, expected.length); for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < epsilon, `${actual} != ${expected}`); }
function quat(node) { const q = new Quaternion().setFromEuler(node.rotation); return [q.x,q.y,q.z,q.w]; }
function sameRotation(actual, expected) { const sign = actual.reduce((n, v, i) => n + v * expected[i], 0) < 0 ? -1 : 1; close(actual.map(v => v * sign), expected); }

test('VRMA converts different source/target rest rotations and ignores duplicate node names', async () => {
  const e = env(); try {
    await e.model(avatarDocument({ headRotation: [0,0,s,s], duplicateNames: true }));
    await e.motion(motionDocument({ nodes: [{ translation: [0,1,0], children: [1] }, { translation: [0,1,0], rotation: [0,s,0,s] }],
      channels: [{ node: 1, path: 'rotation', values: [0,s,0,s, 0.5,0.5,0.5,0.5] }] }));
    e.sample(0); sameRotation(quat(e.node(1)), [0,0,s,s]);
    e.sample(1); sameRotation(quat(e.node(1)), [0.5,-0.5,0.5,0.5]);
  } finally { await e.dispose(); }
});
test('VRMA scales hips displacement and transforms through target parent space', async () => {
  const e = env(); try {
    await e.model(avatarDocument({ height: 2, parentRotation: [0,s,0,s] }));
    await e.motion(motionDocument({ channels: [{ node: 0, path: 'translation', values: [0,1,0, 1,1,0] }] }));
    e.sample(0); close([e.node(0).position.x,e.node(0).position.y,e.node(0).position.z], [0,2,0]);
    e.sample(1); close([e.node(0).position.x,e.node(0).position.y,e.node(0).position.z], [0,2,2]);
  } finally { await e.dispose(); }
});
test('VRM 0 coordinate conversion flips motion X/Z, including rotations', async () => {
  const e = env(); try {
    await e.model(avatarDocument({ legacy: true }));
    await e.motion(motionDocument({ channels: [
      { node: 0, path: 'translation', values: [0,1,0, 1,1,0] },
      { node: 1, path: 'rotation', values: [0,0,0,1, s,0,0,s] },
    ] }));
    e.sample(1); close([e.node(0).position.x,e.node(0).position.y,e.node(0).position.z], [-2,2,0]); sameRotation(quat(e.node(1)), [-s,0,0,s]);
  } finally { await e.dispose(); }
});
test('missing optional ancestors are folded into mapped descendants', async () => {
  const e = env(); try {
    await e.model();
    await e.motion(motionDocument({ nodes: [{ translation: [0,1,0], children: [1] }, { translation: [0,0.5,0], children: [2] }, { translation: [0,0.5,0] }],
      bones: { hips: { node: 0 }, upperChest: { node: 1 }, head: { node: 2 } }, channels: [
        { node: 1, path: 'rotation', values: [0,0,0,1, s,0,0,s] },
        { node: 2, path: 'rotation', values: [0,0,0,1, 0,s,0,s] },
      ] }));
    e.sample(1); sameRotation(quat(e.node(1)), [0.5,0.5,0.5,0.5]);
    assert.ok(e.diagnostics.some(message => message.includes('upperChest')));
  } finally { await e.dispose(); }
});
test('finger mappings use VRM node indices even outside Anyo Avatar bone-name enum', async () => {
  const e = env(); try {
    await e.model(avatarDocument({ finger: true }));
    await e.motion(motionDocument({ nodes: [{ translation: [0,1,0], children: [1,2] }, { translation: [0,1,0] }, { translation: [0.1,0.2,0] }],
      bones: { hips: { node: 0 }, head: { node: 1 }, leftIndexProximal: { node: 2 } }, channels: [{ node: 2, path: 'rotation', values: [0,0,0,1, s,0,0,s] }] }));
    e.sample(); sameRotation(quat(e.node(4)), [s,0,0,s]);
  } finally { await e.dispose(); }
});
test('VRMA blink is clamped, weighted, scoped to its mesh, and updates while paused', async () => {
  const e = env(); try {
    await e.model(); await e.motion(motionDocument({ expressions: { blink: {} }, channels: [{ expression: 'blink', path: 'translation', values: [-1,0,0, 2,0,0] }] }));
    const face = e.node(2), other = e.node(3); assert.ok(face instanceof Mesh);
    e.sample(0); assert.equal(face.geometry.morphWeights[0], 0);
    e.animationModule.update(0);
    const restWidth = face.geometry.positions[3] - face.geometry.positions[0];
    const otherWidth = other.geometry.positions[3] - other.geometry.positions[0];
    e.sample(0.25); assert.equal(face.geometry.morphWeights[0], 0, 'clamp after interpolation');
    e.sample(0.75); assert.equal(face.geometry.morphWeights[0], 0.5, 'clamp after interpolation');
    e.sample(1); assert.equal(face.geometry.morphWeights[0], 0.5); assert.equal(other.geometry.morphWeights[0], 0);
    e.animationModule.update(0);
    close([face.geometry.positions[3] - face.geometry.positions[0]], [restWidth * 0.5]);
    close([other.geometry.positions[3] - other.geometry.positions[0]], [otherWidth]);
    for (let i = 0; i < 10; i++) e.viewer.update(0.1);
    assert.equal(face.geometry.morphWeights[0], 0.5, 'paused updates cannot accumulate weights');
    e.viewer.stop(); assert.equal(face.geometry.morphWeights[0], 0);
  } finally { await e.dispose(); }
});
test('VRM 0 percent binds, split blink fallback, and binary expression thresholds work', async () => {
  for (const options of [{ legacy: true }, { splitBlink: true }, { binary: true }]) {
    const e = env(); try {
      await e.model(avatarDocument(options));
      await e.motion(motionDocument({ expressions: { blink: {} }, channels: [{ expression: 'blink', path: 'translation', values: [0,0,0, 1,0,0] }] }));
      e.sample(0.25); assert.equal(e.node(2).geometry.morphWeights[0], options.binary ? 0 : 0.125);
      e.sample(1); assert.equal(e.node(2).geometry.morphWeights[0], 0.5);
      if (options.splitBlink) assert.equal(e.node(3).geometry.morphWeights[0], 1);
    } finally { await e.dispose(); }
  }
});
test('STEP interpolation remains stepped for body and expression tracks', async () => {
  const e = env(); try {
    await e.model(); await e.motion(motionDocument({ expressions: { blink: {} }, channels: [
      { node: 1, path: 'rotation', values: [0,0,0,1, s,0,0,s], interpolation: 'STEP' },
      { expression: 'blink', path: 'translation', values: [0,0,0, 1,0,0], interpolation: 'STEP' },
    ] }));
    e.sample(0.9); sameRotation(quat(e.node(1)), [0,0,0,1]); assert.equal(e.node(2).geometry.morphWeights[0], 0);
    e.sample(1); sameRotation(quat(e.node(1)), [s,0,0,s]); assert.equal(e.node(2).geometry.morphWeights[0], 0.5);
  } finally { await e.dispose(); }
});
test('unsupported gaze fails explicitly; opt-in skip emits a diagnostic', async () => {
  const doc = motionDocument({ gaze: true, channels: [{ node: 1, path: 'rotation', values: [0,0,0,1, s,0,0,s] }, { gaze: true, path: 'rotation', values: [0,0,0,1, 0,s,0,s] }] });
  const e = env(); try { await e.model(); await assert.rejects(e.motion(doc), /gaze tracks/); assert.equal(e.viewer.getSnapshot().clips.length, 0); } finally { await e.dispose(); }
  const skip = env({ vrma: { unsupportedFeatures: 'skip' } }); try {
    await skip.model(); await skip.motion(doc); assert.equal(skip.viewer.getSnapshot().clips.length, 1); assert.ok(skip.diagnostics.some(value => value.includes('Skipped')));
  } finally { await skip.dispose(); }
});
test('source-avatar-specific unmapped VRMA nodes can be skipped without losing humanoid motion', async () => {
  const doc = motionDocument({
    nodes: [
      { translation: [0,1,0], children: [1,2] },
      { translation: [0,1,0] },
      { name: 'J_Sec_L_Bust1' },
    ],
    channels: [
      { node: 1, path: 'rotation', values: [0,0,0,1, s,0,0,s] },
      { node: 2, path: 'rotation', values: [0,0,0,1, 0,s,0,s] },
    ],
  });
  const strict = env(); try {
    await strict.model();
    await assert.rejects(strict.motion(doc), /non-portable node 2/);
  } finally { await strict.dispose(); }
  const compatible = env({ vrma: { unmappedNodes: 'skip' } }); try {
    await compatible.model(); await compatible.motion(doc); compatible.sample(1);
    sameRotation(quat(compatible.node(1)), [s,0,0,s]);
    assert.ok(compatible.diagnostics.some(value => value.includes('non-portable node 2') && value.includes('J_Sec_L_Bust1')));
  } finally { await compatible.dispose(); }
});

test('source-specific VRMA nodes pass through only on exact name, rest pose, and hierarchy matches', async () => {
  const avatar = avatarDocument();
  const secondary = avatar.nodes.length;
  avatar.nodes.push({ name: 'J_Sec_L_Bust1', translation: [0.1,0.2,0.3] });
  avatar.nodes[1].children = [...(avatar.nodes[1].children ?? []), secondary];
  const motion = motionDocument({
    nodes: [
      { translation: [0,1,0], children: [1] },
      { translation: [0,1,0], children: [2] },
      { name: 'J_Sec_L_Bust1', translation: [0.1,0.2,0.3] },
    ],
    channels: [
      { node: 1, path: 'rotation', values: [0,0,0,1, s,0,0,s] },
      { node: 2, path: 'rotation', values: [0,0,0,1, 0,s,0,s] },
    ],
  });
  const exact = env({ vrma: { unmappedNodes: 'exact-match' } }); try {
    await exact.model(avatar); await exact.motion(motion); exact.sample(1);
    sameRotation(quat(exact.node(1)), [s,0,0,s]);
    sameRotation(quat(exact.node(secondary)), [0,s,0,s]);
    assert.ok(exact.diagnostics.some(value => value.includes('Preserved 1 source-specific VRMA channel')));
  } finally { await exact.dispose(); }

  const changedAvatar = structuredClone(avatar);
  changedAvatar.nodes[secondary].translation = [0.4,0.2,0.3];
  const mismatch = env({ vrma: { unmappedNodes: 'exact-match' } }); try {
    await mismatch.model(changedAvatar); await mismatch.motion(motion); mismatch.sample(1);
    sameRotation(quat(mismatch.node(1)), [s,0,0,s]);
    sameRotation(quat(mismatch.node(secondary)), [0,0,0,1]);
    assert.ok(mismatch.diagnostics.some(value => value.includes('Skipped: VRMA animation targets non-portable node 2')));
  } finally { await mismatch.dispose(); }
});

test('material expression bindings are rejected rather than approximated as morph-only', async () => {
  const e = env(); try {
    await e.model(avatarDocument({ material: true }));
    await assert.rejects(e.motion(motionDocument({ expressions: { blink: {} }, channels: [{ expression: 'blink', path: 'translation', values: [0,0,0, 1,0,0] }] })), /material\/texture/);
  } finally { await e.dispose(); }
});
test('bad VRMA input cannot alter the current clip library', async () => {
  const e = env(); try {
    await e.model(); await e.motion();
    const cases = [
      [motionDocument({ version: '1.0-draft' }), /specVersion/],
      [motionDocument({ channels: [{ node: 1, path: 'translation', values: [0,1,0, 0,2,0] }] }), /only on the hips/],
      [motionDocument({ channels: [{ node: 1, path: 'rotation', values: [0,0,0,1, s,0,0,s], interpolation: 'CUBICSPLINE' }] }), /CUBICSPLINE/],
      [motionDocument({ channels: [{ node: 1, path: 'rotation', values: [0,0,0,0, 0,0,0,1] }] }), /quaternion/],
      [motionDocument({ channels: [{ node: 1, path: 'rotation', times: [0,0], values: [0,0,0,1, s,0,0,s] }] }), /strictly increasing/],
    ];
    for (const [doc, pattern] of cases) { await assert.rejects(e.motion(doc), pattern); assert.equal(e.viewer.getSnapshot().clips.length, 1); }
  } finally { await e.dispose(); }
});
test('STEP changes at an interior key exactly, not one frame afterward', async () => {
  const e = env(); try {
    await e.model(); await e.motion(motionDocument({ expressions: { blink: {} }, channels: [
      { node: 1, path: 'rotation', times: [0,0.5,1], values: [0,0,0,1, s,0,0,s, 0,0,0,1], interpolation: 'STEP' },
      { expression: 'blink', path: 'translation', times: [0,0.5,1], values: [0,0,0, 1,0,0, 0,0,0], interpolation: 'STEP' },
    ] }));
    e.sample(0.5); sameRotation(quat(e.node(1)), [s,0,0,s]); assert.equal(e.node(2).geometry.morphWeights[0], 0.5);
    e.sample(0.49); sameRotation(quat(e.node(1)), [0,0,0,1]); assert.equal(e.node(2).geometry.morphWeights[0], 0);
  } finally { await e.dispose(); }
});
test('animated expressions obey overrideBlink blocking', async () => {
  const e = env(); try {
    const avatar = avatarDocument(); avatar.extensions.VRMC_vrm.expressions.preset.happy = { overrideBlink: 'block', morphTargetBinds: [] };
    await e.model(avatar); await e.motion(motionDocument({ expressions: { blink: {}, happy: {} }, channels: [
      { expression: 'blink', path: 'translation', values: [1,0,0, 1,0,0] },
      { expression: 'happy', path: 'translation', values: [0,0,0, 1,0,0] },
    ] }));
    e.sample(0); assert.equal(e.node(2).geometry.morphWeights[0], 0.5);
    e.sample(1); assert.equal(e.node(2).geometry.morphWeights[0], 0);
  } finally { await e.dispose(); }
});
test('non-uniform/mirrored rest scale and zero hips height are rejected clearly', async () => {
  const e = env(); try {
    await e.model();
    for (const scale of [[2,1,1], [-1,1,1]]) {
      const doc = motionDocument(); doc.nodes[0].scale = scale;
      await assert.rejects(e.motion(doc), /uniform rig scale|mirrored/);
    }
    const doc = motionDocument({ channels: [{ node: 0, path: 'translation', values: [0,0,0, 1,0,0] }] }); doc.nodes[0].translation = [0,0,0];
    await assert.rejects(e.motion(doc), /positive source and target/);
  } finally { await e.dispose(); }
});
test('unload aborts an actual in-flight VRMA fetch and releases its model', async () => {
  let received;
  const requested = new Promise(resolve => { received = resolve; });
  const server = createServer((_request, response) => received(response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const e = env();
  try {
    await e.model();
    const loading = e.viewer.loadAnimation({ url: `http://127.0.0.1:${server.address().port}/motion.vrma`, format: 'vrma' });
    const rejected = assert.rejects(loading);
    const response = await requested;
    e.viewer.unload(); response.end(packDocument(motionDocument())); await rejected;
    assert.equal(e.viewer.getSnapshot().phase, 'empty'); assert.equal(e.viewer.getSnapshot().clips.length, 0); assert.equal(e.animationModule.bindings.size, 0);
  } finally { await e.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
