import { Mesh, type Scene, type Node } from '@blcklab/sekai64';
import { AnimationClip, SkinnedGeometry, createGltfAnimationAdapter, GLTF_ANIMATION_EXTENSION_ID, type AnimationRendererModule, type GltfAnimationSet } from '@blcklab/sekai64/animation';
import { ViewerAnimationTrack as AnimationTrack } from './AnimationTrack.js';
import { GltfLoader, type GltfModelNode } from '@blcklab/sekai64/gltf';
import { parseVrmMetadata } from '@blcklab/anyo-avatar/vrm';
import { Sekai64AvatarBinding } from '@blcklab/anyo-avatar/sekai64-binding';
import type { AvatarComponentConfig } from '@blcklab/anyo-avatar/contracts';
import type { AnimationSource, ModelSession, PreparedAnimations, ViewerBackend, ViewerBounds, ViewerExpressionState, ViewerLookAtOptions, ViewerLookAtState, ViewerVec3 } from '../types.js';
import { Playback } from './Playback.js';
import { createGltfClipImporter, prepareSource, type Sekai64AnimationImporter, type TargetNode } from './importers.js';
import { createVrmAnimationImporter, type VrmAnimationImporterOptions } from './vrma.js';
import { createVrmTargetRig } from './vrm-rig.js';
import { correctGltfRestRotations } from './rotation-compat.js';
import { compensateNormalizedMtoonOutlines } from './mtoon-outline.js';
import { getViewerBounds } from './model-info.js';

export type Sekai64AvatarNormalization = 'preserve' | 'target-height';

