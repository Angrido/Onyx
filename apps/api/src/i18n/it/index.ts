import { INSIGHTS } from "./insights";
import { PLANS } from "./plans";
import { PROJECTS } from "./projects";
import { SAVINGS } from "./savings";
import { STATUS } from "./status";
import { SYSTEM } from "./system";

export const IT: Record<string, string> = {
  ...SAVINGS,
  ...STATUS,
  ...INSIGHTS,
  ...PLANS,
  ...PROJECTS,
  ...SYSTEM,
};
