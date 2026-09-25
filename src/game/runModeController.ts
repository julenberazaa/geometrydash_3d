/**
 * M9.4 run-mode / practice-taint state machine (session scope — never
 * gameplay physics). Pure and headless-testable; `Game` owns one instance
 * and mirrors its transitions onto the sim flag, crystal visibility, HUD
 * and replay lifecycle.
 *
 * - `runMode`: the CURRENT mode (what death/R/crystals obey right now).
 * - `attemptKind`: the OFFICIALITY of the current attempt. Once an attempt
 *   has EVER armed checkpoint mode it is `practice` until a FULL level
 *   restart from the origin — switching back to classic never cleans it,
 *   so a practice-assisted run can never masquerade as an official clean
 *   completion (ReplayV1 stays clean-classic-only).
 */
export type RunMode = 'classic' | 'checkpoint';

/** Officiality of the current attempt. */
export type AttemptKind = 'classic' | 'practice';

export class RunModeController {
  private modeValue: RunMode = 'classic';
  private taintedValue = false;

  /** Current mode (death/R/crystal semantics follow this). */
  public get runMode(): RunMode {
    return this.modeValue;
  }

  /** True once checkpoint mode has been armed in this attempt. */
  public get practiceTainted(): boolean {
    return this.taintedValue;
  }

  /**
   * Officiality of the current attempt: `practice` when checkpoint mode is
   * (or ever was) armed in this attempt, `classic` only for untouched
   * classic attempts.
   */
  public get attemptKind(): AttemptKind {
    return this.modeValue === 'checkpoint' || this.taintedValue ? 'practice' : 'classic';
  }

  /**
   * Begin a fresh attempt in `mode` (level start / full restart). Taint is
   * cleared and re-derived: a fresh checkpoint-mode attempt is practice by
   * definition, a fresh classic attempt is clean.
   */
  public beginAttempt(mode: RunMode): void {
    this.modeValue = mode;
    this.taintedValue = mode === 'checkpoint';
  }

  /**
   * Live-switch the CURRENT mode mid-attempt (pause menu). Arming
   * checkpoint mode taints the attempt permanently (until the next
   * `beginAttempt`); disarming never un-taints. Returns true when the mode
   * actually changed.
   */
  public setMode(mode: RunMode): boolean {
    if (mode === this.modeValue) return false;
    this.modeValue = mode;
    if (mode === 'checkpoint') this.taintedValue = true;
    return true;
  }
}