export interface Sekai64BackendOptions {
  readonly scene: Scene;
  readonly animationModule: AnimationRendererModule;
  readonly importers?: readonly Sekai64AnimationImporter[];
  /** Preserve authored model transforms for Sekai Viewer visual parity, or normalize to a target height. */
  readonly normalization?: Sekai64AvatarNormalization;
  /** Target height in meters. Supplying this without `normalization` implies `target-height`. */
  readonly targetHeight?: number;
  readonly vrma?: VrmAnimationImporterOptions;
  readonly onDiagnostic?: (message: string) => void;
  /** Internal/application hook after optional VRM normalization and before the session is mounted. */
  readonly onModelReady?: (model: GltfModelNode) => void;
  /** Fires only when a prepared model becomes the active mounted session. */
  readonly onModelMounted?: (model: GltfModelNode) => void;
  /** Fires when a mounted session is released; consumers should ignore non-current models. */
  readonly onModelDisposed?: (model: GltfModelNode) => void;
}
/** Scene and animation module are borrowed. This backend only disposes its own models. */
export function createSekai64Backend(options: Sekai64BackendOptions): ViewerBackend {
  if (options.targetHeight !== undefined && (!Number.isFinite(options.targetHeight) || options.targetHeight <= 0)) throw new Error('targetHeight must be finite and positive.');
  const normalization: Sekai64AvatarNormalization = options.normalization ?? (options.targetHeight !== undefined ? 'target-height' : 'preserve');
  let disposed = false;
  const sessions = new Set<ModelSession>();
  const loaders = new Set<GltfLoader>();
  const importers = [...(options.importers ?? []), createGltfClipImporter(), createVrmAnimationImporter(options.vrma)];
  return {
    async loadModel(source, signal) {
      if (disposed) throw new Error('Backend is disposed.');
      if (!['vrm', 'gltf', 'glb'].includes(source.format)) throw new Error(`Unsupported model format: ${source.format}`);
      const loader = new GltfLoader(); loaders.add(loader);
      const prepared = prepareSource(loader, source.url, source.format);
      let model: GltfModelNode | undefined;
      let binding: Sekai64AvatarBinding | undefined;
      try {
        signal.throwIfAborted();
        const animation = createGltfAnimationAdapter(options.animationModule, { createMixer: false });
        let indices: ReadonlyMap<number, readonly Node[]> = new Map();
        model = await loader.loadNode(prepared.url, { signal, staticBatching: true, animation: { ...animation, finalize(context) {
          correctGltfRestRotations(context);
          indices = new Map(context.nodes);
          return animation.finalize?.(context);
        } } });
        signal.throwIfAborted();
        if (disposed) throw new Error('Backend was disposed during loading.');
        const parsed = parseVrmMetadata(model.asset.document);
        if (source.format === 'vrm' && !parsed) throw new Error('The file contains no VRM 0.x or VRM 1.0 metadata.');
        for (const warning of parsed?.warnings ?? []) options.onDiagnostic?.(warning);
        const vrm = createVrmTargetRig(model, indices);
        const pose = capturePose(model);
        if (parsed) {
          const config: AvatarComponentConfig = {
            humanoid: true, bones: parsed.metadata.bones ?? {}, expressions: parsed.metadata.expressions ?? {},
            grounding: 'feet', forward: '-z', attachments: {}, locomotion: {},
            lookAt: { mode: 'disabled', eyes: true, head: true, neck: true, weight: 1, smoothing: 10, maxYaw: 60, maxPitch: 35 },
          };
          binding = new Sekai64AvatarBinding(model.id, model, config, parsed.metadata, undefined, () => {});
          if (normalization === 'target-height') {
            const targetHeight = options.targetHeight ?? 1.7;
            const sourceScale = [model.scale.x, model.scale.y, model.scale.z] as const;
            binding.normalize({ targetHeight, grounding: 'feet', forward: '-z' });
            const normalizationScale = resolveUniformNormalizationScale(sourceScale, [model.scale.x, model.scale.y, model.scale.z]);
            compensateNormalizedMtoonOutlines(model, normalizationScale, options.onDiagnostic);
          } else {
            options.onDiagnostic?.('Preserving authored VRM transform for Sekai Viewer visual parity.');
          }
        }
        options.onModelReady?.(model);
        const session = new Sekai64Session(model, loader, binding, pose, vrm, options, importers, () => { sessions.delete(session); loaders.delete(loader); });
        sessions.add(session);
        return session;
      } catch (error) { binding?.dispose(); model?.dispose(); pruneDisposedBindings(options.animationModule); loader.dispose(); loaders.delete(loader); throw error; }
      finally { prepared.dispose(); }
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const session of [...sessions]) session.dispose();
      for (const loader of loaders) loader.dispose();
      loaders.clear();
    },
  };
}

const EMPTY_EXPRESSIONS: ViewerExpressionState = Object.freeze({ available: Object.freeze([]), values: Object.freeze({}) });

