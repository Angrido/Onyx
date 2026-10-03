import type { ModelTier, PermissionMode, TaskKind } from "@onyx/contracts";

export interface ModelProfileSeed {
  id: string;
  displayName: string;
  alias: string;
  tier: ModelTier;
  contextWindow: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number | null;
  enabled: boolean;
}

export const MODEL_PROFILES: readonly ModelProfileSeed[] = [
  {
    id: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    alias: "opus",
    tier: "ARCHITECT",
    contextWindow: 1_000_000,
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    cacheReadUsdPerMTok: 0.2,
    enabled: true,
  },
  {
    id: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    alias: "sonnet",
    tier: "BUILDER",
    contextWindow: 1_000_000,
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    cacheReadUsdPerMTok: 0.2,
    enabled: true,
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    alias: "haiku",
    tier: "SCOUT",
    contextWindow: 200_000,
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 5,
    cacheReadUsdPerMTok: null,
    enabled: true,
  },
  {
    id: "claude-fable-5-1",
    displayName: "Claude Fable 5.1",
    alias: "fable",
    tier: "APEX",
    contextWindow: 1_000_000,
    inputUsdPerMTok: 10,
    outputUsdPerMTok: 50,
    cacheReadUsdPerMTok: 0.25,
    enabled: false,
  },
];

export interface AgentConfigSeed {
  name: string;
  description: string;
  tier: ModelTier;
  modelId: string;
  fallbackModelIds: string[];
  permissionMode: PermissionMode;
  allowedTools: string[];
  disallowedTools: string[];
  maxTurns: number;
  timeoutSec: number;
  idleTimeoutSec: number;
}

const SAFE_GIT_TOOLS = ["Bash(git status *)", "Bash(git diff *)", "Bash(git log *)"];
const PROJECT_SCRIPT_TOOLS = [
  "Bash(pnpm lint *)",
  "Bash(pnpm typecheck *)",
  "Bash(pnpm test *)",
  "Bash(npm test *)",
  "Bash(npx vitest *)",
  "Bash(npx jest *)",
];
const DESTRUCTIVE_TOOLS = ["Bash(git push *)", "Bash(rm -rf *)", "Bash(sudo *)"];
const READ_TOOLS = ["Read", "Glob", "Grep"];
const EDIT_TOOLS = ["Edit", "Write"];
const TEST_FILE_EDIT_RULES = ["Edit(**/*.test.*)", "Edit(**/*.spec.*)", "Edit(**/__tests__/**)"];

export const AGENT_CONFIGS: readonly AgentConfigSeed[] = [
  {
    name: "architect",
    description: "Architectural work, schema design and cross-module refactors on Opus 5.5.",
    tier: "ARCHITECT",
    modelId: "claude-opus-5-5",
    fallbackModelIds: ["claude-sonnet-5-5"],
    permissionMode: "acceptEdits",
    allowedTools: [...READ_TOOLS, ...EDIT_TOOLS, ...SAFE_GIT_TOOLS, ...PROJECT_SCRIPT_TOOLS],
    disallowedTools: DESTRUCTIVE_TOOLS,
    maxTurns: 60,
    timeoutSec: 3_600,
    idleTimeoutSec: 600,
  },
  {
    name: "planner",
    description: "Read-only planning on Opus 5.5 in plan mode.",
    tier: "ARCHITECT",
    modelId: "claude-opus-5-5",
    fallbackModelIds: ["claude-sonnet-5-5"],
    permissionMode: "plan",
    allowedTools: [...READ_TOOLS, ...SAFE_GIT_TOOLS],
    disallowedTools: [...EDIT_TOOLS, ...DESTRUCTIVE_TOOLS],
    maxTurns: 30,
    timeoutSec: 1_800,
    idleTimeoutSec: 600,
  },
  {
    name: "builder",
    description: "Linear features and UI work on Sonnet 5.5.",
    tier: "BUILDER",
    modelId: "claude-sonnet-5-5",
    fallbackModelIds: ["claude-haiku-4-5"],
    permissionMode: "acceptEdits",
    allowedTools: [...READ_TOOLS, ...EDIT_TOOLS, ...SAFE_GIT_TOOLS, ...PROJECT_SCRIPT_TOOLS],
    disallowedTools: DESTRUCTIVE_TOOLS,
    maxTurns: 40,
    timeoutSec: 1_800,
    idleTimeoutSec: 300,
  },
  {
    name: "scout",
    description: "Read-only exploration, docs and chores on Haiku 4.5.",
    tier: "SCOUT",
    modelId: "claude-haiku-4-5",
    fallbackModelIds: [],
    permissionMode: "manual",
    allowedTools: READ_TOOLS,
    disallowedTools: [...EDIT_TOOLS, "Bash"],
    maxTurns: 20,
    timeoutSec: 900,
    idleTimeoutSec: 300,
  },
  {
    name: "test-fixer",
    description: "Fixes implementation code until tests pass, never the tests themselves.",
    tier: "BUILDER",
    modelId: "claude-sonnet-5-5",
    fallbackModelIds: ["claude-opus-5-5"],
    permissionMode: "acceptEdits",
    allowedTools: [...READ_TOOLS, ...EDIT_TOOLS, ...SAFE_GIT_TOOLS],
    disallowedTools: [...DESTRUCTIVE_TOOLS, ...TEST_FILE_EDIT_RULES, ...PROJECT_SCRIPT_TOOLS],
    maxTurns: 30,
    timeoutSec: 1_800,
    idleTimeoutSec: 300,
  },
];

