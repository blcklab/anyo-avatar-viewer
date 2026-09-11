# VRMA support — 0.2.0-alpha.1

VRMA loading is now built into the Sekai64 integration. The core remains framework/renderer independent. No Three.js, FBX loader, framework adapter or new runtime dependency was added.

```ts
const runtime = await createSekai64AvatarViewer({ canvas });
await runtime.viewer.loadModel({ url: '/me.vrm', format: 'vrm' });
await runtime.viewer.loadAnimation({ url: '/idle.vrma', format: 'vrma' });
const clip = runtime.viewer.getSnapshot().clips.at(-1);
if (clip) runtime.viewer.play(clip.id, { loop: 'repeat' });
```

The browser demo now accepts `.vrma` from its animation picker. A VRMA file does not necessarily contain blink tracks; when it does, the target avatar must provide matching expressions. This release does not synthesize automatic blinking or a relaxed standing pose.

## Support matrix

| Feature | Behavior |
| --- | --- |
| Binary VRMA / `VRMC_vrm_animation` 1.0 | Supported; URL, data URL, or blob source |
| VRM 1 target humanoid | Supported via bone-to-node-index mapping |
| VRM 0 target humanoid | Supported with X/Z coordinate conversion and legacy thumb mapping |
| Finger bones | Supported when mapped by both assets |
| Different T-pose rest rotations | Converted through normalized rotations, then into target local space |
| Different avatar proportions | Hips displacement scaled by source/target rest hips heights |
| Optional bone absent from target | Folded into mapped descendants where possible; diagnostic emitted |
| Source bone absent from animation | Target stays at its captured rest pose |
| Animated required bone absent from target | Load fails |
| Preset/custom morph expressions | Supported with per-mesh bind indices and weights |
| Blink | Supported; falls back to both `blinkLeft` and `blinkRight` if combined blink is absent |
| Binary expressions / overrideBlink | Supported; overrides cover block and blend |
| Missing avatar expression | Channel omitted with diagnostic; a file with no usable channels fails |
| LINEAR / STEP | Supported, including exact STEP key boundaries |
| Multiple animations in one VRMA | Imported with unique IDs |
| CUBICSPLINE | Explicit rejection; export baked LINEAR/STEP tracks |
| Animated lookAt/gaze | Not implemented; rejects by default |
| Material-color / texture expression binds | Not implemented; animated affected expressions reject by default |
| Draft or unknown VRMA versions | Explicit rejection |
| Meshes embedded in VRMA | Rejected; use animation-only files |
| Non-uniform, mirrored or sheared bone transforms | Rejected by the retargeter |
| FBX / BVH | Not supported |

This is forward-kinematic retargeting, not an IK/contact solver. Differences in limb lengths can cause foot sliding or hand-contact differences. Rest poses must represent the intended VRM T-pose; converting arbitrary A-poses into a T-pose is not performed. The importer accepts partial humanoid declarations useful for head/facial clips but is not a complete VRMA schema validator.

Hips translation needs positive source and target rest hips heights. Motion remains in model space, so an authored walk can move the avatar out of the fixed viewport. The viewer's display normalization is applied after the captured rig data and is not multiplied into the retargeting ratio a second time.

When optional ancestors are folded, multi-track LINEAR rotation products are baked at 60 samples/second by default plus original key times. `bakeRate` allows 1–120; the bake limit is 100,000 samples per folded track. STEP chains preserve their key boundaries. Mixed STEP/LINEAR chains requiring folding reject and should be baked in the authoring tool first. This is an approximation between baked keys. Existing limitations for partial-track crossfades and interrupted fades still apply.

## Diagnostics and deliberate partial playback

```ts
const runtime = await createSekai64AvatarViewer({
  canvas,
  onDiagnostic(message) { console.warn(message); },
  // Optional: accept body/morph motion while omitting unsupported gaze/material tracks.
  vrma: { unsupportedFeatures: 'skip', bakeRate: 60 },
});
```

Default `unsupportedFeatures: 'error'` prevents a file containing unsupported animated gaze/material behavior from appearing fully supported. `skip` omits those tracks and reports why. It does not bypass malformed data, incompatible ancestry, invalid scale or interpolation errors. The demo uses the default error policy and shows diagnostics below playback controls.

To configure an importer directly, use `createVrmAnimationImporter(options)` in `importers`. Custom importers are checked before the built-ins.

## Implementation references

VRMA's node mappings distinguish humanoid rotation, hips translation, expressions and gaze. Expression weights come from translation X and are clamped after sampling. The implementation follows those concepts in the [VRMA 1.0 specification](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md).

Rest-rotation conversion, optional-ancestor folding and hips scaling follow the approach described in [Pose Data Compatibility](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md). The quaternion algebra is implemented locally against Sekai64; no upstream implementation code was copied.

VRM 0 axis differences were cross-checked with the official [three-vrm VRMA target conversion](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-animation/src/createVRMAnimationClip.ts). This package does not depend on Three.js.
