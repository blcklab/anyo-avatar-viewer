/** Root contracts intentionally contain no renderer or UI framework types. */
export interface ModelSource { readonly url: string; readonly format: 'vrm' | 'glb' | 'gltf' }
export interface AnimationSource {
  readonly url: string;
  /** Importer identifier. The built-in Sekai64 importer accepts glb and gltf. */
  readonly format: string;
  /** Source node name -> target node name/ID. This is binding, not retargeting. */
  readonly nodeMap?: Readonly<Record<string, string>>;
}
export type ViewerVec3 = readonly [number, number, number];
export interface ClipInfo { readonly id: string; readonly name: string; readonly duration: number }
export type PlaybackStatus = 'stopped' | 'playing' | 'paused' | 'completed';
export interface PlaybackState {
  readonly status: PlaybackStatus; readonly clip: string | null;
  readonly time: number; readonly duration: number; readonly speed: number;
}
export interface ViewerBounds {
  readonly min: ViewerVec3;
  readonly max: ViewerVec3;
  readonly center: ViewerVec3;
  readonly size: ViewerVec3;
  readonly radius: number;
  readonly height: number;
}
export interface ViewerExpressionState {
  readonly available: readonly string[];
  readonly values: Readonly<Record<string, number>>;
}
export type ViewerLookAtSpace = 'world' | 'direction';
export interface ViewerLookAtOptions {
  /** `world` targets a world-space point; `direction` treats the tuple as a model-local direction. */
  readonly space?: ViewerLookAtSpace;
  readonly eyes?: boolean;
  readonly head?: boolean;
  readonly neck?: boolean;
  readonly weight?: number;
  readonly smoothing?: number;
  /** Degrees. */
  readonly maxYaw?: number;
  /** Degrees. */
  readonly maxPitch?: number;
}
export interface ViewerLookAtState {
  readonly target: ViewerVec3;
  readonly space: ViewerLookAtSpace;
  readonly eyes: boolean;
  readonly head: boolean;
  readonly neck: boolean;
  readonly weight: number;
  readonly smoothing: number;
  readonly maxYaw: number;
  readonly maxPitch: number;
}
export interface ViewerState extends PlaybackState {
  readonly status: PlaybackStatus;
  readonly phase: 'empty' | 'loading' | 'ready' | 'error' | 'disposed';
  readonly model: ModelSource | null;
  readonly clips: readonly ClipInfo[];
  readonly loadingAnimations: number;
  readonly error: string | null;
  readonly bounds: ViewerBounds | null;
  readonly expressions: ViewerExpressionState;
  readonly lookAt: ViewerLookAtState | null;
}
export interface PlayOptions { readonly loop?: 'once' | 'repeat'; readonly speed?: number; readonly fade?: number }
export interface LoadOptions { readonly signal?: AbortSignal }
export interface PreparedAnimations { dispose(): void }
/** A backend load must return an unmounted, independently disposable session. */
export interface ModelSession {
  readonly clips: readonly ClipInfo[];
  mount(): void;
  prepareAnimations(source: AnimationSource, signal: AbortSignal): Promise<PreparedAnimations>;
  /** Atomic installation: failure must leave the current clip library intact. */
  installAnimations(prepared: PreparedAnimations): void;
  play(id: string, options: PlayOptions): void;
  pause(): void; resume(): void; stop(): void; seek(seconds: number): void; setSpeed(speed: number): void;
  update(deltaSeconds: number): void;
  getPlayback(): PlaybackState;
  /** Optional renderer-independent presentation metadata/capabilities. */
  getBounds?(): ViewerBounds | null;
  getExpressions?(): ViewerExpressionState;
  setExpression?(name: string, weight: number): boolean;
  clearExpression?(name: string): boolean;
  resetExpressions?(): void;
  setLookAt?(target: ViewerVec3 | null, options?: ViewerLookAtOptions): void;
  getLookAt?(): ViewerLookAtState | null;
  dispose(): void;
}
export interface ViewerBackend {
  loadModel(source: ModelSource, signal: AbortSignal): Promise<ModelSession>;
  dispose(): void | Promise<void>;
}
export interface ViewerOptions {
  readonly backend: ViewerBackend;
  /** Observer exceptions are isolated from resource ownership and load results. */
  readonly onListenerError?: (error: unknown) => void;
}
