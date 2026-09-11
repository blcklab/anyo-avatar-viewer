import { AmbientLight, Box3, DirectionalLight, Mesh, PointLight, Vector3, type Engine, type Scene } from '@blcklab/sekai64';
import type { GltfModelNode } from '@blcklab/sekai64/gltf';
import { StandardMaterial } from '@blcklab/sekai64/materials';
import {
  createProceduralSky,
  packPrefilteredEnvironment,
  prefilterEnvironment,
} from '@blcklab/sekai64/environment-authoring';
import {
  CHARACTER_VISUAL_PRESET,
  DEFAULT_POST_PROCESSING,
  PRODUCT_VISUAL_PRESET,
  type RendererVisualQualityPreset,
} from '@blcklab/sekai64/renderer';

export type Sekai64AvatarQuality = 'sekai-viewer' | 'performance' | 'balanced' | 'character' | 'ultra';
export type Sekai64AvatarEnvironment = 'studio' | 'soft' | 'none';
export type Sekai64AvatarBackground = string | number | readonly [number, number, number] | readonly [number, number, number, number];

export interface Sekai64AvatarVisualOptions {
  readonly quality?: Sekai64AvatarQuality;
  readonly environment?: Sekai64AvatarEnvironment;
  readonly background?: Sekai64AvatarBackground;
  readonly exposure?: number;
  readonly shadows?: boolean;
}

const DISABLED_POST_PROCESSING = Object.freeze({
  ...DEFAULT_POST_PROCESSING,
  enabled: false,
  ssao: Object.freeze({ ...DEFAULT_POST_PROCESSING.ssao, enabled: false }),
  bloom: Object.freeze({ ...DEFAULT_POST_PROCESSING.bloom, enabled: false }),
  outlines: Object.freeze({ ...DEFAULT_POST_PROCESSING.outlines, enabled: false }),
});

/**
 * Sekai64's CHARACTER preset enables a global inverted-hull outline pass.
 * Some real VRM assets already carry authored MToon outlines and can produce a
 * dramatically inflated silhouette when that second pass is enabled at engine
 * creation time. Sekai Viewer Exact keeps upstream behavior verbatim; the
 * tunable Avatar Viewer profiles keep the same character lighting/AA/shadows
 * but rely on the model's authored MToon outline instead of forcing a second
 * global outline pass.
 */
const SAFE_CHARACTER_POST_PROCESSING = Object.freeze({
  ...CHARACTER_VISUAL_PRESET.postProcessing!,
  enabled: Boolean(
    CHARACTER_VISUAL_PRESET.postProcessing?.ssao.enabled ||
    CHARACTER_VISUAL_PRESET.postProcessing?.bloom.enabled
  ),
  outlines: Object.freeze({
    ...CHARACTER_VISUAL_PRESET.postProcessing!.outlines,
    enabled: false,
  }),
});

const SAFE_CHARACTER_PRESET: Readonly<RendererVisualQualityPreset> = Object.freeze({
  ...CHARACTER_VISUAL_PRESET,
  postProcessing: SAFE_CHARACTER_POST_PROCESSING,
});

const BALANCED_PRESET: Readonly<RendererVisualQualityPreset> = Object.freeze({
  colorManagement: CHARACTER_VISUAL_PRESET.colorManagement,
  environmentLighting: Object.freeze({ ...CHARACTER_VISUAL_PRESET.environmentLighting, intensity: 0.58 }),
  shadows: Object.freeze({ ...CHARACTER_VISUAL_PRESET.shadows, mapSize: 1024, cascades: 1, filter: 'pcf3' }),
  imageQuality: Object.freeze({
    ...CHARACTER_VISUAL_PRESET.imageQuality,
    renderScale: 1.1,
    maxAnisotropy: 8,
    antialiasing: 'fxaa',
    sharpen: 0.04,
  }),
  postProcessing: SAFE_CHARACTER_POST_PROCESSING,
});

const PERFORMANCE_PRESET: Readonly<RendererVisualQualityPreset> = Object.freeze({
  colorManagement: CHARACTER_VISUAL_PRESET.colorManagement,
  environmentLighting: Object.freeze({ ...CHARACTER_VISUAL_PRESET.environmentLighting, intensity: 0.48 }),
  shadows: Object.freeze({ ...CHARACTER_VISUAL_PRESET.shadows, mapSize: 1024, cascades: 1, filter: 'pcf3', softness: 0.8 }),
  imageQuality: Object.freeze({
    ...CHARACTER_VISUAL_PRESET.imageQuality,
    renderScale: 1,
    maxAnisotropy: 4,
    msaaSamples: 1,
    antialiasing: 'fxaa',
    sharpen: 0.025,
  }),
  postProcessing: DISABLED_POST_PROCESSING,
});

