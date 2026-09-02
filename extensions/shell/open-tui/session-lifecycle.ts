export class SessionLifecycle {
  private current = 0;
  private deferred: Array<() => void> = [];
  private shutDown = false;

  start(): void {
    this.current++;
    this.shutDown = false;
    this.flushDeferred();
  }

  shutdown(): void {
    this.shutDown = true;
    this.deferred = [];
  }

  isCurrent(generation?: number): boolean {
    if (this.shutDown) return false;
    if (generation === undefined) return true;
    return generation === this.current;
  }

  currentGeneration(): number {
    return this.current;
  }

  defer(fn: () => void): void {
    if (this.shutDown) return;
    this.deferred.push(fn);
  }

  private flushDeferred(): void {
    const pending = this.deferred;
    this.deferred = [];
    for (const fn of pending) {
      try {
        fn();
      } catch {
        // ponytail: silent fallback — deferred tasks are best-effort
      }
    }
  }
}
