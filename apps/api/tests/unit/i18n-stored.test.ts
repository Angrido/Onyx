import type { RoutingFeatures, RunItem } from "@onyx/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalService } from "../../src/application/approval-service";
import { BudgetService } from "../../src/application/budget-service";
import { localizeApprovalText } from "../../src/application/orchestrator-service";
import { TDD_TEXT_KEYS } from "../../src/application/tdd-service";
import { planRouting, type RoutingContext } from "../../src/domain/routing/decide";
import { localizeRationale } from "../../src/domain/routing/rationale";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from "../../src/domain/routing/scoring";
import { resolveRunOutcome } from "../../src/domain/run-outcome";
import { localizeRunItems, localizeRunText, RUN_TEXT } from "../../src/domain/run-texts";
import { ignoredNote } from "../../src/domain/tdd/baseline";
import { decideNext, initialProgress } from "../../src/domain/tdd/loop-policy";
import { msg, rememberLocale, runWithLocale, txKnown } from "../../src/i18n";
import { GITHUB_FAILURE_KEYS } from "../../src/infrastructure/github-client";

const it_ = <T>(fn: () => T): T => runWithLocale("it", fn);
const en = <T>(fn: () => T): T => runWithLocale("en", fn);

function features(overrides: Partial<RoutingFeatures> = {}): RoutingFeatures {
  return {
    kind: "FEATURE",
    workspaceDomain: "FRONTEND",
    domains: ["FRONTEND"],
    crossDomain: false,
    filesTouched: 0,
    targets: [],
    blastRadius: 0,
    archKeywords: [],
    styleOnly: false,
    contextTokens: 0,
    priorFailures: 0,
    ...overrides,
  };
}

function routing(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    features: features(),
    text: "Show a cart label",
    override: null,
    rules: [],
    weights: DEFAULT_WEIGHTS,
    thresholds: DEFAULT_THRESHOLDS,
    classifierConfidence: 0,
    previous: null,
    lastRun: null,
    ...overrides,
  };
}

describe("txKnown", () => {
  afterEach(() => rememberLocale("en"));

  const keys = [msg("Merged {count} tasks into {branch}"), msg("the work branch")];

  it("renders a stored English text with its values in Italian", () => {
    expect(it_(() => txKnown("Merged 2 tasks into onyx/plan-x", keys))).toBe(
      "Uniti 2 task in onyx/plan-x",
    );
    expect(it_(() => txKnown("Merged 2 tasks into the work branch", keys))).toBe(
      "Uniti 2 task in il branch di lavoro",
    );
  });

  it("keeps English texts byte for byte", () => {
    expect(en(() => txKnown("Merged 2 tasks into onyx/plan-x", keys))).toBe(
      "Merged 2 tasks into onyx/plan-x",
    );
  });

  it("passes unknown texts through", () => {
    expect(it_(() => txKnown("Claude wrote this summary", keys))).toBe("Claude wrote this summary");
    expect(it_(() => txKnown("Merged two tasks into main", keys))).toBe(
      "Merged two tasks into main",
    );
  });
});

describe("run texts read in Italian", () => {
  afterEach(() => rememberLocale("en"));

  const items: RunItem[] = [
    {
      kind: "status",
      status: "INTERRUPTED",
      exitCode: null,
      signal: null,
      message: RUN_TEXT.interrupted,
    },
    {
      kind: "context",
      targets: [],
      inferredTargets: [],
      entries: [],
      mapTokens: 0,
      packTokens: 0,
      baselineTokens: 0,
      deliveredTokens: 0,
      reusedTokens: 0,
      signatureTokens: 0,
      mapFrozen: false,
      indexedAt: null,
      mcpEnabled: false,
      note: "No target files: set target paths on the task or name files in the prompt",
      arm: null,
    },
    { kind: "text", messageId: "m1", text: "Interrupted by Onyx restart", parentToolUseId: null },
  ];

  it("translates status messages, context notes and run errors", () => {
    const shown = it_(() => localizeRunItems(items));
    expect(shown[0]).toMatchObject({ message: "Interrotta da un riavvio di Onyx" });
    expect(shown[1]).toMatchObject({
      note: "Nessun file target: imposta i percorsi target sul task o nomina i file nel prompt",
    });
    expect(shown[2]).toEqual(items[2]);
    const outcome = resolveRunOutcome(
      {
        reason: "spawn_error",
        exitCode: null,
        signal: null,
        sawInit: false,
        sawResult: false,
        stderrTail: "",
        error: null,
      },
      null,
    );
    expect(outcome.errorMessage).toBe("Unable to start Claude Code: unknown error");
    expect(it_(() => localizeRunText(outcome.errorMessage))).toBe(
      "Impossibile avviare Claude Code: errore sconosciuto",
    );
    expect(
      it_(() =>
        localizeRunText(
          "Claude Code reported an error: API overloaded. Re-queued on a higher tier.",
        ),
      ),
    ).toBe(
      "Claude Code ha segnalato un errore: API overloaded. Rimessa in coda su un tier superiore.",
    );
  });

  it("leaves English run items untouched", () => {
    expect(en(() => localizeRunItems(items))).toBe(items);
    expect(en(() => localizeRunText(RUN_TEXT.interrupted))).toBe("Interrupted by Onyx restart");
  });
});

