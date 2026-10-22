import type { EntrySession, EntrySource } from '../api';

/** Leaving the form faster than this is taken as a mis-tap, not an abandoned entry. */
export const MIN_ABANDON_MS = 1000;

/**
 * Times one visit to the new-expense form and counts taps on it. `finish`
 * reports the first outcome only: a save, or leaving (unmount / closing the
 * LIFF) without one. Taps are counted by the caller via `tap`.
 */
export class EntryTracker {
  private taps = 0;
  private done = false;

  constructor(
    private readonly send: (session: EntrySession) => void,
    private readonly startedAt: number,
  ) {}

  tap(): void {
    if (!this.done) this.taps += 1;
  }

  finish(outcome: EntrySession['outcome'], source: EntrySource, now: number): void {
    if (this.done) return;
    this.done = true;
    const durationMs = Math.max(0, Math.round(now - this.startedAt));
    if (outcome === 'abandoned' && durationMs < MIN_ABANDON_MS) return;
    this.send({ outcome, source, durationMs, taps: this.taps });
  }
}
