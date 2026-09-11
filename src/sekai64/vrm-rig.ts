import { Mesh, Node, Vector3 } from '@blcklab/sekai64';
import { SkinnedGeometry } from '@blcklab/sekai64/animation';
import type { GltfModelNode } from '@blcklab/sekai64/gltf';
import type { ViewerExpressionState, ViewerLookAtOptions, ViewerLookAtState, ViewerVec3 } from '../types.js';
import type { VrmTargetRig } from './importers.js';


type RecordValue = Record<string, any>;
export function object(value: unknown): RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}; }
const legacyExpressions: Record<string, string> = { joy: 'happy', sorrow: 'sad', fun: 'relaxed', a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh', blink_l: 'blinkLeft', blink_r: 'blinkRight' };
export function legacyBone(name: string): string { return name.replace(/ThumbProximal$/, 'ThumbMetacarpal').replace(/ThumbIntermediate$/, 'ThumbProximal'); }

const DEFAULT_LOOK = Object.freeze({
  space: 'world' as const,
  eyes: true,
  head: true,
  neck: true,
  weight: 1,
  smoothing: 10,
  maxYaw: 60,
  maxPitch: 35,
});

/** Keep glTF node indices through loading; bone names are not unique identifiers. */
export function createVrmTargetRig(model: GltfModelNode, indices: ReadonlyMap<number, readonly Node[]>) {
  const ext = model.asset.document.extensions ?? {};
  const modern = object(ext.VRMC_vrm), legacy = object(ext.VRM);
  if (!ext.VRMC_vrm && !ext.VRM) return undefined;
  const version = ext.VRMC_vrm ? '1' : '0';
  const bones: Record<string, string> = Object.create(null);
  const boneNodes = new Map<string, Node>();
  const resolve = (index: unknown): Node => {
    const nodes = typeof index === 'number' && Number.isInteger(index) ? indices.get(index) : undefined;
    if (nodes?.length !== 1) throw new Error(`VRM node ${String(index)} must identify one loaded node.`);
    return nodes[0]!;
  };
  const declarations = version === '1' ? Object.entries(object(object(modern.humanoid).humanBones))
    : (object(legacy.humanoid).humanBones ?? []).map((entry: RecordValue) => [legacyBone(entry.bone), entry]);
  const usedBones = new Set<string>();
  for (const [name, value] of declarations) {
    const node = resolve(object(value).node);
    if (usedBones.has(node.id)) throw new Error(`VRM node is assigned to multiple humanoid bones: ${name}`);
    usedBones.add(node.id); bones[name] = node.id; boneNodes.set(name, node);
  }

  interface MorphBind { geometry: SkinnedGeometry; index: number; weight: number }
  interface Expression { proxy: Node; binds: MorphBind[]; binary: boolean; overrideBlink: string; supported: boolean; name: string }
  const expressions: Expression[] = [];
  const definitions: Array<[string, RecordValue]> = version === '1'
    ? [...Object.entries(object(object(modern.expressions).preset)), ...Object.entries(object(object(modern.expressions).custom))].map(([name, value]) => [name, object(value)])
    : (object(legacy.blendShapeMaster).blendShapeGroups ?? []).map((entry: RecordValue) => {
      const raw = entry.presetName && entry.presetName !== 'unknown' ? entry.presetName : entry.name;
      return [legacyExpressions[raw] ?? raw, entry];
    });
  const baselines = new Map<SkinnedGeometry, Float32Array>();
  const expressionTargets: Record<string, { target: string; supported: boolean }> = Object.create(null);
  for (const [name, def] of definitions) {
    if (!name || expressionTargets[name]) throw new Error(`Duplicate or empty VRM expression: ${name}`);
    const binds: MorphBind[] = [];
    let supported = !(def.materialColorBinds?.length || def.textureTransformBinds?.length || def.materialValues?.length);
    for (const input of (version === '1' ? def.morphTargetBinds : def.binds) ?? []) {
      const bind = object(input);
      let roots: Node[];
      if (version === '1') roots = [resolve(bind.node)];
      else roots = [...indices].filter(([index]) => model.asset.document.nodes?.[index]?.mesh === bind.mesh).flatMap(([, nodes]) => [...nodes]);
      if (!roots.length) throw new Error(`Expression "${name}" references a missing mesh.`);
      for (const root of roots) {
        const meshes = root instanceof Mesh ? [root] : root.children.filter((node): node is Mesh => node instanceof Mesh);
        for (const mesh of meshes) {
          const geometry = mesh.geometry;
          if (!(geometry instanceof SkinnedGeometry) || !Number.isInteger(bind.index) || bind.index < 0 || bind.index >= geometry.morphWeights.length) throw new Error(`Invalid morph bind for expression "${name}".`);
          const weight = (bind.weight ?? (version === '1' ? 1 : 100)) / (version === '1' ? 1 : 100);
          if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`Invalid expression bind weight: ${name}`);
          binds.push({ geometry, index: bind.index, weight });
          if (!baselines.has(geometry)) baselines.set(geometry, geometry.morphWeights.slice());
        }
      }
    }
    if (def.overrideBlink !== undefined && !['none', 'block', 'blend'].includes(def.overrideBlink)) supported = false;
    const proxy = new Node({ id: `${model.id}:expression:${expressions.length}` });
    proxy.position.x = -1;
    model.add(proxy);
    expressions.push({ name, proxy, binds, supported, binary: def.isBinary === true, overrideBlink: def.overrideBlink ?? 'none' });
    expressionTargets[name] = Object.freeze({ target: proxy.id, supported });
  }
  const description: VrmTargetRig = Object.freeze({ version, bones: Object.freeze(bones), expressions: Object.freeze(expressionTargets) });
  const manualExpressions = new Map<string, number>();
  const availableExpressions = Object.freeze(expressions.filter(expression => expression.supported).map(expression => expression.name).sort());
  let expressionState: ViewerExpressionState = Object.freeze({ available: availableExpressions, values: Object.freeze({}) });
  let expressionsApplied = false;
  let lookTarget: ViewerVec3 | null = null;
  let lookState: ViewerLookAtState | null = null;
  let lookOptions: { space: 'world' | 'direction'; eyes: boolean; head: boolean; neck: boolean; weight: number; smoothing: number; maxYaw: number; maxPitch: number } = { ...DEFAULT_LOOK };
  let currentYaw = 0;
  let currentPitch = 0;
  const appliedLook = new Map<Node, readonly [number, number]>();

  const effectiveExpression = (expression: Expression): number => {
    const manual = manualExpressions.get(expression.name);
    const raw = manual ?? (expression.proxy.position.x >= 0 ? expression.proxy.position.x : 0);
    const clamped = Math.min(1, Math.max(0, raw));
    return expression.binary ? (clamped > 0.5 ? 1 : 0) : clamped;
  };
  const applyExpressions = () => {
    const active = expressions.filter(expression => expression.supported && (manualExpressions.has(expression.name) || expression.proxy.position.x >= 0));
    if (!active.length) {
      if (expressionsApplied) for (const [geometry, baseline] of baselines) geometry.setMorphWeights(baseline);
      expressionsApplied = false;
      return;
    }
    for (const [geometry, baseline] of baselines) geometry.setMorphWeights(baseline);
    let blinkOverride = 0;
    for (const expression of active) {
      const weight = effectiveExpression(expression);
      if (expression.overrideBlink === 'block' && weight > 0) blinkOverride = 1;
      else if (expression.overrideBlink === 'blend') blinkOverride += weight;
    }
    const totals = new Map<SkinnedGeometry, Float32Array>();
    for (const expression of active) {
      const weight = effectiveExpression(expression) * (['blink', 'blinkLeft', 'blinkRight'].includes(expression.name) ? 1 - Math.min(1, blinkOverride) : 1);
      for (const bind of expression.binds) {
        let values = totals.get(bind.geometry);
        if (!values) { values = baselines.get(bind.geometry)!.slice(); totals.set(bind.geometry, values); }
        values[bind.index] = values[bind.index]! + weight * bind.weight;
      }
    }
    for (const [geometry, values] of totals) geometry.setMorphWeights(values.map(value => Math.min(1, Math.max(0, value))));
    expressionsApplied = true;
  };

  const removeLookAt = () => {
    for (const [node, [yaw, pitch]] of appliedLook) {
      if (!node.disposed) { node.rotation.y -= yaw; node.rotation.x -= pitch; }
    }
    appliedLook.clear();
  };
  const applyLookNode = (node: Node | undefined, yaw: number, pitch: number) => {
    if (!node || node.disposed) return;
    node.rotation.y += yaw; node.rotation.x += pitch;
    appliedLook.set(node, [yaw, pitch]);
  };
  const resolveLookDirection = (): Vector3 | null => {
    if (!lookTarget) return null;
    const direction = new Vector3(...lookTarget);
    if (lookOptions.space === 'world') {
      model.updateWorldFromRoot();
      const anchor = boneNodes.get('head') ?? model;
      anchor.updateWorldFromRoot();
      const origin = new Vector3().setFromMatrixPosition(anchor.worldMatrix);
      direction.sub(origin);
      direction.transformDirection(model.worldMatrix.clone().invert());
    }
    if (direction.lengthSquared() <= 1e-12) return null;
    return direction.normalize();
  };
  const applyLookAt = (deltaSeconds: number) => {
    removeLookAt();
    const direction = resolveLookDirection();
    if (!direction) return;
    const maxYaw = degrees(lookOptions.maxYaw);
    const maxPitch = degrees(lookOptions.maxPitch);
    const desiredYaw = clamp(Math.atan2(-direction.x, -direction.z), -maxYaw, maxYaw) * lookOptions.weight;
    const horizontal = Math.hypot(direction.x, direction.z);
    const desiredPitch = clamp(-Math.atan2(direction.y, Math.max(1e-6, horizontal)), -maxPitch, maxPitch) * lookOptions.weight;
    const alpha = lookOptions.smoothing <= 0 ? 1 : 1 - Math.exp(-lookOptions.smoothing * Math.max(0, deltaSeconds));
    currentYaw += (desiredYaw - currentYaw) * alpha;
    currentPitch += (desiredPitch - currentPitch) * alpha;
    if (lookOptions.neck) applyLookNode(boneNodes.get('neck'), currentYaw * 0.25, currentPitch * 0.2);
    if (lookOptions.head) applyLookNode(boneNodes.get('head'), currentYaw * 0.55, currentPitch * 0.5);
    if (lookOptions.eyes) {
      applyLookNode(boneNodes.get('leftEye'), currentYaw, currentPitch);
      applyLookNode(boneNodes.get('rightEye'), currentYaw, currentPitch);
    }
  };

  return {
    description,
    beginFrame() { removeLookAt(); },
    applyExpressions,
    applyLookAt,
    getExpressionState(): ViewerExpressionState {
      const values: Record<string, number> = {};
      for (const expression of expressions) {
        if (!expression.supported) continue;
        const value = effectiveExpression(expression);
        if (manualExpressions.has(expression.name) || expression.proxy.position.x >= 0 || value > 0) values[expression.name] = value;
      }
      const previous = expressionState.values;
      const keys = Object.keys(values);
      if (keys.length === Object.keys(previous).length && keys.every(key => previous[key] === values[key])) return expressionState;
      expressionState = Object.freeze({ available: availableExpressions, values: Object.freeze(values) });
      return expressionState;
    },
    setExpression(name: string, weight: number): boolean {
      const expression = expressions.find(item => item.name === name && item.supported);
      if (!expression) return false;
      manualExpressions.set(name, clamp(weight, 0, 1)); applyExpressions(); return true;
    },
    clearExpression(name: string): boolean {
      const expression = expressions.find(item => item.name === name && item.supported);
      if (!expression) return false;
      manualExpressions.delete(name); applyExpressions(); return true;
    },
    resetExpressions() { manualExpressions.clear(); applyExpressions(); },
    setLookAt(target: ViewerVec3 | null, options: ViewerLookAtOptions = {}) {
      removeLookAt();
      lookTarget = target ? Object.freeze([...target]) as ViewerVec3 : null;
      lookOptions = {
        space: options.space ?? DEFAULT_LOOK.space,
        eyes: options.eyes ?? DEFAULT_LOOK.eyes,
        head: options.head ?? DEFAULT_LOOK.head,
        neck: options.neck ?? DEFAULT_LOOK.neck,
        weight: options.weight ?? DEFAULT_LOOK.weight,
        smoothing: options.smoothing ?? DEFAULT_LOOK.smoothing,
        maxYaw: options.maxYaw ?? DEFAULT_LOOK.maxYaw,
        maxPitch: options.maxPitch ?? DEFAULT_LOOK.maxPitch,
      };
      if (!lookTarget) { currentYaw = 0; currentPitch = 0; lookState = null; }
      else lookState = Object.freeze({ target: lookTarget, ...lookOptions });
    },
    getLookAt(): ViewerLookAtState | null { return lookState; },
    disposePresentation() { removeLookAt(); manualExpressions.clear(); },
  };
}

function degrees(value: number): number { return value * Math.PI / 180; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
