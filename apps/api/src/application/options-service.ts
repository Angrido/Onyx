import {
  SavingsOptionsDtoSchema,
  SavingsOptionsSchema,
  type SavingsOptions,
  type SavingsOptionsDto,
} from "@onyx/contracts";
import type { Prisma, PrismaClient } from "@onyx/db";

export const SAVINGS_OPTIONS_KEY = "savings.options";

const DEFAULTS: SavingsOptions = {
  conciseAnswers: true,
  cheapExploration: true,
  batchSmallTasks: false,
};

export class OptionsService {
  private cached: SavingsOptionsDto | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  current(): SavingsOptionsDto | null {
    return this.cached;
  }

  async get(): Promise<SavingsOptionsDto> {
    if (this.cached) return this.cached;
    const row = await this.prisma.appSetting.findUnique({ where: { key: SAVINGS_OPTIONS_KEY } });
    const parsed = SavingsOptionsDtoSchema.safeParse(row?.value);
    if (parsed.success) {
      this.cached = parsed.data;
      return parsed.data;
    }
    return this.save(this.stamp(DEFAULTS, null));
  }

  async update(input: SavingsOptions): Promise<SavingsOptionsDto> {
    const options = SavingsOptionsSchema.parse(input);
    return this.save(this.stamp(options, await this.get()));
  }

  private stamp(options: SavingsOptions, previous: SavingsOptionsDto | null): SavingsOptionsDto {
    const now = this.now().toISOString();
    const since = (on: boolean, was: boolean | undefined, at: string | null | undefined) =>
      on ? (was && at ? at : now) : null;
    return {
      ...options,
      conciseSince: since(options.conciseAnswers, previous?.conciseAnswers, previous?.conciseSince),
      explorationSince: since(
        options.cheapExploration,
        previous?.cheapExploration,
        previous?.explorationSince,
      ),
      batchingSince: since(
        options.batchSmallTasks,
        previous?.batchSmallTasks,
        previous?.batchingSince,
      ),
    };
  }

  private async save(options: SavingsOptionsDto): Promise<SavingsOptionsDto> {
    const value = options as unknown as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({
      where: { key: SAVINGS_OPTIONS_KEY },
      create: { key: SAVINGS_OPTIONS_KEY, value },
      update: { value },
    });
    this.cached = options;
    return options;
  }
}
