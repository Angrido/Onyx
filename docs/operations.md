# Onyx — guida operativa

Procedure per chi gestisce un'installazione di Onyx: comandi, dati, backup e ripristino, aggiornamenti di Onyx e di Claude Code, sicurezza e risoluzione dei problemi. L'architettura è in [`architecture.md`](../architecture.md).

## 1. Le due modalità

| Modalità | Quando | Processi | Configurazione |
|---|---|---|---|
| Sviluppo | Repository clonato e `scripts/install.sh` | `pnpm dev` in background, avviato da `onyx-start` | `apps/api/.env` |
| Servizio | Container preparato con `deploy/lxc/bootstrap.sh` | `onyx-api.service`, `onyx-web.service`, Caddy | `/etc/onyx/onyx.env` |

I comandi `onyx` riconoscono la modalità da soli (servizio se `onyx-api.service` è installato). `ONYX_MODE=dev` o `ONYX_MODE=service` la forzano.

## 2. Comandi

| Comando | Effetto |
|---|---|
| `onyx-start` / `onyx-stop` / `onyx-restart` | Avvia, ferma, riavvia |
| `onyx-status` | Stato, CLI Claude in uso e indirizzi della console |
| `onyx-logs` | Segue i log (`journalctl` in servizio, `.onyx-data/logs/onyx-dev.log` in sviluppo) |
| `onyx-update` | Aggiorna Onyx: arresto, `git pull`, dipendenze, **backup `pre-update`**, migrazioni, build, riavvio |
| `onyx-backup` | Scrive subito un backup del database |
| `onyx backups` | Elenca i backup, dal più recente |
| `onyx-restore [nome\|latest]` | Ripristina un backup (vedi §4); senza argomenti elenca i backup |
| `onyx-use-claude` / `onyx use-stub` | Passa alla CLI Claude Code vera (installandola se manca) o al simulatore |
| `onyx-update-claude` | Aggiorna Claude Code, ne verifica la compatibilità e riavvia Onyx (vedi §5) |
| `onyx install` | Rimette i comandi sul `PATH` (lo fa anche `onyx-update`) |

## 3. Dove stanno i dati

| Cosa | Sviluppo | Servizio |
|---|---|---|
| Database SQLite (WAL) | `.onyx-data/onyx.db` | `/var/lib/onyx/onyx.db` |
| Chiave dei segreti | `.onyx-data/secret.key` | `/var/lib/onyx/secret.key` |
| Backup | `.onyx-data/backups/` | `/var/backups/onyx/` |
| Progetti clonati | `.onyx-data/projects/` | `/srv/onyx/projects/` |
| Worktree dei piani | `.onyx-data/worktrees/` | `/var/lib/onyx/worktrees/` |
| File temporanei delle run | `.onyx-data/runtime/` | `/var/lib/onyx/runtime/` |
| Configurazione | `apps/api/.env` | `/etc/onyx/onyx.env` |

I token di Claude e GitHub salvati da Settings sono cifrati nel database con AES-256-GCM. La chiave sta in `secret.key` (permessi `0600`), oppure in `ONYX_SECRET_KEY` (32 byte in base64) se definita. Chi ha solo il database o un backup non può leggere i token.

## 4. Backup e ripristino

### Automatici

L'API scrive un backup ogni `ONYX_BACKUP_INTERVAL_HOURS` ore (default 24; `0` li disattiva) e tiene gli ultimi `ONYX_BACKUP_KEEP` (default 14). Il primo controllo avviene 5 minuti dopo l'avvio, poi uno ogni ora. Ogni backup:

- è una copia coerente anche mentre gli agenti lavorano (API di backup online di SQLite), convertita in un file unico senza `-wal`/`-shm`;
- passa `PRAGMA integrity_check` prima di essere tenuto;
- ha accanto un manifest `.json` con checksum SHA-256, migrazioni applicate, numero di progetti, task, run e altri record, e l'impronta della chiave dei segreti.

`onyx-update` e le release in modalità servizio scrivono anche un backup `pre-update` prima delle migrazioni. Ogni ripristino salva prima il database corrente come `pre-restore`.

### Manuali

- Da **Settings → Backups**: *Back up now*, *Verify* (integrità e checksum), *Download* (per tenerne una copia altrove), *Restore command* (copia il comando di ripristino).
- Da terminale: `onyx-backup`, `onyx backups`.

### Ripristino

```bash
onyx-restore                         # elenca i backup
onyx-restore onyx-20261003-030000.db # oppure: onyx-restore latest
```

Il comando verifica il backup (nulla cambia se è danneggiato), ferma Onyx, salva il database corrente come `…-pre-restore.db`, sostituisce il database, applica le migrazioni mancanti (un backup di una versione precedente viene portato allo schema attuale) e riavvia Onyx se era acceso. `latest` ignora le copie `pre-restore`. La CLI sottostante (`node dist/cli.js restore` in servizio, `tsx src/cli.ts restore` in sviluppo) si rifiuta di procedere se Onyx risponde ancora.

### Su un'altra macchina

1. Installa Onyx e copia il backup nella cartella dei backup.
2. Copia anche `secret.key` dalla vecchia installazione (o imposta lo stesso `ONYX_SECRET_KEY`). Senza la chiave il ripristino riesce lo stesso, ma i token salvati risultano mancanti: ricollega Claude e GitHub da Settings. La scheda Backups e la CLI avvisano quando la chiave non coincide (*other key*).
3. `onyx-restore <nome>`.

