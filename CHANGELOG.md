# Changelog

## 0.2.0-alpha.9

- Refresh peer metadata for the frozen S24 renderer line without changing Viewer runtime behavior.
- Accept `@blcklab/sekai64 >=0.8.0-0 <0.9.0` instead of pinning only `0.8.0-rc.33`.
- Accept compatible `@blcklab/anyo-avatar` `0.2.x` releases.
- Validate the existing Viewer runtime against Sekai64 `0.8.0-rc.34`; the 45-test Viewer regression suite remains green.

## 0.2.0-alpha.8

- Publish-prep: add MIT/public package metadata and keep npm contents limited to runtime/docs artifacts.

- Keep `quality: "sekai-viewer"` byte-for-byte aligned with Sekai Viewer model-aware preset behavior.
- Harden `character`, `balanced`, and `ultra` profiles for real VRMs by disabling only the extra global inverted-hull outline pass; authored MToon outlines, AA, anisotropy, IBL, color management and shadows remain intact.
- Make `transparent: true` start with a zero-alpha clear color even when a normal background value is supplied by a framework preset.
- Expose the already-installed Sekai64 animation module on the browser runtime so host scene layers can animate GLB props without creating a second frame owner.

## 0.2.0-alpha.7

- Complete the reusable interactive-viewer capability surface without adding a UI framework.
- Add renderer-neutral model bounds plus direct VRM expression and additive look-at APIs to `AvatarViewer`.
- Add headless Sekai Viewer-style camera navigation: orbit, wheel zoom, pointer pan, fit/reset, body/face/eyes focus, focus nudging, programmatic zoom/rotate/pan, and auto-rotate.
- Add stable immutable camera snapshots/subscriptions for Vue/React/Svelte external-store adapters.
- Add automatic Sekai64 WebGL context/WebGPU device recovery with retry state, module recovery, visual refresh, and host-resume semantics.
- Add optional transparent-canvas rendering for portfolio/card overlays while keeping Sekai Viewer opaque presentation as the default.
- Preserve framework independence: no controls UI, DOM construction, global CSS, Vue, React, Svelte, or Lit runtime is added.
- Expand validation to 45 tests covering the new core capabilities and recovery paths.

## 0.2.0-alpha.6

- Make vanilla JavaScript a first-class supported host with `@blcklab/anyo-avatar-viewer/browser`.
- Keep the root controller renderer/DOM/framework-neutral; browser rendering remains an explicit subpath.
- Add a plain-JavaScript contract check that rejects Vue/React/Svelte/Lit imports from package source/output.
- Update the shipped browser demo and documentation to consume only public ESM JavaScript APIs.

## 0.2.0-alpha.5

- Add `quality: "sekai-viewer"` as the exact Sekai Viewer 0.1.10 visual/presentation path.
- Preserve authored VRM/GLB transforms by default instead of normalizing every VRM to 1.7m; camera framing now owns presentation scale exactly like Sekai Viewer.
- Match Sekai Viewer camera defaults (`42°`, near `0.01`, far `10000`), product-to-character MToon preset switching, background, studio IBL, light rig, color grading, shadow cap and anisotropy floor.
- Keep `normalization: "target-height"` as an explicit compatibility mode; MToon world-coordinate outline compensation remains available only for that mode.
- Keep Avatar Viewer animation/VRMA ownership independent from the visual parity path.

## 0.2.0-alpha.4

- Fix oversized MToon inverted-hull outlines after VRM target-height normalization by scaling only `worldCoordinates` outline widths with the avatar normalization factor.
- Preserve `screenCoordinates` outline widths unchanged and deduplicate shared materials during compensation.
- Keep Sekai64 character-quality rendering, IBL, AA, anisotropy, shadows, and color grading intact instead of disabling outlines globally.

## 0.2.0-alpha.3

- Match Sekai Viewer character rendering by default with Sekai64 `CHARACTER_VISUAL_PRESET`.
- Add prefiltered procedural studio/soft environments for image-based lighting.
- Add adaptive ambient/key/fill/rim studio lighting around the loaded avatar.
- Add `performance`, `balanced`, `character`, and `ultra` quality profiles plus runtime visual controls.
- Add renderer color grading, high-quality antialiasing/anisotropy, cascaded shadows, and character outlines.
- Preserve framework independence: visual quality lives in the Sekai64 integration, not Vue/React UI code.

## 0.2.0-alpha.2

- Add opt-in `vrma.unmappedNodes: "exact-match"` for source-specific secondary animation channels.
- Secondary channels pass through only when source/target node name, local rest transform, and parent hierarchy match exactly.
- Non-matching secondary channels remain safely skippable while portable humanoid VRMA motion continues.

## 0.2.0-alpha.1

- Add VRMA 1.0 body and morph-expression import through the optional Sekai64 integration.
- Retarget bone rotations, scale hips displacement and handle VRM 0 coordinate differences.
- Preserve glTF node-index mappings for duplicate names, finger bones and exact expression binding.
- Add missing-optional-ancestor folding, binary expressions and blink override behavior.
- Add explicit unsupported-feature diagnostics and opt-in partial playback.
- Correct viewer-owned quaternion conversion and STEP key sampling for the supplied Sekai64 rc.33 peer.
- Accept `.vrma` in the browser example and add synthetic VRMA/morph test fixtures.
- Expand validation from 16 to 31 tests, including actual fetch cancellation.

FBX, gaze animation, material/texture expression animation, spring bones, automatic idle/blinking and framework adapters remain unimplemented.

## 0.1.0-alpha.1

- Initial framework-independent controller, Sekai64 integration, compatible GLB/glTF animation loading and browser example.
