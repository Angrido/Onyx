import { common } from "./common";
import { context } from "./context";
import { errors } from "./errors";
import { onboarding } from "./onboarding";
import { palette } from "./palette";
import { plans } from "./plans";
import { projects } from "./projects";
import { savings } from "./savings";
import { shell } from "./shell";
import { tasks } from "./tasks";

export const IT: Readonly<Record<string, string>> = {
  ...common,
  ...errors,
  ...onboarding,
  ...palette,
  ...shell,
  ...projects,
  ...savings,
  ...context,
  ...tasks,
  ...plans,
};
