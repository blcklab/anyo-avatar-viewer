import { Vector3, type Camera } from '@blcklab/sekai64';
import { OrbitControls } from '@blcklab/sekai64/controls';
import type { GltfModelNode } from '@blcklab/sekai64/gltf';
import type { ViewerBounds, ViewerVec3 } from '../types.js';
import {
  getNodeWorldBounds,
  getViewerBounds,
  resolveFocusPoint,
  resolveFrameRegion,
  resolveViewAzimuth,
  type Sekai64FocusPreset,
  type Sekai64FramePreset,
  type Sekai64FrameRegion,
  type Sekai64ViewPreset,
} from './model-info.js';

export interface Sekai64AvatarCameraOptions {
  readonly camera: Camera;
  readonly eventTarget?: EventTarget;
  readonly pointerPan?: boolean;
  readonly autoFit?: boolean;
  readonly rotateSpeed?: number;
  readonly zoomSpeed?: number;
  readonly damping?: number;
}
export interface Sekai64FrameOptions {
  /** Fraction of the viewport the semantic frame should occupy. Defaults are preset-specific. */
  readonly coverage?: number;
  /** Horizontal target offset in frame-width units. Positive moves the camera target right. */
  readonly offsetX?: number;
  /** Vertical target offset in frame-height units. Positive moves the camera target up. */
  readonly offsetY?: number;
  /** Recompute distance when the render surface changes aspect/size. Defaults to false. */
  readonly responsive?: boolean;
}
export interface Sekai64ViewOptions {
  /** Vertical orbit in radians. 0 is eye-level; positive places the camera above the target. */
  readonly elevation?: number;
}
export interface Sekai64FrameState {
  readonly preset: Sekai64FramePreset;
  readonly coverage: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly responsive: boolean;
}
export interface Sekai64AvatarCameraSnapshot {
  readonly target: ViewerVec3;
  readonly position: ViewerVec3;
  readonly distance: number;
  /** Horizontal camera orbit in radians. 0 is +Z, positive rotates toward +X. */
  readonly azimuth: number;
  /** Vertical camera orbit in radians. 0 is eye-level; positive is above the target. */
  readonly elevation: number;
  readonly enabled: boolean;
  readonly autoRotate: boolean;
  readonly autoRotateSpeed: number;
  readonly bounds: ViewerBounds | null;
  readonly framing: Sekai64FrameState | null;
}

/** Headless Sekai Viewer-style camera/navigation controller. It owns no UI or CSS. */
export class Sekai64AvatarCameraController {
  readonly controls: OrbitControls;
  private model?: GltfModelNode;
  private authoredRotation?: readonly [number, number, number];
  private autoRotateValue = false;
  private autoRotateSpeedValue = 0.28;
  private disposed = false;
  private readonly initialViewDirection = new Vector3(1, 0.56, 1).normalize();
  private panPointer?: number;
  private panX = 0;
  private panY = 0;
  private readonly eventTarget?: EventTarget;
  private readonly pointerPan: boolean;
  private framing?: Sekai64FrameState;
  private framingRegion?: Sekai64FrameRegion;
  private framingViewport = '';
  private listeners = new Set<() => void>();
  private lastSignature = '';
  private snapshot!: Sekai64AvatarCameraSnapshot;

  constructor(private readonly options: Sekai64AvatarCameraOptions) {
    this.eventTarget = options.eventTarget;
    this.pointerPan = options.pointerPan ?? true;
    const inputTarget = options.eventTarget ?? new EventTarget();
    this.controls = new OrbitControls({
      camera: options.camera,
      eventTarget: inputTarget,
      target: [0, 0.9, 0],
      rotateSpeed: options.rotateSpeed ?? 0.0027,
      zoomSpeed: options.zoomSpeed ?? 0.00068,
      minDistance: 0.08,
      maxDistance: 5000,
      minPolarAngle: 0.06,
      maxPolarAngle: Math.PI - 0.06,
      damping: options.damping ?? 0.24,
    });
    if (this.pointerPan && this.eventTarget) this.attachPan();
    this.lastSignature = this.signature();
    this.snapshot = this.createSnapshot();
  }

