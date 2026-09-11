export function fixture({ embedded = false, offset = 0, name = 'Hips', invalidVrm = false, extraParent = false } = {}) {
  const buffers = [], views = [], accessors = [];
  function accessor(data, type, componentType = 5126) {
    const bytes = Buffer.from(data.buffer); const offset = buffers.reduce((n, b) => n + b.length, 0);
    buffers.push(bytes); views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    const sizes = { SCALAR: 1, VEC3: 3, VEC4: 4 };
    accessors.push({ bufferView: views.length - 1, componentType, count: data.length / sizes[type], type }); return accessors.length - 1;
  }
  const positions = accessor(new Float32Array([0,0,0, 0.2,0,0, 0,0.2,0]), 'VEC3');
  const joints = accessor(new Uint16Array(12), 'VEC4', 5123);
  const weights = accessor(new Float32Array([1,0,0,0, 1,0,0,0, 1,0,0,0]), 'VEC4');
  const time = accessor(new Float32Array([0, 1]), 'SCALAR');
  const translations = accessor(new Float32Array([0,0,0, 1,0,0]), 'VEC3');
  const doc = { asset: { version: '2.0' }, scene: 0,
    scenes: [{ nodes: extraParent ? [3, 2] : [0, 2] }],
    nodes: [{ name, translation: [offset,0,0], children: [1] }, { name: 'Head', translation: [0,1,0] }, { name: 'Body', mesh: 0, skin: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: positions, JOINTS_0: joints, WEIGHTS_0: weights } }] }],
    skins: [{ joints: [0] }],
    animations: embedded ? [{ name: 'Move', samplers: [{ input: time, output: translations }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }] : [],
    extensions: invalidVrm ? {} : { VRMC_vrm: { specVersion: '1.0', humanoid: { humanBones: { hips: { node: 0 }, head: { node: 1 } } } } },
    buffers: [{ byteLength: buffers.reduce((n, b) => n + b.length, 0), uri: 'data:application/octet-stream;base64,' + Buffer.concat(buffers).toString('base64') }],
    bufferViews: views, accessors,
  };
  if (extraParent) doc.nodes.push({ name: 'Extra', children: [0] });
  return 'data:application/json;base64,' + Buffer.from(JSON.stringify(doc)).toString('base64');
}
