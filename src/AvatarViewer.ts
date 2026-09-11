import type {
  AnimationSource,
  LoadOptions,
  ModelSession,
  ModelSource,
  PlayOptions,
  ViewerBounds,
  ViewerExpressionState,
  ViewerLookAtOptions,
  ViewerLookAtState,
  ViewerOptions,
  ViewerState,
  ViewerVec3,
} from './types.js';

const stopped = { status: 'stopped' as const, clip: null, time: 0, duration: 0, speed: 1 };
const emptyExpressions: ViewerExpressionState = Object.freeze({ available: Object.freeze([]), values: Object.freeze({}) });
export class AvatarViewer {
  private session?: ModelSession;
  private generation = 0;
  private pending = new Set<AbortController>();
  private listeners = new Set<() => void>();
  private disposal?: Promise<void>;
  private state: ViewerState = Object.freeze({
    ...stopped,
    phase: 'empty',
    model: null,
    clips: Object.freeze([]),
    loadingAnimations: 0,
    error: null,
    bounds: null,
    expressions: emptyExpressions,
    lookAt: null,
  });
  constructor(private readonly options: ViewerOptions) {}
  /** Stable immutable snapshots until something changes; suitable for external stores. */
  getSnapshot = (): ViewerState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.assertAlive(); this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  async loadModel(source: ModelSource, options: LoadOptions = {}): Promise<void> {
    this.assertAlive();
    if (!source.url.trim()) throw new Error('Model URL must not be empty.');
    options.signal?.throwIfAborted();
    const input = Object.freeze({ ...source });
    const generation = ++this.generation;
    this.cancelPending();
    const operation = this.operation(options.signal);
    this.patch({ phase: 'loading', loadingAnimations: 0, error: null });
    let candidate: ModelSession | undefined;
    try {
      candidate = await this.options.backend.loadModel(input, operation.controller.signal);
      this.checkOperation(generation, operation.controller.signal);
      candidate.mount();
      const previous = this.session;
      this.session = candidate; candidate = undefined;
      previous?.dispose();
      this.patch({ phase: 'ready', model: input, clips: this.clipSnapshot(), ...this.sessionSnapshot() });
    } catch (error) {
      candidate?.dispose();
      if (generation === this.generation && this.state.phase !== 'disposed') {
        this.patch({ phase: this.session ? 'ready' : operation.controller.signal.aborted ? 'empty' : 'error', error: operation.controller.signal.aborted ? null : message(error) });
      }
      throw error;
    } finally { operation.cleanup(); }
  }

  async loadAnimation(source: AnimationSource, options: LoadOptions = {}): Promise<void> {
    const session = this.requireSession();
    if (!source.url.trim()) throw new Error('Animation URL must not be empty.');
    options.signal?.throwIfAborted();
    const generation = this.generation;
    const operation = this.operation(options.signal);
    const input = { ...source, nodeMap: source.nodeMap ? Object.freeze({ ...source.nodeMap }) : undefined };
    this.patch({ loadingAnimations: this.state.loadingAnimations + 1, error: null });
    let prepared;
    try {
      prepared = await session.prepareAnimations(input, operation.controller.signal);
      this.checkOperation(generation, operation.controller.signal);
      session.installAnimations(prepared);
      this.patch({ clips: this.clipSnapshot() });
    } catch (error) {
      if (generation === this.generation && this.state.phase !== 'disposed' && !operation.controller.signal.aborted) this.patch({ error: message(error) });
      throw error;
    } finally {
      prepared?.dispose(); operation.cleanup();
      if (generation === this.generation && this.state.phase !== 'disposed') this.patch({ loadingAnimations: Math.max(0, this.state.loadingAnimations - 1) });
    }
  }

  play(id: string, options: PlayOptions = {}): void {
    const session = this.requireSession();
    if (!session.clips.some(clip => clip.id === id)) throw new Error(`Unknown clip: ${id}`);
    finite(options.speed ?? 1, 'speed'); finite(options.fade ?? 0, 'fade');
    if (options.loop !== undefined && options.loop !== 'repeat' && options.loop !== 'once') throw new Error('Unsupported loop mode.');
    session.play(id, options); this.refresh();
  }
  pause(): void { this.requireSession().pause(); this.refresh(); }
  resume(): void { this.requireSession().resume(); this.refresh(); }
  stop(): void { this.requireSession().stop(); this.refresh(); }
  seek(seconds: number): void { finite(seconds, 'time'); this.requireSession().seek(seconds); this.refresh(); }
  setSpeed(speed: number): void { finite(speed, 'speed'); this.requireSession().setSpeed(speed); this.refresh(); }

