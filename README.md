# @blcklab/anyo-avatar-viewer

Framework-independent avatar viewer core for VRM/GLB models, VRMA and glTF animation, expressions, look-at, camera navigation, high-quality Sekai64 rendering, and browser recovery.

> `0.2.0-alpha.8` is a prerelease and is published under the `next` npm dist-tag.

## Installation

For the browser/Sekai64 integration:

```bash
npm install @blcklab/anyo-avatar-viewer@next @blcklab/anyo-avatar @blcklab/sekai64@next
```

The root controller is renderer-neutral. The `/browser` and `/sekai64` entries activate the Sekai64 integration.

## Vanilla JavaScript

```js
import { createSekai64AvatarViewer } from '@blcklab/anyo-avatar-viewer/browser'

const runtime = await createSekai64AvatarViewer({
  canvas: document.querySelector('#avatar'),
  quality: 'sekai-viewer',
  environment: 'studio',
  transparent: true,
})

await runtime.viewer.loadModel({
  url: '/avatar.vrm',
  format: 'vrm',
})

await runtime.viewer.loadAnimation({
  url: '/idle.vrma',
  format: 'vrma',
})

const clip = runtime.viewer.getSnapshot().clips[0]
if (clip) runtime.viewer.play(clip.id, { loop: 'repeat' })

runtime.navigation.focus('face')
runtime.navigation.fit()
```

## Model and animation support

- VRM 0.x/1.0, GLB, and glTF models
- Embedded glTF animation clips
- External same-rig GLB/glTF animation
- VRMA 1.0 humanoid retargeting, fingers, expressions, blink handling, and secondary-node exact-match pass-through
- Play, pause, resume, stop, seek, playback speed, repeat/once, and crossfades

Separate glTF animation files must use a compatible rig/rest hierarchy. Use VRMA for portable humanoid animation across VRM characters.

## Camera and interaction

The browser runtime exposes headless navigation APIs for orbit, zoom, pan, fit/reset, auto-rotate, and body/face/eyes focus. Frameworks can bind controls to these APIs without duplicating camera logic.

```js
runtime.navigation.zoomIn()
runtime.navigation.rotateLeft()
runtime.navigation.panBy(20, -10)
runtime.navigation.focus('eyes')
runtime.navigation.resetView()
```

## Expressions and look-at

```js
runtime.viewer.setExpression('happy', 1)
runtime.viewer.setLookAt([0, 1.7, -2], {
  space: 'world',
  eyes: true,
  head: true,
  neck: true,
})
```

## Rendering

`quality: 'sekai-viewer'` preserves authored model transforms and follows the Sekai Viewer presentation path. Additional `character`, `ultra`, `balanced`, and `performance` profiles are available. Studio/soft/no-environment modes, shadows, exposure, opaque backgrounds, and transparent canvas output are configurable.

See [Rendering](docs/RENDERING.md).

## State and lifecycle

`viewer`, `navigation`, and `recovery` expose immutable snapshots and subscriptions suitable for Vanilla JS, Vue, React, Svelte, or other host layers. The browser runtime owns one frame loop; do not advance the viewer from a second animation loop.

Dispose resources when the host unmounts:

```js
await runtime.dispose()
```

## Documentation

- [Core capabilities](docs/CORE-CAPABILITIES.md)
- [Rendering](docs/RENDERING.md)
- [VRMA support](docs/VRMA.md)

## License

MIT