const ULTRA_PRESET: Readonly<RendererVisualQualityPreset> = Object.freeze({
  colorManagement: CHARACTER_VISUAL_PRESET.colorManagement,
  environmentLighting: Object.freeze({ ...CHARACTER_VISUAL_PRESET.environmentLighting, intensity: 0.68 }),
  shadows: Object.freeze({ ...CHARACTER_VISUAL_PRESET.shadows, mapSize: 4096, cascades: 3, filter: 'pcf5' }),
  imageQuality: Object.freeze({
    ...CHARACTER_VISUAL_PRESET.imageQuality,
    renderScale: 1.5,
    maxAnisotropy: 16,
    msaaSamples: 4,
    antialiasing: 'fxaa-high',
    sharpen: 0.04,
  }),
  postProcessing: SAFE_CHARACTER_POST_PROCESSING,
});

/**
 * Resolves the renderer preset for Avatar Viewer.
 * `sekai-viewer` mirrors Sekai Viewer 0.1.10 exactly: PRODUCT before a model is
 * known, then CHARACTER only when the loaded model actually uses MToon.
 */
export function avatarVisualPreset(
  quality: Sekai64AvatarQuality,
  model?: GltfModelNode,
): Readonly<RendererVisualQualityPreset> {
  switch (quality) {
    case 'sekai-viewer': return model && usesCharacterRendering(model) ? CHARACTER_VISUAL_PRESET : PRODUCT_VISUAL_PRESET;
    case 'performance': return PERFORMANCE_PRESET;
    case 'balanced': return BALANCED_PRESET;
    case 'ultra': return ULTRA_PRESET;
    default: return SAFE_CHARACTER_PRESET;
  }
}

/** Framework-neutral visual pipeline; Vue/React/etc. only expose these controls. */
export class Sekai64AvatarVisualController {
  private quality: Sekai64AvatarQuality;
  private environment: Sekai64AvatarEnvironment;
  private exposure?: number;
  private shadows: boolean;
  private background: Sekai64AvatarBackground;
  private model?: GltfModelNode;
  private readonly ambient: AmbientLight;
  private readonly key: DirectionalLight;
  private readonly fill: PointLight;
  private readonly rim: PointLight;
  private disposed = false;

  constructor(private readonly engine: Engine, private readonly scene: Scene, options: Sekai64AvatarVisualOptions = {}) {
    this.quality = options.quality ?? 'sekai-viewer';
    this.environment = options.environment ?? 'studio';
    this.exposure = options.exposure;
    this.shadows = options.shadows ?? true;
    this.background = options.background ?? '#0a0c10';

    // Exact Sekai Viewer 0.1.10 studio rig.
    this.ambient = new AmbientLight({ color: '#dbe7ff', intensity: 0.11 });
    this.key = new DirectionalLight({ color: '#fff4e8', intensity: 3.1, direction: [-0.48, -1, -0.42] });
    this.key.castShadow = this.shadows;
    this.fill = new PointLight({ color: '#b9d7ff', intensity: 7, range: 16, decay: 2 });
    this.rim = new PointLight({ color: '#ffe2bf', intensity: 5, range: 14, decay: 2 });
    this.fill.position.set(-3.6, 2.5, 4.2);
    this.rim.position.set(3.4, 3.1, -4.1);
    this.scene.add(this.ambient, this.key, this.fill, this.rim);

    this.engine.setClearColor(this.background);
    this.applyQuality();
    this.applyEnvironment();
  }

  getQuality(): Sekai64AvatarQuality { return this.quality; }
  getEnvironment(): Sekai64AvatarEnvironment { return this.environment; }

  setQuality(quality: Sekai64AvatarQuality): void {
    this.assertAlive();
    this.quality = quality;
    this.applyQuality();
  }

  setEnvironment(environment: Sekai64AvatarEnvironment): void {
    this.assertAlive();
    this.environment = environment;
    this.applyEnvironment();
  }

  setBackground(color: Sekai64AvatarBackground): void {
    this.assertAlive();
    this.background = color;
    this.engine.setClearColor(color);
  }

  /** Reapply CPU-side visual state after renderer/device recovery. */
  refresh(): void {
    this.assertAlive();
    this.engine.setClearColor(this.background);
    this.applyQuality();
    this.applyEnvironment();
    if (this.model) this.updateFromModel(this.model);
  }

  setExposure(exposure: number | undefined): void {
    this.assertAlive();
    if (exposure !== undefined && (!Number.isFinite(exposure) || exposure < 0)) throw new Error('Exposure must be finite and non-negative.');
    this.exposure = exposure;
    this.applyQuality();
  }

  setShadows(enabled: boolean): void {
    this.assertAlive();
    this.shadows = enabled;
    this.key.castShadow = enabled;
    this.applyQuality();
  }

