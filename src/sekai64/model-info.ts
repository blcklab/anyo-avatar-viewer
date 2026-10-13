import { Box3, Mesh, Vector3, type Node } from '@blcklab/sekai64';
import type { GltfModelNode } from '@blcklab/sekai64/gltf';
import type { ViewerBounds } from '../types.js';

export type Sekai64FocusPreset = 'body' | 'face' | 'eyes';
export type Sekai64FramePreset = 'body' | 'portrait' | 'face' | 'eyes';
export type Sekai64ViewPreset = 'front' | 'back' | 'left' | 'right';

/**
 * Absolute camera azimuth for semantic avatar views.
 *
 * VRM 0.x stores avatars facing Z-, while VRM 1.0 stores them facing Z+.
 * A camera placed on the same forward axis therefore sees the avatar from the front.
 * Generic glTF falls back to Z+ because glTF itself does not define humanoid forward.
 */
export function resolveViewAzimuth(model: GltfModelNode, preset: Sekai64ViewPreset): number {
  const document = model.asset.document as unknown as ExtendedGltfDocument;
  const front = document.extensions?.VRM ? Math.PI : 0;
  if (preset === 'front') return front;
  if (preset === 'back') return front + Math.PI;
  if (preset === 'left') return front - Math.PI * 0.5;
  return front + Math.PI * 0.5;
}

