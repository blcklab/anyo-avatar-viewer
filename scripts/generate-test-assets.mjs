import { mkdir, writeFile } from 'node:fs/promises';
import { fixture } from '../tests/fixtures.mjs';
import { avatarDocument, motionDocument, packDocument } from '../tests/vrma-fixtures.mjs';
export function binaryFixture(options = {}) {
  const json = Buffer.from(fixture(options).split(',')[1], 'base64');
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, padded]);
}
if (process.argv[1]?.endsWith('generate-test-assets.mjs')) {
  const directory = new URL('../tests/assets/', import.meta.url); await mkdir(directory, { recursive: true });
  await writeFile(new URL('test-avatar.vrm', directory), binaryFixture());
  await writeFile(new URL('test-animation.glb', directory), binaryFixture({ embedded: true }));
  await writeFile(new URL('test-face.vrm', directory), packDocument(avatarDocument({ blinkWeight: 1 })));
  const motion = motionDocument({ expressions: { blink: {} }, channels: [
    { node: 1, path: 'rotation', times: [0,1,2,3,4], values: [0,0,0,1, 0,0,0.025,0.99968745, 0,0,0,1, 0,0,-0.025,0.99968745, 0,0,0,1] },
    { expression: 'blink', path: 'translation', times: [0,1.6,1.7,1.8,4], values: [0,0,0, 0,0,0, 1,0,0, 0,0,0, 0,0,0] },
  ] });
  motion.animations[0].name = 'Head motion + blink (test)';
  await writeFile(new URL('test-motion.vrma', directory), packDocument(motion));
  console.log('Generated synthetic skinned triangle fixtures; these are not production avatars.');
}
