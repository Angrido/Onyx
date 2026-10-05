export const PLANS: Record<string, string> = {
  "Interrupted by an Onyx restart while planning":
    "Interrotto da un riavvio di Onyx durante la pianificazione",
  "Interrupted by an Onyx restart: resume it to continue":
    "Interrotto da un riavvio di Onyx: riprendilo per continuare",
  "Cancelled by the operator": "Annullato dall'operatore",
  "Plan discarded": "Piano scartato",
  "Plan cancelled": "Piano annullato",
  "Planning was interrupted": "La pianificazione è stata interrotta",
  "Waiting for a merge decision in Approvals":
    "In attesa di una decisione sul merge in Approvazioni",
  "Claude did not return a plan in the expected format":
    "Claude non ha restituito un piano nel formato previsto",
  "The plan has no usable tasks": "Il piano non ha task utilizzabili",
  "A task it depends on failed": "Un task da cui dipende non è riuscito",
  "Merge declined: the task was dropped": "Merge rifiutato: il task è stato abbandonato",
  "Reading the project index": "Lettura dell'indice del progetto",
  "Collecting the README, the tests and the history": "Raccolta di README, test e cronologia",
  "Claude is studying the project": "Claude sta studiando il progetto",
  "Not reviewed": "Non verificato",
  "The review returned no verdict": "La revisione non ha restituito un verdetto",
  "Git found no conflict to resolve": "Git non ha trovato conflitti da risolvere",
  "The resolution left nothing to commit": "La risoluzione non ha lasciato nulla da committare",
  "The tests or the type check fail on the proposal":
    "I test o il type check falliscono sulla proposta",
  "The plan moved on and the proposal no longer applies":
    "Il piano è andato avanti e la proposta non si applica più",
  "Tests not run: the plan does not verify.": "Test non eseguiti: il piano non prevede verifiche.",
  "No test runner: tests not run.": "Nessun test runner: test non eseguiti.",
  Interrupted: "Interrotta",
  "The roadmap was interrupted": "La generazione della roadmap è stata interrotta",
  "Claude did not return a roadmap in the expected JSON format":
    "Claude non ha restituito una roadmap nel formato JSON previsto",
  "Collecting README, manifests, TODOs and history":
    "Raccolta di README, manifest, TODO e cronologia",
  "Stopped by the operator": "Fermato dall'operatore",
  "The test runner found no tests to run": "Il test runner non ha trovato test da eseguire",
  "Interrupted by an Onyx restart": "Interrotto da un riavvio di Onyx",
  "Already green: tests and gates passed before any fix{note}":
    "Già verde: test e gate superati prima di qualsiasi correzione{note}",
  "Green after {count} fix attempt{note}": "Verde dopo {count} tentativo di correzione{note}",
  "Green after {count} fix attempts{note}": "Verde dopo {count} tentativi di correzione{note}",
  "Interrupted by an Onyx restart; restored {count} test file(s)":
    "Interrotto da un riavvio di Onyx; ripristinati {count} file di test",
  "The test command could not start (exit {code}): {detail}":
    "Il comando dei test non è partito (uscita {code}): {detail}",
  "The fix run ended with {status}: {error}":
    "La run di correzione è finita con stato {status}: {error}",
  "The fix run could not start: {error}": "La run di correzione non è potuta partire: {error}",
  "The loop budget of ${budget} is spent (${spent})":
    "Il budget del loop di ${budget} è esaurito (${spent})",
  "Still failing after {count} fix attempts (limit {limit})":
    "Ancora in errore dopo {count} tentativi di correzione (limite {limit})",
  "The same failures came back {count} times in a row after the escalation":
    "Gli stessi errori sono tornati {count} volte di fila dopo l'escalation",
  " · ignored {count} failure that already failed before this work: {labels}":
    " · ignorato {count} errore che falliva già prima di questo lavoro: {labels}",
  " · ignored {count} failures that already failed before this work: {labels}":
    " · ignorati {count} errori che fallivano già prima di questo lavoro: {labels}",
  "{labels} and {count} more": "{labels} e altri {count}",
  "Tests and type check on the proposal: no new failures.":
    "Test e type check sulla proposta: nessun nuovo errore.",
  "Tests and type check on the proposal: no new failures ({count} already failing before).":
    "Test e type check sulla proposta: nessun nuovo errore ({count} fallivano già prima).",
  "Tests or type check fail on the proposal: {failures}.":
    "Test o type check falliscono sulla proposta: {failures}.",
  "Claude Code stopped before answering ({reason})":
    "Claude Code si è fermato prima di rispondere ({reason})",
  "{count} task failed: {titles}": "{count} task non riuscito: {titles}",
  "{count} tasks failed: {titles}": "{count} task non riusciti: {titles}",
  "The task has no workspace": "Il task non ha un workspace",
  "The agent run could not start": "La run dell'agente non è potuta partire",
  "The agent run ended {status}: {error}":
    "La run dell'agente è finita con stato {status}: {error}",
  "The tests did not pass: {reason}": "I test non sono passati: {reason}",
  "QA found problems after {count} review: {problems}":
    "La QA ha trovato problemi dopo {count} revisione: {problems}",
  "QA found problems after {count} reviews: {problems}":
    "La QA ha trovato problemi dopo {count} revisioni: {problems}",
  "QA could not finish: {summary}": "La QA non è riuscita a finire: {summary}",
  "criterion {index} not met": "criterio {index} non soddisfatto",
  "The task has no branch to merge": "Il task non ha un branch da unire",
  "Merge conflict in {files}: Claude is proposing a resolution":
    "Conflitto di merge in {files}: Claude sta proponendo una risoluzione",
  "Merge conflict in {files}: a resolution is waiting in Approvals":
    "Conflitto di merge in {files}: una risoluzione aspetta in Approvazioni",
  "Merge conflict in {files}. {note}": "Conflitto di merge in {files}. {note}",
  "Merge conflict in {files}": "Conflitto di merge in {files}",
  "Claude's proposal was not usable: {reason}":
    "La proposta di Claude non era utilizzabile: {reason}",
  "The proposal no longer applies": "La proposta non si applica più",
  "The merged branch does not pass the tests: {reason}":
    "Il branch unito non passa i test: {reason}",
  "Merged {count} task into {branch}": "Unito {count} task in {branch}",
  "Merged {count} tasks into {branch}": "Uniti {count} task in {branch}",
  "the work branch": "il branch di lavoro",
  "Plan for {project}: {goal}": "Piano per {project}: {goal}",
  "the project": "il progetto",
  "{count} task: {summary}": "{count} task: {summary}",
  "{count} tasks: {summary}": "{count} task: {summary}",
  "Review: {title}": "Revisione: {title}",
  "QA found problems after {count} review: {problems}. {summary}":
    "La QA ha trovato problemi dopo {count} revisione: {problems}. {summary}",
  "QA found problems after {count} reviews: {problems}. {summary}":
    "La QA ha trovato problemi dopo {count} revisioni: {problems}. {summary}",
  "QA could not finish: {summary}. {details}":
    "La QA non è riuscita a finire: {summary}. {details}",
  "Merge conflict: {title}": "Conflitto di merge: {title}",
  "{note}. {branch} conflicts with {base} in {count} file(s). Resolve it on {branch} (for example in {path}) and retry, or drop the task.":
    "{note}. {branch} è in conflitto con {base} in {count} file. Risolvilo su {branch} (per esempio in {path}) e riprova, oppure abbandona il task.",
  "{branch} conflicts with {base} in {count} file(s). Resolve it on {branch} (for example in {path}) and retry, or drop the task.":
    "{branch} è in conflitto con {base} in {count} file. Risolvilo su {branch} (per esempio in {path}) e riprova, oppure abbandona il task.",
  "its worktree": "il suo worktree",
  "Resolved conflict: {title}": "Conflitto risolto: {title}",
  "Claude resolved the conflict in {count} file(s). {checks} Cost ${cost}. Read the diff on the plan page before applying it.":
    "Claude ha risolto il conflitto in {count} file. {checks} Costo ${cost}. Leggi il diff nella pagina del piano prima di applicarlo.",
  "Claude resolved the conflict in {count} file(s). {checks} Read the diff on the plan page before applying it.":
    "Claude ha risolto il conflitto in {count} file. {checks} Leggi il diff nella pagina del piano prima di applicarlo.",
};
