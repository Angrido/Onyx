export const help: Record<string, string> = {
  "Model level": "Livello del modello",
  Token: "Token",
  Cache: "Cache",
  Worktree: "Worktree",
  Approval: "Approvazione",
  "onyx tools": "Strumenti onyx",
  "Allowed commands": "Comandi consentiti",
  Ideation: "Ideation",
  Fence: "Recinto",
  Guard: "Guardia",
  "Claude limits": "Limiti di Claude",
  "Open the guide": "Apri la guida",
  "What does {term} mean?": "Cosa vuol dire {term}?",
  "An area of the project, such as frontend or backend, defined by folders. Each workspace keeps its own Claude conversations, so an agent only works on the files of its area.":
    "Un'area del progetto, come frontend o backend, definita da cartelle. Ogni workspace ha le sue conversazioni con Claude, così un agente lavora solo sui file della sua area.",
  "A Claude conversation that runs continue. Resuming it reuses what Claude already read, which costs fewer tokens than starting over.":
    "Una conversazione con Claude che le run proseguono. Riprenderla riusa quello che Claude ha già letto, e costa meno token che ricominciare da capo.",
  "When a task moves to another area or the conversation gets too long, Onyx starts a new session and passes a short summary of the previous one instead of the whole history.":
    "Quando un task passa a un'altra area o la conversazione diventa troppo lunga, Onyx apre una sessione nuova e le passa un breve riassunto di quella precedente invece di tutta la storia.",
  "What Onyx sends to Claude before it starts: the files of the task, the parts of the related files it needs and a map of the project. It avoids Claude reading whole folders.":
    "Quello che Onyx manda a Claude prima di iniziare: i file del task, le parti dei file collegati che servono e una mappa del progetto. Evita che Claude legga cartelle intere.",
  "A compact list of the project's files and their main functions, built from the code index and sent at the start of a session.":
    "Un elenco compatto dei file del progetto e delle loro funzioni principali, costruito dall'indice del codice e mandato all'inizio di una sessione.",
  "Onyx groups the Claude models in three levels: Architect (the strongest, for plans), Builder (for normal changes) and Scout (the cheapest, for small or read-only work).":
    "Onyx raggruppa i modelli di Claude in tre livelli: Architect (il più capace, per i piani), Builder (per le modifiche normali) e Scout (il più economico, per lavori piccoli o di sola lettura).",
  "The part of Onyx that picks the model for each run: the cheapest level that should finish the task, and a stronger one if the run fails for lack of turns.":
    "La parte di Onyx che sceglie il modello per ogni run: il livello più economico che dovrebbe finire il task, e uno più capace se la run fallisce perché finisce i turni.",
  "The unit Claude counts text in, roughly three quarters of a word. Your subscription limits and costs are measured in tokens.":
    "L'unità con cui Claude conta il testo, circa tre quarti di parola. I limiti dell'abbonamento e i costi si misurano in token.",
  "Text Claude has just read and can read again at a tenth of the price. It lasts a few minutes, so runs that resume quickly cost less.":
    "Testo che Claude ha appena letto e può rileggere a un decimo del prezzo. Dura pochi minuti, quindi le run che riprendono subito costano meno.",
  "Onyx runs the tests, gives the agent a short summary of what fails and repeats until everything passes or the attempts run out. The tests themselves cannot be changed by the agent.":
    "Onyx esegue i test, dà all'agente un breve riepilogo di ciò che fallisce e ripete finché tutto passa o i tentativi finiscono. L'agente non può modificare i test.",
  "A larger feature split by Claude into small tasks with their order. You approve the plan, then agents work on the tasks in parallel and Onyx merges them on one branch.":
    "Una funzionalità più grande che Claude divide in piccoli task con il loro ordine. Tu approvi il piano, poi gli agenti lavorano sui task in parallelo e Onyx li unisce su un solo branch.",
  "A separate copy of the project folder on its own branch, so that agents working in parallel do not change each other's files.":
    "Una copia separata della cartella del progetto su un suo branch, così gli agenti che lavorano in parallelo non si toccano i file a vicenda.",
  "A decision Onyx leaves to you before anything irreversible: starting a plan, merging a task, resolving a conflict or spending beyond a budget.":
    "Una decisione che Onyx lascia a te prima di qualcosa di irreversibile: avviare un piano, unire un task, risolvere un conflitto o spendere oltre un budget.",
  "The page where you choose which files Claude may never read, such as secrets, build output or large data, for the whole project or one workspace.":
    "La pagina dove scegli i file che Claude non deve mai leggere, come segreti, output della build o dati pesanti, per tutto il progetto o per un workspace.",
  "Tools Onyx gives Claude during a run to read only a function, the outline of a file or who uses what, instead of whole files.":
    "Strumenti che Onyx dà a Claude durante una run per leggere solo una funzione, lo schema di un file o chi usa cosa, invece di file interi.",
  "Commands agents may run without asking, such as tests and lint. Anything else is refused during a run, and the run page lets you allow it and continue.":
    "Comandi che gli agenti possono eseguire senza chiedere, come test e lint. Gli altri vengono rifiutati durante una run, e la pagina della run ti permette di consentirli e continuare.",
  "A task marked like this waits when your Claude subscription is near its limit and starts by itself when the window resets.":
    "Un task segnato così aspetta quando l'abbonamento Claude è vicino al limite e parte da solo quando la finestra si azzera.",
  "A spending limit. Above the soft limit new runs wait for your approval; at the hard limit Onyx stops them.":
    "Un limite di spesa. Oltre il limite soft le nuove run aspettano la tua approvazione; al limite hard Onyx le ferma.",
  "Short facts Onyx learns from the runs, such as the test command or files that matter, given to new sessions so Claude explores less.":
    "Brevi fatti che Onyx impara dalle run, come il comando dei test o i file importanti, dati alle sessioni nuove così Claude esplora meno.",
  "What Onyx knows about the project's code: files, functions and who imports what. It is updated after every run and costs no tokens.":
    "Quello che Onyx sa del codice del progetto: file, funzioni e chi importa cosa. Si aggiorna dopo ogni run e non costa token.",
  "A drawing of which files import which, to see the central files and the circular dependencies.":
    "Un disegno di quali file importano quali, per vedere i file centrali e le dipendenze circolari.",
  "Questions about the code. Many are answered from the index for free; the others go to the cheapest model.":
    "Domande sul codice. Molte trovano risposta gratis nell'indice; le altre vanno al modello più economico.",
  "A free check of the code for security and performance problems. Claude looks only at the suspicious lines, and only if you ask.":
    "Un controllo gratuito del codice per problemi di sicurezza e prestazioni. Claude guarda solo le righe sospette, e solo se glielo chiedi.",
  "An extra read-only agent that checks each task of a plan against its acceptance criteria before the merge.":
    "Un agente in più, in sola lettura, che controlla ogni task di un piano rispetto ai suoi criteri di accettazione prima del merge.",
  "The folders an agent may write to. Hard fences block writes outside them; handoff fences let the agent leave the area with a new session.":
    "Le cartelle in cui un agente può scrivere. I recinti rigidi bloccano le scritture fuori; quelli con passaggio lasciano uscire l'agente dall'area con una sessione nuova.",
  "A check Onyx runs before each command and file read of an agent, to block secrets and dangerous commands.":
    "Un controllo che Onyx fa prima di ogni comando e lettura di file di un agente, per bloccare segreti e comandi pericolosi.",
  "Claude Max lets you use a certain amount in each 5-hour window and each week. Onyx shows how much is used and can hold tasks that can wait.":
    "Claude Max permette un certo uso in ogni finestra di 5 ore e in ogni settimana. Onyx mostra quanto è usato e può trattenere i task che possono aspettare.",
};
