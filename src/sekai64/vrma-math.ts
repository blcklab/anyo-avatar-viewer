import { Matrix4, Quaternion, Vector3 } from '@blcklab/sekai64';
export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];
export const identity: Quat = [0, 0, 0, 1];
export function multiply(a: Quat, b: Quat): Quat {
  const q = new Quaternion(...a).multiply(new Quaternion(...b)).normalize();
  return [q.x, q.y, q.z, q.w];
}
export function inverse(q: Quat): Quat { return [-q[0], -q[1], -q[2], q[3]]; }
export function normalize(values: ArrayLike<number>, offset = 0): Quat {
  const q = [values[offset]!, values[offset + 1]!, values[offset + 2]!, values[offset + 3]!] as const;
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error('Invalid VRMA rotation quaternion.');
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}
export function matrix(values: readonly number[]): Matrix4 { const m = new Matrix4(); m.elements.set(values); return m; }
export function position(m: Matrix4): Vec3 { return [m.elements[12]!, m.elements[13]!, m.elements[14]!]; }
export function transform(p: Vec3, m: Matrix4): Vec3 { const v = new Vector3(...p).applyMatrix4(m); return [v.x, v.y, v.z]; }
/** Positive uniform scale only. Non-uniform scale/shear makes quaternion FK ambiguous. */
export function rotation(m: Matrix4): Quat {
  const e = m.elements;
  const sx = Math.hypot(e[0]!, e[1]!, e[2]!), sy = Math.hypot(e[4]!, e[5]!, e[6]!), sz = Math.hypot(e[8]!, e[9]!, e[10]!);
  if (sx < 1e-8 || Math.abs(sx - sy) > 1e-4 || Math.abs(sx - sz) > 1e-4) throw new Error('VRMA retargeting requires positive uniform rig scale.');
  const a = e[0]! / sx, b = e[4]! / sy, c = e[8]! / sz, d = e[1]! / sx, f = e[5]! / sy, g = e[9]! / sz, h = e[2]! / sx, i = e[6]! / sy, j = e[10]! / sz;
  const det = a * (f * j - g * i) - b * (d * j - g * h) + c * (d * i - f * h);
  if (Math.abs(det - 1) > 1e-4) throw new Error('VRMA retargeting does not support mirrored or sheared rigs.');
  let q: Quat;
  const trace = a + f + j;
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; q = [(i - g) / s, (c - h) / s, (d - b) / s, s / 4]; }
  else if (a > f && a > j) { const s = Math.sqrt(1 + a - f - j) * 2; q = [s / 4, (b + d) / s, (c + h) / s, (i - g) / s]; }
  else if (f > j) { const s = Math.sqrt(1 + f - a - j) * 2; q = [(b + d) / s, s / 4, (g + i) / s, (c - h) / s]; }
  else { const s = Math.sqrt(1 + j - a - f) * 2; q = [(c + h) / s, (g + i) / s, s / 4, (d - b) / s]; }
  return normalize(q);
}
