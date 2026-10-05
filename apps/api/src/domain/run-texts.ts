import type { RunItem } from "@onyx/contracts";
import { currentLocale, msg, txKnown, txKnownOrNull } from "../i18n";
import { localizeRationale } from "./routing/rationale";

export const RUN_TEXT = {
  interrupted: msg("Interrupted by Onyx restart"),
  aborted: msg("Aborted by operator"),
  shutdown: msg("Interrupted by Onyx shutdown"),
  wallClock: msg("Run exceeded its wall-clock limit"),
  idle: msg("Run produced no output within the idle limit"),
  init: msg("Claude Code did not initialise in time"),
  spawn: msg("Unable to start Claude Code: {error}"),
  claudeAborted: msg("Run aborted by Claude Code"),
  reported: msg("Claude Code reported an error: {error}"),
  finishedWithCause: msg("Claude Code finished with {subtype}: {cause}"),
  finished: msg("Claude Code finished with {subtype}"),
  exitedWithDetail: msg("Claude Code exited without a result ({exit}): {detail}"),
  exited: msg("Claude Code exited without a result ({exit})"),
  signal: msg("signal {signal}"),
  exitCode: msg("exit code {code}"),
  unknownError: msg("unknown error"),
  noDetails: msg("no details"),
  runFailed: msg("Run failed"),
  newSession: msg("{error}. Claude Code no longer has this session: re-queued in a new one."),
  higherTier: msg("{error}. Re-queued on a higher tier."),
  noTargets: msg("No target files: set target paths on the task or name files in the prompt"),
  excluded: msg("Excluded by the context profile: {files}"),
} as const;

export const RUN_TEXT_KEYS: readonly string[] = [
  RUN_TEXT.newSession,
  RUN_TEXT.higherTier,
  ...Object.values(RUN_TEXT).filter(
    (key) => key !== RUN_TEXT.newSession && key !== RUN_TEXT.higherTier,
  ),
];

export function localizeRunText(text: string | null): string | null {
  return txKnownOrNull(text, RUN_TEXT_KEYS);
}

function localizeItem(item: RunItem): RunItem {
  if (item.kind === "status" && item.message !== null)
    return { ...item, message: txKnown(item.message, RUN_TEXT_KEYS) };
  if (item.kind === "context" && item.note !== null)
    return { ...item, note: txKnown(item.note, RUN_TEXT_KEYS) };
  if (item.kind === "routing") return { ...item, rationale: localizeRationale(item.rationale) };
  return item;
}

export function localizeRunItems(items: RunItem[]): RunItem[] {
  return currentLocale() === "en" ? items : items.map(localizeItem);
}