  /** Detect MToon exactly like Sekai Viewer and adapt its studio rig to model bounds. */
  updateFromModel(model: GltfModelNode): void {
    this.assertAlive();
    this.model = model;
    this.applyQuality();
    const bounds = getNodeWorldBounds(model);
    if (!bounds || bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const radius = Math.max(size.length() * 0.5, 0.5);
    this.fill.position.set(center.x - radius * 2.1, center.y + radius * 1.1, center.z + radius * 1.7);
    this.rim.position.set(center.x + radius * 1.7, center.y + radius * 1.45, center.z - radius * 1.8);
    this.fill.range = radius * 7;
    this.rim.range = radius * 7;
    this.fill.intensity = Math.max(2.5, radius * 1.8);
    this.rim.intensity = Math.max(2, radius * 1.45);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.model = undefined;
    this.engine.renderer.setEnvironmentMap(undefined);
    for (const light of [this.ambient, this.key, this.fill, this.rim]) {
      light.removeFromParent();
      light.dispose();
    }
  }

  private applyQuality(): void {
    const preset = avatarVisualPreset(this.quality, this.model);
    const exact = this.quality === 'sekai-viewer';
    this.engine.setColorManagement({ ...preset.colorManagement, exposure: this.exposure ?? preset.colorManagement.exposure });
    this.engine.setEnvironmentLighting(preset.environmentLighting);
    this.engine.setShadowOptions({
      ...preset.shadows,
      enabled: this.shadows,
      ...(exact ? { mapSize: Math.min(2048, preset.shadows.mapSize) } : {}),
    });
    this.engine.setImageQuality(exact
      ? { ...preset.imageQuality, maxAnisotropy: Math.max(8, preset.imageQuality.maxAnisotropy) }
      : preset.imageQuality);
    if (preset.postProcessing) this.engine.setPostProcessing(preset.postProcessing);
    else this.engine.setPostProcessing(DISABLED_POST_PROCESSING);
    this.engine.setColorGrading({
      enabled: this.quality !== 'performance',
      saturation: 1.015,
      contrast: 1.035,
      brightness: 0,
      temperature: 0.01,
      tint: 0,
      vignette: this.quality === 'ultra' ? 0.06 : 0.055,
      vignetteSoftness: 0.72,
      highlightGlow: this.quality === 'ultra' ? 0.035 : 0.025,
      highlightThreshold: 1.25,
      lutIntensity: 1,
    });
  }

  private applyEnvironment(): void {
    if (this.environment === 'none') {
      this.engine.renderer.setEnvironmentMap(undefined);
      return;
    }
    const soft = this.environment === 'soft';
    const sky = createProceduralSky({
      id: `sekai-viewer-${this.environment}`,
      width: 64,
      height: 32,
      zenithColor: soft ? [0.26, 0.3, 0.38] : [0.12, 0.17, 0.27],
      horizonColor: soft ? [0.72, 0.69, 0.64] : [0.88, 0.73, 0.56],
      groundColor: soft ? [0.08, 0.085, 0.095] : [0.025, 0.03, 0.045],
      sunColor: [1, 0.91, 0.78],
      sunDirection: [-0.42, 0.72, 0.36],
      sunAngularRadius: 0.12,
      sunIntensity: soft ? 5 : 9,
      haze: soft ? 0.48 : 0.28,
      cloudCoverage: 0,
      intensity: soft ? 0.72 : 0.9,
    });
    const filtered = prefilterEnvironment(sky, {
      diffuseWidth: 16,
      specularWidth: 32,
      levels: 5,
      diffuseSampleCount: 40,
      specularSampleCount: 48,
      brdfSize: 32,
      brdfSampleCount: 48,
    });
    this.engine.renderer.setEnvironmentMap(packPrefilteredEnvironment(filtered, {
      intensity: soft ? 0.78 : 0.92,
      exposure: 1,
      label: `Sekai Viewer ${this.environment}`,
    }));
    sky.dispose();
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('Avatar visual controller is disposed.');
  }
}

export function usesCharacterRendering(model: GltfModelNode): boolean {
  return model.asset.scene.findByTag('gltf-mesh').some(node =>
    node instanceof Mesh && node.material instanceof StandardMaterial && node.material.shadingModel === 'mtoon'
  );
}

function getNodeWorldBounds(root: GltfModelNode): Box3 | undefined {
  root.updateWorldFromRoot();
  const bounds = new Box3().makeEmpty();
  let found = false;
  root.traverse(node => {
    if (!(node instanceof Mesh) || node.geometry.disposed) return;
    const worldBounds = node.geometry.bounds.clone().applyMatrix4(node.worldMatrix);
    if (worldBounds.isEmpty()) return;
    bounds.expandByBox(worldBounds);
    found = true;
  });
  return found ? bounds : undefined;
}