class Bank implements PreparedAnimations {
  constructor(readonly clips: readonly AnimationClip[], readonly owner: object) {}
  dispose(): void { for (const clip of this.clips) clip.dispose(); }
}
class Sekai64Session implements ModelSession {
  private readonly library = new Map<string, AnimationClip>();
  private readonly playback: Playback;
  private sequence = 0;
  private disposed = false;
  private pending = new Set<AbortController>();
  private readonly bounds: ViewerBounds | null;
  constructor(
    private readonly model: GltfModelNode, private readonly loader: GltfLoader,
    private readonly binding: Sekai64AvatarBinding | undefined, private readonly pose: ReturnType<typeof capturePose>,
    private readonly vrm: ReturnType<typeof createVrmTargetRig>,
    private readonly options: Sekai64BackendOptions, private readonly importers: readonly Sekai64AnimationImporter[],
    private readonly onDispose: () => void,
  ) {
    this.playback = new Playback(model, pose.restore);
    this.bounds = getViewerBounds(model);
    const embedded = model.asset.getExtension<GltfAnimationSet>(GLTF_ANIMATION_EXTENSION_ID)?.clips ?? [];
    for (const [index, clip] of embedded.entries()) this.library.set(`embedded:${index}`, cloneClip(clip, `embedded:${index}`));
  }
  private mounted = false;
  get clips() { return [...this.library.values()].map(clip => ({ id: clip.id, name: clip.name, duration: clip.duration })); }
  mount(): void { this.alive(); this.options.scene.add(this.model); this.mounted = true; this.options.onModelMounted?.(this.model); }
  async prepareAnimations(source: AnimationSource, signal: AbortSignal): Promise<PreparedAnimations> {
    this.alive(); signal.throwIfAborted();
    const importer = this.importers.find(candidate => candidate.formats.includes(source.format));
    if (!importer) throw new Error(`Unsupported animation format: ${source.format}. FBX requires a separate importer and retargeter.`);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    this.pending.add(controller);
    let clips: readonly AnimationClip[] | undefined;
    try {
      clips = await importer.load({ source, signal: controller.signal, targets: this.pose.targets, vrm: this.vrm?.description, onDiagnostic: this.options.onDiagnostic });
      controller.signal.throwIfAborted(); this.alive();
      if (clips.length === 0) throw new Error('Importer returned no animation clips.');
      for (const clip of clips) validateClip(clip, this.pose.targets);
      return new Bank(clips, this);
    } catch (error) { for (const clip of clips ?? []) clip.dispose(); throw error; }
    finally { signal.removeEventListener('abort', abort); this.pending.delete(controller); }
  }
  installAnimations(prepared: PreparedAnimations): void {
    this.alive();
    if (!(prepared instanceof Bank) || prepared.owner !== this) throw new Error('Animation bank belongs to another model session.');
    const staged: AnimationClip[] = [];
    const namespace = `external:${this.sequence++}`;
    try {
      for (const [index, clip] of prepared.clips.entries()) staged.push(cloneClip(clip, `${namespace}:${index}`));
      for (const clip of staged) this.library.set(clip.id, clip);
    } catch (error) { for (const clip of staged) clip.dispose(); throw error; }
  }
  play(id: string, options: Parameters<ModelSession['play']>[1]) { this.alive(); const clip = this.library.get(id); if (!clip) throw new Error(`Unknown clip: ${id}`); this.vrm?.beginFrame(); this.playback.play(clip, options); this.evaluateAvatar(0); }
  pause() { this.playback.pause(); } resume() { this.playback.resume(); }
  stop() { this.vrm?.beginFrame(); this.playback.stop(); this.evaluateAvatar(0); }
  seek(seconds: number) { this.vrm?.beginFrame(); this.playback.seek(seconds); this.evaluateAvatar(0); }
  setSpeed(speed: number) { this.playback.setSpeed(speed); }
  update(delta: number) { this.vrm?.beginFrame(); this.playback.update(delta); this.evaluateAvatar(delta); }
  getPlayback() { return this.playback.getSnapshot(); }
  getBounds() { return this.bounds; }
  getExpressions(): ViewerExpressionState { return this.vrm?.getExpressionState() ?? EMPTY_EXPRESSIONS; }
  setExpression(name: string, weight: number) { const applied = this.vrm?.setExpression(name, weight) ?? false; if (applied) this.evaluateAvatar(0); return applied; }
  clearExpression(name: string) { const applied = this.vrm?.clearExpression(name) ?? false; if (applied) this.evaluateAvatar(0); return applied; }
  resetExpressions() { this.vrm?.resetExpressions(); this.evaluateAvatar(0); }
  setLookAt(target: ViewerVec3 | null, options: ViewerLookAtOptions = {}) { if (!this.vrm) throw new Error('Look-at requires a VRM humanoid model.'); this.vrm.setLookAt(target, options); this.evaluateAvatar(0); }
  getLookAt(): ViewerLookAtState | null { return this.vrm?.getLookAt() ?? null; }
  private evaluateAvatar(delta: number) { this.vrm?.applyExpressions(); this.vrm?.applyLookAt(delta); }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const controller of this.pending) controller.abort(); this.pending.clear();
    this.playback.dispose(); for (const clip of this.library.values()) clip.dispose(); this.library.clear();
    this.vrm?.disposePresentation();
    if (this.mounted) this.options.onModelDisposed?.(this.model);
    this.binding?.dispose(); this.model.removeFromParent(); this.model.dispose(); pruneDisposedBindings(this.options.animationModule); this.loader.dispose(); this.onDispose();
  }
  private alive() { if (this.disposed) throw new Error('Model session is disposed.'); }
}

