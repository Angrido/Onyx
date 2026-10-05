import { common } from "./common";
import { context } from "./context";
import { errors } from "./errors";
import { help } from "./help";
import { uxNav } from "./ux-nav";
import { uxProject } from "./ux-project";
import { uxSettings } from "./ux-settings";
import { uxTask } from "./ux-task";
import { onboarding } from "./onboarding";
import { palette } from "./palette";
import { plans } from "./plans";
import { projects } from "./projects";
import { savings } from "./savings";
import { shell } from "./shell";
import { system } from "./system";
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
  ...system,
  ...help,
  ...uxNav,
  ...uxProject,
  ...uxTask,
  ...uxSettings,
};
