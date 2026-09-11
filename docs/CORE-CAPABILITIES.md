# Reusable core capability surface — 0.2.0-alpha.7

This document defines what belongs in `@blcklab/anyo-avatar-viewer` before any Vue, React, Svelte, or other adapter is introduced.

## Public layers

```text
@blcklab/anyo-avatar-viewer
  Renderer/DOM/framework-neutral avatar controller

@blcklab/anyo-avatar-viewer/browser
  First-class vanilla-JavaScript Sekai64 runtime

@blcklab/anyo-avatar-viewer/sekai64
  Lower-level Sekai64 backend/importer/presentation APIs
```

The package creates no buttons, menus, custom elements, framework components, or global CSS.

## Core avatar controller

`AvatarViewer` owns the active avatar session and provides:

- transactional VRM/GLB/glTF replacement;
- embedded and external animation libraries;
- VRMA humanoid/expression retargeting and compatible GLB/glTF animation;
- play, pause, resume, stop, seek, speed, once/repeat and crossfade;
- immutable stable snapshots and subscriptions;
- cancellation, unload and idempotent disposal;
- stable model bounds;
- direct VRM expressions;
- additive look-at layered over animation.

## Browser/Sekai64 presentation runtime

`createSekai64AvatarViewer()` additionally owns one Sekai64 engine, scene, camera and frame loop and exposes:

- Sekai Viewer 0.1.10 exact visual/presentation path by default;
- quality/environment/background/shadow controls;
- optional transparent-canvas output;
- orbit, wheel zoom and middle/right drag pan;
- bounds-based fit/reset;
- body, face and eyes focus presets;
- programmatic focus, zoom, rotate and pan;
- optional model auto-rotation;
- stable camera snapshots/subscriptions;
- automatic WebGL context/WebGPU device recovery with observable state;
- manual recovery retry when a host wants explicit control.

## Framework contract

A framework adapter should only:

1. own the canvas DOM element and framework lifetime;
2. create one browser runtime after mount;
3. subscribe to `viewer`, `navigation`, and `recovery` snapshots;
4. map component props/events to the public methods;
5. dispose the runtime on unmount.

It must not duplicate loaders, animation clocks, retargeting, camera math, expression state, look-at math, renderer recovery, or visual-quality configuration.

## Host/application concerns

These stay outside the avatar core deliberately:

- HTML/buttons/toolbars and a `More` menu;
- fullscreen UX and screenshot/download UX;
- page layout and card styling;
- scene props such as desks, computers, rooms and chairs;
- orchestration of multiple independent avatar sessions;
- application animation state machines/world behavior.

A host may use `runtime.scene` for environment props without making them avatar sessions.

## Current non-goals / future extensions

The current reusable viewer scope does not claim complete avatar/world-engine coverage. Future capabilities may include FBX/BVH importers, VRMA gaze/material animation, VRM spring-bone simulation, procedural idle behavior, root-motion extraction, animation state machines/layers, and higher-level multi-avatar orchestration.
