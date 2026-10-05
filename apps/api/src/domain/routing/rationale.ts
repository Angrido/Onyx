import { msg, txKnown } from "../../i18n";

export const RATIONALE = {
  rule: msg("Rule {rule} matched ({reasons})"),
  score: msg("Score {score} {band}: {signals}"),
  lightBand: msg("< {threshold} for a {kind} task"),
  operatorRun: msg("Model chosen by the operator for this run"),
  pinned: msg("Model pinned on the task by the operator"),
  escalated: msg("Escalated to {tier}: {reason}. Base routing: {base}"),
  turnLimit: msg(
    "Escalated from {previous} to {tier}: the last run hit the turn limit. Base routing: {base}",
  ),
  back: msg("Back to {tier} after the escalated {previous} run succeeded. {base}"),
  keeping: msg("Keeping the escalated tier {tier} until a run succeeds. Base routing: {base}"),
  classifier: msg("Classifier {model}: {verdict} (heuristic: {heuristic})"),
  unavailable: msg("{rationale} · classifier unavailable"),
  notEnabled: msg("{rationale} · {model} is not enabled"),
  substituted: msg("{rationale} · no enabled {tier} model, using {resolved}"),
  planHint: msg("suggested by the plan"),
  tddStalled: msg("the TDD loop made no progress in {count} attempts on {tier}"),
} as const;

export const SIGNAL = {
  blastRadius: msg("blast radius {count}"),
  crossDomain: msg("cross-domain ({domains})"),
  file: msg("{count} target file"),
  files: msg("{count} target files"),
  keywords: msg("architecture keywords: {keywords}"),
  kiloTokens: msg("~{count}k tokens of targets"),
  tokens: msg("~{count} tokens of targets"),
  failedRun: msg("{count} failed run"),
  failedRuns: msg("{count} failed runs"),
  none: msg("no complexity signals"),
} as const;

export const RULE_REASON = {
  kind: msg("kind {kind}"),
  workspace: msg("workspace {workspace}"),
  path: msg("path {path}"),
  keyword: msg('keyword "{keyword}"'),
  files: msg("{count} files ≤ {max}"),
  blastRadius: msg("blast radius {count} ≤ {max}"),
  styleOnly: msg("style files only"),
  notStyleOnly: msg("not only style files"),
} as const;

const RATIONALE_KEYS: readonly string[] = [
  RATIONALE.unavailable,
  RATIONALE.notEnabled,
  RATIONALE.substituted,
  RATIONALE.classifier,
  RATIONALE.escalated,
  RATIONALE.turnLimit,
  RATIONALE.back,
  RATIONALE.keeping,
  RATIONALE.rule,
  RATIONALE.score,
  RATIONALE.lightBand,
  RATIONALE.operatorRun,
  RATIONALE.pinned,
  RATIONALE.planHint,
  RATIONALE.tddStalled,
];

const SIGNAL_KEYS: readonly string[] = Object.values(SIGNAL);
const RULE_REASON_KEYS: readonly string[] = Object.values(RULE_REASON);

const SIGNAL_START =
  /, (?=blast radius \d|cross-domain \(|\d+ target files?(?:, |$)|architecture keywords: |~\d+k? tokens of targets|\d+ failed runs?(?:, |$))/;
const REASON_START =
  /, (?=kind |workspace |path |keyword "|\d+ files ≤ |blast radius \d+ ≤ |style files only$|not only style files$)/;

function translateList(text: string, separator: RegExp, keys: readonly string[]): string {
  return text
    .split(separator)
    .map((part) => txKnown(part, keys))
    .join(", ");
}

export function localizeRationale(text: string): string {
  return txKnown(text, RATIONALE_KEYS, {
    signals: (value) => translateList(value, SIGNAL_START, SIGNAL_KEYS),
    reasons: (value) => translateList(value, REASON_START, RULE_REASON_KEYS),
    verdict: (value) => value,
  });
}
