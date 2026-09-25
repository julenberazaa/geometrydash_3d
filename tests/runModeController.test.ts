import { describe, expect, it } from 'vitest';
import { RunModeController } from '../src/game/runModeController';

/**
 * M9.4 practice-taint contract (pure session state, headless):
 * once checkpoint mode has EVER been armed, the attempt stays practice
 * until a full restart — switching back to classic never cleans it.
 */
describe('M9.4 RunModeController', () => {
  it('starts clean classic / practice checkpoint per beginAttempt', () => {
    const c = new RunModeController();
    c.beginAttempt('classic');
    expect(c.runMode).toBe('classic');
    expect(c.attemptKind).toBe('classic');
    expect(c.practiceTainted).toBe(false);

    c.beginAttempt('checkpoint');
    expect(c.runMode).toBe('checkpoint');
    expect(c.attemptKind).toBe('practice');
    expect(c.practiceTainted).toBe(true);
  });

  it('classic -> checkpoint taints the attempt', () => {
    const c = new RunModeController();
    c.beginAttempt('classic');
    expect(c.setMode('checkpoint')).toBe(true);
    expect(c.runMode).toBe('checkpoint');
    expect(c.attemptKind).toBe('practice');
  });

  it('checkpoint -> classic keeps the practice taint', () => {
    const c = new RunModeController();
    c.beginAttempt('classic');
    c.setMode('checkpoint');
    expect(c.setMode('classic')).toBe(true);
    expect(c.runMode).toBe('classic');
    expect(c.practiceTainted).toBe(true);
    expect(c.attemptKind).toBe('practice');
  });

  it('toggling back to checkpoint stays practice', () => {
    const c = new RunModeController();
    c.beginAttempt('classic');
    c.setMode('checkpoint');
    c.setMode('classic');
    c.setMode('checkpoint');
    expect(c.runMode).toBe('checkpoint');
    expect(c.attemptKind).toBe('practice');
  });

  it('only a full restart clears the taint', () => {
    const c = new RunModeController();
    c.beginAttempt('classic');
    c.setMode('checkpoint');
    c.setMode('classic');
    expect(c.attemptKind).toBe('practice');
    // Full restart in classic opens a fresh clean attempt.
    c.beginAttempt('classic');
    expect(c.attemptKind).toBe('classic');
    expect(c.practiceTainted).toBe(false);
    // Full restart in checkpoint opens a fresh practice attempt.
    c.beginAttempt('checkpoint');
    expect(c.attemptKind).toBe('practice');
  });

  it('setMode to the current mode is a no-op', () => {
    const c = new RunModeController();
    c.beginAttempt('classic');
    expect(c.setMode('classic')).toBe(false);
    expect(c.attemptKind).toBe('classic');
  });
});
