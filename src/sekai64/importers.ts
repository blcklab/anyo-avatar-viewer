import { AnimationClip, SkinnedGeometry, createAnimationRendererModule, createGltfAnimationAdapter, GLTF_ANIMATION_EXTENSION_ID, type GltfAnimationSet } from '@blcklab/sekai64/animation';
import { ViewerAnimationTrack as AnimationTrack } from './AnimationTrack.js';
import { GltfLoader, type GltfModelNode } from '@blcklab/sekai64/gltf';
import type { AnimationSource } from '../types.js';
import { Mesh, type Node } from '@blcklab/sekai64';
import { correctGltfRestRotations } from './rotation-compat.js';

export interface TargetNode {
  readonly id: string; readonly name: string;
  readonly restMatrix: readonly number[];
  readonly parentId: string | null;
  readonly morphNames: readonly string[];
}
export interface AnimationImportContext {
  readonly source: AnimationSource;
  readonly signal: AbortSignal;
  readonly targets: readonly TargetNode[];
  readonly vrm?: VrmTargetRig;
  readonly onDiagnostic?: (message: string) => void;
}
export interface VrmTargetRig {
  readonly version: '0' | '1';
  readonly bones: Readonly<Record<string, string>>;
  readonly expressions: Readonly<Record<string, { readonly target: string; readonly supported: boolean }>>;
}
/** Return newly owned clips bound to target node IDs; do not mutate the target model. */
export interface Sekai64AnimationImporter {
  readonly formats: readonly string[];
  load(context: AnimationImportContext): Promise<readonly AnimationClip[]>;
}
export function createGltfClipImporter(): Sekai64AnimationImporter {
  return {
    formats: ['glb', 'gltf'],
    async load({ source, signal, targets }) {
      const loader = new GltfLoader();
      const module = createAnimationRendererModule();
      const prepared = prepareSource(loader, source.url, source.format);
      let model: GltfModelNode | undefined;
      const clips: AnimationClip[] = [];
      try {
        signal.throwIfAborted();
        const animationAdapter = createGltfAnimationAdapter(module, { createMixer: false });
        model = await loader.loadNode(prepared.url, { signal, animation: { ...animationAdapter, finalize(context) {
          correctGltfRestRotations(context); return animationAdapter.finalize?.(context);
        } } });
        signal.throwIfAborted();
        if (model.asset.document.extensions?.VRMC_vrm_animation) throw new Error('VRMA requires a humanoid retargeting importer; it cannot be loaded as a same-rig glTF clip.');
        const animation = model.asset.getExtension<GltfAnimationSet>(GLTF_ANIMATION_EXTENSION_ID);
        if (!animation?.clips.length) throw new Error('The animation file contains no clips.');
        model.updateWorldFromRoot();
        const nodes = new Map<string, Node>(); model.traverse(node => { nodes.set(node.id, node); });
        const targetIds = new Map(targets.map(node => [node.id, node]));
        const resolve = (node: Node): TargetNode => {
          const mapped = source.nodeMap?.[node.name];
          const matches = mapped && targetIds.has(mapped) ? [targetIds.get(mapped)!] : targets.filter(target => target.name === (mapped ?? node.name) && Boolean(mapped ?? node.name));
          if (matches.length !== 1) throw new Error(`Animation node "${node.name || node.id}" has ${matches.length} target matches. Supply an unambiguous nodeMap.`);
          const target = matches[0]!;
          if (Array.from(node.localMatrix.elements).some((value, index) => Math.abs(value - target.restMatrix[index]!) > 0.0001)) {
            throw new Error(`Rest pose mismatch for "${node.name}". This importer binds compatible rigs; different rigs require retargeting.`);
          }
          return target;
        };
        for (const clip of animation.clips) {
          const seen = new Set<string>();
          const tracks = clip.tracks.map(track => {
            const node = nodes.get(track.target);
            if (!node) throw new Error(`Missing source node: ${track.target}`);
            const target = resolve(node);
            // Walk every ancestor: equal local poses alone cannot establish rig compatibility.
            let parent = node.parent;
            let parentId = target.parentId;
            while (parent && parent !== model) {
              const targetParent = resolve(parent);
              if (targetParent.id !== parentId) throw new Error(`Hierarchy mismatch for "${node.name}"; retargeting is required.`);
              parentId = targetParent.parentId; parent = parent.parent;
            }
            if (parentId !== null) throw new Error(`Hierarchy mismatch for "${node.name}"; retargeting is required.`);
            if (track.path === 'weights' && track.valueSize !== target.morphNames.length) throw new Error(`Morph target count mismatch for "${node.name}".`);
            if (track.path === 'weights' && (!(node instanceof Mesh) || !(node.geometry instanceof SkinnedGeometry) || node.geometry.morphTargets.some((morph, index) => morph.name !== target.morphNames[index]))) throw new Error(`Morph target order mismatch for "${node.name}".`);
            const key = `${target.id}:${track.path}`;
            if (seen.has(key)) throw new Error(`Multiple tracks bind to ${key}.`);
            seen.add(key);
            return new AnimationTrack({ target: target.id, path: track.path, times: track.times, values: track.values, interpolation: track.interpolation, valueSize: track.valueSize });
          });
          clips.push(new AnimationClip({ id: clip.id, name: clip.name, duration: clip.duration, tracks, markers: clip.markers }));
        }
        return clips;
      } catch (error) { for (const clip of clips) clip.dispose(); throw error; }
      finally { model?.dispose(); prepared.dispose(); loader.dispose(); module.dispose(); }
    },
  };
}

/** Preserve the directory for relative glTF buffers, but give blob/data URLs a format. */
export function prepareSource(loader: GltfLoader, source: string, format: string) {
  const real = new URL(source, typeof location === 'undefined' ? 'file:///' : location.href);
  if (real.pathname.toLowerCase().endsWith(`.${format}`)) return { url: real, dispose: () => {} };
  const virtual = real.protocol === 'blob:' || real.protocol === 'data:'
    ? new URL(`https://avatar-viewer.invalid/asset.${format}`)
    : new URL(real.href);
  if (virtual.origin !== 'https://avatar-viewer.invalid') virtual.pathname += `.${format}`;
  const dispose = loader.assets.addResolver({
    canResolve: candidate => candidate.href === virtual.href,
    fetch: (_candidate, options) => fetch(real, { signal: options.signal, headers: options.headers }),
  });
  return { url: virtual, dispose };
}
