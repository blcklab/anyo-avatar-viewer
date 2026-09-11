import { Matrix4, type Node } from '@blcklab/sekai64';
import { AnimationClip } from '@blcklab/sekai64/animation';
import { ViewerAnimationTrack as AnimationTrack } from './AnimationTrack.js';
import { GltfLoader, type GltfAnimationFinalizeContext } from '@blcklab/sekai64/gltf';
import { prepareSource, type AnimationImportContext, type Sekai64AnimationImporter, type TargetNode } from './importers.js';
import { object } from './vrm-rig.js';
import { identity, inverse, matrix, multiply, normalize, position, rotation, transform, type Quat } from './vrma-math.js';
import { correctGltfRestRotations } from './rotation-compat.js';

export interface VrmAnimationImporterOptions {
  /** Unsupported animated gaze/material features reject by default. Skipping emits diagnostics. */
  readonly unsupportedFeatures?: 'error' | 'skip';
  /** Source-avatar-specific animation channels outside VRMC_vrm_animation mappings reject by default. */
  readonly unmappedNodes?: 'error' | 'skip' | 'exact-match';
  /** Bake rate when an absent optional ancestor must be folded into a descendant. */
  readonly bakeRate?: number;
}
const requiredBones = new Set(['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']);
const extensionId = 'anyo.avatar-viewer.vrma';

export function createVrmAnimationImporter(options: VrmAnimationImporterOptions = {}): Sekai64AnimationImporter {
  const rate = options.bakeRate ?? 60;
  if (!Number.isFinite(rate) || rate < 1 || rate > 120) throw new Error('VRMA bakeRate must be between 1 and 120.');
  if (options.unsupportedFeatures !== undefined && !['error', 'skip'].includes(options.unsupportedFeatures)) throw new Error('Invalid VRMA unsupportedFeatures policy.');
  if (options.unmappedNodes !== undefined && !['error', 'skip', 'exact-match'].includes(options.unmappedNodes)) throw new Error('Invalid VRMA unmappedNodes policy.');
  return {
    formats: ['vrma'],
    async load(context) {
      if (!context.vrm) throw new Error('VRMA requires a target model with VRM humanoid/expression metadata.');
      context.signal.throwIfAborted();
      const loader = new GltfLoader();
      const prepared = prepareSource(loader, context.source.url, 'glb');
      let asset;
      try {
        asset = await loader.load(prepared.url, { signal: context.signal, animation: {
          id: extensionId,
          createGeometry() { throw new Error('VRMA animation files with meshes are not supported. Export an animation-only VRMA.'); },
          finalize(value) { correctGltfRestRotations(value); return { id: extensionId, value }; },
        } });
        context.signal.throwIfAborted();
        const raw = asset.getExtension<GltfAnimationFinalizeContext>(extensionId);
        if (!raw) throw new Error('VRMA animation data was not loaded.');
        return retarget(raw, context, rate, options.unsupportedFeatures ?? 'error', options.unmappedNodes ?? 'error');
      } finally { asset?.dispose(); prepared.dispose(); loader.dispose(); }
    },
  };
}

