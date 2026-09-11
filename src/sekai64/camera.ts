import { Vector3, type Camera } from '@blcklab/sekai64';
import { OrbitControls } from '@blcklab/sekai64/controls';
import type { GltfModelNode } from '@blcklab/sekai64/gltf';
import type { ViewerBounds, ViewerVec3 } from '../types.js';
import { getNodeWorldBounds, getViewerBounds, resolveFocusPoint, type Sekai64FocusPreset } from './model-info.js';

export interface Sekai64AvatarCameraOptions {
  readonly camera: Camera;
  readonly eventTarget?: EventTarget;
  readonly pointerPan?: boolean;
  readonly autoFit?: boolean;
  readonly rotateSpeed?: number;
  readonly zoomSpeed?: number;
  readonly damping?: number;
}
export interface Sekai64AvatarCameraSnapshot {
  readonly target: ViewerVec3;
  readonly position: ViewerVec3;
  readonly distance: number;
  readonly enabled: boolean;
  readonly autoRotate: boolean;
  readonly autoRotateSpeed: number;
  readonly bounds: ViewerBounds | null;
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
    if (this.options.autoFit !== false) this.fit();
    this.notifyIfChanged();
  }
  detachModel(model?: GltfModelNode): void {
    if (model && this.model !== model) return;
    this.model = undefined;
    this.authoredRotation = undefined;
    this.notifyIfChanged();
  }
  getBounds(): ViewerBounds | null { return this.model ? getViewerBounds(this.model) : null; }
  /** Subscribe to camera state changes for framework/store adapters. */
  subscribe(listener: () => void): () => void {
    this.assertAlive(); this.listeners.add(listener); return () => this.listeners.delete(listener);
  }

  fit(): void {
    this.assertAlive();
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
  resetView(): void {
    this.assertAlive();
    if (this.model && !this.model.disposed && this.authoredRotation) this.model.rotation.set(...this.authoredRotation);
    this.fit();
    this.notifyIfChanged();
  }
  focus(preset: Sekai64FocusPreset): void {
    this.assertAlive();
    if (preset === 'body') { this.fit(); return; }
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
  focusAt(target: ViewerVec3, distance = this.controls.getDistance()): void {
    this.assertAlive(); validateVector(target, 'focus target');
    this.focusVector(new Vector3(...target), distance);
    this.notifyIfChanged();
  }
  focusHeight(ratio: number, distance = this.controls.getDistance()): void {
    this.assertAlive();
    if (!Number.isFinite(ratio)) throw new Error('Focus height ratio must be finite.');
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
  focusUp(step = 0.035): void { this.nudgeFocus(Math.abs(step)); }
  focusDown(step = 0.035): void { this.nudgeFocus(-Math.abs(step)); }
  getFocusTarget(): ViewerVec3 { return tuple(this.controls.target); }
  zoomIn(): void { this.zoomBy(0.84); }
  zoomOut(): void { this.zoomBy(1.19); }
  rotateLeft(): void { this.rotateBy(-Math.PI / 14); }
  rotateRight(): void { this.rotateBy(Math.PI / 14); }
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
  }

  private focusVector(target: Vector3, distance: number): void {
    const safeDistance = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, distance));
    this.options.camera.near = Math.max(0.001, safeDistance / 1200);
    this.options.camera.far = Math.max(100, safeDistance * 120);
    this.controls.focus(target, safeDistance);
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
  private rotateBy(angle: number): void {
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
    return `${this.model?.id ?? 'none'}|` + [p.x,p.y,p.z,t.x,t.y,t.z,this.controls.getDistance(),this.controls.enabled ? 1 : 0,this.autoRotateValue ? 1 : 0,this.autoRotateSpeedValue].map(value => Number(value).toFixed(6)).join('|');
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
      enabled: this.controls.enabled,
      autoRotate: this.autoRotateValue,
      autoRotateSpeed: this.autoRotateSpeedValue,
      bounds: this.getBounds(),
    });
  }
  private assertAlive(): void { if (this.disposed) throw new Error('Avatar camera controller is disposed.'); }
}

function tuple(value: Vector3): ViewerVec3 { return Object.freeze([value.x, value.y, value.z]) as ViewerVec3; }
function finite(value: number, name: string) { if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`); }
function validateVector(value: ViewerVec3, name: string) { if (value.length !== 3 || value.some(component => !Number.isFinite(component))) throw new Error(`${name} must contain three finite numbers.`); }
