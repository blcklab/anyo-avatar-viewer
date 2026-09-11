import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarVisualPreset } from '../dist/sekai64/visual.js';

test('character quality mirrors Sekai64 character image targets without forcing the unsafe global outline pass', () => {
  const preset = avatarVisualPreset('character');
  assert.equal(preset.imageQuality.renderScale, 1.25);
  assert.equal(preset.imageQuality.maxAnisotropy, 16);
  assert.equal(preset.imageQuality.msaaSamples, 4);
  assert.equal(preset.imageQuality.antialiasing, 'fxaa-high');
  assert.equal(preset.shadows.mapSize, 2048);
  assert.equal(preset.shadows.cascades, 2);
  assert.equal(preset.postProcessing?.outlines.enabled, false);
});

test('quality profiles scale predictably around character mode', () => {
  const performance = avatarVisualPreset('performance');
  const balanced = avatarVisualPreset('balanced');
  const character = avatarVisualPreset('character');
  const ultra = avatarVisualPreset('ultra');
  assert.ok(performance.imageQuality.renderScale < balanced.imageQuality.renderScale);
  assert.ok(balanced.imageQuality.renderScale < character.imageQuality.renderScale);
  assert.ok(character.imageQuality.renderScale < ultra.imageQuality.renderScale);
  assert.equal(performance.postProcessing?.enabled, false);
  assert.equal(ultra.shadows.mapSize, 4096);
  assert.equal(balanced.postProcessing?.outlines.enabled, false);
  assert.equal(character.postProcessing?.outlines.enabled, false);
  assert.equal(ultra.postProcessing?.outlines.enabled, false);
});


test('normalized MToon world-coordinate outlines scale while screen-coordinate outlines remain authored', async () => {
  const { compensateNormalizedMtoonOutlines } = await import('../dist/sekai64/mtoon-outline.js');
  const { Node, Mesh } = await import('@blcklab/sekai64');
  const { Geometry } = await import('@blcklab/sekai64/geometry');
  const { StandardMaterial } = await import('@blcklab/sekai64/materials');

  const root = new Node({ id: 'root' });
  const geometry = new Geometry({ positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]) });
  const world = new StandardMaterial({ shadingModel: 'mtoon', mtoon: { outlineWidthMode: 'worldCoordinates', outlineWidth: 0.05 } });
  const screen = new StandardMaterial({ shadingModel: 'mtoon', mtoon: { outlineWidthMode: 'screenCoordinates', outlineWidth: 0.05 } });
  root.add(new Mesh({ geometry, material: world }), new Mesh({ geometry, material: screen }));

  assert.equal(compensateNormalizedMtoonOutlines(root, 0.01), 1);
  assert.ok(Math.abs(world.mtoonOutlineWidth - 0.0005) < 1e-12);
  assert.equal(screen.mtoonOutlineWidth, 0.05);

  root.dispose();
});

test('sekai-viewer mode starts with Sekai Viewer PRODUCT preset before model detection', async () => {
  const { PRODUCT_VISUAL_PRESET } = await import('@blcklab/sekai64/renderer');
  const preset = avatarVisualPreset('sekai-viewer');
  assert.equal(preset, PRODUCT_VISUAL_PRESET);
  assert.equal(preset.imageQuality.renderScale, PRODUCT_VISUAL_PRESET.imageQuality.renderScale);
});

test('sekai-viewer mode switches to CHARACTER only for an MToon model', async () => {
  const { Node, Mesh } = await import('@blcklab/sekai64');
  const { Geometry } = await import('@blcklab/sekai64/geometry');
  const { StandardMaterial } = await import('@blcklab/sekai64/materials');
  const { CHARACTER_VISUAL_PRESET, PRODUCT_VISUAL_PRESET } = await import('@blcklab/sekai64/renderer');

  const scene = new Node({ id: 'fake-scene' });
  const geometry = new Geometry({ positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]) });
  const mtoon = new StandardMaterial({ shadingModel: 'mtoon' });
  scene.add(new Mesh({ name: 'character', geometry, material: mtoon }));
  const fakeMtoonModel = { asset: { scene: { findByTag: () => scene.children } } };
  assert.equal(avatarVisualPreset('sekai-viewer', fakeMtoonModel), CHARACTER_VISUAL_PRESET);

  const standard = new StandardMaterial({ shadingModel: 'metallic-roughness' });
  const productMesh = new Mesh({ name: 'product', geometry, material: standard });
  const fakeProductModel = { asset: { scene: { findByTag: () => [productMesh] } } };
  assert.equal(avatarVisualPreset('sekai-viewer', fakeProductModel), PRODUCT_VISUAL_PRESET);

  productMesh.dispose();
  scene.dispose();
});
