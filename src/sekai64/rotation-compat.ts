import { Quaternion, type Node } from '@blcklab/sekai64';
import type { GltfAnimationFinalizeContext } from '@blcklab/sekai64/gltf';
import type { AnimationAction } from '@blcklab/sekai64/animation';

/** rc.33's conversion uses a different order from its XYZ compose operation. */
export function setNodeQuaternion(node: Node, values: ArrayLike<number>): void {
  const x = values[0]!, y = values[1]!, z = values[2]!, w = values[3]!;
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error('Invalid rotation quaternion.');
  const qx = x / length, qy = y / length, qz = z / length, qw = w / length;
  const m13 = Math.max(-1, Math.min(1, 2 * (qx * qz + qy * qw)));
  const pitch = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) {
    node.rotation.set(Math.atan2(2 * (qx * qw - qy * qz), 1 - 2 * (qx * qx + qy * qy)), pitch,
      Math.atan2(2 * (qz * qw - qx * qy), 1 - 2 * (qy * qy + qz * qz)), 'XYZ');
  } else node.rotation.set(Math.atan2(2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qz * qz)), pitch, 0, 'XYZ');
}
export function correctGltfRestRotations(context: GltfAnimationFinalizeContext): void {
  for (const [index, nodes] of context.nodes) {
    const rotation = context.document.nodes?.[index]?.rotation;
    if (rotation) for (const node of nodes) setNodeQuaternion(node, rotation);
  }
  context.scene.updateWorldFromRoot();
}
export function correctSampledRotations(actions: readonly AnimationAction[], nodes: ReadonlyMap<string, Node>): void {
  const values = new Map<string, { q: Quaternion; weight: number }>();
  for (const action of actions) {
    // Finished once-actions still contribute their terminal sample for this frame.
    if (!action.enabled || action.paused || action.weight <= 0) continue;
    for (const track of action.clip.tracks) {
      if (track.path !== 'rotation') continue;
      const q = new Quaternion().fromArray(track.sample(action.time)).normalize();
      const prior = values.get(track.target);
      if (prior) { prior.q.slerp(q, action.weight / (prior.weight + action.weight)); prior.weight += action.weight; }
      else values.set(track.target, { q, weight: action.weight });
    }
  }
  for (const [id, { q }] of values) { const node = nodes.get(id); if (node) setNodeQuaternion(node, [q.x, q.y, q.z, q.w]); }
}