export const DEFAULT_AGENT_CONFIG_NAME = "builder";

export interface RoutingRuleSeed {
  name: string;
  priority: number;
  targetTier: ModelTier;
  matcher: {
    taskKinds?: TaskKind[];
    workspaceDomains?: string[];
    pathGlobs?: string[];
    keywordsAny?: string[];
    styleOnly?: boolean;
  };
}

export const ROUTING_RULES: readonly RoutingRuleSeed[] = [
  {
    name: "architecture-work",
    priority: 10,
    targetTier: "ARCHITECT",
    matcher: { taskKinds: ["ARCHITECTURE"] },
  },
  {
    name: "architecture-keywords",
    priority: 15,
    targetTier: "ARCHITECT",
    matcher: {
      taskKinds: ["FEATURE", "REFACTOR", "BUGFIX"],
      keywordsAny: [
        "architettura",
        "architecture",
        "migrazione",
        "migration",
        "security",
        "sicurezza",
        "concorrenza",
        "concurrency",
        "api pubblica",
        "public api",
      ],
    },
  },
  {
    name: "database-changes",
    priority: 20,
    targetTier: "ARCHITECT",
    matcher: { workspaceDomains: ["DATABASE"], pathGlobs: ["**/prisma/**", "**/migrations/**"] },
  },
  {
    name: "ui-styling",
    priority: 30,
    targetTier: "BUILDER",
    matcher: { taskKinds: ["UI_STYLE"] },
  },
  {
    name: "style-only-files",
    priority: 35,
    targetTier: "BUILDER",
    matcher: { styleOnly: true },
  },
  {
    name: "test-fixing",
    priority: 40,
    targetTier: "BUILDER",
    matcher: { taskKinds: ["TEST_FIX"] },
  },
  {
    name: "docs-and-chores",
    priority: 50,
    targetTier: "SCOUT",
    matcher: { taskKinds: ["DOCS", "CHORE"] },
  },
];

export const APP_SETTINGS: Readonly<Record<string, unknown>> = {
  "router.weights": {
    blastRadius: 0.3,
    crossDomain: 0.2,
    filesTouched: 0.15,
    archKeywords: 0.15,
    contextTokens: 0.1,
    priorFailures: 0.1,
  },
  "router.thresholds": { architect: 0.55, builder: 0.2 },
  "router.classifierConfidence": 0.5,
  "router.autoEscalate": true,
  "router.tierModels": {},
  "runtime.maxConcurrentAgents": 2,
  "events.retentionDays": 30,
  "surgeon.defaultPreset": "aggressive",
};