  /** Current model bounds in the backend's world/presentation coordinate space. */
  getBounds(): ViewerBounds | null { return this.requireSession().getBounds?.() ?? null; }
  getExpressions(): ViewerExpressionState { return this.requireSession().getExpressions?.() ?? emptyExpressions; }
  getLookAt(): ViewerLookAtState | null { return this.requireSession().getLookAt?.() ?? null; }
  setExpression(name: string, weight: number): boolean {
    if (!name.trim()) throw new Error('Expression name must not be empty.');
    unit(weight, 'expression weight');
    const session = this.requireSession();
    if (!session.setExpression) throw new Error('The active backend does not support direct expressions.');
    const applied = session.setExpression(name, weight); this.refresh(); return applied;
  }
  clearExpression(name: string): boolean {
    if (!name.trim()) throw new Error('Expression name must not be empty.');
    const session = this.requireSession();
    if (!session.clearExpression) throw new Error('The active backend does not support direct expressions.');
    const applied = session.clearExpression(name); this.refresh(); return applied;
  }
  resetExpressions(): void {
    const session = this.requireSession();
    if (!session.resetExpressions) throw new Error('The active backend does not support direct expressions.');
    session.resetExpressions(); this.refresh();
  }
  /** World-space point by default; pass `{ space: 'direction' }` for a model-local direction. */
  setLookAt(target: ViewerVec3 | null, options: ViewerLookAtOptions = {}): void {
    if (target) vector(target, 'look-at target');
    const session = this.requireSession();
    if (!session.setLookAt) throw new Error('The active backend does not support look-at control.');
    validateLookAt(options);
    session.setLookAt(target, options); this.refresh();
  }
  clearLookAt(): void { this.setLookAt(null); }

  /** Seconds. Exactly one frame owner must call this, before skin deformation/render. */
  update(deltaSeconds: number): void {
    this.assertAlive(); finite(deltaSeconds, 'deltaSeconds');
    this.session?.update(Math.min(deltaSeconds, 0.1)); this.refresh();
  }
  unload(): void {
    this.assertAlive(); ++this.generation; this.cancelPending();
    this.session?.dispose(); this.session = undefined;
    this.patch({ ...stopped, phase: 'empty', model: null, clips: Object.freeze([]), error: null, loadingAnimations: 0, bounds: null, expressions: emptyExpressions, lookAt: null });
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    // Assign before notifying observers; an observer may re-enter dispose().
    this.disposal = Promise.resolve().then(() => this.options.backend.dispose());
    ++this.generation; this.cancelPending();
    this.session?.dispose(); this.session = undefined;
    this.patch({ ...stopped, phase: 'disposed', model: null, clips: Object.freeze([]), error: null, loadingAnimations: 0, bounds: null, expressions: emptyExpressions, lookAt: null });
    this.listeners.clear();
    return this.disposal;
  }
  private refresh(): void { if (this.session) this.patch(this.sessionSnapshot()); }
  private sessionSnapshot(): Partial<ViewerState> {
    const session = this.session!;
    return {
      ...session.getPlayback(),
      bounds: session.getBounds?.() ?? null,
      expressions: session.getExpressions?.() ?? emptyExpressions,
      lookAt: session.getLookAt?.() ?? null,
    };
  }
  private clipSnapshot() { return Object.freeze(this.session!.clips.map(clip => Object.freeze({ ...clip }))); }
  private patch(patch: Partial<ViewerState>): void {
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof ViewerState] === value)) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) {
      try { listener(); } catch (error) { try { this.options.onListenerError?.(error); } catch { /* An observer cannot break disposal. */ } }
    }
  }
  private operation(signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.pending.add(controller);
    return { controller, cleanup: () => { signal?.removeEventListener('abort', abort); this.pending.delete(controller); } };
  }
  private cancelPending() { for (const controller of this.pending) controller.abort(); this.pending.clear(); }
  private checkOperation(generation: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (generation !== this.generation || this.state.phase === 'disposed') throw new DOMException('Load superseded.', 'AbortError');
  }
  private assertAlive() { if (this.state.phase === 'disposed') throw new Error('Avatar viewer is disposed.'); }
  private requireSession() {
    this.assertAlive();
    if (this.state.phase === 'loading') throw new Error('Wait for model loading to finish.');
    if (!this.session) throw new Error('Load a model first.');
    return this.session;
  }
}
export function createAvatarViewer(options: ViewerOptions): AvatarViewer { return new AvatarViewer(options); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function finite(value: number, field: string) { if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and non-negative.`); }
function unit(value: number, field: string) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1.`); }
function vector(value: ViewerVec3, field: string) { if (value.length !== 3 || value.some(component => !Number.isFinite(component))) throw new Error(`${field} must contain three finite numbers.`); }
function validateLookAt(options: ViewerLookAtOptions) {
  if (options.space !== undefined && options.space !== 'world' && options.space !== 'direction') throw new Error('look-at space must be world or direction.');
  if (options.weight !== undefined) unit(options.weight, 'look-at weight');
  for (const [name, value] of [['smoothing', options.smoothing], ['maxYaw', options.maxYaw], ['maxPitch', options.maxPitch]] as const) {
    if (value !== undefined) finite(value, `look-at ${name}`);
  }
}
