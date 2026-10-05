import {
  QuotaSettingsSchema,
  type QuotaDto,
  type QuotaLevel,
  type QuotaSettings,
  type RunItemOf,
} from "@onyx/contracts";
import type { Prisma, PrismaClient } from "@onyx/db";
import type { Logger } from "pino";
import { z } from "zod";
import {
  DEFAULT_QUOTA_SETTINGS,
  isStale,
  nextExpiry,
  nextReset,
  quotaAdmission,
  quotaLevel,
  quotaMessage,
  type QuotaAdmission,
  type QuotaWindow,
} from "../domain/quota";

export const QUOTA_SETTINGS_KEY = "quota.settings";
export const QUOTA_WINDOWS_KEY = "quota.windows";
const MAX_TIMER_MS = 2_147_000_000;

const StoredWindowsSchema = z.array(
  z.object({
    type: z.string(),
    status: z.string(),
    utilization: z.number().nullable(),
    resetsAt: z.string().nullable(),
    observedAt: z.string(),
  }),
);

export interface QuotaServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  publish: (quota: QuotaDto) => void;
  onChange: () => void;
  waitingTasks: () => readonly { canWait: boolean }[];
  onLevel?: (previous: QuotaLevel, next: QuotaLevel, message: string) => void;
  now?: () => Date;
}

export class QuotaService {
  private windows = new Map<string, QuotaWindow>();
  private settings: QuotaSettings = DEFAULT_QUOTA_SETTINGS;
  private timer: NodeJS.Timeout | null = null;
  private lastLevel: QuotaLevel = "UNKNOWN";
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly deps: QuotaServiceDeps) {}

  async load(): Promise<void> {
    const rows = await this.deps.prisma.appSetting.findMany({
      where: { key: { in: [QUOTA_SETTINGS_KEY, QUOTA_WINDOWS_KEY] } },
    });
    for (const row of rows) {
      if (row.key === QUOTA_SETTINGS_KEY) {
        const parsed = QuotaSettingsSchema.safeParse(row.value);
        if (parsed.success) this.settings = parsed.data;
      } else {
        const parsed = StoredWindowsSchema.safeParse(row.value);
        if (!parsed.success) continue;
        for (const window of parsed.data)
          this.windows.set(window.type, {
            type: window.type,
            status: window.status,
            utilization: window.utilization,
            resetsAt: window.resetsAt === null ? null : new Date(window.resetsAt),
            observedAt: new Date(window.observedAt),
          });
      }
    }
    this.lastLevel = this.level();
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async idle(): Promise<void> {
    await this.saving;
  }

  level(): QuotaLevel {
    return quotaLevel([...this.windows.values()], this.settings, this.now());
  }

  admit(item: { canWait?: boolean }): QuotaAdmission {
    const windows = [...this.windows.values()];
    const now = this.now();
    return quotaAdmission(
      quotaLevel(windows, this.settings, now),
      item.canWait === true,
      this.settings,
      nextReset(windows, this.settings, now),
    );
  }

  observe(item: RunItemOf<"rate_limit">): void {
    const type = item.limitType ?? "subscription";
    const previous = this.windows.get(type);
    const next: QuotaWindow = {
      type,
      status: item.status,
      utilization:
        item.utilization ?? (item.status === "allowed" ? null : (previous?.utilization ?? null)),
      resetsAt: item.resetsAt === null ? null : new Date(item.resetsAt),
      observedAt: this.now(),
    };
    this.windows.set(type, next);
    if (next.status !== previous?.status || this.level() !== this.lastLevel)
      this.deps.logger.info(
        { type, status: next.status, utilization: next.utilization, resetsAt: item.resetsAt },
        "Claude reported a subscription limit",
      );
    this.changed();
    this.persist(QUOTA_WINDOWS_KEY, this.storedWindows());
  }

  async updateSettings(settings: QuotaSettings): Promise<QuotaDto> {
    this.settings = QuotaSettingsSchema.parse(settings);
    this.persist(QUOTA_SETTINGS_KEY, this.settings);
    await this.saving;
    this.changed();
    return this.dto();
  }

  async resume(): Promise<QuotaDto> {
    this.windows.clear();
    this.persist(QUOTA_WINDOWS_KEY, []);
    await this.saving;
    this.changed();
    return this.dto();
  }

  dto(): QuotaDto {
    const now = this.now();
    const windows = [...this.windows.values()];
    const level = quotaLevel(windows, this.settings, now);
    const deferred = this.deps
      .waitingTasks()
      .filter(
        (item) => quotaAdmission(level, item.canWait, this.settings, null).decision === "hold",
      ).length;
    const resumeAt =
      level === "HOLDING" || level === "LIMITED" ? nextReset(windows, this.settings, now) : null;
    return {
      level,
      windows: windows
        .sort((left, right) => left.type.localeCompare(right.type))
        .map((window) => ({
          type: window.type,
          status: window.status,
          utilization: window.utilization,
          resetsAt: window.resetsAt?.toISOString() ?? null,
          observedAt: window.observedAt.toISOString(),
          stale: isStale(window, now),
        })),
      settings: this.settings,
      deferredTasks: deferred,
      nextResetAt: resumeAt?.toISOString() ?? null,
      message: quotaMessage(level, windows, this.settings, now, deferred),
    };
  }

  announce(): void {
    this.deps.publish(this.dto());
  }

  private changed(): void {
    const previous = this.lastLevel;
    this.lastLevel = this.level();
    if (previous !== this.lastLevel && this.deps.onLevel)
      this.deps.onLevel(previous, this.lastLevel, this.dto().message);
    this.schedule();
    this.announce();
    this.deps.onChange();
  }

  private schedule(): void {
    this.stop();
    const now = this.now();
    const at = nextExpiry([...this.windows.values()], now);
    if (at === null) return;
    const delay = Math.min(Math.max(at.getTime() - now.getTime(), 0) + 1_000, MAX_TIMER_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.changed();
    }, delay);
    this.timer.unref();
  }

  private storedWindows(): Prisma.InputJsonValue {
    return [...this.windows.values()].map((window) => ({
      type: window.type,
      status: window.status,
      utilization: window.utilization,
      resetsAt: window.resetsAt?.toISOString() ?? null,
      observedAt: window.observedAt.toISOString(),
    }));
  }

  private persist(key: string, value: Prisma.InputJsonValue): void {
    this.saving = this.saving
      .then(() =>
        this.deps.prisma.appSetting
          .upsert({ where: { key }, create: { key, value }, update: { value } })
          .then(() => undefined),
      )
      .catch((error: unknown) =>
        this.deps.logger.error({ err: error, key }, "Could not save the subscription limits"),
      );
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