describe("router rationale read in Italian", () => {
  afterEach(() => rememberLocale("en"));

  it("translates the heuristic score and its signals", () => {
    const quiet = planRouting(routing());
    expect(quiet.rationale).toBe("Score 0.00 < 0.55: no complexity signals");
    expect(it_(() => localizeRationale(quiet.rationale))).toBe(
      "Punteggio 0.00 < 0.55: nessun segnale di complessità",
    );
    const busy = planRouting(
      routing({
        features: features({
          kind: "DOCS",
          crossDomain: true,
          domains: ["FRONTEND", "BACKEND"],
          filesTouched: 2,
          blastRadius: 3,
          archKeywords: ["auth", "schema"],
          contextTokens: 2_400,
          priorFailures: 1,
        }),
      }),
    );
    expect(en(() => localizeRationale(busy.rationale))).toBe(busy.rationale);
    expect(it_(() => localizeRationale(`${busy.rationale} · classifier unavailable`))).toBe(
      it_(() => localizeRationale(busy.rationale)) + " · classificatore non disponibile",
    );
    const shown = it_(() => localizeRationale(busy.rationale));
    expect(shown).toMatch(/^Punteggio \d\.\d\d /);
    for (const part of [
      "raggio d'impatto 3",
      "multi-dominio (FRONTEND, BACKEND)",
      "2 file target",
      "parole chiave di architettura: auth, schema",
      "~2k token dei target",
      "1 run fallita",
    ])
      expect(shown).toContain(part);
  });

  it("translates rules, escalations and suffixes", () => {
    const rule = planRouting(
      routing({
        rules: [
          {
            id: "r1",
            name: "ui-styling",
            priority: 1,
            projectId: null,
            matcher: { taskKinds: ["FEATURE"], keywordsAny: ["cart"] },
            targetTier: "BUILDER",
            modelId: null,
          },
        ],
      }),
    );
    expect(rule.rationale).toBe('Rule ui-styling matched (kind FEATURE, keyword "cart")');
    expect(it_(() => localizeRationale(rule.rationale))).toBe(
      'Regola ui-styling applicata (tipo FEATURE, parola chiave "cart")',
    );
    const escalated = planRouting(
      routing({ escalation: { tier: "ARCHITECT", reason: "suggested by the plan" } }),
    );
    expect(it_(() => localizeRationale(escalated.rationale))).toBe(
      "Scalato a ARCHITECT: suggerito dal piano. Routing di base: Punteggio 0.00 < 0.55: nessun segnale di complessità",
    );
    expect(
      it_(() =>
        localizeRationale(
          "Score 0.00 < 0.55: no complexity signals · classifier unavailable · claude-x is not enabled",
        ),
      ),
    ).toBe(
      "Punteggio 0.00 < 0.55: nessun segnale di complessità · classificatore non disponibile · claude-x non è abilitato",
    );
  });
});

