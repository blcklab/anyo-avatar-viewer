/**
 * First-class browser/vanilla-JavaScript entry.
 *
 * This entry owns Sekai64 browser integration only. It intentionally contains no
 * framework adapter, custom element, global CSS, or application UI. React/Vue/
 * Svelte wrappers should depend on the same public runtime instead of reaching
 * into package internals.
 */
export {
  createSekai64AvatarViewer,
  createSekai64Backend,
  createGltfClipImporter,
  createVrmAnimationImporter,
  Sekai64AvatarVisualController,
  Sekai64AvatarCameraController,
  Sekai64AvatarRecoveryController,
  avatarVisualPreset,
  usesCharacterRendering,
  compensateNormalizedMtoonOutlines,
} from './sekai64/index.js';
export type {
  Sekai64ViewerOptions,
  Sekai64AvatarNormalization,
  Sekai64BackendOptions,
  Sekai64AnimationImporter,
  AnimationImportContext,
  TargetNode,
  VrmTargetRig,
  VrmAnimationImporterOptions,
  Sekai64AvatarEnvironment,
  Sekai64AvatarBackground,
  Sekai64AvatarQuality,
  Sekai64AvatarVisualOptions,
  Sekai64AvatarCameraOptions,
  Sekai64AvatarCameraSnapshot,
  Sekai64FocusPreset,
  Sekai64RecoverySnapshot,
  Sekai64RecoveryStatus,
  Sekai64AvatarRecoveryOptions,
} from './sekai64/index.js';
