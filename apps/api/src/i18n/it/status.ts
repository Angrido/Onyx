export const STATUS: Record<string, string> = {
  "5-hour window": "finestra di 5 ore",
  "weekly limit": "limite settimanale",
  "weekly Opus limit": "limite settimanale Opus",
  "weekly Sonnet limit": "limite settimanale Sonnet",
  "extra usage": "uso extra",
  "subscription limit": "limite dell'abbonamento",
  "No limit reported yet: Claude reports the subscription limits during runs.":
    "Ancora nessun limite segnalato: Claude segnala i limiti dell'abbonamento durante le run.",
  "Within the subscription limits.": "Entro i limiti dell'abbonamento.",
  "Getting close to the {name}. Runs continue.": "Vicino al limite: {name}. Le run continuano.",
  "Getting close to the {name} ({percent}% used). Runs continue.":
    "Vicino al limite: {name} ({percent}% usato). Le run continuano.",
  "Almost at the {name}. Holding tasks that can wait is off.":
    "Quasi al limite: {name}. I task che possono aspettare non vengono trattenuti.",
  "Almost at the {name} ({percent}% used). Holding tasks that can wait is off.":
    "Quasi al limite: {name} ({percent}% usato). I task che possono aspettare non vengono trattenuti.",
  "Almost at the {name}: tasks that can wait will be held until it resets.":
    "Quasi al limite: {name}. I task che possono aspettare verranno trattenuti finché non si azzera.",
  "Almost at the {name} ({percent}% used): tasks that can wait will be held until it resets.":
    "Quasi al limite: {name} ({percent}% usato). I task che possono aspettare verranno trattenuti finché non si azzera.",
  "Almost at the {name}: {count} task that can wait is held until it resets.":
    "Quasi al limite: {name}. {count} task che può aspettare è trattenuto finché non si azzera.",
  "Almost at the {name} ({percent}% used): {count} task that can wait is held until it resets.":
    "Quasi al limite: {name} ({percent}% usato). {count} task che può aspettare è trattenuto finché non si azzera.",
  "Almost at the {name}: {count} tasks that can wait are held until it resets.":
    "Quasi al limite: {name}. {count} task che possono aspettare sono trattenuti finché non si azzera.",
  "Almost at the {name} ({percent}% used): {count} tasks that can wait are held until it resets.":
    "Quasi al limite: {name} ({percent}% usato). {count} task che possono aspettare sono trattenuti finché non si azzera.",
  "The {name} is reached: queued runs wait until it resets.":
    "Limite raggiunto: {name}. Le run in coda aspettano che si azzeri.",
  "The {name} ({percent}% used) is reached: queued runs wait until it resets.":
    "Limite raggiunto: {name} ({percent}% usato). Le run in coda aspettano che si azzeri.",
  "The code index failed: {error}": "L'indicizzazione del codice è fallita: {error}",
  "Git could not read the project: {error}": "Git non è riuscito a leggere il progetto: {error}",
  "Not a git repository": "Non è un repository git",
  "The last run failed": "L'ultima run è fallita",
  "The last run was interrupted": "L'ultima run è stata interrotta",
  "The last TDD loop did not reach green": "L'ultimo TDD loop non è arrivato al verde",
  "{count} approval waiting": "{count} approvazione in attesa",
  "{count} approvals waiting": "{count} approvazioni in attesa",
  "{count} commit behind {upstream}": "{count} commit indietro rispetto a {upstream}",
  "{count} commits behind {upstream}": "{count} commit indietro rispetto a {upstream}",
  "Run failed · {task}": "Run fallita · {task}",
  "Run timeout · {task}": "Run scaduta · {task}",
  "Run interrupted · {task}": "Run interrotta · {task}",
  "Waiting for you · {task}": "Ti aspetta · {task}",
  "{project}: {task}. The agent was not allowed to run {count} command: allow them to continue.":
    "{project}: {task}. L'agente non ha potuto eseguire {count} comando: consentilo per continuare.",
  "{project}: {task}. The agent was not allowed to run {count} commands: allow them to continue.":
    "{project}: {task}. L'agente non ha potuto eseguire {count} comandi: consentili per continuare.",
  "Done · {task}": "Completata · {task}",
  "Checks passed · {title}": "Check superati · {title}",
  "{project} #{number}: every check is green.": "{project} #{number}: tutti i check sono verdi.",
  "Checks failed · {title}": "Check falliti · {title}",
  "{project} #{number}: a check failed.": "{project} #{number}: un check è fallito.",
  "{project} #{number}: {checks} failed.": "{project} #{number}: check falliti: {checks}.",
  "Budget reached": "Budget raggiunto",
  "Approval needed": "Serve un'approvazione",
  "Runs stopped by a budget": "Run fermate da un budget",
  "Claude limits reset": "Limiti di Claude azzerati",
  "Claude limits: getting close": "Limiti di Claude: quasi raggiunti",
  "Claude limits: tasks that can wait are held":
    "Limiti di Claude: i task che possono aspettare sono trattenuti",
  "Claude limits reached": "Limiti di Claude raggiunti",
  "Open in Onyx": "Apri in Onyx",
  "Onyx test notification": "Notifica di prova di Onyx",
  "Notifications reach this channel.": "Le notifiche arrivano su questo canale.",
  "Enter the ntfy server and topic first": "Inserisci prima il server e il topic di ntfy",
  "Enter the bot token and chat id first": "Inserisci prima il token del bot e il chat id",
  "No browser is subscribed yet": "Ancora nessun browser iscritto",
  "No browser accepted the notification": "Nessun browser ha accettato la notifica",
  "Sent to {url}": "Inviata a {url}",
  "Sent to chat {chat}": "Inviata alla chat {chat}",
  "Sent to {count} browser": "Inviata a {count} browser",
  "Sent to {count} browsers": "Inviata a {count} browser",
  "All projects reached the hard budget of {amount}":
    "Tutti i progetti hanno raggiunto il limite hard di {amount}",
  "{project} reached the hard budget of {amount}":
    "{project} ha raggiunto il limite hard di {amount}",
  Project: "Progetto",
};
