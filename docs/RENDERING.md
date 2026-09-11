# Sekai64 rendering integration

## Reference mode: Sekai Viewer 0.1.10

`quality: 'sekai-viewer'` is the default visual path. It mirrors the supplied Sekai Viewer 0.1.10 presentation behavior on Sekai64 0.8.0-rc.33:

- preserve the model's authored transform
- initialize with `PRODUCT_VISUAL_PRESET`
- detect MToon after model load and switch to `CHARACTER_VISUAL_PRESET`
- 42° perspective camera with the same initial position and clipping defaults
- `#0a0c10` clear color
- the same procedural/prefiltered studio or soft environment
- the same ambient/key/fill/rim light values and model-bounds adaptation
- the same color grading, 2048 shadow cap, and minimum anisotropy behavior

Alpha.7 includes a headless `Sekai64AvatarCameraController` that mirrors Sekai Viewer's useful orbit/zoom/pan and bounds-fit behavior. The host owns only the controls UI; Vanilla/Vue/React/Svelte consumers call the same navigation API.

## Explicit normalized-world mode

Some applications need avatars normalized to a common world height. Opt into that behavior explicitly:

```ts
createSekai64AvatarViewer({
  normalization: 'target-height',
  targetHeight: 1.7,
})
```

This is **not** Sekai Viewer-exact because it changes the model's authored world transform. In this mode only, Avatar Viewer compensates MToon `worldCoordinates` outline widths by the same normalization scale. `screenCoordinates` outline widths are not modified.

## Other quality profiles

`character`, `balanced`, `performance`, and `ultra` remain available as application-specific profiles. They are useful tuning modes, but `sekai-viewer` is the reference when visual parity is the goal.


## Transparent/card presentation

The browser factory remains opaque by default for exact Sekai Viewer presentation. For portfolio cards or layered page composition, `transparent: true` enables the renderer alpha channel and defaults the clear color to transparent. An explicit `background` value can still be supplied and changed later through `runtime.visuals.setBackground(...)`.