Il database non contiene i repository: i progetti si ripristinano dai loro remote Git, oppure con il backup `vzdump` del container (architecture.md §10.9).

### Prova periodica

Una volta al mese: `onyx-backup`, poi `onyx-restore latest` e un controllo della console. Il ripristino è coperto anche dal test automatico `apps/api/tests/integration/backup.test.ts`.

## 5. Aggiornare Claude Code

Onyx avvia Claude Code con `DISABLE_AUTOUPDATER=1`: la CLI si aggiorna solo quando lo decidi.

```bash
onyx-update-claude
```

1. Esegue `claude update`.
2. Controlla che la nuova versione accetti tutte le opzioni che Onyx passa. Le opzioni documentate si leggono da `--help`; quelle nascoste (`--max-turns`, `--append-system-prompt-file`) si provano con input `stream-json` e stdin vuoto, così un'opzione sconosciuta fallisce subito e una valida termina senza inviare richieste. Il controllo non consuma token.
3. Riavvia Onyx.

Se la versione non è compatibile, Settings mostra quali opzioni mancano e `/api/ready` segnala `claude-cli` come non pronto. Per tornare indietro: `claude install <versione precedente>`, poi *Check again* in Settings (o `onyx-cli check-claude`).

### Trascrizioni per i test di contratto

Dopo un aggiornamento si possono registrare trascrizioni reali della nuova versione, usate dai test del parser `stream-json`:

```bash
pnpm --filter @onyx/agent-runtime fixtures:record -- --yes
```

Lo script invia cinque prompt minimi con Haiku (risposta breve, uso di un tool, output strutturato, partial messages, limite di turni), ognuno con `--max-budget-usd 0.05`: costa pochi centesimi e senza `--yes` non parte. Rimuove percorsi locali, ID di sessione e campi dell'account, poi scrive in `packages/agent-runtime/fixtures/recorded/<versione>/`. I test `recorded-fixtures.test.ts` le verificano automaticamente.

## 6. Aggiornare Onyx

`onyx-update` ferma Onyx, prende il codice nuovo, installa le dipendenze, fa un backup `pre-update`, applica le migrazioni e lo riavvia se era acceso. Backup e migrazioni passano da `onyx-cli migrate`: se il backup non riesce le migrazioni non partono; se una migrazione fallisce a metà il database torna com'era prima dell'aggiornamento (la copia mezza migrata resta come `…-pre-restore.db`), così il tentativo successivo non si blocca con *P3009*. Le migrazioni girano sempre a Onyx spento: con l'API accesa SQLite può rifiutarle con *database is locked*. Se un passo fallisce, Onyx resta fermo e il messaggio dice cosa rifare. In modalità servizio costruisce una release in `/opt/onyx/releases/` e sposta il collegamento `/opt/onyx/current`; se le migrazioni falliscono riavvia la release precedente. Per tornare alla release precedente basta riportare il collegamento e riavviare (con `onyx-restore` del backup `pre-update` se le migrazioni nuove vanno annullate).

## 7. Sicurezza

### Checklist del §12 (verificata nella Fase 7)

