import { describe, expect, it } from 'vitest';
import type { EntrySession } from '../src/api';
import { EntryTracker, MIN_ABANDON_MS } from '../src/lib/entryTracking';

function tracker(startedAt = 1000) {
  const sent: EntrySession[] = [];
  return { t: new EntryTracker((s) => sent.push(s), startedAt), sent };
}

describe('EntryTracker', () => {
  it('reports a save with its duration and taps', () => {
    const { t, sent } = tracker();
    t.tap();
    t.tap();
    t.tap();
    t.finish('saved', 'sentence', 9200.4);
    expect(sent).toEqual([{ outcome: 'saved', source: 'sentence', durationMs: 8200, taps: 3 }]);
  });

  it('reports only the first outcome, so leaving after a save is not an abandon', () => {
    const { t, sent } = tracker();
    t.finish('saved', 'form', 5000);
    t.tap();
    t.finish('abandoned', 'form', 6000);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ outcome: 'saved', taps: 0 });
  });

  it('reports leaving without saving as abandoned', () => {
    const { t, sent } = tracker();
    t.tap();
    t.finish('abandoned', 'form', 1000 + MIN_ABANDON_MS + 500);
    expect(sent).toEqual([{ outcome: 'abandoned', source: 'form', durationMs: MIN_ABANDON_MS + 500, taps: 1 }]);
  });

  it('ignores leaving right away as a mis-tap', () => {
    const { t, sent } = tracker();
    t.finish('abandoned', 'form', 1000 + MIN_ABANDON_MS - 1);
    expect(sent).toEqual([]);
  });
});