describe("plan, loop and approval texts read in Italian", () => {
  afterEach(() => rememberLocale("en"));

  it("translates the stored plan and approval messages", () => {
    const cases: Array<[string, string]> = [
      [
        "Plan for shop: Show a cart label on the checkout page",
        "Piano per shop: Show a cart label on the checkout page",
      ],
      ["Merged 2 tasks into onyx/plan-20261005-cart", "Uniti 2 task in onyx/plan-20261005-cart"],
      ["Merged 1 task into the work branch", "Unito 1 task in il branch di lavoro"],
      [
        "The tests did not pass: Still failing after 3 fix attempts (limit 3)",
        "I test non sono passati: Ancora in errore dopo 3 tentativi di correzione (limite 3)",
      ],
      ["2 tasks failed: Add badge, Fix cart", "2 task non riusciti: Add badge, Fix cart"],
      [
        "Merge conflict in src/a.ts, src/b.ts: a resolution is waiting in Approvals",
        "Conflitto di merge in src/a.ts, src/b.ts: una risoluzione aspetta in Approvazioni",
      ],
      [
        "Merge conflict in src/a.ts. Claude's proposal was not usable: Git found no conflict to resolve",
        "Conflitto di merge in src/a.ts. La proposta di Claude non era utilizzabile: Git non ha trovato conflitti da risolvere",
      ],
      [
        "QA found problems after 2 reviews: criterion 1 not met; the badge is missing",
        "La QA ha trovato problemi dopo 2 revisioni: criterio 1 non soddisfatto; the badge is missing",
      ],
      [
        "The agent run ended interrupted: Interrupted by Onyx restart",
        "La run dell'agente è finita con stato interrupted: Interrotta da un riavvio di Onyx",
      ],
      [
        "Claude resolved the conflict in 1 file(s). No test runner: tests not run. Cost $0.012. Read the diff on the plan page before applying it.",
        "Claude ha risolto il conflitto in 1 file. Nessun test runner: test non eseguiti. Costo $0.012. Leggi il diff nella pagina del piano prima di applicarlo.",
      ],
      [
        "onyx/a conflicts with onyx/plan in 2 file(s). Resolve it on onyx/a (for example in its worktree) and retry, or drop the task.",
        "onyx/a è in conflitto con onyx/plan in 2 file. Risolvilo su onyx/a (per esempio in il suo worktree) e riprova, oppure abbandona il task.",
      ],
    ];
    for (const [english, italian] of cases) {
      expect(it_(() => localizeApprovalText(english))).toBe(italian);
      expect(en(() => localizeApprovalText(english))).toBe(english);
    }
    expect(it_(() => localizeApprovalText("A plan Claude wrote: keep it"))).toBe(
      "A plan Claude wrote: keep it",
    );
  });

  it("translates the loop messages generated in English", () => {
    const stop = decideNext(
      { ...initialProgress(), fixes: 3 },
      { maxIterations: 3, budgetUsd: null, spentUsd: 0 },
    );
    expect(stop).toMatchObject({ reason: "Still failing after 3 fix attempts (limit 3)" });
    const reason = stop.action === "stop" ? stop.reason : "";
    expect(it_(() => txKnown(reason, TDD_TEXT_KEYS))).toBe(
      "Ancora in errore dopo 3 tentativi di correzione (limite 3)",
    );
    const green = `Green after 2 fix attempts${ignoredNote(["a", "b", "c", "d", "e"])}`;
    expect(green).toBe(
      "Green after 2 fix attempts · ignored 5 failures that already failed before this work: a; b; c and 2 more",
    );
    expect(it_(() => txKnown(green, TDD_TEXT_KEYS))).toBe(
      "Verde dopo 2 tentativi di correzione · ignorati 5 errori che fallivano già prima di questo lavoro: a; b; c e altri 2",
    );
    expect(
      it_(() => txKnown("Already green: tests and gates passed before any fix", TDD_TEXT_KEYS)),
    ).toBe("Già verde: test e gate superati prima di qualsiasi correzione");
  });

  it("translates budget approvals through their registered localizer", () => {
    let localize: ((text: string) => string) | undefined;
    const approvals = {
      register: (_kind: string, _handler: unknown, given?: (text: string) => string) => {
        localize = given;
      },
      create: () => Promise.reject(new Error("unused")),
      expire: () => Promise.resolve(0),
    } as unknown as Pick<ApprovalService, "create" | "register" | "expire">;
    new BudgetService({ approvals } as unknown as ConstructorParameters<typeof BudgetService>[0]);
    const title = "All projects: soft budget of $5.00 passed";
    expect(it_(() => localize?.(title))).toBe("Tutti i progetti: limite soft di $5.00 superato");
    expect(en(() => localize?.(title))).toBe(title);
  });

  it("translates the GitHub account errors", () => {
    expect(
      it_(() =>
        txKnown("GitHub rejected the token: it is wrong, expired or revoked", GITHUB_FAILURE_KEYS),
      ),
    ).toBe("GitHub ha rifiutato il token: è errato, scaduto o revocato");
    expect(
      it_(() =>
        txKnown(
          "GitHub is unreachable from this machine (getaddrinfo ENOTFOUND)",
          GITHUB_FAILURE_KEYS,
        ),
      ),
    ).toBe("GitHub non è raggiungibile da questa macchina (getaddrinfo ENOTFOUND)");
  });
});
