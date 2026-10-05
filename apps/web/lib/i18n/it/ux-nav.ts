export const uxNav: Record<string, string> = {
  Work: "Lavoro",
  Analysis: "Analisi",
  Usage: "Consumi",
  Models: "Modelli",
  Help: "Guida",
  More: "Altro",
  "Main navigation": "Navigazione principale",
  "Every project at a glance: what is running, waiting or needs you":
    "Tutti i progetti a colpo d'occhio: cosa gira, cosa aspetta, cosa serve a te",
  "Your repositories with their tasks, plans and workspaces":
    "I tuoi repository con task, piani e workspace",
  "Runs in progress and terminals, side by side": "Run in corso e terminali, fianco a fianco",
  "Decisions waiting for you before Onyx goes on": "Decisioni che aspettano te prima di proseguire",
  "How many tokens Onyx saved, measured or estimated":
    "Quanti token ha risparmiato Onyx, misurati o stimati",
  "Tokens, costs and Claude limits over time": "Token, costi e limiti di Claude nel tempo",
  "Which Claude model each run uses, and why": "Quale modello di Claude usa ogni run, e perché",
  "What Onyx did, with errors and details": "Cosa ha fatto Onyx, con errori e dettagli",
  "Claude account, GitHub, budgets, notifications and backups":
    "Account Claude, GitHub, budget, notifiche e backup",
  "How Onyx works, short how-tos and the glossary":
    "Come funziona Onyx, istruzioni brevi e glossario",
  "Other pages, search and sign out": "Altre pagine, ricerca e uscita",
  "Pages, projects, tasks and terms of the guide": "Pagine, progetti, task e termini della guida",
  Glossary: "Glossario",
  "How Onyx works, the things you do most often and the meaning of every term. The ? next to a word in the console opens its definition.":
    "Come funziona Onyx, le cose che fai più spesso e il significato di ogni termine. Il ? accanto a una parola nella console ne apre la definizione.",
  "On this page": "In questa pagina",
  "How Onyx works": "Come funziona Onyx",
  "From a folder to merged code, in six steps.": "Da una cartella al codice unito, in sei passi.",
  "Point Onyx at a folder or import a repository from GitHub. Onyx reads the code and builds its index without spending tokens.":
    "Indica a Onyx una cartella o importa un repository da GitHub. Onyx legge il codice e ne costruisce l'indice senza spendere token.",
  "Split it into workspaces": "Dividilo in workspace",
  "A workspace is an area of the project, such as frontend or backend. Onyx proposes them from the folders, and each one keeps its own Claude conversations.":
    "Un workspace è un'area del progetto, come frontend o backend. Onyx li propone dalle cartelle, e ognuno ha le sue conversazioni con Claude.",
  "Write a task": "Scrivi un task",
  "Describe what you want in a few lines, as you would to a colleague. If it is not urgent, mark it as one that can wait.":
    "Descrivi in poche righe quello che vuoi, come faresti con un collega. Se non è urgente, segnalo come task che può aspettare.",
  "Run it": "Avvialo",
  "An agent works on the task in its workspace. Onyx picks the model, sends only the files that matter and runs the tests until they pass.":
    "Un agente lavora al task nel suo workspace. Onyx sceglie il modello, manda solo i file che servono ed esegue i test finché passano.",
  "Review and merge": "Controlla e unisci",
  "Read the changes and the summary, then merge them, or reply to the agent and run it again. Anything irreversible waits for you in Approvals.":
    "Leggi le modifiche e il riepilogo, poi uniscile, oppure rispondi all'agente e rilancia. Tutto ciò che è irreversibile ti aspetta in Approvazioni.",
  "Check the savings": "Guarda i risparmi",
  "Savings shows how many tokens Onyx saved and how it knows: measured on real runs or estimated.":
    "Risparmi mostra quanti token ha risparmiato Onyx e come lo sa: misurati su run vere o stimati.",
  "How to": "Come fare",
  "The things you do most often.": "Le cose che fai più spesso.",
  "Start a task": "Avviare un task",
  "Open the project from Projects.": "Apri il progetto da Progetti.",
  "Press New task, write what you want and choose the workspace, or leave it to Onyx.":
    "Premi Nuovo task, scrivi cosa vuoi e scegli il workspace, oppure lascia scegliere a Onyx.",
  "Start it: the run page shows what the agent does, live.":
    "Avvialo: la pagina della run mostra in diretta cosa fa l'agente.",
  "When it ends, read the changes and merge them, or reply to the agent.":
    "Quando finisce, leggi le modifiche e uniscile, oppure rispondi all'agente.",
  "Plan a bigger feature": "Pianificare una funzionalità più grande",
  "In the project, press Plan a feature and describe the goal.":
    "Nel progetto, premi Pianifica una funzionalità e descrivi l'obiettivo.",
  "Claude splits it into small tasks with their order. Read the plan and approve it.":
    "Claude la divide in piccoli task con il loro ordine. Leggi il piano e approvalo.",
  "Agents work on the tasks in parallel, each on its own copy of the project.":
    "Gli agenti lavorano ai task in parallelo, ognuno su una sua copia del progetto.",
  "Onyx merges them on one branch; with QA review on, a read-only agent checks each task first.":
    "Onyx li unisce su un solo branch; con la revisione QA attiva, un agente in sola lettura controlla prima ogni task.",
  "When a run fails or a command is refused":
    "Quando una run fallisce o un comando viene rifiutato",
  "Open the run: the last lines of its output say why it stopped.":
    "Apri la run: le ultime righe dell'output dicono perché si è fermata.",
  "If a command was refused, press Allow and continue: you choose whether it applies to this task or to the agent, and for how long.":
    "Se un comando è stato rifiutato, premi Consenti e continua: scegli se vale per questo task o per l'agente, e per quanto tempo.",
  "If the run ran out of turns, Onyx can queue it again on a stronger model by itself.":
    "Se la run ha finito i turni, Onyx può rimetterla in coda da solo su un modello più capace.",
  "Otherwise reply to the agent with what to change and run it again.":
    "Altrimenti rispondi all'agente con cosa cambiare e rilancia.",
  "Read Savings": "Leggere Risparmi",
  "Measured means Onyx compared the token counts Claude reported on real runs.":
    "Misurato vuol dire che Onyx ha confrontato i token che Claude ha contato su run vere.",
  "Estimated means Onyx calculated what it avoided sending, such as files Claude did not have to read.":
    "Stimato vuol dire che Onyx ha calcolato quello che ha evitato di mandare, come i file che Claude non ha dovuto leggere.",
  "The two are not added up, because they are counted in different ways.":
    "I due non si sommano, perché sono contati in modi diversi.",
  "To turn an estimate into a measurement, run the experiment on the Savings page.":
    "Per trasformare una stima in una misura, esegui l'esperimento nella pagina Risparmi.",
  "Find logs and diagnostics": "Trovare log e diagnostica",
  "Each run keeps its own output on its page.": "Ogni run conserva il suo output nella sua pagina.",
  "Logs shows the last lines written by Onyx, with secrets masked.":
    "Log mostra le ultime righe scritte da Onyx, con i segreti mascherati.",
  "In Settings, Diagnostics prepares one file with versions, health and recent errors, to send when you ask for help.":
    "In Impostazioni, Diagnostica prepara un unico file con versioni, stato ed errori recenti, da mandare quando chiedi aiuto.",
  "Related terms": "Termini collegati",
  "The words Onyx uses, in plain terms.": "Le parole che usa Onyx, spiegate in modo semplice.",
  "Filter the glossary": "Filtra il glossario",
  "Filter the terms…": "Filtra i termini…",
  "Clear the filter": "Cancella il filtro",
  "1 term": "1 termine",
  "{count} terms": "{count} termini",
  "No term matches “{query}”.": "Nessun termine corrisponde a “{query}”.",
  "Onyx picks a Claude model for every run: the cheapest that should finish the task, and a stronger one if it fails. Here you see what this saves, try a task in the simulator and set your own rules.":
    "Onyx sceglie un modello di Claude per ogni run: il più economico che dovrebbe finire il task, e uno più capace se fallisce. Qui vedi quanto si risparmia, provi un task nel simulatore e imposti le tue regole.",
  "How the choice is made": "Come avviene la scelta",
};
