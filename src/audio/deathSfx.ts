/**
 * DeathSfx: minimal procedural death blip (Web Audio, no assets, no packages).
 *
 * - AudioContext created lazily on the first user gesture (autoplay-safe).
 * - One 0.18 s descending square blip per death; fully guarded so audio can
 *   never throw into gameplay or QA (headless silence is fine).
 * - Removable without touching gameplay: Game calls play() inside onDeath.
 */
export class DeathSfx {
  private context: AudioContext | null = null;

  /** Call from a user-gesture path (keydown). Never throws. */
  public ensure(): void {
    try {
      if (this.context === null) {
        this.context = new window.AudioContext();
      }
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      this.context = null;
    }
  }

  /** Fire-and-forget blip. Never throws; no-op without a context. */
  public play(): void {
    try {
      const ctx = this.context;
      if (ctx === null || ctx.state !== 'running') return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(210, t0);
      osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.16);
      gain.gain.setValueAtTime(0.1, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.19);
      osc.onended = (): void => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch {
      // Audio must never break gameplay or QA.
    }
  }

  public dispose(): void {
    try {
      void this.context?.close();
    } catch {
      // Ignore.
    }
    this.context = null;
  }
}
