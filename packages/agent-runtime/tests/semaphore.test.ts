import { describe, expect, it } from "vitest";
import { Semaphore, SemaphoreCancelledError } from "../src";

describe("Semaphore", () => {
  it("limits concurrent holders and serves waiters in FIFO order", async () => {
    const semaphore = new Semaphore(1);
    const order: string[] = [];
    const first = await semaphore.acquire();
    const second = semaphore.acquire().then((release) => {
      order.push("second");
      return release;
    });
    const third = semaphore.acquire().then((release) => {
      order.push("third");
      return release;
    });
    expect(semaphore.pending).toBe(2);
    first();
    (await second)();
    (await third)();
    expect(order).toEqual(["second", "third"]);
    expect(semaphore.active).toBe(0);
  });

  it("ignores double release", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    release();
    release();
    expect(semaphore.active).toBe(0);
  });

  it("cancels a pending acquisition", async () => {
    const semaphore = new Semaphore(1);
    const held = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(SemaphoreCancelledError);
    expect(semaphore.pending).toBe(0);
    held();
  });

  it("admits waiters when resized upwards", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    const waiting = semaphore.acquire();
    semaphore.resize(2);
    await expect(waiting).resolves.toBeTypeOf("function");
  });

  it("rejects invalid capacities", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });
});