function capturePose(model: GltfModelNode) {
  model.updateWorldFromRoot();
  const nodes: Node[] = []; model.traverse(node => { if (node !== model) nodes.push(node); });
  const snapshots = nodes.map(node => ({ node, position: [node.position.x, node.position.y, node.position.z] as const,
    rotation: [node.rotation.x, node.rotation.y, node.rotation.z] as const, scale: [node.scale.x, node.scale.y, node.scale.z] as const,
    weights: node instanceof Mesh && node.geometry instanceof SkinnedGeometry ? node.geometry.morphWeights.slice() : undefined,
  }));
  const targets: readonly TargetNode[] = Object.freeze(nodes.map(node => Object.freeze({
    id: node.id, name: node.name, restMatrix: Object.freeze(Array.from(node.localMatrix.elements)),
    parentId: node.parent === model ? null : node.parent?.id ?? null,
    morphNames: Object.freeze(node instanceof Mesh && node.geometry instanceof SkinnedGeometry ? node.geometry.morphTargets.map(target => target.name) : []),
  })));
  return { targets, restore() {
    for (const snapshot of snapshots) {
      snapshot.node.position.set(...snapshot.position); snapshot.node.rotation.set(...snapshot.rotation); snapshot.node.scale.set(...snapshot.scale);
      if (snapshot.weights && snapshot.node instanceof Mesh && snapshot.node.geometry instanceof SkinnedGeometry) snapshot.node.geometry.setMorphWeights(snapshot.weights);
    }
  } };
}
function cloneClip(clip: AnimationClip, id: string) {
  return new AnimationClip({ id, name: clip.name, duration: clip.duration, markers: clip.markers,
    tracks: clip.tracks.map(track => new AnimationTrack({ target: track.target, path: track.path, times: track.times, values: track.values, interpolation: track.interpolation, valueSize: track.valueSize })),
  });
}
function validateClip(clip: AnimationClip, targets: readonly TargetNode[]) {
  if (!Number.isFinite(clip.duration) || clip.duration < 0 || clip.tracks.length === 0) throw new Error('Animation clip must have valid tracks and duration.');
  const ids = new Set(targets.map(node => node.id));
  for (const track of clip.tracks) {
    if (!ids.has(track.target)) throw new Error(`Animation targets missing node: ${track.target}`);
    if ([...track.times, ...track.values].some(value => !Number.isFinite(value)) || (track.times[0] ?? -1) < 0) throw new Error('Animation contains invalid keyframe values.');
    if ((track.times[track.times.length - 1] ?? 0) > clip.duration) throw new Error('Animation keyframe exceeds clip duration.');
  }
}
function pruneDisposedBindings(module: AnimationRendererModule) {
  // Upstream lazily removes these on its next update; teardown must also work when stopped.
  for (const binding of module.bindings) if (binding.mesh.disposed || binding.mesh.geometry.disposed || binding.skeleton?.disposed) module.bindings.delete(binding);
}

function resolveUniformNormalizationScale(before: readonly number[], after: readonly number[]): number {
  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const source = before[index] ?? 0;
    const normalized = after[index] ?? source;
    if (Math.abs(source) > 1e-8) {
      const factor = normalized / source;
      if (Number.isFinite(factor) && factor > 0) return factor;
    }
  }
  return 1;
}