export interface Sekai64FrameRegion {
  readonly target: Vector3;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export function getNodeWorldBounds(root: GltfModelNode): Box3 | undefined {
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

export function getViewerBounds(root: GltfModelNode): ViewerBounds | null {
  const bounds = getNodeWorldBounds(root);
  if (!bounds || bounds.isEmpty()) return null;
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  return Object.freeze({
    min: tuple(bounds.min),
    max: tuple(bounds.max),
    center: tuple(center),
    size: tuple(size),
    radius: Math.max(0, size.length() * 0.5),
    height: Math.max(0, size.y),
  });
}

export function resolveFocusPoint(
  model: GltfModelNode,
  preset: Exclude<Sekai64FocusPreset, 'body'>,
  bounds: Box3,
): Vector3 {
  model.updateWorldFromRoot();
  const height = Math.max(bounds.max.y - bounds.min.y, 0.001);

  if (preset === 'eyes') {
    const left = worldPositionForBone(model, 'leftEye');
    const right = worldPositionForBone(model, 'rightEye');
    if (left && right) return left.add(right).multiplyScalar(0.5);
    if (left) return left;
    if (right) return right;
    const head = worldPositionForBone(model, 'head');
    if (head) return head.add(new Vector3(0, height * 0.075, 0));
  } else {
    const head = worldPositionForBone(model, 'head');
    if (head) return head.add(new Vector3(0, height * 0.035, 0));
  }

  const center = bounds.getCenter(new Vector3());
  center.y = bounds.min.y + height * (preset === 'eyes' ? 0.90 : 0.855);
  return center;
}

/**
 * Semantic camera region used by responsive framing. Unlike `fit()`, portrait,
 * face and eyes framing intentionally ignore full-body/T-pose width and derive
 * a compact region from humanoid landmarks plus the authored model bounds.
 */
export function resolveFrameRegion(
  model: GltfModelNode,
  preset: Sekai64FramePreset,
  bounds: Box3,
): Sekai64FrameRegion {
  model.updateWorldFromRoot();
  const size = bounds.getSize(new Vector3());
  const fullHeight = Math.max(size.y, 0.001);
  const fullDepth = Math.max(size.z, 0.001);

  if (preset === 'body') {
    return {
      target: bounds.getCenter(new Vector3()),
      width: Math.max(size.x, 0.001),
      height: fullHeight,
      depth: fullDepth,
    };
  }

  const top = bounds.max.y;
  const face = resolveFocusPoint(model, preset === 'eyes' ? 'eyes' : 'face', bounds);
  const neck = worldPositionForBone(model, 'neck');
  const upperChest = worldPositionForBone(model, 'upperChest') ?? worldPositionForBone(model, 'chest');
  const leftUpperArm = worldPositionForBone(model, 'leftUpperArm');
  const rightUpperArm = worldPositionForBone(model, 'rightUpperArm');

  if (preset === 'portrait') {
    const semanticBottom = upperChest?.y ?? (top - fullHeight * 0.255);
    const bottom = clamp(semanticBottom - fullHeight * 0.035, bounds.min.y, top - fullHeight * 0.20);
    const height = clamp(top - bottom, fullHeight * 0.26, fullHeight * 0.36);
    const shoulderWidth = leftUpperArm && rightUpperArm ? leftUpperArm.distanceTo(rightUpperArm) : 0;
    const width = Math.max(shoulderWidth * 1.70, height * 0.68, fullHeight * 0.19);
    const target = face.clone();
    target.y = top - height * 0.50;
    if (leftUpperArm && rightUpperArm) target.x = (leftUpperArm.x + rightUpperArm.x) * 0.5;
    return { target, width, height, depth: Math.max(fullDepth * 0.82, height * 0.34) };
  }

  if (preset === 'face') {
    const bottom = clamp((neck?.y ?? (face.y - fullHeight * 0.10)) - fullHeight * 0.018, bounds.min.y, top - fullHeight * 0.12);
    const height = clamp(top - bottom, fullHeight * 0.17, fullHeight * 0.25);
    const target = face.clone();
    target.y = top - height * 0.50;
    return { target, width: Math.max(height * 0.76, fullHeight * 0.15), height, depth: Math.max(fullDepth * 0.70, height * 0.34) };
  }

  const head = worldPositionForBone(model, 'head');
  const bottom = clamp((head?.y ?? face.y) - fullHeight * 0.015, bounds.min.y, top - fullHeight * 0.08);
  const height = clamp(top - bottom, fullHeight * 0.10, fullHeight * 0.17);
  const target = face.clone();
  target.y = top - height * 0.52;
  return { target, width: Math.max(height * 1.10, fullHeight * 0.13), height, depth: Math.max(fullDepth * 0.60, height * 0.32) };
}

export function worldPositionForNode(node: Node): Vector3 {
  node.updateWorldFromRoot();
  return new Vector3().setFromMatrixPosition(node.worldMatrix);
}

function worldPositionForBone(model: GltfModelNode, name: string): Vector3 | undefined {
  return worldPositionForGltfNode(model, humanoidBoneIndex(model, name));
}

function humanoidBoneIndex(model: GltfModelNode, name: string): number | undefined {
  const document = model.asset.document as unknown as ExtendedGltfDocument;
  const vrm1 = asRecord(document.extensions?.VRMC_vrm) as Vrm1Extension | undefined;
  const vrm0 = asRecord(document.extensions?.VRM) as Vrm0Extension | undefined;
  const direct = vrm1?.humanoid?.humanBones?.[name]?.node;
  if (typeof direct === 'number') return direct;
  const legacy = vrm0?.humanoid?.humanBones?.find(item => item?.bone === name)?.node;
  return typeof legacy === 'number' ? legacy : undefined;
}

function worldPositionForGltfNode(model: GltfModelNode, index: number | undefined): Vector3 | undefined {
  if (index === undefined) return undefined;
  const suffix = `:node-${index}`;
  let result: Vector3 | undefined;
  model.traverse(node => {
    if (!result && node.id.endsWith(suffix)) result = new Vector3().setFromMatrixPosition(node.worldMatrix);
  });
  return result;
}

function tuple(vector: Vector3): readonly [number, number, number] {
  return Object.freeze([vector.x, vector.y, vector.z]) as readonly [number, number, number];
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function asRecord(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, any> : undefined;
}
type VrmBoneRef = { node?: number };
type Vrm1Extension = { humanoid?: { humanBones?: Record<string, VrmBoneRef> } };
type Vrm0Bone = { bone?: string; node?: number };
type Vrm0Extension = { humanoid?: { humanBones?: Vrm0Bone[] } };
type ExtendedGltfDocument = { extensions?: Record<string, unknown> };
