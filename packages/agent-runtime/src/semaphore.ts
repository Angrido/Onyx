export type Release = () => void;

interface Waiter {
  resolve: (release: Release) => void;
  reject: (reason: Error) => void;
}

export class SemaphoreCancelledError extends Error {
  constructor() {
    super("Semaphore wait cancelled");
    this.name = "SemaphoreCancelledError";
  }
}

export class Semaphore {
  private inUse = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("Semaphore capacity must be a positive integer");
    }
  }

  get active(): number {
    return this.inUse;
  }

  get pending(): number {
    return this.waiters.length;
  }

  get limit(): number {
    return this.capacity;
  }

  resize(capacity: number): void {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("Semaphore capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.drain();
  }

  acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(new SemaphoreCancelledError());
    if (this.inUse < this.capacity && this.waiters.length === 0) {
      this.inUse += 1;
      return Promise.resolve(this.createRelease());
    }
    return new Promise<Release>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      this.waiters.push(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          const index = this.waiters.indexOf(waiter);
          if (index === -1) return;
          this.waiters.splice(index, 1);
          reject(new SemaphoreCancelledError());
        },
        { once: true },
      );
    });
  }

  private createRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse -= 1;
      this.drain();
    };
  }

  private drain(): void {
    while (this.inUse < this.capacity && this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      this.inUse += 1;
      waiter.resolve(this.createRelease());
    }
  }
}
