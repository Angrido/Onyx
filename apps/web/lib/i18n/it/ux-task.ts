export const uxTask: Record<string, string> = {
  Breadcrumb: "Percorso",
  "Run of {task}": "Run di {task}",
  "Advanced options": "Opzioni avanzate",
  "Parallel agents, planner model, tests, QA, conflicts":
    "Agenti in parallelo, modello del planner, test, QA, conflitti",
  "work branch": "branch di lavoro",
  "Describe the work in plain words. Onyx picks the area of the project and the model; you can change them in Advanced options.":
    "Descrivi il lavoro a parole tue. Onyx sceglie l'area del progetto e il modello; puoi cambiarli in Opzioni avanzate.",
  "Empty: the first line of the prompt.": "Se vuoto, usa la prima riga del prompt.",
  "For example: Add a total to the cart in src/cart. Show it under the list, with two decimals. The cart tests must pass.":
    "Per esempio: aggiungi il totale al carrello in src/cart. Mostralo sotto l'elenco, con due decimali. I test del carrello devono passare.",
  "Say what to change, where, and how you will know it works.":
    "Di' cosa cambiare, dove, e come capirai che funziona.",
  "Short name in the task list": "Nome breve nell'elenco dei task",
  "Title (optional)": "Titolo (facoltativo)",
  "What should the agent do?": "Cosa deve fare l'agente?",
  "Workspace, kind, model, target files, can wait":
    "Workspace, tipo, modello, file target, può aspettare",
  "How to fix it: {fix}": "Come risolvere: {fix}",
  "A new Claude conversation instead of the previous one: costs more, helps when the agent got confused.":
    "Una nuova conversazione con Claude invece della precedente: costa di più, aiuta se l'agente si è confuso.",
  "An agent starts from the prompt of the task. You can change model and more in Advanced options.":
    "Un agente parte dal prompt del task. Modello e altro si cambiano in Opzioni avanzate.",
  "Ask for more": "Chiedi altro",
  "Auto lets Onyx pick the cheapest model that should finish the task.":
    "Con Auto Onyx sceglie il modello più economico che dovrebbe portare a termine il task.",
  "Changed options": "Opzioni modificate",
  "Choose the commands": "Scegli i comandi",
  "For example: also add a test for the empty cart.":
    "Per esempio: aggiungi anche un test per il carrello vuoto.",
  "How the agent runs": "Come lavora l'agente",
  "Model choice": "Scelta del modello",
  "Model, profile, TDD loop": "Modello, profilo, TDD loop",
  "Publish from the project": "Pubblica dal progetto",
  Relaunch: "Rilancia",
  "See the limits": "Vedi i limiti",
  "Show the changed file": "Mostra il file modificato",
  "Show the {count} changed files": "Mostra i {count} file modificati",
  "Try again": "Riprova",
  "View the pull request": "Vedi la pull request",
  "What should the agent do now?": "Cosa deve fare ora l'agente?",
  "Which tools and permissions the agent has. The workspace default suits most tasks.":
    "Quali strumenti e permessi ha l'agente. Quello predefinito del workspace va bene per quasi tutti i task.",
  "Go to the task": "Vai al task",
  "Context saved": "Contesto risparmiato",
  "Context saved, net": "Contesto risparmiato, netto",
  "Conversation size": "Dimensione della conversazione",
  Duration: "Durata",
  "Reread from cache": "Riletti dalla cache",
  "Tokens count towards your Claude limits.": "I token contano per i limiti di Claude.",
  "Tokens sent": "Token inviati",
  "Tokens written": "Token scritti",
  "1 task needs your decision": "1 task aspetta una tua decisione",
  "{count} tasks need your decision": "{count} task aspettano una tua decisione",
  "A merge conflict or a QA problem is waiting for you in Approvals.":
    "Un conflitto di merge o un problema trovato dal QA ti aspetta in Approvazioni.",
  "Agents are working on the plan": "Gli agenti lavorano sul piano",
  "All the work is on {branch}. Push it and open a pull request when ready.":
    "Tutto il lavoro è su {branch}. Pubblicalo e apri una pull request quando vuoi.",
  "An agent is working on it in its own worktree.": "Un agente ci lavora nel suo worktree.",
  "Final tests on the merged branch": "Test finali sul branch unito",
  "Fix the cause, then resume: the tasks already merged are kept.":
    "Risolvi la causa, poi riprendi: i task già uniti restano.",
  "If you approve, Claude's resolution is applied and the task is merged.":
    "Se approvi, la soluzione di Claude viene applicata e il task viene unito.",
  "If you approve, Onyx goes ahead as described above.":
    "Se approvi, Onyx procede come descritto sopra.",
  "If you approve, Onyx tries the merge again: fix the conflict on the task branch first.":
    "Se approvi, Onyx riprova il merge: prima risolvi il conflitto sul branch del task.",
  "If you approve, agents start on the tasks of the plan, each in its own worktree.":
    "Se approvi, gli agenti partono sui task del piano, ognuno nel suo worktree.",
  "If you approve, the task is merged into the work branch despite the problems.":
    "Se approvi, il task viene unito al branch di lavoro nonostante i problemi.",
  "If you approve, the waiting runs start and spending can go up to the hard limit.":
    "Se approvi, le run in attesa partono e la spesa può arrivare al limite massimo.",
  "If you reject, Onyx does not go ahead and nothing changes.":
    "Se rifiuti, Onyx non procede e non cambia nulla.",
  "If you reject, runs stay paused until the next period or a higher budget.":
    "Se rifiuti, le run restano in pausa fino al prossimo periodo o a un budget più alto.",
  "If you reject, the plan is discarded and no file changes.":
    "Se rifiuti, il piano viene scartato e nessun file cambia.",
  "If you reject, the resolution is discarded and you fix the conflict yourself.":
    "Se rifiuti, la soluzione viene scartata e risolvi tu il conflitto.",
  "If you reject, the task is dropped and its changes are not merged.":
    "Se rifiuti, il task viene abbandonato e le sue modifiche non vengono unite.",
  "It cannot start because a task it depends on did not finish.":
    "Non può partire perché un task da cui dipende non è finito.",
  "It did not finish: open the task to see why.": "Non è finito: apri il task per vedere perché.",
  "It reads the project without changing anything and splits the work into small tasks. It takes a few minutes.":
    "Legge il progetto senza cambiare nulla e divide il lavoro in piccoli task. Ci vuole qualche minuto.",
  "It will not run.": "Non verrà eseguito.",
  "Its changes are being merged into the work branch.":
    "Le sue modifiche vengono unite al branch di lavoro.",
  "Its changes are on the work branch.": "Le sue modifiche sono sul branch di lavoro.",
  "Its changes clash with another task: decide in Approvals.":
    "Le sue modifiche sono in conflitto con un altro task: decidi in Approvazioni.",
  "Merge conflicts": "Conflitti di merge",
  "No more tasks start. What was already merged stays on {branch}.":
    "Non partono altri task. Quello che era già unito resta su {branch}.",
  "No more tasks start.": "Non partono altri task.",
  "Onyx is running the tests on its changes.": "Onyx esegue i test sulle sue modifiche.",
  "Onyx runs the whole suite and the type check on {branch}.":
    "Onyx esegue tutta la suite e il type check su {branch}.",
  Permissions: "Permessi",
  "Plan finished: everything is merged": "Piano finito: è tutto unito",
  "Plans to start": "Piani da avviare",
  "QA found problems: decide in Approvals.": "Il QA ha trovato problemi: decidi in Approvazioni.",
  "QA problems": "Problemi trovati dal QA",
  "Read the tasks below. Nothing runs until you approve; then each task gets its own worktree.":
    "Leggi i task qui sotto. Non parte nulla finché non approvi; poi ogni task avrà il suo worktree.",
  "Starts when the tasks before it are merged and an agent is free.":
    "Parte quando i task precedenti sono uniti e c'è un agente libero.",
  "Stronger models": "Modelli più potenti",
  "The QA reviewer is checking the changes.": "Il revisore QA controlla le modifiche.",
  "The plan is ready and needs your approval": "Il piano è pronto e aspetta la tua approvazione",
  "The plan stopped": "Il piano si è fermato",
  "{merged} of {total} tasks merged. You can follow each task below.":
    "{merged} task su {total} uniti. Puoi seguire ogni task qui sotto.",
  "1 file changed · {cost} · {duration}.": "1 file modificato · {cost} · {duration}.",
  "{count} files changed · {cost} · {duration}.": "{count} file modificati · {cost} · {duration}.",
  "No file changed · {cost} · {duration}.": "Nessun file modificato · {cost} · {duration}.",
  "Check the changes in the steps below, then publish them from the project page.":
    "Controlla le modifiche nei passi qui sotto, poi pubblicale dalla pagina del progetto.",
  "Check the prompt, then start it: an agent works on it in its workspace and you follow every step here.":
    "Controlla il prompt e avvialo: un agente ci lavora nel suo workspace e tu segui ogni passo qui.",
  "Choose the ones you trust and the agent picks up in the same session.":
    "Scegli quelli di cui ti fidi e l'agente riprende nella stessa sessione.",
  "Claude Code took longer than the time limit. Try again with a smaller request.":
    "Claude Code ha superato il tempo massimo. Riprova con una richiesta più piccola.",
  "Claude is planning this work": "Claude sta pianificando questo lavoro",
  "Follow each step below. You can stop it at any time.":
    "Segui ogni passo qui sotto. Puoi fermarlo quando vuoi.",
  "In line: another agent is working in the same workspace":
    "In coda: un altro agente lavora nello stesso workspace",
  "In line: every agent slot is busy": "In coda: tutti gli slot degli agenti sono occupati",
  "In line: this project is at its run limit": "In coda: il progetto ha già il massimo di run",
  "Interrupted by an Onyx restart": "Interrotto da un riavvio di Onyx",
  "It did not finish": "Non è andato a buon fine",
  "It ran out of time": "Ha finito il tempo",
  "It starts as soon as another run ends.": "Parte appena finisce un'altra run.",
  "It starts when another run of this project ends.":
    "Parte quando finisce un'altra run di questo progetto.",
  "It starts when that run ends, so the two never change the same files.":
    "Parte quando quella run finisce, così le due non toccano mai gli stessi file.",
  "It stopped on commands it was not allowed to run":
    "Si è fermato su comandi che non aveva il permesso di eseguire",
  "It was stopped before finishing. You can run it again whenever you want.":
    "È stato fermato prima della fine. Puoi rieseguirlo quando vuoi.",
  "It was stopped before finishing.": "È stata fermata prima della fine.",
  "Nothing starts until you decide in Approvals.":
    "Non parte nulla finché non decidi in Approvazioni.",
  "Onyx is about to start an agent.": "Onyx sta per avviare un agente.",
  "Onyx is preparing the context and starting Claude Code.":
    "Onyx prepara il contesto e avvia Claude Code.",
  "Onyx runs the tests and has the agent fix what fails, until everything passes.":
    "Onyx esegue i test e fa correggere all'agente ciò che fallisce, finché passa tutto.",
  "Position {position} in the queue.": "Posizione {position} in coda.",
  "Published on {branch}: open a pull request when you are ready.":
    "Pubblicato su {branch}: apri una pull request quando vuoi.",
  "Read the last steps below to see where it stopped, then try again.":
    "Leggi gli ultimi passi qui sotto per capire dove si è fermato, poi riprova.",
  "Read the last steps below to see where it stopped.":
    "Leggi gli ultimi passi qui sotto per capire dove si è fermata.",
  "Ready, not started yet": "Pronto, non ancora avviato",
  "Relaunch the task to continue from the same session.":
    "Rilancia il task per continuare dalla stessa sessione.",
  "Right now a helper agent is working on a part.":
    "In questo momento un agente di supporto lavora a una parte.",
  "Right now it is changing files.": "In questo momento sta modificando dei file.",
  "Right now it is reading files.": "In questo momento sta leggendo dei file.",
  "Right now it is reading the project index.":
    "In questo momento sta consultando l'indice del progetto.",
  "Right now it is reading the web.": "In questo momento sta leggendo dal web.",
  "Right now it is running a command.": "In questo momento sta eseguendo un comando.",
  "Right now it is searching the code.": "In questo momento sta cercando nel codice.",
  "Right now it is thinking or writing.": "In questo momento sta ragionando o scrivendo.",
  "Right now it is updating its list of steps.":
    "In questo momento sta aggiornando la sua lista di passi.",
  "Right now it is using {tool}.": "In questo momento sta usando {tool}.",
  "Run finished": "Run finita",
  "Run stopped": "Run fermata",
  "Starting soon": "Parte a breve",
  "Starting the agent": "Avvio dell'agente",
  "The Claude limits or a budget are holding it. If a budget passed its soft limit, approve it in Approvals.":
    "Lo trattengono i limiti di Claude o un budget. Se un budget ha superato il limite soft, approvalo in Approvazioni.",
  "The TDD loop is running": "Il TDD loop è in corso",
  "The agent is working": "L'agente sta lavorando",
  "The next steps are on the task page: publish, open a pull request or ask for more.":
    "I passi successivi sono nella pagina del task: pubblica, apri una pull request o chiedi altro.",
  "The pull request is open: follow its checks on GitHub.":
    "La pull request è aperta: segui i suoi controlli su GitHub.",
  "The run did not finish": "La run non è andata a buon fine",
  "The run ran out of time": "La run ha finito il tempo",
  "The work done so far is kept in the session: relaunch it to pick up where it stopped.":
    "Il lavoro fatto finora resta nella sessione: rilancialo per ripartire da dove si è fermato.",
  "The work is finished.": "Il lavoro è finito.",
  "Waiting for the Claude window": "In attesa della finestra di Claude",
  "Waiting for the limits or for your approval": "In attesa dei limiti o della tua approvazione",
  "Waiting for your approval": "In attesa della tua approvazione",
  "When the plan is ready, Onyx asks you to approve it.":
    "Quando il piano è pronto, Onyx ti chiede di approvarlo.",
  "You can try again from the task page.": "Puoi riprovare dalla pagina del task.",
  "Your Claude limits are almost used up: it starts by itself when they reset {time}.":
    "I limiti di Claude sono quasi esauriti: parte da solo quando si azzerano {time}.",
  "Your Claude limits are almost used up: it starts by itself when they reset.":
    "I limiti di Claude sono quasi esauriti: parte da solo quando si azzerano.",
  "{phase} · attempt {attempt} of {max}.": "{phase} · tentativo {attempt} di {max}.",
};
