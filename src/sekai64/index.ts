import { createEngine, createScene, PerspectiveCamera, type EngineOptions } from '@blcklab/sekai64';
import { createAnimationRendererModule } from '@blcklab/sekai64/animation';
import { createAvatarViewer, type AvatarViewer } from '../index.js';
import {
  createSekai64Backend,
  type Sekai64AvatarNormalization,
  type Sekai64BackendOptions,
} from './backend.js';
import {
  Sekai64AvatarVisualController,
  avatarVisualPreset,
  type Sekai64AvatarEnvironment,
  type Sekai64AvatarQuality,
  type Sekai64AvatarBackground,
} from './visual.js';
import { Sekai64AvatarCameraController } from './camera.js';
import { Sekai64AvatarRecoveryController } from './recovery.js';
export { createSekai64Backend } from './backend.js';
export type { Sekai64AvatarNormalization, Sekai64BackendOptions } from './backend.js';
export { createGltfClipImporter } from './importers.js';
export type { Sekai64AnimationImporter, AnimationImportContext, TargetNode } from './importers.js';
export type { VrmTargetRig } from './importers.js';
export { createVrmAnimationImporter } from './vrma.js';
export type { VrmAnimationImporterOptions } from './vrma.js';
export { Sekai64AvatarVisualController, avatarVisualPreset, usesCharacterRendering } from './visual.js';
export { compensateNormalizedMtoonOutlines } from './mtoon-outline.js';
export type { Sekai64AvatarEnvironment, Sekai64AvatarQuality, Sekai64AvatarBackground, Sekai64AvatarVisualOptions } from './visual.js';
export { Sekai64AvatarCameraController } from './camera.js';
export type { Sekai64AvatarCameraOptions, Sekai64AvatarCameraSnapshot } from './camera.js';
export type { Sekai64FocusPreset } from './model-info.js';
export { Sekai64AvatarRecoveryController } from './recovery.js';
export type { Sekai64RecoverySnapshot, Sekai64RecoveryStatus, Sekai64AvatarRecoveryOptions } from './recovery.js';

export interface Sekai64ViewerOptions extends Pick<Sekai64BackendOptions, 'importers' | 'targetHeight' | 'normalization' | 'onDiagnostic' | 'vrma'> {
  readonly canvas: EngineOptions['canvas'];
  readonly backend?: 'auto' | 'webgl2' | 'webgpu';
  readonly autoStart?: boolean;
  readonly pixelRatio?: number;
  readonly maxPixelRatio?: number;
  /** Defaults to `sekai-viewer`, which mirrors Sekai Viewer 0.1.10's model-aware visual path. */
  readonly quality?: Sekai64AvatarQuality;
  /** Prefiltered procedural image-based lighting. Defaults to studio. */
  readonly environment?: Sekai64AvatarEnvironment;
  readonly background?: Sekai64AvatarBackground;
  /** Allow the canvas alpha channel for transparent/card overlays. Defaults to false. */
  readonly transparent?: boolean;
  readonly exposure?: number;
  readonly shadows?: boolean;
  /** Built-in headless orbit/zoom/pan/focus controller. Defaults to true. */
  readonly navigation?: boolean;
  /** Middle/right drag pan when the render surface accepts pointer events. Defaults to true. */
  readonly pointerPan?: boolean;
  /** Fit the camera whenever a model becomes active. Defaults to true. */
  readonly autoFit?: boolean;
  readonly autoRotate?: boolean;
  readonly autoRotateSpeed?: number;
  /** Automatic WebGL/WebGPU renderer recovery. Defaults to true. */
  readonly recovery?: boolean | { readonly maxAttempts?: number };
}

