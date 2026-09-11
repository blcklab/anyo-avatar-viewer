import { AnimationMixer, type AnimationAction, type AnimationClip } from '@blcklab/sekai64/animation';
import type { Node } from '@blcklab/sekai64';
import type { PlaybackState, PlaybackStatus, PlayOptions } from '../types.js';
import { correctSampledRotations } from './rotation-compat.js';

/** Owns one mixer. It is deliberately NOT registered with AnimationRendererModule. */
export class Playback {
  readonly mixer: AnimationMixer;
  private action?: AnimationAction;
  private status: PlaybackStatus = 'stopped';
  private speed = 1;
  private readonly nodes = new Map<string, Node>();
  private fade?: { from: AnimationAction; to: AnimationAction; elapsed: number; duration: number };
  constructor(root: Node, private readonly restorePose: () => void) {
    this.mixer = new AnimationMixer(root);
    root.traverse(node => { this.nodes.set(node.id, node); if (node.name && !this.nodes.has(node.name)) this.nodes.set(node.name, node); });
  }
  play(clip: AnimationClip, options: PlayOptions): void {
    const previous = this.status !== 'stopped' && this.status !== 'completed' ? this.action : undefined;
    this.speed = options.speed ?? this.speed;
    this.mixer.stopAll(); this.fade = undefined;
    if (previous && (options.fade ?? 0) > 0) {
      previous.enabled = true; previous.finished = false; previous.paused = false;
      previous.weight = 1; previous.speed = this.speed;
      this.mixer.actions.push(previous);
    }
    this.restorePose();
    this.action = this.mixer.play(clip, { speed: this.speed, loop: options.loop ?? 'repeat' });
    if (previous && (options.fade ?? 0) > 0) {
      this.action.weight = 0;
      this.fade = { from: previous, to: this.action, elapsed: 0, duration: options.fade! };
    }
    this.status = 'playing'; this.sample();
  }
  pause(): void { if (this.status === 'playing') this.status = 'paused'; }
  resume(): void { if (this.status === 'paused') this.status = 'playing'; }
  stop(): void { this.mixer.stopAll(); this.action = undefined; this.fade = undefined; this.status = 'stopped'; this.restorePose(); }
  setSpeed(speed: number): void { this.speed = speed; for (const action of this.mixer.actions) action.speed = speed; if (this.action) this.action.speed = speed; }
  seek(seconds: number): void {
    if (!this.action) return;
    // Seeking cancels a transition and displays exactly the requested target pose.
    this.fade = undefined;
    this.mixer.stopAll();
    this.action.seek(seconds); this.action.enabled = true; this.action.weight = 1;
    this.mixer.actions.push(this.action);
    if (this.status === 'completed') this.status = 'paused';
    this.restorePose(); this.sample();
  }
  update(delta: number): void {
    if (this.status !== 'playing' || !this.action || delta === 0 || this.speed === 0) return;
    if (this.fade) {
      this.fade.elapsed = Math.min(this.fade.duration, this.fade.elapsed + delta);
      const ratio = this.fade.elapsed / this.fade.duration;
      // The rc.33 mixer skips zero-weight actions before advancing built-in fades.
      // Advance these weights explicitly, so incoming actions actually participate.
      this.fade.to.weight = ratio; this.fade.from.weight = 1 - ratio;
      if (ratio === 1) { this.fade.from.stop(); this.fade = undefined; }
    }
    const sampled = [...this.mixer.actions];
    this.restorePose(); this.mixer.update(delta); correctSampledRotations(sampled, this.nodes);
    if (this.action.finished || this.action.clip.duration === 0) {
      this.status = 'completed'; this.fade = undefined;
      this.mixer.stopAll(); this.action.enabled = true;
      this.sample();
    }
  }
  getSnapshot(): PlaybackState {
    return { status: this.status, clip: this.action?.clip.id ?? null, time: this.action?.time ?? 0, duration: this.action?.clip.duration ?? 0, speed: this.speed };
  }
  dispose(): void { this.stop(); this.mixer.clips.clear(); this.mixer.clearListeners(); this.nodes.clear(); }
  private sample(): void {
    // Evaluate without advancing or completing once-actions at time zero.
    const original = [...this.mixer.actions];
    if (this.action && !original.includes(this.action)) this.mixer.actions.push(this.action);
    const saved = this.mixer.actions.map(action => ({ action, loop: action.loop, finished: action.finished, direction: action.direction, time: action.time, paused: action.paused }));
    for (const { action } of saved) { action.loop = 'ping-pong'; action.finished = false; action.paused = false; }
    this.mixer.update(0);
    correctSampledRotations(saved.map(({ action }) => action), this.nodes);
    for (const { action, ...state } of saved) Object.assign(action, state);
    this.mixer.actions.splice(0, this.mixer.actions.length, ...original);
  }
}
