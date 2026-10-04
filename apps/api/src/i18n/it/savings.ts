export const SAVINGS: Record<string, string> = {
  "p = n/a": "p = n/d",
  "n/a": "n/d",
  "Careful: {percent} fewer runs succeed with the context.":
    "Attenzione: con il contesto riescono il {percent} di run in meno.",
  "Until then the estimate says no estimate yet.": "Fino ad allora non c'è ancora nessuna stima.",
  "Until then the estimate says an estimated {percent} fewer context tokens.":
    "Fino ad allora la stima indica il {percent} di token di contesto in meno.",
  "Until then the estimate says no saving even by the estimate.":
    "Fino ad allora nemmeno la stima indica un risparmio.",
  "Median input tokens per run over {pack} runs with the context and {control} without ({p}).":
    "Mediana dei token di input per run su {pack} run con il contesto e {control} senza ({p}).",
  "Measured: runs with the Onyx context use {percent} fewer input tokens":
    "Misurato: le run con il contesto di Onyx usano il {percent} di token di input in meno",
  "Median cost per run down {percent}.": "Costo mediano per run in calo del {percent}.",
  "Median cost per run up {percent}.": "Costo mediano per run in aumento del {percent}.",
  "Measured: runs with the Onyx context use {percent} more input tokens":
    "Misurato: le run con il contesto di Onyx usano il {percent} di token di input in più",
  "The pack is adding tokens instead of saving them: check the re-reads below and the pack budget.":
    "Il pacchetto aggiunge token invece di risparmiarli: controlla le riletture qui sotto e il budget del pacchetto.",
  "Measured: no significant difference yet": "Misurato: ancora nessuna differenza significativa",
  "Over {pack} runs with the context and {control} without the median differs by an unknown amount, which could still be chance ({p}).":
    "Su {pack} run con il contesto e {control} senza, la mediana differisce di una quantità sconosciuta, che potrebbe ancora essere casuale ({p}).",
  "Over {pack} runs with the context and {control} without the median differs by {change}, which could still be chance ({p}).":
    "Su {pack} run con il contesto e {control} senza, la mediana differisce del {change}, che potrebbe ancora essere casuale ({p}).",
  "Keep the experiment running for a clearer answer.":
    "Lascia attivo l'esperimento per una risposta più chiara.",
  "Measuring: {count} of {needed} runs per arm so far":
    "Misurazione in corso: finora {count} run su {needed} per gruppo",
  "The experiment needs {count} finished runs with and without the context before it can tell.":
    "L'esperimento ha bisogno di {count} run concluse con e senza il contesto prima di potersi esprimere.",
  "No runs with an Onyx context yet": "Ancora nessuna run con il contesto di Onyx",
  "Run a task on an indexed project with target paths to see what the context pack saves.":
    "Esegui un task su un progetto indicizzato con dei percorsi target per vedere quanto risparmia il pacchetto di contesto.",
  "Estimated {percent} fewer context tokens, not measured":
    "Stimato il {percent} di token di contesto in meno, non misurato",
  "Estimated: the context pack saves nothing":
    "Stimato: il pacchetto di contesto non risparmia nulla",
  "The estimate assumes that without Onyx the agent would read every target and direct dependency in full, and subtracts the files it read again anyway. Turn on the experiment to measure the saving on real runs.":
    "La stima presume che senza Onyx l'agente leggerebbe per intero ogni target e ogni dipendenza diretta, e sottrae i file che ha riletto comunque. Attiva l'esperimento per misurare il risparmio su run reali.",
  "Onyx context is on": "Il contesto di Onyx è attivo",
  "Runs get a context pack, a project map and the onyx MCP tools.":
    "Le run ricevono un pacchetto di contesto, una mappa del progetto e gli strumenti MCP di onyx.",
  "Onyx context is off": "Il contesto di Onyx è spento",
  "ONYX_CONTEXT_ENABLED is false: runs get no pack and nothing is saved.":
    "ONYX_CONTEXT_ENABLED è false: le run non ricevono nessun pacchetto e non si risparmia nulla.",
  "No finished runs yet": "Ancora nessuna run conclusa",
  "Nothing ran in the last {days} days.": "Nessuna run negli ultimi {days} giorni.",
  "{count} of {total} runs got a context pack":
    "{count} run su {total} hanno ricevuto un pacchetto di contesto",
  "Only {count} of {total} runs got a context pack":
    "Solo {count} run su {total} hanno ricevuto un pacchetto di contesto",
  "The pack is built from the target paths of the task or the files named in the prompt.":
    "Il pacchetto viene costruito dai percorsi target del task o dai file citati nel prompt.",
  "A run gets no pack when the project is not indexed or the task names no files: set target paths or name files in the prompt.":
    "Una run non riceve il pacchetto quando il progetto non è indicizzato o il task non cita file: imposta i percorsi target o cita i file nel prompt.",
  "Re-reads not measured yet": "Riletture non ancora misurate",
  "They are counted on runs that received a pack.":
    "Vengono contate sulle run che hanno ricevuto un pacchetto.",
  "{runs} of {total} runs read again {count} file the pack already covered (~{tokens} tokens, {share} of the full-read baseline).":
    "{runs} run su {total} hanno riletto {count} file già coperto dal pacchetto (~{tokens} token, il {share} della lettura completa).",
  "{runs} of {total} runs read again {count} files the pack already covered (~{tokens} tokens, {share} of the full-read baseline).":
    "{runs} run su {total} hanno riletto {count} file già coperti dal pacchetto (~{tokens} token, il {share} della lettura completa).",
  "The agent re-reads files it already has": "L'agente rilegge file che ha già",
  "Claude Code reads a file before editing it, so edited targets are always read again.":
    "Claude Code legge un file prima di modificarlo, quindi i target modificati vengono sempre riletti.",
  "Most re-read: {paths}.": "I più riletti: {paths}.",
  "Few re-reads": "Poche riletture",
  "No estimate yet": "Ancora nessuna stima",
  "It appears after the first run with a pack.": "Compare dopo la prima run con un pacchetto.",
  "The pack is smaller than what it replaces": "Il pacchetto è più piccolo di ciò che sostituisce",
  "Pack, map, MCP expansions and re-reads add up to {spent} tokens against {baseline} for reading the same files in full.":
    "Pacchetto, mappa, espansioni MCP e riletture sommano {spent} token contro i {baseline} della lettura completa degli stessi file.",
  "The pack costs more than it saves": "Il pacchetto costa più di quanto risparmia",
  "Pack, map, MCP expansions and re-reads add up to {spent} tokens against {baseline}: lower the pack budget or narrow the target paths.":
    "Pacchetto, mappa, espansioni MCP e riletture sommano {spent} token contro {baseline}: abbassa il budget del pacchetto o restringi i percorsi target.",
  "{pack} runs with the context and {control} without, {p}.":
    "{pack} run con il contesto e {control} senza, {p}.",
  "The saving is not measured": "Il risparmio non è misurato",
  "Everything above is an estimate. Turn on the experiment to compare real runs with and without the Onyx context.":
    "Tutto ciò che è sopra è una stima. Attiva l'esperimento per confrontare run reali con e senza il contesto di Onyx.",
  "The experiment is collecting runs": "L'esperimento sta raccogliendo run",
  "{pack} runs with the context and {control} without so far; {count} per arm are needed.":
    "Finora {pack} run con il contesto e {control} senza; ne servono {count} per gruppo.",
  "The experiment confirms the saving": "L'esperimento conferma il risparmio",
  "The experiment finds no clear difference": "L'esperimento non trova una differenza chiara",
  "The experiment says the context costs more": "Secondo l'esperimento il contesto costa di più",
  "Output tokens per completed run: {before} before short summaries, {after} after ({change}, medians over {beforeRuns} and {afterRuns} runs of {days} days each side). Before and after, not an A/B: the tasks differ too.":
    "Token di output per run completata: {before} prima dei riepiloghi brevi, {after} dopo ({change}, mediane su {beforeRuns} e {afterRuns} run di {days} giorni per parte). Un prima e dopo, non un A/B: anche i task sono diversi.",
  "Expected 20–40% fewer output tokens per run (output costs five times the input). Measured once there are {count} completed runs before and after the switch: now {before} and {after}.":
    "Previsto un 20–40% di token di output in meno per run (l'output costa cinque volte l'input). Misurato quando ci sono {count} run completate prima e dopo l'attivazione: ora {before} e {after}.",
  "Off: final summaries are as long as the agent makes them.":
    "Spento: i riepiloghi finali sono lunghi quanto li fa l'agente.",
  "Planner-model cost per plan: {without} without the explorer, {with} with it ({change}, medians over {withoutPlans} and {withPlans} plans). On Claude Max this is the share that weighs on the Opus quota.":
    "Costo del modello del planner per piano: {without} senza l'esploratore, {with} con l'esploratore ({change}, mediane su {withoutPlans} e {withPlans} piani). Su Claude Max è la quota che pesa sul limite di Opus.",
  "The planner and the roadmap delegate searches to an explorer on Haiku and the roadmap runs on Sonnet, so less of the Opus quota goes to reading files. Measured once there are {count} plans with and {count} without it: now {with} and {without}.":
    "Il planner e la roadmap delegano le ricerche a un esploratore su Haiku e la roadmap gira su Sonnet, così una parte minore del limite di Opus va nella lettura dei file. Misurato quando ci sono {count} piani con e {count} senza: ora {with} e {without}.",
  "Off: the planner and the roadmap explore on their own model.":
    "Spento: il planner e la roadmap esplorano con il proprio modello.",
  "Tokens per completed small task: {single} alone, {batched} in a grouped run ({change}, {batchedTasks} tasks in {batchedRuns} grouped runs against {singleTasks} in {singleRuns} single runs).":
    "Token per task piccolo completato: {single} da solo, {batched} in una run raggruppata ({change}, {batchedTasks} task in {batchedRuns} run raggruppate contro {singleTasks} in {singleRuns} run singole).",
  "Expected 10–30% fewer tokens per completed small task. Measured after {count} grouped and {count} single runs of small tasks: now {batched} and {single}.":
    "Previsto un 10–30% di token in meno per task piccolo completato. Misurato dopo {count} run raggruppate e {count} singole di task piccoli: ora {batched} e {single}.",
  "Off: turn it on in Settings to let Onyx group small queued tasks of the same workspace.":
    "Spento: attivalo nelle Impostazioni per far raggruppare a Onyx i task piccoli in coda dello stesso workspace.",
  "No plan used QA in the last {days} days. It is a cost, not a saving: each review reads the diff on the Builder model, an estimated 5–20K tokens per task, to avoid rework after the merge.":
    "Nessun piano ha usato la QA negli ultimi {days} giorni. È un costo, non un risparmio: ogni revisione legge il diff con il modello Builder, circa 5–20K token stimati per task, per evitare rilavorazioni dopo il merge.",
  "A cost, not a saving: {reviews} of {tasks} used {tokens} tokens ({usd}) in the last {days} days. They found problems in {caught} before the merge, and the agent fixed {fixed} of them after the review. The rework this avoids after the merge is not measured.":
    "Un costo, non un risparmio: {reviews} di {tasks}, per {tokens} token ({usd}) negli ultimi {days} giorni. Problemi trovati in {caught} prima del merge; l'agente ne ha corretti {fixed} dopo la revisione. La rilavorazione evitata dopo il merge non è misurata.",
  "{count} review": "{count} revisione",
  "{count} reviews": "{count} revisioni",
  "{count} task": "{count} task",
  "{count} tasks": "{count} task",
  "No merge conflict was handed to Claude in the last {days} days. It costs tokens only when a plan with the option on hits a conflict.":
    "Nessun conflitto di merge affidato a Claude negli ultimi {days} giorni. Costa token solo quando un piano con l'opzione attiva incontra un conflitto.",
  "A cost, not a saving: {count} conflict handed to Claude for {usd} in the last {days} days; {applied} applied, {refused} refused and {unusable} not usable (markers left or tests failing).":
    "Un costo, non un risparmio: {count} conflitto affidato a Claude per {usd} negli ultimi {days} giorni; applicati: {applied}, rifiutati: {refused}, non utilizzabili: {unusable} (marcatori rimasti o test falliti).",
  "A cost, not a saving: {count} conflicts handed to Claude for {usd} in the last {days} days; {applied} applied, {refused} refused and {unusable} not usable (markers left or tests failing).":
    "Un costo, non un risparmio: {count} conflitti affidati a Claude per {usd} negli ultimi {days} giorni; applicati: {applied}, rifiutati: {refused}, non utilizzabili: {unusable} (marcatori rimasti o test falliti).",
  "No question in the last {days} days. Questions about definitions, usages, imports, central files and cycles are answered from the index at no cost.":
    "Nessuna domanda negli ultimi {days} giorni. Le domande su definizioni, utilizzi, import, file centrali e cicli ricevono risposta dall'indice senza costi.",
  "{index} of {count} answer came from the index without a model ({percent}, measured).":
    "{index} risposta su {count} è arrivata dall'indice senza un modello ({percent}, misurato).",
  "{index} of {count} answers came from the index without a model ({percent}, measured).":
    "{index} risposte su {count} sono arrivate dall'indice senza un modello ({percent}, misurato).",
  "With no model answer yet, each is counted at ~{tokens} tokens (estimate).":
    "Senza ancora una risposta del modello, ognuna è contata ~{tokens} token (stima).",
  "A model answer used a median of {tokens} tokens (measured), so the index answers saved about that much each.":
    "Una risposta del modello ha usato una mediana di {tokens} token (misurato), quindi ogni risposta dall'indice ne ha risparmiati circa altrettanti.",
  "No analysis in the last {days} days. The static part is free; Claude only reads the suspicious snippets when you ask.":
    "Nessuna analisi negli ultimi {days} giorni. La parte statica è gratuita; Claude legge i frammenti sospetti solo quando lo chiedi.",
  "{count} analysis without a model in the last {days} days: rules, dependency audit and import graph cost no tokens.":
    "{count} analisi senza modello negli ultimi {days} giorni: regole, audit delle dipendenze e grafo degli import non costano token.",
  "{count} analyses without a model in the last {days} days: rules, dependency audit and import graph cost no tokens.":
    "{count} analisi senza modello negli ultimi {days} giorni: regole, audit delle dipendenze e grafo degli import non costano token.",
  "In {count} review Claude read {snippets} tokens of snippets instead of the {project} tokens of the analysed code (both measured), for {total} tokens in all ({usd}). The saving assumes a review of the whole code would read all of it.":
    "In {count} revisione Claude ha letto {snippets} token di frammenti invece dei {project} token del codice analizzato (entrambi misurati), per {total} token in tutto ({usd}). Il risparmio presume che una revisione di tutto il codice lo leggerebbe per intero.",
  "In {count} reviews Claude read {snippets} tokens of snippets instead of the {project} tokens of the analysed code (both measured), for {total} tokens in all ({usd}). The saving assumes a review of the whole code would read all of it.":
    "In {count} revisioni Claude ha letto {snippets} token di frammenti invece dei {project} token del codice analizzato (entrambi misurati), per {total} token in tutto ({usd}). Il risparmio presume che una revisione di tutto il codice lo leggerebbe per intero.",
  "In {count} review the snippets ({snippets} tokens) were not smaller than the analysed code ({project} tokens): on a project this small there is nothing to save. Cost {total} tokens ({usd}).":
    "In {count} revisione i frammenti ({snippets} token) non erano più piccoli del codice analizzato ({project} token): su un progetto così piccolo non c'è nulla da risparmiare. Costo {total} token ({usd}).",
  "In {count} reviews the snippets ({snippets} tokens) were not smaller than the analysed code ({project} tokens): on a project this small there is nothing to save. Cost {total} tokens ({usd}).":
    "In {count} revisioni i frammenti ({snippets} token) non erano più piccoli del codice analizzato ({project} token): su un progetto così piccolo non c'è nulla da risparmiare. Costo {total} token ({usd}).",
  "No run had to continue after a refused command in the last {days} days.":
    "Nessuna run ha dovuto proseguire dopo un comando rifiutato negli ultimi {days} giorni.",
  "Runs that continued after a refused command: {current} ({currentTokens} tokens, measured) in the last {days} days, {previous} ({previousTokens}) in the {days} days before. Allowing the stack's commands in advance avoids them; the drop is counted as saved.":
    "Run proseguite dopo un comando rifiutato: {current} ({currentTokens} token, misurato) negli ultimi {days} giorni, {previous} ({previousTokens}) nei {days} giorni precedenti. Consentire in anticipo i comandi dello stack le evita; il calo è contato come risparmio.",
  "No task has waited for the subscription window and no run has hit the limit in the last {days} days.":
    "Negli ultimi {days} giorni nessun task ha aspettato la finestra dell'abbonamento e nessuna run ha raggiunto il limite.",
  "In the last {days} days {deferred} waited for the subscription window to reset and {limited} hit the limit while working. Holding moves the spend after the reset instead of reducing it.":
    "Negli ultimi {days} giorni: {deferred} in attesa che la finestra dell'abbonamento si azzerasse, {limited} al limite mentre lavoravano. Trattenere i task sposta la spesa dopo l'azzeramento invece di ridurla.",
  "{count} run": "{count} run",
  "{count} runs": "{count} run",
  "A/B experiment: {change} input tokens per run with the Onyx context than without (median over {pack} and {control} runs, p {p}).":
    "Esperimento A/B: {change} di token di input per run con il contesto di Onyx rispetto a senza (mediana su {pack} e {control} run, p {p}).",
  "Reading every target and direct dependency in full, minus what Onyx delivered and the files the agent read again anyway. Turn on the experiment to measure it.":
    "La lettura completa di ogni target e dipendenza diretta, meno ciò che Onyx ha consegnato e i file che l'agente ha riletto comunque. Attiva l'esperimento per misurarlo.",
  "A/B against the current pack: {change} input tokens per run when the files to edit arrive as signatures (median over {variant} and {pack} runs, {p}).":
    "A/B contro il pacchetto attuale: {change} di token di input per run quando i file da modificare arrivano come firme (mediana su {variant} e {pack} run, {p}).",
  "Not tried yet: choose the variant in the experiment to send the files a task will edit as signatures instead of in full.":
    "Non ancora provato: scegli la variante nell'esperimento per inviare come firme, invece che per intero, i file che un task modificherà.",
  "In the last {days} days {count} run of the variant received the files to edit as signatures: {tokens} tokens not sent (counted at delivery). Claude reads a file before editing it anyway; the experiment says whether it explores more.":
    "Negli ultimi {days} giorni {count} run della variante ha ricevuto come firme i file da modificare: {tokens} token non inviati (contati alla consegna). Claude legge comunque un file prima di modificarlo; l'esperimento dice se esplora di più.",
  "In the last {days} days {count} runs of the variant received the files to edit as signatures: {tokens} tokens not sent (counted at delivery). Claude reads a file before editing it anyway; the experiment says whether it explores more.":
    "Negli ultimi {days} giorni {count} run della variante hanno ricevuto come firme i file da modificare: {tokens} token non inviati (contati alla consegna). Claude legge comunque un file prima di modificarlo; l'esperimento dice se esplora di più.",
  "No new session has started with it in the last {days} days.":
    "Negli ultimi {days} giorni nessuna nuova sessione è partita con la memoria.",
  "In the last {days} days {count} new session started with it, adding {tokens} tokens in all.":
    "Negli ultimi {days} giorni {count} nuova sessione è partita con la memoria, aggiungendo {tokens} token in tutto.",
  "In the last {days} days {count} new sessions started with it, adding {tokens} tokens in all.":
    "Negli ultimi {days} giorni {count} nuove sessioni sono partite con la memoria, aggiungendo {tokens} token in tutto.",
  "A/B on new sessions: {tokens} input tokens, {files} files read and {turns} turns per run with the project memory than without (medians over {with} and {without} runs, {p}).":
    "A/B sulle nuove sessioni: {tokens} di token di input, {files} di file letti e {turns} di turni per run con la memoria del progetto rispetto a senza (mediane su {with} e {without} run, {p}).",
  "Expected 10–30% fewer files read and turns in new sessions that start with the project memory; not measured yet.":
    "Previsto un 10–30% di file letti e turni in meno nelle nuove sessioni che partono con la memoria del progetto; non ancora misurato.",
  "The experiment is collecting runs: {with} with and {without} without, {count} each needed.":
    "L'esperimento sta raccogliendo run: {with} con e {without} senza, ne servono {count} per gruppo.",
  "Turn on the memory experiment in Settings to measure it.":
    "Attiva l'esperimento sulla memoria nelle Impostazioni per misurarlo.",
  "Resumed runs whose project map had changed but kept the one their session started with. They read {tokens} tokens from Claude's cache (measured); with a new map Claude would have written them again at 1.25× instead of 0.1×.":
    "Run riprese la cui mappa del progetto era cambiata ma che hanno tenuto quella con cui era partita la sessione. Hanno letto {tokens} token dalla cache di Claude (misurato); con una nuova mappa Claude li avrebbe riscritti a 1.25× invece che a 0.1×.",
  "No resumed run has needed it yet: it counts the resumes whose project map changed during the session.":
    "Nessuna run ripresa ne ha ancora avuto bisogno: conta le riprese la cui mappa del progetto è cambiata durante la sessione.",
  "Context pack entries the conversation already had, unchanged: listed by name instead of being sent again in resumed runs.":
    "Voci del pacchetto di contesto che la conversazione aveva già, invariate: elencate per nome invece di essere reinviate nelle run riprese.",
  "No resumed run has reused the pack yet.": "Nessuna run ripresa ha ancora riusato il pacchetto.",
  "{tokens} tokens Claude read from its cache in the last {days} days instead of at the full input rate.":
    "{tokens} token che Claude ha letto dalla sua cache negli ultimi {days} giorni invece che alla tariffa di input piena.",
  "Appears after the first completed task.": "Compare dopo il primo task completato.",
  "{percent} less than running every completed task on the reference model with the same tokens.":
    "{percent} in meno rispetto a eseguire ogni task completato sul modello di riferimento con gli stessi token.",
};
