// Batch sizing for the worker's write loops: every DB call runs on the event loop that also serves HTTP.

/**
 * Batch size that adapts so one transaction (statements + COMMIT, which grows with the pages written)
 * lasts about `targetMs`, whatever the disk and the table sizes. Keep one per loop, at module level.
 */
export class AdaptiveBatch {
  private current: number;
  /** Expected duration of the next batch (the last one, scaled to the new size). */
  private expectedMs = 0;
  /** No batch yet in this call: the first one always runs, so work always moves forward. */
  private fresh = true;

  constructor(
    initial: number,
    private readonly min: number,
    private readonly max: number,
    private readonly targetMs = 20,
  ) {
    this.current = initial;
  }

  get size(): number {
    return Math.round(this.current);
  }

  /** Call at the start of each worker call. */
  start(): this {
    this.fresh = true;
    return this;
  }

  /** True for the first batch of a call, then while the next batch should still end before `deadline`. */
  fits(deadline: number): boolean {
    return this.fresh || Date.now() + this.expectedMs <= deadline;
  }

  /** Times `fn` (one batch of `size` rows) and resizes the next batch from it. */
  measure<T>(fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const ms = Math.max(performance.now() - start, 0.5);
      const before = this.current;
      const ideal = (before * this.targetMs) / ms;
      // Shrink at once when too slow, grow gently when fast.
      this.current = Math.min(this.max, Math.max(this.min, ideal < before ? ideal : before * 0.7 + ideal * 0.3));
      this.expectedMs = (ms * this.current) / before;
      this.fresh = false;
    }
  }
}
