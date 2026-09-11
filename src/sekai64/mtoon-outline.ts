import { Mesh, type Node } from '@blcklab/sekai64';
import { StandardMaterial } from '@blcklab/sekai64/materials';

/**
 * Sekai64 renders MToon `worldCoordinates` outline width in world units after
 * the mesh model transform. Avatar Viewer may normalize a VRM by changing the
 * model root scale, so the authored outline width must be scaled by the same
 * factor or it can become dramatically oversized relative to the avatar.
 *
 * Screen-coordinate outlines are intentionally left untouched. Shared
 * materials are only adjusted once.
 */
export function compensateNormalizedMtoonOutlines(
  root: Node,
  normalizationScale: number,
  onDiagnostic?: (message: string) => void,
): number {
  if (!Number.isFinite(normalizationScale) || normalizationScale <= 0) {
    throw new Error('normalizationScale must be finite and positive.');
  }
  if (Math.abs(normalizationScale - 1) < 1e-6) return 0;

  const seen = new Set<StandardMaterial>();
  let adjusted = 0;
  root.traverse(node => {
    if (!(node instanceof Mesh)) return;
    const material = node.material;
    if (!(material instanceof StandardMaterial) || seen.has(material)) return;
    seen.add(material);
    if (material.shadingModel !== 'mtoon') return;
    if (material.mtoonOutlineWidthMode !== 'worldCoordinates' || material.mtoonOutlineWidth <= 0) return;

    material.mtoonOutlineWidth *= normalizationScale;
    adjusted += 1;
  });

  if (adjusted > 0) {
    onDiagnostic?.(
      `Adjusted ${adjusted} MToon world-coordinate outline material${adjusted === 1 ? '' : 's'} for avatar normalization scale ${normalizationScale.toFixed(6)}.`,
    );
  }
  return adjusted;
}
