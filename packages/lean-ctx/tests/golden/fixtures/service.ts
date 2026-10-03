import type { Logger } from "pino";
import { type Clock, systemClock } from "./clock";
import * as path from "node:path";
import defaultExport, { helper as renamedHelper } from "../shared/helpers";
import "./side-effect";
import legacy = require("./legacy");

export * from "./domain";
export * as errors from "./errors";
export type { Settings } from "./settings";

/**
 * Status of a job in the queue.
 * Second line that should not appear.
 */
export enum JobStatus {
  Queued = "queued",
  Running = "running",
  Done = "done",
}

export enum Tiny { A, B }

/** Options accepted by {@link JobService}. */
export interface JobServiceOptions {
  /** Maximum concurrent jobs. */
  concurrency: number;
  logger: Logger;
  clock?: Clock;
  onError?(error: unknown): void;
}

export type JobId = string;

export type JobEvent =
  | { type: "queued"; id: JobId; at: Date }
  | { type: "started"; id: JobId; at: Date; worker: number }
  | { type: "finished"; id: JobId; at: Date; ok: boolean };

const DEFAULT_OPTIONS = { concurrency: 2 };

export const RETRY_DELAYS_MS = [100, 200, 400, 800, 1_600, 3_200, 6_400, 12_800, 25_600, 51_200];

const { join, resolve } = path;

// A regular comment that never reaches a skeleton.
export function parseJobId(raw: string): JobId;
export function parseJobId(raw: number): JobId;
export function parseJobId(raw: string | number): JobId {
  const value = String(raw).trim();
  if (value.length === 0) throw new Error("empty id");
  return value;
}

export const toEvent = (id: JobId, type: JobEvent["type"]): JobEvent => ({ type, id, at: new Date() } as JobEvent);

function internalHelper(): void {}

/** Coordinates job execution. */
@injectable()
export class JobService<T extends { id: JobId }> extends BaseService implements Disposable {
  private readonly queue: T[] = [];
  #secret = 42;
  static instances = 0;
  protected readonly handlers = new Map<string, (job: T) => Promise<void>>();

  static {
    JobService.instances = 0;
  }

  constructor(private readonly options: JobServiceOptions = DEFAULT_OPTIONS as JobServiceOptions) {
    super();
  }

  /** Number of queued jobs. */
  get size(): number {
    return this.queue.length;
  }

  @trace("enqueue")
  async enqueue(job: T): Promise<void> {
    this.queue.push(job);
    await this.drain();
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) await this.run(job);
    }
  }

  protected onTick = async (now: Date): Promise<void> => {
    this.options.logger.info({ now }, "tick");
  };

  abstract describe?(): string;

  [Symbol.dispose](): void {}
}

export namespace Internals {
  export const VERSION = 1;
  export function reset(): void {
    JobService.instances = 0;
  }
  const hidden = true;
}

declare module "pino" {
  interface LoggerOptions {
    jobId?: JobId;
  }
}

export async function loadPlugin(name: string) {
  const plugin = await import(`./plugins/${name}`);
  const fallback = await import("./plugins/default");
  return plugin ?? fallback;
}

const lazy = () => require("./lazy-module");

export { internalHelper as helper, lazy };

export default JobService;

bootstrap();