| Minaccia | Mitigazione | Verifica |
|---|---|---|
| Accesso non autorizzato | Login argon2id, cookie `httpOnly` + `SameSite=Strict`, sessioni con scadenza, rate limit (5/min sulla configurazione iniziale, 10/min sul login) | `auth.test.ts`, `security.test.ts` (l'undicesimo tentativo riceve 429) |
| Richieste cross-site e DNS rebinding | Controllo dell'origine su scritture e WebSocket | `auth.test.ts` |
| Agente che legge segreti | `deny` su `.env*`, chiavi e certificati; `deny` e hook di guardia sui file di Onyx (chiave, database, backup, runtime delle run, log, `/etc/onyx`); ambiente dei processi figli da allowlist | `security.test.ts`, `agent-isolation.test.ts` |
| Agente che fa eseguire codice a Onyx | Gli agenti non possono scrivere in `.git/`; ogni `git` lanciato da Onyx ignora hook e `core.fsmonitor` e non riceve i segreti nell'ambiente | `agent-isolation.test.ts` |
| Segreti a riposo | Token cifrati AES-256-GCM, chiave `0600`, dato associato al nome dell'impostazione | `security.test.ts` |
| Comandi distruttivi | `acceptEdits`, Bash solo da allowlist, `deny` su `rm -rf`, `git push`, `sudo` | `permission-rules`, test del Context Surgeon |
| Prompt injection | Recinto di scrittura, approvazioni per piani, merge e budget, audit | test di orchestrator e TDD |
| Endpoint interni | Solo loopback, token di run con revoca e scadenza a 12 ore | `context.test.ts`, `security.test.ts` |
| Escalation nel container | Utente `onyx` senza sudo, `NoNewPrivileges`, `RestrictSUIDSGID`, `LockPersonality`, `UMask=0027`. **Limite noto:** gli agenti girano con lo stesso utente dell'API; un agente che esegue codice (per esempio con un test) può leggere i file di Onyx. Il guard riduce gli incidenti ma non è un confine di sicurezza: la sandbox è nella roadmap 2.0 (milestone 3) | unit systemd |
| Esfiltrazione | Firewall in ingresso (`nftables.conf`) | — |
| Perdita di dati | WAL, backup giornalieri verificati, backup prima di aggiornamenti e ripristini | `backup.test.ts` |
| Header HTTP | API: `no-store`, `nosniff`, `Referrer-Policy`; web: `X-Frame-Options`, CSP `frame-ancestors`/`object-src`/`base-uri`/`form-action`, `Permissions-Policy` | `security.test.ts` |

### Dipendenze

`pnpm audit --prod` riporta due avvisi residui, non sfruttabili qui: `deepmerge-ts` (nella CLI di Prisma, usata solo per le migrazioni) e `braces` (in `repomix`, riceve solo pattern generati da Onyx; non esiste una versione corretta). `postcss` e `mysql2` sono forzati a versioni corrette con `overrides` in `pnpm-workspace.yaml`.

### HTTPS

In LAN Onyx usa HTTP: Lighthouse segnala per questo *best practices* a 78. Per HTTPS si attiva la CA interna di Caddy (architecture.md §10.7) e `COOKIE_SECURE=true`.

## 8. Risoluzione dei problemi

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Settings dice *simulator* | `CLAUDE_BIN` punta allo stub | `onyx-use-claude` |
| *Claude Code … is not compatible* | Versione di Claude Code senza opzioni che Onyx usa | `onyx-update` (Onyx più recente) o `claude install <versione>` |
| *Sign in with Claude* non procede | Link scaduto o codice errato | *Get a new sign-in link*; incolla il codice intero |
| Token spariti dopo un ripristino | Backup sigillato con un'altra chiave | Rimetti il vecchio `secret.key` o ricollega gli account |
| Run in coda che non partono | Budget soft superato | Approva il periodo in **Approvals** |
| Run rifiutate con *hard budget* | Limite hard raggiunto | Alza il limite o mettilo in pausa in **Settings → Budgets** |
| Piano fermo su *Waiting for a merge decision* | Conflitto di merge | **Approvals**: *Retry the merge* dopo averlo risolto sul branch del task, oppure *Drop this task* |
| Piano *Stopped* dopo un riavvio | Onyx riavviato durante l'esecuzione | *Resume* nella pagina del piano |
| `/api/ready` non pronto per `disk` | Meno del 10% di spazio libero | Libera spazio (backup vecchi, worktree di piani annullati in `worktrees/`) |
| Run fallita con *error_during_execution*, 0 turni, $0.00 | Claude Code non ha più la sessione che Onyx riprende (creata col simulatore, con un'altra HOME o svuotata con `/clear` nel terminale): *No conversation found with session ID* | Nessuna azione: Onyx chiude la sessione persa e rimette in coda la run in una sessione nuova, con la nota di passaggio |
| Run *Completed* ma con *N blocked · permission rule*, e l'agente chiede il permesso | Durante una run nessuno può approvare comandi: Claude Code rifiuta quelli fuori dalla lista dell'agente (per esempio `python3`, `npx`, `npm install`) | Nella run, **Allow and continue**: scegli i comandi da consentire nel progetto, rispondi all'agente se ha chiesto qualcosa, e il task riprende nella stessa sessione. L'elenco si modifica nella pagina del progetto, *Commands agents may run* |
| `onyx-update` dice *The migration failed: the database is back as it was before the update* | Una migrazione nuova non si applica al tuo database | Il database è intatto e Onyx resta sulla versione precedente (in servizio) o fermo (in sviluppo): manda l'errore sopra il messaggio; la copia mezza migrata è in `onyx backups` come `pre-restore` |
| `onyx-update` si ferma prima delle migrazioni con un errore del backup | Cartella dei backup non scrivibile o disco pieno | Libera spazio o sistema i permessi di `ONYX_BACKUP_DIR`, poi rilancia: nulla è stato migrato |
| `onyx-update` si ferma su *database is locked* | Versione di `onyx-update` precedente al 4 ottobre 2026, che migrava con Onyx acceso | `onyx-stop`, poi `onyx-update`, poi `onyx-start`: il database non è stato toccato e il backup `pre-update` c'è |
| Console *Offline* | API ferma o WebSocket bloccato dal proxy | `onyx-status`, `onyx-logs`; con Caddy controlla la rotta `/ws` |
| **Savings**: *Only N of M runs got a context pack* | Progetto non indicizzato o task senza file target | Imposta i *target paths* del task o nomina i file nel prompt; controlla l'indice nella pagina del progetto |
| **Savings**: *The agent re-reads files it already has* | L'agente rilegge i file del pacchetto (sempre, prima di modificarli) | Guarda *Most read again*; abbassa `ONYX_CONTEXT_BUDGET_TOKENS` o restringi i target |
| **Savings → Prompt cache on resumed runs**: *System prompt changed* | Tra due run della stessa sessione sono cambiati il primer del workspace, le istruzioni dell'agente o i sotto-agenti (per esempio un TDD loop usa l'agente `test-fixer`) | Normale se il cambio è voluto; altrimenti evita di modificare il primer mentre un workspace lavora |
| **Savings → Prompt cache on resumed runs**: *Cache expired during the pause* | La sessione è stata ripresa dopo la durata della cache (5 minuti di default per Claude) | Manda i follow-up prima; se il tuo account ha una cache più lunga, alza `ONYX_PROMPT_CACHE_TTL_MINUTES` perché Onyx la classifichi bene |
| **Savings → Prompt cache on resumed runs**: *Unexplained* | Claude Code ha riscritto la conversazione per un motivo che Onyx non vede (per esempio il suo prompt di sistema è cambiato) | Nessuna azione: se succede spesso, registra una trascrizione reale (§5) e segnalalo |
| Nodo di un piano *Green … ignored N failures that already failed before this work* | Il progetto aveva già test o errori di tipo prima del piano | Nessuna azione: sono elencati nel messaggio; correggili con un task a parte se vuoi la suite verde |
| **Savings**: *Not paying off* | Con il pacchetto le run consumano più token di quelle senza | Controlla riletture e budget del pacchetto; con `ONYX_CONTEXT_ENABLED=false` le run girano senza contesto |

## 9. Accessibilità e prestazioni

Ogni pagina principale (login, console, progetti, progetto, piano, roadmap, task, approvazioni, impostazioni, telemetria, router, savings) è misurata con Lighthouse 13 e axe-core 4 sulla build di produzione:

| | Desktop | Mobile (Moto G Power simulato) |
|---|---|---|
| Performance | 100 su tutte | 91–99 |
| Accessibilità | 100 su tutte | 100 su tutte |
| axe (WCAG 2.1 AA) | 0 violazioni | 0 violazioni |

Navigazione da tastiera: link *Skip to content*, focus visibile su ogni elemento, palette dei comandi con **Ctrl+K** (⌘K su Mac) per pagine, progetti, task recenti e azioni. Con `prefers-reduced-motion` le firme di movimento restano ferme nello stato finale.

## 10. Il risparmio di token funziona?

La pagina **Savings** risponde in cima con un verdetto. Ogni cifra porta l'etichetta *Measured* (token reali riportati da Claude) o *Estimate* (calcolo di Onyx).

| Verdetto | Significato |
|---|---|
| *Saving confirmed* | Misurato: con il contesto le run usano meno token di input, con differenza statisticamente significativa |
| *Not paying off* | Misurato: con il contesto le run usano più token |
| *No clear difference* | Misurato, ma la differenza può ancora essere caso: lascia girare l'esperimento |
| *Measuring* | Esperimento attivo, servono almeno 10 run finite per gruppo |
| *Estimate only* | Esperimento spento: c'è solo la stima |
| *No data yet* | Nessuna run con un pacchetto di contesto |

**La stima.** Per ogni run Onyx calcola quanti token servirebbero per leggere per intero i file target e le loro dipendenze dirette (la *baseline*) e quanti ne ha consegnati: pacchetto, mappa del progetto ed espansioni MCP. A fine run sottrae i file della baseline che l'agente ha riletto con `Read`: Claude Code legge sempre un file prima di modificarlo, quindi i target modificati vengono riletti. Il risultato è la *net estimate*. La stima presuppone che senza Onyx l'agente leggerebbe quei file una volta, per intero: per questo resta una stima.

**La misura.** Con *Run the experiment* attivo, una quota delle run che aprono una sessione nuova (10–50%, default 25%) parte senza contesto Onyx: niente pacchetto, mappa o tool MCP. Le run che riprendono una sessione non partecipano. Onyx confronta i due gruppi sui token di input per run (mediana) e con il test di Mann–Whitney; sotto p = 0,05 la differenza conta. La tabella mostra anche costo, turni, file letti ed esito, così un risparmio ottenuto con più fallimenti salta all'occhio.

Le run di controllo costano quanto costerebbero senza Onyx, quindi l'esperimento consuma qualcosa in più finché è attivo. Conviene accenderlo per qualche decina di run e spegnerlo quando il verdetto è chiaro: i risultati restano visibili per 90 giorni.

**Registro dei risparmi.** Una riga per fonte, sempre con l'etichetta *Measured* o *Estimate*:

| Fonte | Come si calcola | Tipo |
|---|---|---|
| Contesto Onyx (pacchetto, mappa, MCP) | Stima netta come sopra; diventa misura con l'esperimento A/B | Stima o misura |
| Mappa tenuta per la sessione | Riprese in cui la mappa nuova sarebbe stata diversa: i token letti dalla cache (misurati) per la differenza tra riscriverli (1,25×) e rileggerli (0,1×) | Stima su dati misurati |
| Pacchetto non rimandato | Token delle voci del pacchetto già presenti nella conversazione e quindi solo elencate | Stima |
| Cache dei prompt | Token letti dalla cache riportati da Claude | Misura |
| Routing dei modelli | Costo contro lo stesso uso sul modello di riferimento | Stima |
| Comandi consentiti per lo stack | Token delle run di continuazione dopo un comando rifiutato negli ultimi 30 giorni, contro i 30 precedenti: il calo conta come risparmio | Stima su dati misurati |
| Task trattenuti vicino al limite | Run che hanno aspettato il reset della finestra e run che hanno ricevuto il limite mentre lavoravano. Nessun token: sposta la spesa, non la riduce | Misura |

I token sono *input-equivalenti* sugli ultimi 30 giorni e le righe non si sommano perché i metodi sono diversi.

**Cache dei prompt nelle riprese.** Ogni run registra quanti token del primo turno Claude ha letto dalla cache e quanti ha scritto. In una run che riprende una sessione, una scrittura grande vuol dire che la cache è andata persa: Onyx dice se è cambiato il prompt di sistema, il modello, se la pausa ha superato la durata della cache (`ONYX_PROMPT_CACHE_TTL_MINUTES`, default 5) o se non lo sa. La console della run lo scrive a fine run.

**Is it working?** elenca i controlli: contesto attivo, quota di run che ricevono un pacchetto, peso delle riletture, stima netta positiva, stato dell'esperimento. Cache dei prompt (misurata) e routing dei modelli (stimato) sono in fondo alla pagina, separati, perché non dipendono dal pacchetto.

Nella console di una run il risparmio diventa netto a fine run (*Net saving*) e una riga indica i file riletti; le run di controllo sono marcate *control*.

## 11. Limiti dell'abbonamento Claude

Con un account Claude Max, Claude Code riporta durante le run lo stato delle finestre dell'abbonamento (`rate_limit_event`): quale finestra (5 ore, settimanale, settimanale Opus o Sonnet), quanto è usata e quando si azzera. Onyx tiene l'ultimo valore di ciascuna, anche dopo un riavvio, e lo mostra in **Telemetry → Claude subscription limits**.

| Stato | Quando | Cosa fa Onyx |
|---|---|---|
| *Not reported* | Nessuna run ha ancora riportato i limiti | Niente |
| *Within limits* | Sotto la soglia di avviso | Niente |
| *Close to the limit* | Sopra la soglia di avviso (default 80%) | Indicatore nella barra laterale; le run partono |
| *Holding tasks that can wait* | Sopra la soglia di attesa (default 90%), o avviso di Claude senza percentuale | I task *Can wait* restano in coda fino al reset; gli altri partono |
| *Limit reached* | Claude ha rifiutato per il limite | Tutta la coda aspetta il reset |

- **Can wait** si sceglie nella finestra *New task* o nella pagina del task, anche mentre è in coda: togliendolo il task parte subito.
- Al reset Onyx rilancia la coda da solo. Un limite riportato senza ora di reset scade dopo 30 minuti; **Resume now** dimentica subito i limiti noti (utile se il reset è già avvenuto o hai cambiato account). Se il limite c'è ancora, la run successiva lo riporta e la coda torna ad aspettare.
- Soglie e attesa si cambiano nella stessa card; *Hold tasks marked "can wait"* spento lascia solo gli avvisi.
- In Savings la riga *Tasks held near the Claude limit* conta le run che hanno aspettato e quelle fermate dal limite negli ultimi 30 giorni.

| Problema | Causa probabile | Cosa fare |
|---|---|---|
| Un task resta *Queued* e la pagina dice *Waiting for the Claude subscription limit* | La finestra è sopra la soglia di attesa e il task è *Can wait* | Aspetta il reset indicato, togli *Can wait* o usa *Resume now* |
| Tutta la coda è ferma con *Limit reached* | Claude ha rifiutato una run per il limite | Aspetta il reset; con un altro account usa *Resume now* |
| La card resta *Not reported* | La versione di Claude Code non manda l'evento, o non c'è ancora stata una run | Niente da fare: senza dati Onyx non trattiene nulla |

## 12. Isolare gli agenti

Di default gli agenti girano con l'utente di Onyx: il guard tiene fuori dal contesto i file esclusi, ma non è un confine di sicurezza. Con un utente separato il confine lo mette il sistema operativo.

**Attivazione** (come root, una volta):

```bash
sudo /opt/onyx/current/deploy/scripts/agent-sandbox.sh --enable
```

Lo script crea il gruppo `onyx-work` e l'utente `onyx-agent`, aggiunge `onyx` al gruppo, scrive `/etc/sudoers.d/onyx-agent` (solo `onyx → onyx-agent`), un drop-in systemd che toglie `NoNewPrivileges` all'API (sudo ne ha bisogno), condivide con il gruppo progetti e worktree (`.git` resta in sola lettura), rende leggibili all'agente i file MCP del rilascio e il binario di Claude Code, imposta `ONYX_AGENT_USER` e riavvia l'API. Senza `--enable` prepara tutto ma non cambia `onyx.env`.

**Verifica**: `curl -s http://127.0.0.1:4000/api/ready` deve riportare il controllo `agent-sandbox` con `"ok": true` e *agents run as onyx-agent*. Una run deve completarsi; nel terminale di un workspace `id` deve mostrare `onyx-agent`.

**Cosa cambia**:

- l'agente non legge `secret.key`, il database, i backup, `/etc/onyx` e l'ambiente dell'API; continua a leggere e scrivere i progetti;
- il token di Claude passa comunque all'agente, che ne ha bisogno: resta leggibile nel suo ambiente;
- i file che Onyx scrive nei progetti (checkout, merge, ripristini del TDD) restano modificabili dal gruppo;
- i progetti di altri proprietari vanno condivisi: lo script lo fa per quelli in `/srv/onyx/projects`.

| Problema | Causa probabile | Cosa fare |
|---|---|---|
| `agent-sandbox` con `ok: false`: *sudo to onyx-agent failed* | Regola sudoers assente o `NoNewPrivileges` ancora attivo | Rilancia lo script; `systemctl cat onyx-api` deve mostrare il drop-in `agent-sandbox.conf` |
| `agent-sandbox` con `ok: false`: *cannot share … with onyx-work* | `onyx` non è nel gruppo (serve un riavvio del servizio) o la cartella è di un altro utente | `systemctl restart onyx-api`; `chown onyx` sulla cartella |
| Le run falliscono con *Permission denied* sul binario di Claude | Claude Code installato in una cartella non attraversabile | Rilancia lo script dopo ogni aggiornamento di Claude Code che cambia cartella |
| Un progetto registrato a mano dà errori di scrittura | I file non sono del gruppo `onyx-work` | Rilancia lo script, oppure `chgrp -R onyx-work <cartella>` e `chmod -R g+rwX` (non su `.git`) |
| Il feed mostra *Undone* dopo una run | La run ha cambiato file di un altro workspace | È voluto: il compito va affidato al workspace giusto, oppure i percorsi del workspace vanno allargati |


## 13. Coda e limite per progetto

Tutte le run in attesa, di qualunque progetto, stanno in un'unica coda. La home (**Mission control → Run queue**) la mostra con il motivo dell'attesa di ogni riga:

| Motivo | Significato |
|---|---|
| *waiting for a free slot* | Tutti gli slot (`MAX_CONCURRENT_AGENTS`) sono occupati da run o terminali |
| *project at its run limit* | Il progetto ha già il numero massimo di run consentito |
| *workspace busy* | Nello stesso workspace (o worktree) c'è già una run o un terminale |
| *held by the quota or a budget* | Limiti di Claude vicini e task *Can wait*, oppure un budget raggiunto |

- **Ordine**: priorità del task, poi anzianità. Chi aspetta sale di un livello ogni 30 minuti (**Settings → Run queue → Raise waiting tasks**, *Off* per disattivare). Le frecce spostano un task in cima, su o giù e salvano la nuova priorità sul task. I passi del TDD e dei piani hanno priorità alta di loro.
- **Limite per progetto**: spento di default. Con *At most 1* un progetto con dieci task in coda ne fa girare uno alla volta e lascia gli altri slot agli altri progetti. Si può dare un limite diverso a un singolo progetto nella stessa scheda. Il limite è rigido: uno slot libero non viene prestato a un progetto già al limite.
- Le schede di Mission control leggono branch e modifiche con `git status` una volta ogni 30 secondi per progetto (subito dopo una run o una pubblicazione). Un progetto *Git unavailable* ha un `.git` illeggibile: `git -C <cartella> status` dalla shell dice perché.

## 14. Notifiche

Sono tutte spente finché non si accendono in **Settings → Notifications**. Onyx invia e basta: non apre porte e non legge messaggi da ntfy o Telegram, quindi non si comanda dall'esterno.

**Eventi**: run fallita (anche per timeout o interruzione), run che aspetta comandi da consentire, approvazione richiesta, budget raggiunto o run fermate da un budget, limiti di Claude che peggiorano o si azzerano, controlli di una pull request falliti o tornati verdi; facoltativo ogni run finita. Lo stesso evento parte al massimo una volta al minuto.

**Link**: le notifiche aprono la pagina giusta se `ONYX_PUBLIC_ORIGIN` è impostata in `/etc/onyx/onyx.env` (per esempio `https://onyx.lan`), altrimenti usano la prima di `ONYX_ALLOWED_ORIGINS` o arrivano senza link.

**Nel browser (Web Push)**: i browser lo consentono solo in HTTPS. Su `http://<ip>` la scheda lo dice e il pulsante non compare.

1. Nel Caddyfile si aggiunge un blocco con il nome host e `tls internal` (architecture.md §10.7), si imposta `COOKIE_SECURE=true` e `ONYX_PUBLIC_ORIGIN=https://onyx.lan`, e si riavviano Caddy e l'API.
2. Si installa sul dispositivo la CA locale di Caddy (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`): su Android come certificato CA, su iOS come profilo con l'attendibilità completa attivata; su iOS le notifiche web funzionano solo con Onyx aggiunto alla schermata Home.
3. Da quel dispositivo, **Turn on for this device** e poi **Send a test**.

Le chiavi VAPID si creano al primo uso; la chiave privata e le sottoscrizioni sono cifrate con la chiave dei segreti. Un dispositivo che il servizio push dichiara scaduto viene tolto da solo.

**ntfy**: server (anche uno proprio in LAN) e topic; il token d'accesso è facoltativo e viene cifrato. Su `ntfy.sh` chiunque conosca il topic può leggerlo: va scelto lungo e casuale.

**Telegram**: si crea un bot con @BotFather, si scrive al bot almeno una volta e si ricava il chat id (per esempio da `https://api.telegram.org/bot<token>/getUpdates` nel browser). Token cifrato; il bot non riceve comandi.

| Problema | Causa probabile | Cosa fare |
|---|---|---|
| *Send a test* dice *ntfy answered 401/403* | Topic protetto | Inserisci il token d'accesso |
| *Telegram answered 400* | Chat id sbagliato o nessun messaggio mandato al bot | Scrivi al bot e ricontrolla il chat id |
| *No browser accepted the notification* | Sottoscrizione scaduta o permesso revocato | Riattiva su quel dispositivo |
| Nessuna notifica dalle run | L'evento è spento o nessun canale è attivo | Controlla le caselle *Tell me when* |

## 15. Griglia degli agenti e ricerca

**Agent grid** (`/agents`) mostra fino a nove pannelli, ciascuno con una run dal vivo o il terminale di un workspace di qualunque progetto; la disposizione resta nel browser. Ogni terminale aperto occupa uno slot come una run. I pannelli fuori vista (o con la scheda del browser nascosta) si staccano e, quando tornano visibili, riprendono dallo stato attuale dello schermo. *Paste* incolla nel terminale il task scelto: si controlla e si invia con Invio.

Se un terminale ripreso si chiude subito (Claude Code non aveva salvato la sessione, per esempio dopo un `/clear` senza messaggi), Onyx chiude quella sessione e il terminale successivo ne apre una nuova.

**Ricerca**: la palette (Ctrl K o **Search** nella barra laterale) cerca da due caratteri in titoli, prompt e riassunti dei task, negli errori delle run e nei percorsi dei file di tutti i progetti; gli accenti non contano. L'indice (tabella `SearchEntry`) contiene solo testi brevi e si aggiorna da solo; l'API lo crea al primo avvio della versione 2.0 · 4 e lo ricostruisce solo dopo un aggiornamento che ne cambia il formato.

## 16. Memoria di progetto

Ogni progetto ha una memoria di fatti raccolti dalle sue run: **Memory** nella pagina del progetto.

| Fatto | Quando entra | Esempio |
|---|---|---|
| Comando | Un comando di test, build, lint, type check o simile è riuscito in una run | `pnpm --filter web test` works (3 runs) |
| File chiave | Lo stesso file è stato letto in almeno tre run | `apps/api/src/server.ts` is read often (4 runs) |
| Test | Un TDD loop è finito in verde | Tests pass with `pnpm vitest run` |
| Insidia | Lo stesso comando è fallito con lo stesso errore in almeno due run | `pnpm build` has failed with: "Cannot find module …" |
| Nota | La scrivi tu | Prices are stored in cents |

- Le insidie restano in **To confirm** finché non le confermi: il loro testo viene dall'output dei comandi, che un file del progetto può influenzare.
- **Forget** toglie un fatto e impedisce che torni; **Restore** in *Forgotten* lo riporta. La matita cambia il testo che vedono gli agenti; la puntina lo tiene sempre in cima e non lo fa scadere.
- La memoria entra nel prompt di sistema delle sessioni **nuove** (run e terminali) fino al limite di token. Una sessione ripresa tiene quella con cui è partita: per far vedere una modifica agli agenti serve una sessione nuova (*Reset* del workspace o *Fresh context*).
- **Settings → Project memory**: interruttore, limite (400–2000 token), scadenza dei fatti (14–90 giorni) ed esperimento. Con l'esperimento metà delle sessioni nuove parte senza memoria; **Savings → Project memory experiment** confronta i due gruppi dopo 10 run ciascuno. Se il risultato è *costs more* o *no difference*, conviene spegnere la memoria.

| Problema | Causa probabile | Cosa fare |
|---|---|---|
| La pagina dice *Nothing yet* | Nessuna run conclusa dopo l'aggiornamento | Fai girare qualche task; i comandi compaiono dopo la prima run |
| Un fatto sbagliato continua a comparire | È ancora attivo | **Forget**: non verrà più raccolto |
| Gli agenti non vedono una nota appena aggiunta | La sessione era già partita | Apri una sessione nuova |

## 17. Esperimenti e opzioni di risparmio

**Savings → Context experiment** confronta il pacchetto di contesto con il controllo (nessun contesto Onyx) e, se scegli una **variante**, anche la variante con il pacchetto. Le run nuove si dividono così: la quota di controllo che imposti, il resto metà al pacchetto e metà alla variante. Ogni confronto ha il suo test di Mann–Whitney e il suo verdetto dopo 10 run per gruppo.

| Variante | Cosa cambia | Cosa guardare |
|---|---|---|
| *Files to edit as signatures* | I file indicati nel campo *Files* del task arrivano come firme (L2); quelli dedotti e gli altri restano come prima | Token di input per run e file letti: se l'agente legge di più, il guadagno sparisce |

**Settings → Token saving options** raccoglie tre opzioni. Valgono per le sessioni nuove: le riprese tengono il prompt con cui sono partite, così la cache non si rompe.

| Opzione | Default | Cosa fa | Riga di Savings | Quando diventa misurata |
|---|---|---|---|---|
| Short final summaries | Acceso | Chiede un riassunto finale di al massimo sei righe. Le run di controllo dell'esperimento ne fanno a meno | *Short final summaries* | 10 run completate prima e 10 dopo l'accensione (confronto prima/dopo, non A/B) |
| Explore on a cheaper model | Acceso | Planner e roadmap ricevono un sotto-agente `explorer` su Haiku per le ricerche; la roadmap gira sul modello Builder | *Plan exploration on a cheaper model* | 3 piani con e 3 senza esploratore (costo del modello del planner per piano) |
| Group small queued tasks | Spento | Quando parte un task breve (prompt fino a 600 caratteri, al massimo due file, niente architettura o refactor, niente worktree), fino a tre altri task brevi dello stesso workspace in coda si uniscono alla run | *Small tasks grouped in one run* | 5 run raggruppate e 5 singole (token per task completato) |

Nel gruppo ogni task chiude con una riga `TASK n: DONE` o `TASK n: FAILED — motivo`. I task *DONE* si completano, quelli *FAILED* falliscono con il motivo, quelli senza riga tornano in coda e girano da soli. Il gruppo condivide sessione, prefisso e pacchetto: se un task modifica file che un altro tocca, conviene tenere l'opzione spenta per quel workspace o lanciarli a mano.

| Problema | Causa probabile | Cosa fare |
|---|---|---|
| La riga dell'esploratore resta *now 0 and …* | Il nome dello strumento dei sotto-agenti non è quello atteso (`Task` o `Agent`) | Controlla nella run del planner se compare l'`explorer`; se no, spegni l'opzione e segnalalo |
| Un task raggruppato torna in coda | L'agente non ha scritto la sua riga `TASK n:` | Nessuna azione: gira da solo alla prossima occasione |
| I riassunti restano lunghi | La sessione era già partita prima dell'accensione | Apri una sessione nuova |

## 18. GitHub: issue, pull request e changelog

La pagina **GitHub** di un progetto funziona quando `origin` (o il remote registrato all'import) punta a `github.com`. Il token si collega in **Settings → GitHub**; per un repository pubblico l'elenco delle issue funziona anche senza.

| Permesso del token fine-grained | Serve per |
|---|---|
| Contents: read and write | clonare e pubblicare i branch |
| Pull requests: read and write | aprire e seguire le pull request |
| Issues: read | importare le issue |
| Checks: read, Commit statuses: read | leggere i controlli della PR |

**Issue come task.** I task importati partono in bozza: nessun agente parte da solo. Il prompt contiene il testo dell'issue tra `<issue>` e `</issue>` (commenti HTML e marcatori finti tolti, al massimo 8.000 caratteri) e chiede all'agente di non seguire istruzioni che vi compaiano. Le stesse regole valgono per tutti i task: sandbox, guard e comandi consentiti (§12) restano attivi. Un'issue già importata non si importa due volte.

**Pull request.** Il branch deve esistere nel progetto: lo crea *Publish* nella card git o la fine di un piano. *Push and open* lo pubblica di nuovo (se è già aggiornato non cambia nulla) e apre la PR verso il branch di default; se una PR aperta esiste già, Onyx la riprende. La descrizione si può modificare prima dell'invio e non passa da un modello.

**Controlli.** Onyx legge check run e commit status della testa della PR: ogni minuto finché qualcosa gira o cambia, poi raddoppiando l'intervallo fino a 15 minuti; dopo un errore (rete, limite di GitHub) aspetta almeno 5 minuti, fino a 30. Le richieste usano gli ETag, quindi quelle senza novità non consumano il limite orario. Smette quando la PR viene unita o chiusa. *Check now* rilegge subito.

**Changelog.** Parte dall'ultimo rilascio salvato da Onyx, altrimenti dall'ultimo tag, altrimenti dall'inizio. *Save* scrive in `CHANGELOG.md` nella cartella del progetto (sul branch attuale) e registra il rilascio; il file va poi pubblicato come le altre modifiche. Non crea tag e non fa commit.

| Problema | Causa probabile | Cosa fare |
|---|---|---|
| *The project has no GitHub remote* | `origin` non punta a GitHub | `git remote set-url origin https://github.com/<owner>/<repo>.git` nella cartella del progetto |
| *The GitHub token cannot do this* | Mancano i permessi Pull requests | Rigenera il token con i permessi della tabella e ricollegalo |
| I controlli restano *No checks* | Il repository non ha CI, o il token non legge Checks | Aggiungi Checks e Commit statuses in lettura al token |
| Il changelog ripete voci già rilasciate | Il rilascio precedente non è un antenato del branch attuale | Torna sul branch giusto o indica il punto di partenza con `?from=<tag>` nell'API |

## 19. QA e conflitti nei piani

Le due opzioni si scelgono quando si crea il piano e valgono per tutto il piano.

**QA prima del merge.** Per ogni task, dopo l'agente e (se attiva) la verifica con i test, Onyx fa il commit nel worktree del task e avvia un revisore:

1. Il revisore riceve titolo, descrizione, criteri di accettazione numerati e il diff rispetto al branch del piano, fino a circa 12.000 token: i file oltre il limite compaiono solo per nome e il revisore li può leggere. Non può modificare file né eseguire comandi.
2. Risponde con un JSON: verdetto, riepilogo, per ogni criterio *soddisfatto sì/no* con la prova, e i problemi trovati. Onyx considera non soddisfatto un criterio senza una prova che citi un file del diff, e promuove il task solo se tutti i criteri sono soddisfatti.
3. Se il verdetto è negativo, l'agente del task riprende la sua sessione con l'elenco dei problemi, poi test e commit di nuovo, poi una seconda revisione.
4. Se anche la seconda è negativa, o il revisore non riesce a rispondere, il task resta in *QA found problems* e Approvals chiede: **Merge anyway** o **Drop this task**.

**Conflitti.** Con l'opzione accesa, al primo conflitto Onyx:

1. Crea un worktree temporaneo sul branch del piano e ripete il merge, lasciando i marcatori di conflitto.
2. Chiede a Claude di risolvere solo i file in conflitto, senza eseguire comandi.
3. Controlla che non restino marcatori, fa il commit e, se il piano verifica con i test, esegue test e type check confrontandoli con quelli del branch del piano: contano solo i fallimenti nuovi.
4. Mette la proposta in Approvals con il diff combinato (anche nella pagina del piano). Se restano marcatori o i test falliscono, la proposta è *not usable* e Approvals offre direttamente la scelta manuale.

Applicata la proposta, il task risulta unito come gli altri. Se nel frattempo il branch del piano è andato avanti e la proposta non si applica più, Onyx torna alla scelta manuale.

| Problema | Causa probabile | Cosa fare |
|---|---|---|
| Il revisore boccia criteri che sono stati fatti | Il criterio non è verificabile dal diff (per esempio "è veloce") | Scrivi criteri controllabili nel codice; *Merge anyway* in Approvals |
| *QA did not finish* | Claude non ha restituito il JSON (limite, errore) | Leggi il messaggio nel task; riprova riprendendo il piano o unisci a mano |
| La proposta di risoluzione è *not usable* | Marcatori rimasti o test nuovi rossi | Risolvi nel worktree indicato e scegli *Retry the merge* |