/** Browser convenience factory; no custom element, framework, controls UI, or global CSS. */
export async function createSekai64AvatarViewer(options: Sekai64ViewerOptions) {
  const animation = createAnimationRendererModule();
  let viewer: AvatarViewer | undefined;
  const quality = options.quality ?? 'sekai-viewer';
  const preset = avatarVisualPreset(quality);
  const exact = quality === 'sekai-viewer';
  const engine = await createEngine({
    canvas: options.canvas,
    renderer: options.backend ?? 'auto',
    antialias: true,
    alpha: options.transparent ?? false,
    autoResize: true,
    pixelRatio: options.pixelRatio,
    maxPixelRatio: options.maxPixelRatio ?? 2,
    colorManagement: { ...preset.colorManagement, exposure: options.exposure ?? preset.colorManagement.exposure },
    environmentLighting: preset.environmentLighting,
    shadows: {
      ...preset.shadows,
      enabled: options.shadows ?? true,
      ...(exact ? { mapSize: Math.min(2048, preset.shadows.mapSize) } : {}),
    },
    imageQuality: exact
      ? { ...preset.imageQuality, maxAnisotropy: Math.max(8, preset.imageQuality.maxAnisotropy) }
      : preset.imageQuality,
    postProcessing: preset.postProcessing,
    colorGrading: {
      enabled: true,
      saturation: 1.015,
      contrast: 1.035,
      brightness: 0,
      temperature: 0.01,
      tint: 0,
      vignette: 0.055,
      vignetteSoftness: 0.72,
      highlightGlow: 0.025,
      highlightThreshold: 1.25,
      lutIntensity: 1,
    },
    optimization: {
      frustumCulling: true,
      cachedBounds: true,
      pipelineSorting: true,
      shadowCasterCulling: true,
      staticBatching: true,
    },
    modules: [{ id: animation.id, version: animation.version, setup(context) {
      const instance = animation.setup(context);
      return { ...instance, update(frame) {
        viewer?.update(frame.deltaTime);
        // Sample -> blend -> deform -> camera -> render. Never advance a mixer twice.
        instance.update?.({ ...frame, deltaTime: Math.min(frame.deltaTime, 0.1) });
      } };
    } }],
  });

  const scene = createScene({ name: 'Anyo Avatar Viewer Scene', autoDisposeResources: true });
  const camera = new PerspectiveCamera({ fieldOfView: 42, near: 0.01, far: 10000, autoAspect: true });
  camera.position.set(3.4, 2.15, 4.2);
  const visuals = new Sekai64AvatarVisualController(engine, scene, {
    quality,
    environment: options.environment ?? 'studio',
    background: options.transparent ? [0, 0, 0, 0] as const : (options.background ?? '#0a0c10'),
    exposure: options.exposure,
    shadows: options.shadows ?? true,
  });
  const eventTarget = asEventTarget(engine.canvas);
  const navigation = new Sekai64AvatarCameraController({
    camera,
    eventTarget: options.navigation === false ? undefined : eventTarget,
    pointerPan: options.pointerPan ?? true,
    autoFit: options.autoFit ?? true,
  });
  if (options.navigation === false) navigation.setEnabled(false);
  navigation.setAutoRotate(options.autoRotate ?? false);
  if (options.autoRotateSpeed !== undefined) navigation.setAutoRotateSpeed(options.autoRotateSpeed);

  const normalization: Sekai64AvatarNormalization = options.normalization ?? (options.targetHeight !== undefined ? 'target-height' : 'preserve');
  const backend = createSekai64Backend({
    ...options,
    normalization,
    scene,
    animationModule: animation,
    onModelReady(model) { options.onDiagnostic?.(`Prepared avatar model ${model.name || model.id}.`); },
    onModelMounted(model) { visuals.updateFromModel(model); navigation.attachModel(model); },
    onModelDisposed(model) { navigation.detachModel(model); },
  });

  let desiredRunning = options.autoStart !== false;
  let disposed = false;
  const frame = ({ deltaTime }: { deltaTime: number }) => {
    navigation.update(deltaTime);
    engine.render(scene, camera);
  };
  const startEngine = () => { if (!disposed) engine.start(frame); };
  const suspendEngine = () => engine.stop();
  const resumeEngine = () => { if (desiredRunning && !disposed) startEngine(); };
  const recovery = new Sekai64AvatarRecoveryController(engine, {
    maxAttempts: typeof options.recovery === 'object' ? options.recovery.maxAttempts : undefined,
    onDiagnostic: options.onDiagnostic,
    suspend: suspendEngine,
    resume: resumeEngine,
    refresh: () => visuals.refresh(),
    automatic: options.recovery !== false,
  });

  viewer = createAvatarViewer({ backend: {
    loadModel: (source, signal) => backend.loadModel(source, signal),
    async dispose() {
      if (disposed) return;
      disposed = true; desiredRunning = false;
      engine.stop();
      recovery.dispose();
      navigation.dispose();
      await backend.dispose();
      visuals.dispose();
      scene.dispose();
      camera.dispose();
      await engine.disposeAsync();
    },
  } });
  const controller = viewer;
  const start = () => {
    if (controller.getSnapshot().phase === 'disposed') throw new Error('Viewer is disposed.');
    desiredRunning = true;
    if (recovery.getSnapshot().status === 'ready') startEngine();
  };
  const stop = () => { desiredRunning = false; engine.stop(); };
  if (desiredRunning) start();

  return {
    viewer: controller,
    /** Shared Sekai64 animation module. Host scene layers may attach animated GLB props to the same frame owner. */
    animation,
    engine,
    scene,
    camera,
    navigation,
    visuals,
    recovery,
    start,
    stop,
    dispose: () => controller.dispose(),
  };
}

function asEventTarget(value: unknown): EventTarget | undefined {
  return value && typeof (value as EventTarget).addEventListener === 'function' ? value as EventTarget : undefined;
}
