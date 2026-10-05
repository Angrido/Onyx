export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) {
    void work.catch(() => undefined);
    return Promise.resolve(null);
  }
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
