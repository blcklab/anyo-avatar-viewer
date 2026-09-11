import type { DiagnosticReport, Engine } from '@blcklab/sekai64';
import type { RecoverableRenderer } from '@blcklab/sekai64/renderer';

export type Sekai64RecoveryStatus = 'ready' | 'lost' | 'recovering' | 'failed' | 'disposed';
export interface Sekai64RecoverySnapshot {
  readonly status: Sekai64RecoveryStatus;
  readonly attempt: number;
  readonly error: string | null;
  readonly backend: string;
}
export interface Sekai64AvatarRecoveryOptions {
  readonly maxAttempts?: number;
  readonly onDiagnostic?: (message: string) => void;
  /** Stop the frame loop without changing the host's desired running state. */
  readonly suspend: () => void;
  /** Resume only if the host still wants the viewer running. */
  readonly resume: () => void;
  readonly refresh: () => void;
  /** Subscribe to renderer-loss diagnostics automatically. Defaults to true. */
  readonly automatic?: boolean;
}

/** Browser/runtime recovery coordinator. No DOM or framework UI is created. */
export class Sekai64AvatarRecoveryController {
  private state: Sekai64RecoverySnapshot;
  private listeners = new Set<() => void>();
  private recovering?: Promise<void>;
  private disposed = false;
  private unsubscribeDiagnostic: () => void = () => {};

  constructor(private readonly engine: Engine, private readonly options: Sekai64AvatarRecoveryOptions) {
    this.state = freeze('ready', 0, null, engine.capabilities.backend);
    if (options.automatic !== false) this.unsubscribeDiagnostic = engine.on('diagnostic', diagnostic => this.handleDiagnostic(diagnostic));
  }
  getSnapshot(): Sekai64RecoverySnapshot { return this.state; }
  subscribe(listener: () => void): () => void {
    this.assertAlive(); this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  recover(reason?: unknown): Promise<void> {
    this.assertAlive();
    if (this.recovering) return this.recovering;
    this.recovering = this.runRecovery(reason).finally(() => { this.recovering = undefined; });
    return this.recovering;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeDiagnostic();
    this.listeners.clear();
    this.state = freeze('disposed', this.state.attempt, null, this.engine.capabilities.backend);
  }

  private handleDiagnostic(diagnostic: DiagnosticReport): void {
    if (this.disposed) return;
    if (diagnostic.code === 'SEKAI64_WEBGL_CONTEXT_LOST') {
      this.options.suspend();
      this.patch('lost', 0, diagnostic.message);
      return;
    }
    if (diagnostic.code === 'SEKAI64_WEBGL_CONTEXT_RESTORED') {
      void this.recover(diagnostic).catch(error => this.options.onDiagnostic?.(`Avatar renderer recovery failed: ${message(error)}`));
      return;
    }
    if (diagnostic.code === 'SEKAI64_WEBGPU_DEVICE_LOST') {
      this.options.suspend();
      this.patch('lost', 0, diagnostic.message);
      void this.recover(diagnostic).catch(error => this.options.onDiagnostic?.(`Avatar renderer recovery failed: ${message(error)}`));
    }
  }
  private async runRecovery(reason?: unknown): Promise<void> {
    this.options.suspend();
    const renderer = this.engine.renderer as Partial<RecoverableRenderer>;
    if (typeof renderer.recover !== 'function') {
      const error = new Error('The active Sekai64 renderer does not support automatic recovery.');
      this.patch('failed', 0, error.message); throw error;
    }
    const maximum = Math.max(1, Math.floor(this.options.maxAttempts ?? 2));
    let lastError: unknown;
    for (let attempt = 1; attempt <= maximum; attempt += 1) {
      this.patch('recovering', attempt, null);
      try {
        await renderer.recover({
          reason,
          onProgress: (_progress, text) => { if (text) this.options.onDiagnostic?.(text); },
        });
        await this.engine.recoverModules({
          backend: this.engine.capabilities.backend,
          attempt,
          reason,
          report: (_progress, text) => { if (text) this.options.onDiagnostic?.(text); },
        });
        this.engine.resizeToDisplaySize();
        this.options.refresh();
        this.patch('ready', attempt, null);
        this.options.resume();
        return;
      } catch (error) {
        lastError = error;
        this.options.onDiagnostic?.(`Renderer recovery attempt ${attempt}/${maximum} failed: ${message(error)}`);
      }
    }
    const error = new Error(`Sekai64 renderer recovery failed after ${maximum} attempts: ${message(lastError)}`);
    this.patch('failed', maximum, error.message);
    throw error;
  }
  private patch(status: Sekai64RecoveryStatus, attempt: number, error: string | null) {
    this.state = freeze(status, attempt, error, this.engine.capabilities.backend);
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* UI observers do not own recovery. */ } }
  }
  private assertAlive() { if (this.disposed) throw new Error('Avatar recovery controller is disposed.'); }
}

function freeze(status: Sekai64RecoveryStatus, attempt: number, error: string | null, backend: string): Sekai64RecoverySnapshot {
  return Object.freeze({ status, attempt, error, backend });
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