  attachModel(model: GltfModelNode): void {
    this.assertAlive();
    this.model = model;
    this.authoredRotation = [model.rotation.x, model.rotation.y, model.rotation.z];
    if (this.framing) this.applyFrame(this.framing, true);
    else if (this.options.autoFit !== false) this.fitModel();
    this.notifyIfChanged();
  }
  detachModel(model?: GltfModelNode): void {
    if (model && this.model !== model) return;
    this.model = undefined;
    this.authoredRotation = undefined;
    this.framingRegion = undefined;
    this.notifyIfChanged();
  }
  getBounds(): ViewerBounds | null { return this.model ? getViewerBounds(this.model) : null; }
  /** Subscribe to camera state changes for framework/store adapters. */
  subscribe(listener: () => void): () => void {
    this.assertAlive(); this.listeners.add(listener); return () => this.listeners.delete(listener);
  }

  /** Full authored-model fit. Use `frame('portrait')` for semantic upper-body framing. */
  fit(): void {
    this.assertAlive();
    this.clearFraming(false);
    this.fitModel();
  }
  resetView(): void {
    this.assertAlive();
    this.clearFraming(false);
    if (this.model && !this.model.disposed && this.authoredRotation) this.model.rotation.set(...this.authoredRotation);
    this.fitModel();
    this.notifyIfChanged();
  }
  focus(preset: Sekai64FocusPreset): void {
    this.assertAlive();
    this.clearFraming(false);
    if (preset === 'body') { this.fitModel(); return; }
    const model = this.model;
    if (!model || model.disposed) return;
    const bounds = getNodeWorldBounds(model);
    if (!bounds || bounds.isEmpty()) return;
    const size = bounds.getSize(new Vector3());
    const target = resolveFocusPoint(model, preset, bounds);
    const height = Math.max(size.y, 0.001);
    const depth = Math.max(size.z, 0.001);
    const distance = preset === 'eyes'
      ? Math.max(height * 0.26, depth * 1.35, this.controls.minDistance * 1.5)
      : Math.max(height * 0.43, depth * 2.0, this.controls.minDistance * 2);
    this.focusVector(target, distance);
  }
  /**
   * Responsive semantic framing. `portrait` includes authored hair plus upper torso/shoulders
   * instead of fitting the avatar's entire body or T-pose width.
   */
  frame(preset: Sekai64FramePreset = 'body', options: Sekai64FrameOptions = {}): void {
    this.assertAlive();
    const state = normalizeFrameState(preset, options);
    this.framing = state;
    this.framingViewport = this.viewportSignature();
    this.applyFrame(state, true);
  }
  clearFrame(): void { this.assertAlive(); this.clearFraming(true); }
  focusAt(target: ViewerVec3, distance = this.controls.getDistance()): void {
    this.assertAlive(); validateVector(target, 'focus target');
    this.clearFraming(false);
    this.focusVector(new Vector3(...target), distance);
    this.notifyIfChanged();
  }
  focusHeight(ratio: number, distance = this.controls.getDistance()): void {
    this.assertAlive();
    if (!Number.isFinite(ratio)) throw new Error('Focus height ratio must be finite.');
    this.clearFraming(false);
    const model = this.model;
    if (!model || model.disposed) return;
    const bounds = getNodeWorldBounds(model);
    if (!bounds || bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const clamped = Math.max(0, Math.min(1, ratio));
    center.y = bounds.min.y + (bounds.max.y - bounds.min.y) * clamped;
    this.focusVector(center, distance);
    this.notifyIfChanged();
  }
  focusUp(step = 0.035): void { this.clearFraming(false); this.nudgeFocus(Math.abs(step)); }
  focusDown(step = 0.035): void { this.clearFraming(false); this.nudgeFocus(-Math.abs(step)); }
  getFocusTarget(): ViewerVec3 { return tuple(this.controls.target); }
  zoomIn(): void { this.zoomBy(0.84); }
  zoomOut(): void { this.zoomBy(1.19); }
  rotateLeft(): void { this.rotateBy(-Math.PI / 14); }
  rotateRight(): void { this.rotateBy(Math.PI / 14); }
  /** Relative orbit rotation in radians. */
  rotateBy(angle: number): void {
    this.assertAlive(); finite(angle, 'rotation angle');
    this.rotateAroundTarget(angle);
  }
  /**
   * Absolute horizontal orbit in radians. 0 places the camera on +Z looking at the target.
   * Distance, elevation and active semantic framing are preserved.
   */
  setAzimuth(angle: number): void {
    this.assertAlive(); finite(angle, 'azimuth');
    const target = this.controls.target;
    const offset = this.options.camera.position.clone().sub(target);
    const horizontal = Math.hypot(offset.x, offset.z);
    if (horizontal < 1e-8) {
      const distance = Math.max(this.controls.minDistance, offset.length());
      offset.x = Math.sin(angle) * distance;
      offset.z = Math.cos(angle) * distance;
      offset.y = 0;
    } else {
      offset.x = Math.sin(angle) * horizontal;
      offset.z = Math.cos(angle) * horizontal;
    }
    this.options.camera.position.copy(target).add(offset);
    this.controls.syncFromCamera();
    this.controls.update(0);
    this.notifyIfChanged();
  }
  /** Absolute vertical orbit in radians. 0 is eye-level; positive is above the target. */
  setElevation(angle: number): void {
    this.assertAlive(); finite(angle, 'elevation');
    const maxElevation = Math.PI * 0.5 - 0.06;
    const clamped = Math.max(-maxElevation, Math.min(maxElevation, angle));
    const target = this.controls.target;
    const offset = this.options.camera.position.clone().sub(target);
    const distance = Math.max(this.controls.minDistance, offset.length());
    const azimuth = this.getAzimuth();
    const horizontal = Math.cos(clamped) * distance;
    offset.x = Math.sin(azimuth) * horizontal;
    offset.z = Math.cos(azimuth) * horizontal;
    offset.y = Math.sin(clamped) * distance;
    this.options.camera.position.copy(target).add(offset);
    this.controls.syncFromCamera();
    this.controls.update(0);
    this.notifyIfChanged();
  }
  /**
   * Version-aware semantic orbit. `front` follows VRM's authored forward axis:
   * VRM 0.x = Z-, VRM 1.0 = Z+. Generic glTF falls back to Z+.
   * Pass `elevation` when a view should also define its vertical presentation angle.
   */
  setView(preset: Sekai64ViewPreset, options: Sekai64ViewOptions = {}): void {
    this.assertAlive();
    const model = this.model;
    if (!model || model.disposed) return;
    this.setAzimuth(resolveViewAzimuth(model, preset));
    if (options.elevation !== undefined) this.setElevation(options.elevation);
  }
  panBy(x: number, y: number): void {
    this.assertAlive(); finite(x, 'pan x'); finite(y, 'pan y');
    const distance = this.options.camera.position.distanceTo(this.controls.target);
    const scale = Math.max(0.0001, distance * 0.00105);
    this.options.camera.updateWorldFromRoot();
    const e = this.options.camera.worldMatrix.elements;
    const right = new Vector3(e[0] ?? 1, e[1] ?? 0, e[2] ?? 0).normalize();
    const up = new Vector3(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0).normalize();
    const offset = right.multiplyScalar(-x * scale).add(up.multiplyScalar(y * scale));
    this.options.camera.position.add(offset);
    this.controls.target.add(offset);
    this.controls.syncFromCamera();
    this.options.camera.lookAt(this.controls.target);
    this.notifyIfChanged();
  }
  setAutoRotate(enabled: boolean): void { this.assertAlive(); this.autoRotateValue = enabled; this.notifyIfChanged(); }
  setAutoRotateSpeed(speed: number): void { this.assertAlive(); finite(speed, 'auto-rotate speed'); this.autoRotateSpeedValue = speed; this.notifyIfChanged(); }
  setEnabled(enabled: boolean): void { this.assertAlive(); enabled ? this.controls.resume() : this.controls.pause(); this.notifyIfChanged(); }
  update(deltaSeconds: number): void {
    if (this.disposed) return;
    if (this.framing?.responsive) {
      const viewport = this.viewportSignature();
      if (viewport && viewport !== this.framingViewport) {
        this.framingViewport = viewport;
        this.applyFrame(this.framing, false);
      }
    }
    this.controls.update(deltaSeconds);
    if (this.autoRotateValue && this.model && !this.model.disposed) this.model.rotation.y += this.autoRotateSpeedValue * Math.max(0, deltaSeconds);
    this.notifyIfChanged();
  }
  /** Stable immutable snapshot until camera/model state changes. */
  getSnapshot(): Sekai64AvatarCameraSnapshot { return this.snapshot; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachPan();
    this.controls.dispose();
    this.listeners.clear();
    this.model = undefined;
    this.framing = undefined;
    this.framingRegion = undefined;
  }

  private fitModel(): void {
    const model = this.model;
    if (!model || model.disposed) return;
    const bounds = getNodeWorldBounds(model);
    if (!bounds || bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
    const radius = Math.max(0.001, size.length() * 0.5);
    const fovRadians = ((this.options.camera as any).fieldOfView * Math.PI) / 180;
    const fitDistance = Math.max(radius / Math.sin(Math.max(0.12, fovRadians * 0.5)), maxDimension * 1.1) * 1.18;
    this.controls.target.copy(center);
    this.options.camera.near = Math.max(0.001, fitDistance / 1000);
    this.options.camera.far = Math.max(100, fitDistance * 80);
    this.options.camera.position.copy(center).addScaledVector(this.initialViewDirection, fitDistance);
    this.controls.minDistance = Math.max(radius * 0.08, 0.02);
    this.controls.maxDistance = Math.max(fitDistance * 12, radius * 20);
    this.controls.syncFromCamera();
    this.controls.update(0);
    this.notifyIfChanged();
  }
  private applyFrame(state: Sekai64FrameState, recomputeRegion: boolean): void {
    const model = this.model;
    if (!model || model.disposed) return;
    let region = this.framingRegion;
    if (recomputeRegion || !region) {
      const bounds = getNodeWorldBounds(model);
      if (!bounds || bounds.isEmpty()) return;
      region = resolveFrameRegion(model, state.preset, bounds);
      this.framingRegion = region;
    }
    const target = region.target.clone();
    target.x += region.width * state.offsetX;
    target.y += region.height * state.offsetY;

    const fovRadians = ((this.options.camera as any).fieldOfView * Math.PI) / 180;
    const tanHalfVertical = Math.max(0.001, Math.tan(Math.max(0.12, fovRadians * 0.5)));
    const aspect = this.viewportAspect();
    const verticalDistance = (region.height * 0.5) / (tanHalfVertical * state.coverage);
    const horizontalDistance = (region.width * 0.5) / (tanHalfVertical * Math.max(0.1, aspect) * state.coverage);
    const depthAllowance = region.depth * 0.5;
    const distance = Math.max(verticalDistance, horizontalDistance) + depthAllowance;
    this.focusVector(target, distance);
  }
  private focusVector(target: Vector3, distance: number): void {
    const safeDistance = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, distance));
    this.options.camera.near = Math.max(0.001, safeDistance / 1200);
    this.options.camera.far = Math.max(100, safeDistance * 120);
    // Keep the current orbit direction while changing semantic target/distance. This makes
    // responsive framing composable with setView()/user orbit instead of snapping back to
    // whatever default direction the underlying controls choose for focus().
    const direction = this.options.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSquared() < 1e-12) direction.copy(this.initialViewDirection);
    direction.normalize();
    this.controls.target.copy(target);
    this.options.camera.position.copy(target).addScaledVector(direction, safeDistance);
    this.controls.syncFromCamera();
    this.controls.update(0);
    this.notifyIfChanged();
  }
  private nudgeFocus(step: number): void {
    const model = this.model;
    if (!model || model.disposed) return;
    const bounds = getNodeWorldBounds(model);
    if (!bounds || bounds.isEmpty()) return;
    const height = Math.max(bounds.max.y - bounds.min.y, 0.001);
    const target = this.controls.target.clone();
    target.y = Math.max(bounds.min.y, Math.min(bounds.max.y, target.y + height * step));
    this.focusVector(target, this.controls.getDistance());
  }
  private zoomBy(factor: number): void {
    const target = this.controls.target;
    const offset = this.options.camera.position.clone().sub(target);
    const distance = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, offset.length() * factor));
    if (offset.lengthSquared() < 1e-12) offset.copy(this.initialViewDirection);
    offset.setLength(distance);
    this.options.camera.position.copy(target).add(offset);
    this.controls.syncFromCamera();
    this.notifyIfChanged();
  }
  private rotateAroundTarget(angle: number): void {
    const target = this.controls.target;
    const offset = this.options.camera.position.clone().sub(target);
    const cosine = Math.cos(angle); const sine = Math.sin(angle);
    const x = offset.x * cosine - offset.z * sine;
    const z = offset.x * sine + offset.z * cosine;
    offset.x = x; offset.z = z;
    this.options.camera.position.copy(target).add(offset);
    this.controls.syncFromCamera();
    this.controls.update(0);
    this.notifyIfChanged();
  }
  private getAzimuth(): number {
    const offset = this.options.camera.position.clone().sub(this.controls.target);
    return Math.atan2(offset.x, offset.z);
  }
  private getElevation(): number {
    const offset = this.options.camera.position.clone().sub(this.controls.target);
    return Math.atan2(offset.y, Math.hypot(offset.x, offset.z));
  }
  private clearFraming(notify: boolean): void {
    if (!this.framing) return;
    this.framing = undefined;
    this.framingRegion = undefined;
    this.framingViewport = '';
    if (notify) this.notifyIfChanged();
  }
  private viewportAspect(): number {
    const target = this.eventTarget as any;
    const width = Number(target?.clientWidth ?? target?.width ?? 0);
    const height = Number(target?.clientHeight ?? target?.height ?? 0);
    if (width > 0 && height > 0) return width / height;
    const cameraAspect = Number((this.options.camera as any).aspect ?? (this.options.camera as any).aspectRatio ?? 1);
    return Number.isFinite(cameraAspect) && cameraAspect > 0 ? cameraAspect : 1;
  }
  private viewportSignature(): string {
    const target = this.eventTarget as any;
    const width = Number(target?.clientWidth ?? target?.width ?? 0);
    const height = Number(target?.clientHeight ?? target?.height ?? 0);
    return width > 0 && height > 0 ? `${Math.round(width)}x${Math.round(height)}` : `aspect:${this.viewportAspect().toFixed(4)}`;
  }
  private attachPan(): void {
    this.eventTarget!.addEventListener('pointerdown', this.onPointerDown as EventListener);
    this.eventTarget!.addEventListener('pointermove', this.onPointerMove as EventListener);
    this.eventTarget!.addEventListener('pointerup', this.onPointerEnd as EventListener);
    this.eventTarget!.addEventListener('pointercancel', this.onPointerEnd as EventListener);
    this.eventTarget!.addEventListener('contextmenu', this.onContextMenu as EventListener);
  }
  private detachPan(): void {
    this.eventTarget?.removeEventListener('pointerdown', this.onPointerDown as EventListener);
    this.eventTarget?.removeEventListener('pointermove', this.onPointerMove as EventListener);
    this.eventTarget?.removeEventListener('pointerup', this.onPointerEnd as EventListener);
    this.eventTarget?.removeEventListener('pointercancel', this.onPointerEnd as EventListener);
    this.eventTarget?.removeEventListener('contextmenu', this.onContextMenu as EventListener);
  }
  private onPointerDown = (event: PointerEvent) => {
    if (!this.controls.enabled || (event.button !== 1 && event.button !== 2)) return;
    this.panPointer = event.pointerId; this.panX = event.clientX; this.panY = event.clientY;
  };
  private onPointerMove = (event: PointerEvent) => {
    if (this.panPointer !== event.pointerId) return;
    const dx = event.clientX - this.panX; const dy = event.clientY - this.panY;
    this.panX = event.clientX; this.panY = event.clientY; this.panBy(dx, dy);
  };
  private onPointerEnd = (event: PointerEvent) => { if (this.panPointer === event.pointerId) this.panPointer = undefined; };
  private onContextMenu = (event: Event) => { if (this.pointerPan) event.preventDefault(); };
  private signature(): string {
    const p = this.options.camera.position, t = this.controls.target;
    const frame = this.framing ? `${this.framing.preset},${this.framing.coverage},${this.framing.offsetX},${this.framing.offsetY},${this.framing.responsive ? 1 : 0}` : 'none';
    return `${this.model?.id ?? 'none'}|${frame}|` + [p.x,p.y,p.z,t.x,t.y,t.z,this.controls.getDistance(),this.controls.enabled ? 1 : 0,this.autoRotateValue ? 1 : 0,this.autoRotateSpeedValue].map(value => Number(value).toFixed(6)).join('|');
  }
  private notifyIfChanged(): void {
    const next = this.signature();
    if (next === this.lastSignature) return;
    this.lastSignature = next;
    this.snapshot = this.createSnapshot();
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* UI observers do not own camera state. */ } }
  }
  private createSnapshot(): Sekai64AvatarCameraSnapshot {
    return Object.freeze({
      target: tuple(this.controls.target),
      position: tuple(this.options.camera.position),
      distance: this.controls.getDistance(),
      azimuth: this.getAzimuth(),
      elevation: this.getElevation(),
      enabled: this.controls.enabled,
      autoRotate: this.autoRotateValue,
      autoRotateSpeed: this.autoRotateSpeedValue,
      bounds: this.getBounds(),
      framing: this.framing ? Object.freeze({ ...this.framing }) : null,
    });
  }
  private assertAlive(): void { if (this.disposed) throw new Error('Avatar camera controller is disposed.'); }
}

function normalizeFrameState(preset: Sekai64FramePreset, options: Sekai64FrameOptions): Sekai64FrameState {
  const defaultCoverage = preset === 'portrait' ? 0.84 : preset === 'face' ? 0.86 : preset === 'eyes' ? 0.88 : 0.90;
  const coverage = options.coverage ?? defaultCoverage;
  if (!Number.isFinite(coverage) || coverage <= 0.1 || coverage > 0.98) throw new Error('Frame coverage must be > 0.1 and <= 0.98.');
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;
  finite(offsetX, 'frame offsetX'); finite(offsetY, 'frame offsetY');
  return Object.freeze({ preset, coverage, offsetX, offsetY, responsive: options.responsive ?? false });
}
function tuple(value: Vector3): ViewerVec3 { return Object.freeze([value.x, value.y, value.z]) as ViewerVec3; }
function finite(value: number, name: string) { if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`); }
function validateVector(value: ViewerVec3, name: string) { if (value.length !== 3 || value.some(component => !Number.isFinite(component))) throw new Error(`${name} must contain three finite numbers.`); }
