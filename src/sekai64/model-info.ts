import { Box3, Mesh, Vector3, type Node } from '@blcklab/sekai64';
import type { GltfModelNode } from '@blcklab/sekai64/gltf';
import type { ViewerBounds } from '../types.js';

export type Sekai64FocusPreset = 'body' | 'face' | 'eyes';

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
  const document = model.asset.document as unknown as ExtendedGltfDocument;
  const vrm1 = asRecord(document.extensions?.VRMC_vrm) as Vrm1Extension | undefined;
  const vrm0 = asRecord(document.extensions?.VRM) as Vrm0Extension | undefined;
  const height = Math.max(bounds.max.y - bounds.min.y, 0.001);
  const boneIndex = (name: string): number | undefined => {
    const direct = vrm1?.humanoid?.humanBones?.[name]?.node;
    if (typeof direct === 'number') return direct;
    const legacy = vrm0?.humanoid?.humanBones?.find(item => item?.bone === name)?.node;
    return typeof legacy === 'number' ? legacy : undefined;
  };

  if (preset === 'eyes') {
    const left = worldPositionForGltfNode(model, boneIndex('leftEye'));
    const right = worldPositionForGltfNode(model, boneIndex('rightEye'));
    if (left && right) return left.add(right).multiplyScalar(0.5);
    if (left) return left;
    if (right) return right;
    const head = worldPositionForGltfNode(model, boneIndex('head'));
    if (head) return head.add(new Vector3(0, height * 0.075, 0));
  } else {
    const head = worldPositionForGltfNode(model, boneIndex('head'));
    if (head) return head.add(new Vector3(0, height * 0.035, 0));
  }

  const center = bounds.getCenter(new Vector3());
  center.y = bounds.min.y + height * (preset === 'eyes' ? 0.90 : 0.855);
  return center;
}

export function worldPositionForNode(node: Node): Vector3 {
  node.updateWorldFromRoot();
  return new Vector3().setFromMatrixPosition(node.worldMatrix);
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
function asRecord(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, any> : undefined;
}
type VrmBoneRef = { node?: number };
type Vrm1Extension = { humanoid?: { humanBones?: Record<string, VrmBoneRef> } };
type Vrm0Bone = { bone?: string; node?: number };
type Vrm0Extension = { humanoid?: { humanBones?: Vrm0Bone[] } };
type ExtendedGltfDocument = { extensions?: Record<string, unknown> };