function retarget(raw: GltfAnimationFinalizeContext, context: AnimationImportContext, bakeRate: number, unsupported: 'error' | 'skip', unmappedNodes: 'error' | 'skip' | 'exact-match'): readonly AnimationClip[] {
  const ext = object(raw.document.extensions?.VRMC_vrm_animation);
  if (ext.specVersion !== '1.0') throw new Error('Expected VRMC_vrm_animation specVersion "1.0". Draft or missing VRMA metadata is unsupported.');
  const rig = context.vrm!;
  const targets = new Map(context.targets.map(target => [target.id, target]));
  const targetWorld = new Map<string, Matrix4>();
  const active = new Set<string>();
  function world(id: string): Matrix4 {
    const found = targetWorld.get(id); if (found) return found;
    const target = targets.get(id); if (!target || active.has(id)) throw new Error('Invalid target rig hierarchy.');
    active.add(id);
    const result = target.parentId ? world(target.parentId).clone().multiply(matrix(target.restMatrix)) : matrix(target.restMatrix);
    rotation(result); targetWorld.set(id, result); active.delete(id); return result;
  }
  const targetBoneNames = new Map(Object.entries(rig.bones).map(([name, id]) => [id, name]));
  const sourceBones = new Map<string, Node>();
  const sourceNames = new Map<Node, string>();
  const sourceNodes = new Map<number, { kind: 'bone' | 'expression' | 'gaze'; name: string; node: Node }>();
  const add = (index: unknown, kind: 'bone' | 'expression' | 'gaze', name: string) => {
    const nodes = typeof index === 'number' && Number.isInteger(index) ? raw.nodes.get(index) : undefined;
    if (nodes?.length !== 1 || sourceNodes.has(index as number)) throw new Error(`Invalid or duplicate VRMA node mapping: ${name}`);
    const node = nodes[0]!; sourceNodes.set(index as number, { kind, name, node }); return node;
  };
  for (const [name, input] of Object.entries(object(object(ext.humanoid).humanBones))) {
    if (['leftEye', 'rightEye'].includes(name)) throw new Error('VRMA eye bones must use lookAt rather than humanoid animation.');
    const node = add(object(input).node, 'bone', name); sourceBones.set(name, node); sourceNames.set(node, name);
  }
  const expressionNames = new Set<string>();
  for (const bucket of ['preset', 'custom']) for (const [name, input] of Object.entries(object(object(ext.expressions)[bucket]))) {
    if (expressionNames.has(name) || ['lookUp', 'lookDown', 'lookLeft', 'lookRight'].includes(name)) throw new Error(`Invalid VRMA expression mapping: ${name}`);
    expressionNames.add(name); add(object(input).node, 'expression', name);
  }
  if (object(ext.lookAt).node !== undefined) add(object(ext.lookAt).node, 'gaze', 'lookAt');
  raw.scene.updateWorldFromRoot();
  const local = new Map<Node, Quat>(), global = new Map<Node, Quat>();
  for (const node of sourceBones.values()) { local.set(node, rotation(node.localMatrix)); global.set(node, rotation(node.worldMatrix)); }
  const skip = (message: string) => {
    if (unsupported === 'error') throw new Error(message);
    context.onDiagnostic?.(`Skipped: ${message}`);
  };
  const skipUnmapped = (message: string) => {
    if (unmappedNodes === 'error') throw new Error(message);
    context.onDiagnostic?.(`Skipped: ${message}`);
  };
  const targetNames = new Map<string, TargetNode[]>();
  for (const target of context.targets) {
    if (!target.name) continue;
    const matches = targetNames.get(target.name) ?? [];
    matches.push(target); targetNames.set(target.name, matches);
  }
  const sourceIndexByNode = new Map<Node, number>();
  for (const [index, nodes] of raw.nodes) if (nodes.length === 1) sourceIndexByNode.set(nodes[0]!, index);
  const exactBindings = new Map<number, TargetNode | null>();
  const sameRest = (node: Node, target: TargetNode) => Array.from(node.localMatrix.elements).every((value, index) => Math.abs(value - target.restMatrix[index]!) <= 0.0001);
  const exactTarget = (index: number): TargetNode | undefined => {
    if (rig.version !== '1') return undefined;
    if (exactBindings.has(index)) return exactBindings.get(index) ?? undefined;
    // Break cycles while resolving parent chains.
    exactBindings.set(index, null);
    const sourceNode = raw.nodes.get(index);
    const sourceName = raw.document.nodes?.[index]?.name?.trim();
    if (sourceNode?.length !== 1 || !sourceName) return undefined;
    const matches = targetNames.get(sourceName) ?? [];
    if (matches.length !== 1) return undefined;
    const target = matches[0]!;
    if (!sameRest(sourceNode[0]!, target)) return undefined;
    let expectedParentId: string | null = null;
    const parent = sourceNode[0]!.parent;
    if (parent && parent !== raw.scene) {
      const parentIndex = sourceIndexByNode.get(parent);
      if (parentIndex === undefined) return undefined;
      const portableParent = sourceNodes.get(parentIndex);
      if (portableParent) {
        if (portableParent.kind !== 'bone') return undefined;
        expectedParentId = rig.bones[portableParent.name] ?? null;
        if (!expectedParentId) return undefined;
      } else {
        const matchedParent = exactTarget(parentIndex);
        if (!matchedParent) return undefined;
        expectedParentId = matchedParent.id;
      }
    }
    if (target.parentId !== expectedParentId) return undefined;
    exactBindings.set(index, target);
    return target;
  };
  const result: AnimationClip[] = [];
  try {
    for (const [clipIndex, animation] of (raw.document.animations ?? []).entries()) {
      context.signal.throwIfAborted();
      const rotations = new Map<Node, AnimationTrack>();
      const output: AnimationTrack[] = [];
      const seen = new Set<string>();
      let duration = 0;
      let exactPassThrough = 0;
      for (const channel of animation.channels) {
        const nodeIndex = channel.target.node;
        if (typeof nodeIndex !== 'number' || !Number.isInteger(nodeIndex) || !raw.document.nodes?.[nodeIndex]) {
          throw new Error(`VRMA animation targets an invalid node: ${nodeIndex}`);
        }
        const path = channel.target.path;
        const entry = sourceNodes.get(nodeIndex);
        const passthrough = !entry && unmappedNodes === 'exact-match' ? exactTarget(nodeIndex) : undefined;
        if (!entry && !passthrough) {
          const nodeName = raw.document.nodes[nodeIndex]?.name;
          skipUnmapped(`VRMA animation targets non-portable node ${nodeIndex}${nodeName ? ` (${nodeName})` : ''}.`);
          continue;
        }
        if (entry && path !== 'rotation' && path !== 'translation') throw new Error(`Unsupported VRMA channel path: ${path}`);
        if (passthrough && !['rotation', 'translation', 'scale'].includes(path)) {
          skipUnmapped(`VRMA secondary node ${nodeIndex} (${raw.document.nodes[nodeIndex]?.name ?? 'unnamed'}) uses unsupported pass-through path ${path}.`);
          continue;
        }
        const key = `${channel.target.node}:${path}`;
        if (seen.has(key)) throw new Error(`Duplicate VRMA channel: ${key}`); seen.add(key);
        const sampler = animation.samplers[channel.sampler];
        if (!sampler) throw new Error('VRMA animation references a missing sampler.');
        if (sampler.interpolation !== undefined && !['LINEAR', 'STEP'].includes(sampler.interpolation)) throw new Error('VRMA supports LINEAR and STEP samplers; bake CUBICSPLINE before import.');
        const input = raw.document.accessors?.[sampler.input], value = raw.document.accessors?.[sampler.output];
        const expectedValueType = path === 'rotation' ? 'VEC4' : 'VEC3';
        if (input?.type !== 'SCALAR' || input.componentType !== 5126 || value?.type !== expectedValueType || value.componentType !== 5126) throw new Error('Invalid VRMA animation accessor type.');
        const times = raw.readAccessor(sampler.input), values = raw.readAccessor(sampler.output);
        if (!times.length || times[0]! < 0 || times.some((time, index) => !Number.isFinite(time) || (index > 0 && time <= times[index - 1]!)) || values.some(value => !Number.isFinite(value))) throw new Error('VRMA requires finite values and strictly increasing non-negative keyframe times.');
        if (path === 'rotation') for (let index = 0; index < values.length; index += 4) values.set(normalize(values, index), index);
        duration = Math.max(duration, times[times.length - 1]!);
        if (passthrough) {
          output.push(new AnimationTrack({ target: passthrough.id, path: path as 'rotation' | 'translation' | 'scale', times, values, interpolation: sampler.interpolation === 'STEP' ? 'step' : 'linear' }));
          exactPassThrough++;
          continue;
        }
        const track = new AnimationTrack({ target: entry!.node.id, path: path as 'rotation' | 'translation', times, values, interpolation: sampler.interpolation === 'STEP' ? 'step' : 'linear' });
        if (entry!.kind === 'gaze') { skip('VRMA lookAt/gaze tracks are not implemented in this version.'); continue; }
        if (entry!.kind === 'expression') {
          if (path !== 'translation') throw new Error('VRMA expression weights must use translation.x.');
          const resolved = rig.expressions[entry!.name] ? [rig.expressions[entry!.name]!]
            : entry!.name === 'blink' && rig.expressions.blinkLeft && rig.expressions.blinkRight ? [rig.expressions.blinkLeft, rig.expressions.blinkRight] : [];
          if (!resolved.length) { context.onDiagnostic?.(`Avatar has no "${entry!.name}" expression; that VRMA channel is omitted.`); continue; }
          if (resolved.some(expression => !expression.supported)) { skip(`VRMA expression "${entry!.name}" needs unsupported material/texture expression bindings.`); continue; }
          const weights = new Float32Array(times.length * 3);
          // Clamp the sampled expression weight, not the keys: clamping keys changes interpolation.
          for (let index = 0; index < times.length; index++) weights[index * 3] = values[index * 3]!;
          for (const expression of resolved) output.push(new AnimationTrack({ target: expression.target, path: 'translation', times, values: weights, interpolation: track.interpolation }));
          continue;
        }
        if (path === 'rotation') rotations.set(entry!.node, track);
        else {
          if (entry!.name !== 'hips') throw new Error('VRMA permits translation only on the hips bone.');
          const targetId = rig.bones.hips;
          if (!targetId) throw new Error('Avatar is missing the required hips bone.');
          const sourceRest = position(entry!.node.worldMatrix), targetRest = position(world(targetId));
          if (sourceRest[1] < 0.0001 || targetRest[1] < 0.0001) throw new Error('Hips translation retargeting requires positive source and target rest hips heights.');
          const ratio = targetRest[1] / sourceRest[1];
          const parentId = targets.get(targetId)!.parentId;
          const toLocal = parentId ? world(parentId).clone().invert() : new Matrix4();
          const parentSource = entry!.node.parent?.worldMatrix ?? new Matrix4();
          const converted = new Float32Array(values.length);
          for (let index = 0; index < times.length; index++) {
            const p = transform([values[index * 3]!, values[index * 3 + 1]!, values[index * 3 + 2]!], parentSource);
            const flip = rig.version === '0' ? -1 : 1;
            const desired = [targetRest[0] + (p[0] - sourceRest[0]) * ratio * flip, targetRest[1] + (p[1] - sourceRest[1]) * ratio, targetRest[2] + (p[2] - sourceRest[2]) * ratio * flip] as const;
            converted.set(transform(desired, toLocal), index * 3);
          }
          output.push(new AnimationTrack({ target: targetId, path: 'translation', times, values: converted, interpolation: track.interpolation }));
        }
      }
      if (exactPassThrough) context.onDiagnostic?.(`Preserved ${exactPassThrough} source-specific VRMA channel${exactPassThrough === 1 ? '' : 's'} by exact node/rest/hierarchy match.`);
      for (const [name, source] of sourceBones) {
        const id = rig.bones[name];
        if (!id) {
          if (rotations.has(source) && requiredBones.has(name)) throw new Error(`Avatar is missing animated required bone: ${name}`);
          if (rotations.has(source)) context.onDiagnostic?.(`Avatar has no ${name}; its rotation is folded into available descendants where possible.`);
          continue;
        }
        const chain = [source];
        let ancestor = source.parent, expectedParent: string | undefined;
        while (ancestor && ancestor !== raw.scene) {
          const ancestorName = sourceNames.get(ancestor);
          if (ancestorName && rig.bones[ancestorName]) { expectedParent = ancestorName; break; }
          if (ancestorName) chain.unshift(ancestor);
          ancestor = ancestor.parent;
        }
        let targetParentId = targets.get(id)?.parentId, actualParent: string | undefined;
        while (targetParentId) {
          const parentName = targetBoneNames.get(targetParentId);
          if (parentName && sourceBones.has(parentName)) { actualParent = parentName; break; }
          targetParentId = targets.get(targetParentId)?.parentId;
        }
        if (expectedParent !== actualParent) throw new Error(`Incompatible humanoid ancestry for ${name}.`);
        const tracks = chain.map(node => rotations.get(node)).filter((track): track is AnimationTrack => Boolean(track));
        if (!tracks.length) continue;
        const modes = new Set(tracks.map(track => track.interpolation));
        if (modes.size > 1) throw new Error('Mixed STEP/LINEAR rotations in a folded bone chain must be baked before import.');
        const interpolation = tracks[0]!.interpolation;
        const keys = new Set(tracks.flatMap(track => Array.from(track.times)));
        if (tracks.length > 1 && interpolation === 'linear') {
          const count = Math.ceil(duration * bakeRate);
          if (count > 100000) throw new Error('VRMA folded animation exceeds the 100000-sample bake limit.');
          for (let index = 0; index <= count; index++) keys.add(Math.min(duration, index / bakeRate));
        }
        const times = Float32Array.from([...keys].sort((a, b) => a - b));
        const values = new Float32Array(times.length * 4);
        const targetLocal = rotation(matrix(targets.get(id)!.restMatrix)), targetGlobal = rotation(world(id));
        for (let index = 0; index < times.length; index++) {
          let normalized = identity;
          for (const node of chain) {
            const track = rotations.get(node);
            const pose = track ? normalize(track.sample(times[index]!)) : local.get(node)!;
            const normalizedLocal = multiply(multiply(multiply(global.get(node)!, inverse(local.get(node)!)), pose), inverse(global.get(node)!));
            normalized = multiply(normalized, normalizedLocal);
          }
          if (rig.version === '0') normalized = [-normalized[0], normalized[1], -normalized[2], normalized[3]];
          const converted = multiply(multiply(multiply(targetLocal, inverse(targetGlobal)), normalized), targetGlobal);
          values.set(converted, index * 4);
        }
        output.push(new AnimationTrack({ target: id, path: 'rotation', times, values, interpolation }));
      }
      const bound = new Set<string>();
      for (const track of output) { const key = `${track.target}:${track.path}`; if (bound.has(key)) throw new Error(`VRMA channels overlap on target: ${key}`); bound.add(key); }
      if (!output.length) throw new Error('VRMA contains no supported animation channels for this avatar.');
      result.push(new AnimationClip({ id: `vrma:${clipIndex}`, name: animation.name ?? `VRMA ${clipIndex + 1}`, tracks: output, duration }));
    }
    if (!result.length) throw new Error('VRMA file contains no animations.');
    return result;
  } catch (error) { for (const clip of result) clip.dispose(); throw error; }
}
