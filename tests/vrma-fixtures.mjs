import { fixture } from './fixtures.mjs';
export function packDocument(document) {
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}
export function dataUrl(document) { return 'data:application/octet-stream;base64,' + packDocument(document).toString('base64'); }
function addAccessor(doc, values, type) {
  const data = new Float32Array(values);
  const buffer = Buffer.from(data.buffer);
  const index = doc.buffers.length;
  doc.buffers.push({ byteLength: buffer.length, uri: 'data:application/octet-stream;base64,' + buffer.toString('base64') });
  doc.bufferViews.push({ buffer: index, byteLength: buffer.length });
  doc.accessors.push({ bufferView: doc.bufferViews.length - 1, componentType: 5126, type, count: values.length / ({ SCALAR: 1, VEC3: 3, VEC4: 4 }[type]) });
  return doc.accessors.length - 1;
}
export function avatarDocument({ height = 2, headRotation, parentRotation, duplicateNames = false, legacy = false, blinkWeight = 0.5, binary = false, material = false, splitBlink = false, finger = false } = {}) {
  const doc = JSON.parse(Buffer.from(fixture().split(',')[1], 'base64').toString());
  doc.nodes[0].translation = [0, height, 0];
  if (headRotation) doc.nodes[1].rotation = headRotation;
  if (duplicateNames) for (const node of doc.nodes) node.name = 'Repeated';
  if (parentRotation) { doc.nodes.push({ name: 'Wrapper', rotation: parentRotation, children: [0] }); doc.scenes[0].nodes = [3, 2]; }
  const morph = addAccessor(doc, [0,0,0, -0.2,0,0, 0,-0.2,0], 'VEC3');
  doc.meshes[0].primitives[0].targets = [{ POSITION: morph }];
  // Another mesh with the same morph index must not be driven by Face's blink.
  const other = doc.nodes.length;
  doc.nodes.push({ name: 'OtherMesh', mesh: 1, translation: [-0.5,0,0] });
  doc.meshes.push(structuredClone(doc.meshes[0])); doc.scenes[0].nodes.push(other);
  const blink = { isBinary: binary, morphTargetBinds: [{ node: 2, index: 0, weight: blinkWeight }] };
  if (material) blink.materialColorBinds = [{ material: 0, type: 'color', targetValue: [1,1,1,1] }];
  doc.extensions.VRMC_vrm.expressions = { preset: splitBlink ? { blinkLeft: blink, blinkRight: { ...blink, morphTargetBinds: [{ node: other, index: 0, weight: 1 }] } } : { blink } };
  if (finger) {
    const index = doc.nodes.length; doc.nodes.push({ name: 'finger-with-arbitrary-name', translation: [0.1,0.2,0] });
    doc.nodes[0].children.push(index); doc.extensions.VRMC_vrm.humanoid.humanBones.leftIndexProximal = { node: index };
  }
  if (legacy) doc.extensions = { VRM: {
    humanoid: { humanBones: [{ bone: 'hips', node: 0 }, { bone: 'head', node: 1 }] },
    blendShapeMaster: { blendShapeGroups: [{ presetName: 'blink', isBinary: binary, binds: [{ mesh: 0, index: 0, weight: blinkWeight * 100 }] }] },
  } };
  return doc;
}
export function motionDocument({ nodes, bones, expressions = {}, channels, version = '1.0', gaze = false } = {}) {
  const doc = { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
    nodes: nodes ?? [{ translation: [0,1,0], children: [1] }, { translation: [0,1,0] }],
    buffers: [], bufferViews: [], accessors: [],
    extensionsUsed: ['VRMC_vrm_animation'], extensions: { VRMC_vrm_animation: {
      specVersion: version, humanoid: { humanBones: bones ?? { hips: { node: 0 }, head: { node: 1 } } }, expressions: { preset: {} },
    } }, animations: [{ name: 'VRMA test', channels: [], samplers: [] }],
  };
  for (const [name, input] of Object.entries(expressions)) {
    const index = doc.nodes.length; doc.nodes.push({ name }); doc.scenes[0].nodes.push(index);
    doc.extensions.VRMC_vrm_animation.expressions.preset[name] = { node: index };
  }
  if (gaze) { const node = doc.nodes.length; doc.nodes.push({}); doc.scenes[0].nodes.push(node); doc.extensions.VRMC_vrm_animation.lookAt = { node }; }
  const list = channels ?? [{ node: 1, path: 'rotation', values: [0,0,0,1, Math.SQRT1_2,0,0,Math.SQRT1_2] }];
  for (const channel of list) {
    let node = channel.node;
    if (channel.expression) node = doc.extensions.VRMC_vrm_animation.expressions.preset[channel.expression].node;
    if (channel.gaze) node = doc.extensions.VRMC_vrm_animation.lookAt.node;
    const input = addAccessor(doc, channel.times ?? [0,1], 'SCALAR');
    const output = addAccessor(doc, channel.values, channel.path === 'rotation' ? 'VEC4' : 'VEC3');
    doc.animations[0].samplers.push({ input, output, interpolation: channel.interpolation ?? 'LINEAR' });
    doc.animations[0].channels.push({ sampler: doc.animations[0].samplers.length - 1, target: { node, path: channel.path } });
  }
  return doc;
}
