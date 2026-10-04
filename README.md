# Onyx

Pannello di controllo orchestratore per **Claude Code**: accoda task, avvia agenti headless come processi figli, ne mostra l'output in tempo reale e traccia token e costi. Gira in un container LXC Debian 13 su Proxmox VE.

L'architettura completa (topologia, schema dati, rete, roadmap) è in [`architecture.md`](./architecture.md).

## Stato

| Fase | Contenuto | Stato |
|---|---|---|
| 0 | Infrastruttura LXC e rete | Documentata in `architecture.md` §10–11, script in `deploy/` |
| 1 | Monorepo, database, Agent Runtime, API, console web | **Completata** |
| 2 | Lean-ctx (scheletri AST con tree-sitter), Graphify (grafo delle importazioni), server MCP `onyx`, vista Grafo (Graph) | **Completata** (manca solo la prova con un modello reale, vedi `architecture.md` §16) |
| 3 | Context Surgeon: profili di contesto, regole di permesso compilate, hook di guardia, calibrazione dei token | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 4 | Model Router, compartimenti di sessione con handoff, recinti di scrittura, terminali interattivi con `/clear` e `/compact` | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 5 | TDD Auto-Loop: test Vitest/Jest in PTY, digest dei fallimenti, anti-cheat, gate, escalation su stallo | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 6 | Orchestrator multi-agente: planner, approvazione del piano, DAG, git worktree in parallelo, merge assistito, sub-agenti nativi, budget, centro approvazioni | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 7 | Hardening: token cifrati, backup e ripristino testati, aggiornamento e verifica di Claude Code, firme di movimento, accessibilità, palette dei comandi, Lighthouse ≥ 90 | **Completata** (manca solo la registrazione delle trascrizioni reali, vedi `architecture.md` §16) |
| 2.0 · 0 | Audit (`docs/audit-2.0.md`), correzione dei bug critici, piano della 2.0 (`docs/roadmap-2.0.md`) | **Completata** |
| 2.0 · 1 | Sprechi di token: mappa tenuta per la sessione, pacchetto non rimandato, telemetria della cache, registro dei risparmi, verifica dei piani sui test già rossi, falsi positivi del guard | **Completata** (manca la misura con Claude reale, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 2 | Limiti di Claude Max (avvisi, task che possono aspettare trattenuti fino al reset), comandi consentiti e workspace proposti dal progetto | **Completata** (manca la conferma del formato dei limiti con Claude reale, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 3 | Agenti in un utente di sistema separato, guard e recinto più precisi con verifica a fine run, *Consenti e continua* (*Allow and continue*) con regole strette, per task o per agente e con scadenza | **Completata** (manca la prova dello script di sandbox sulla macchina vera, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 4 | Mission control con una scheda per progetto, coda globale con priorità e limite per progetto, griglia degli agenti, notifiche (browser, ntfy, Telegram), ricerca globale, prestazioni con molti progetti | **Completata** (manca la prova delle notifiche push via HTTPS su un telefono vero, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 5 | Memoria di progetto: fatti stabili raccolti dalle run, curati da una pagina, sotto un limite di token, nel prompt delle sessioni nuove e misurabili con un A/B | **Completata** (manca la misura con Claude reale, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 6 | Esperimenti sul contesto: A/B con una variante (file da modificare come firme), riassunti finali brevi, esplorazione su un modello economico, task piccoli raggruppati, ognuno con la sua riga in Risparmi (Savings) | **Completata** (manca la misura con Claude reale, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 7 | GitHub: issue importate come task, pull request aperte da Onyx con descrizione dai task, stato dei controlli nel task e nelle notifiche, changelog dai commit e dai task | **Completata** (manca la prova su un repository GitHub vero, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 8 | Piani con QA: un revisore in sola lettura controlla ogni task prima del merge con prove dal diff; conflitti di merge risolti da Claude e applicati solo dopo la tua approvazione | **Completata** (manca la prova con Claude reale, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 9 | Insights: domande sul codice risposte dall'indice senza modello, Haiku solo se serve; Ideation: analisi statica gratuita di sicurezza e prestazioni, Claude solo sui punti sospetti, un task con un clic | **Completata** (manca la prova con Claude reale, vedi `docs/roadmap-2.0.md`) |
| 2.0 · 10 | Console in italiano (inglese a scelta), anche nei messaggi prodotti dal server; stati vuoti che dicono cosa fare; guida al primo progetto; palette con creazione, impostazioni e lingua; errori con la soluzione; Lighthouse ≥ 90 e axe pulito su tutte le pagine con `scripts/ui-audit.mjs` | **Completata** |
| 2.0 · 11 | Affidabilità: recupero automatico dopo un riavvio (piani, coda, follow-up, processi orfani, worktree), semaforo di salute per progetto, log nella console con i segreti mascherati, diagnostica in un file, aggiornamenti con ritorno alla release precedente | **Completata** (manca la prova di `release.sh` e di `onyx-update` da root sulla macchina vera) |

## Requisiti

- Linux (Debian, Ubuntu, Fedora, Arch, openSUSE) o macOS, x64 o arm64
- Node.js 22 LTS (≥ 22.18, serve il type stripping nativo per lo stub di Claude)
- pnpm 10.28 (la versione fissata in `package.json`)
- git, curl, un compilatore C/C++ con make e Python 3 per i binding nativi quando manca un binario precompilato
- Claude Code CLI (installata dallo script); per sviluppo e test c'è anche lo stub incluso

Non serve installarli a mano: lo fa `scripts/install.sh`.

## Avvio rapido in sviluppo

```bash
git clone https://github.com/Angrido/Onyx.git
cd Onyx
./scripts/install.sh
onyx-start
```

### Comandi

`scripts/install.sh` mette sul `PATH` questi comandi (per farlo a mano: `./scripts/onyx install`, in `/usr/local/bin` da root, altrimenti in `~/.local/bin`):

| Comando | Effetto |
|---|---|
| `onyx-start` | Avvia Onyx in background e stampa gli indirizzi della console |
| `onyx-stop` | Ferma Onyx e tutti i suoi processi |
| `onyx-restart` | Ferma e riavvia |
| `onyx-update` | Ferma Onyx, scarica l'ultima versione (`git pull`), aggiorna le dipendenze, applica le migrazioni del database, ricompila e lo riavvia se era acceso |
| `onyx-status` | Dice se Onyx è acceso e dove raggiungerlo |
| `onyx-logs` | Segue i log |
| `onyx-use-claude` | Passa alla CLI Claude Code vera (la installa se manca) e riavvia Onyx: serve per collegare il tuo account Claude da Impostazioni (Settings). `onyx use-stub` torna al simulatore |
| `onyx-update-claude` | Aggiorna Claude Code, controlla senza consumare token che accetti tutte le opzioni usate da Onyx e riavvia |
| `onyx-backup` | Scrive subito un backup del database (`onyx backups` li elenca) |
| `onyx-restore [nome\|latest]` | Ferma Onyx, salva il database corrente, ripristina il backup, applica le migrazioni e riavvia |

Funzionano in due modi, scelti da soli: in sviluppo eseguono `pnpm dev` dalla cartella del repository (log in `.onyx-data/logs/onyx-dev.log`); nel container di produzione (installato con `deploy/lxc/bootstrap.sh`) gestiscono i servizi systemd e `onyx-update` costruisce e installa una nuova release, tenendo le ultime tre. `ONYX_MODE=dev` o `ONYX_MODE=service` forzano la scelta.

`scripts/install.sh` installa solo ciò che manca e si può rilanciare quando si vuole:

| Passo | Cosa fa |
|---|---|
| Pacchetti di sistema | git, curl, certificati, toolchain C/C++, Python 3, SQLite con `apt`, `dnf`, `pacman` o `zypper`; su macOS controlla gli Xcode Command Line Tools |
| Node.js 22 | Se manca o è più vecchio di 22.18: da NodeSource su Debian/Ubuntu, altrimenti (o se NodeSource non è raggiungibile) la build ufficiale di nodejs.org verificata con SHA-256, in `/usr/local` oppure in `~/.local` senza permessi di amministratore |
| pnpm | Attiva con corepack la versione fissata in `package.json` (ripiego: `npm install -g`) |
| Claude Code | In modalità `real` (predefinita) o con `--with-claude`; non in modalità `stub` |
| Progetto | `pnpm install --frozen-lockfile`, `scripts/dev-setup.sh` (database, progetto demo, `.env`) e i comandi `onyx-*` |

Opzioni: `./scripts/install.sh stub` per il simulatore (sviluppo e test, nessun token), `--tools-only` per installare solo gli strumenti, `--with-claude` per aggiungere la CLI. Va lanciato come utente normale: chiede `sudo` solo per i pacchetti di sistema. Se installa Node in una cartella che non è in testa al `PATH`, alla fine stampa la riga da aggiungere al profilo della shell.

Apri http://localhost:3000 **oppure, da qualsiasi altro dispositivo della rete, `http://<ip-della-macchina>:3000`** (lo script stampa gli indirizzi). Crea l'utente operatore, registra il progetto demo (`.onyx-data/projects/demo`) e lancia un task.

In modalità `stub` gli agenti sono simulati da `packages/agent-runtime/bin/claude-stub.ts`, che rigioca trascrizioni `stream-json` registrate: nessun token consumato. Nel prompt si può scegliere lo scenario con un marcatore, ad esempio `[stub:hang]` (run che non termina, per provare l'abort), `[stub:crash]`, `[stub:error-max-turns]`, `[stub:quick]`, `[stub:mcp]`, che avvia il vero server MCP `onyx` della run ed espande il primo simbolo del pacchetto di contesto, oppure `[stub:guard] read:dist/app.js grep:logs bash:{cat .env}`, che prova quelle letture passando dal vero hook di guardia.

Con Claude Code reale (modalità predefinita) l'account si collega da **Impostazioni → Accedi con Claude** (**Settings → Sign in with Claude**); in alternativa si imposta **una sola** credenziale tra `ANTHROPIC_API_KEY` e `CLAUDE_CODE_OAUTH_TOKEN` in `apps/api/.env`. Con il simulatore la pagina Impostazioni lo segnala: il link di accesso dello stub non è un vero link di claude.ai e viene rifiutato ("Invalid request format"); `onyx use-claude` passa alla CLI vera senza reinstallare. `./scripts/dev-setup.sh [real|stub]` rigenera solo `.env`, database e progetto demo.

## Contesto Onyx (Fase 2)

Ogni progetto viene indicizzato alla registrazione e dopo ogni run: tree-sitter estrae simboli e import, repomix enumera i file e segnala quelli con segreti, Graphify costruisce il grafo delle importazioni e ne calcola centralità, cicli e blast radius. A ogni run l'agente riceve:

- nel system prompt, una mappa compatta del progetto (file più centrali con i loro export);
- nel primo messaggio, un pacchetto di contesto: i file target completi, gli estratti dei simboli importati dalle dipendenze, le righe in cui i dipendenti usano i target;
- il server MCP `onyx` con `expand_symbol`, `file_skeleton`, `deps` e `search_symbols`, per leggere solo ciò che serve.

Sui benchmark (`pnpm --filter @onyx/graphify bench <cartella…>`) il pacchetto costa dal 46% all'81% in meno del contesto naive "file target + dipendenze dirette". La pagina del progetto mostra lo stato dell'indice e porta alla vista Grafo (Graph); la console della run mostra il contesto inviato e le chiamate ai tool `onyx`.

### Il risparmio è reale?

La pagina **Risparmi** (**Savings**) lo dice con un verdetto e separa ciò che è misurato da ciò che è stimato:

- **stima netta**: pacchetto, mappa ed espansioni MCP contro la lettura completa di target e dipendenze, meno i file che l'agente ha riletto comunque con `Read` (succede sempre prima di modificarli);
- **misura**: con *Esegui l'esperimento* (*Run the experiment*) una quota delle sessioni nuove (default 25%) parte senza contesto Onyx; i due gruppi si confrontano sui token reali riportati da Claude, con un test statistico. Le run di controllo costano come senza Onyx, quindi l'esperimento è spento di default;
- **controlli** su copertura del pacchetto, riletture e stima netta, con i file più riletti; cache dei prompt e routing sono mostrati a parte;
- **registro dei risparmi**: una riga per ogni modo in cui Onyx risparmia token (contesto, mappa tenuta per la sessione, pacchetto non rimandato, cache dei prompt, routing), ciascuna marcata *Misurato* (*Measured*) o *Stima* (*Estimate*) con il calcolo usato;
- **cache dei prompt nelle riprese**: per ogni run che riprende una sessione, quanti token Claude ha riletto dalla cache e, se l'ha dovuta riscrivere, perché (prompt di sistema cambiato, modello cambiato, cache scaduta, non spiegato).

### Meno token nelle sessioni riprese (2.0, milestone 1)

- Una sessione tiene la mappa del progetto con cui è partita: le run che la riprendono mandano lo stesso prompt di sistema e Claude rilegge la conversazione dalla cache invece di riscriverla. La mappa aggiornata entra con la sessione successiva.
- Le run riprese non rimandano i file del pacchetto che la conversazione ha già: li elencano per nome e mandano solo quelli cambiati. Dopo una compattazione del contesto il pacchetto torna intero.
- Nei piani multi-agente, i test già rossi prima del lavoro non fanno fallire i nodi: Onyx esegue la suite sul commit di partenza (senza token) e la verifica del nodo li ignora, a meno che non siano test dei file del nodo. Il messaggio dice quali sono stati ignorati.

Dettagli in [docs/operations.md §10](docs/operations.md#10-il-risparmio-di-token-funziona).

### Limiti di Claude Max e progetti nuovi (2.0, milestone 2)

- Durante le run Claude Code riporta quanto è usato delle finestre dell'abbonamento (5 ore, settimanale). Onyx lo mostra in **Telemetria → Limiti dell'abbonamento Claude** (**Telemetry → Claude subscription limits**) e, quando ci si avvicina, nella barra laterale.
- Un task marcato **Può aspettare** (**Can wait**), alla creazione o nella sua pagina, resta in coda quando la finestra supera la soglia di attesa (default 90%) e parte da solo al reset; gli altri partono comunque. Al limite raggiunto aspetta tutta la coda. *Riprendi ora* (*Resume now*) sblocca a mano, per esempio dopo aver cambiato account.
- Registrando una cartella, **Anteprima** (**Preview**) propone i workspace dalla struttura reale (`apps/*`, `packages/*`, `src/*`, `prisma`, `deploy`, `Dockerfile`…): si tolgono quelli che non servono prima di confermare. Anche l'import da GitHub li usa.
- La pagina del progetto propone i comandi precisi per lo stack rilevato (Node con il suo gestore e gli script, Python, Go, Rust, make, Docker). Install e build di immagini sono segnalati e non preselezionati; gli interpreti non vengono mai proposti.

Dettagli in [docs/operations.md §11](docs/operations.md#11-limiti-dellabbonamento-claude).

### Agenti isolati e comandi più sicuri (2.0, milestone 3)

- **Utente separato per gli agenti**: `sudo deploy/scripts/agent-sandbox.sh --enable` crea l'utente `onyx-agent` e fa girare agenti, terminali e test con quello. Un agente ingannato da un file del progetto non legge più la chiave di cifratura, il database né i token delle altre run, e non cambia la configurazione git. Il controllo `agent-sandbox` di `/api/ready` deve risultare `ok`.
- ***Consenti e continua*** (***Allow and continue***): propone regole strette (`pnpm run build`, non `pnpm`), mostra il comando da cui nasce ognuna, preseleziona solo quelle sicure e spiega le altre; `sudo` e `git push` non si possono consentire. Si sceglie se valgono per il task, per il profilo d'agente o per tutto il progetto, e per quanto tempo; la pagina del progetto le elenca e le revoca.
- **Recinti**: a fine run Onyx rimette a posto i file degli altri workspace che la run ha cambiato per vie traverse (script, `node -e`…) e lo segnala nel feed.

Dettagli in [docs/operations.md §12](docs/operations.md#12-isolare-gli-agenti).

### Più progetti insieme (2.0, milestone 4)

- **Mission control** è la nuova home: una scheda per progetto con branch, file modificati, commit avanti e indietro, agenti al lavoro e in coda, ultima run e ultimo TDD, spesa e token di oggi e della settimana, approvazioni in attesa e uno stato di salute che dice cosa guardare. Si filtra (al lavoro, da guardare, fermi), si cerca per nome e si ordina per attività, nome o spesa.
- **Coda globale**: le run in attesa di tutti i progetti stanno in un'unica coda ordinata per priorità; chi aspetta da tempo sale di un livello ogni 30 minuti (regolabile). Dalla home si sposta un task in cima, su o giù, e ogni riga dice perché aspetta. In **Impostazioni → Coda delle run** (**Settings → Run queue**) si limita quante run può avere un progetto alla volta, in generale o per singolo progetto.
- **Griglia degli agenti** (**Agent grid**): fino a nove pannelli con run dal vivo o terminali di qualunque progetto. I pannelli fuori vista si mettono in pausa e riprendono dallo stato dello schermo. *Incolla* (*Paste*) incolla nel terminale titolo, prompt, criteri e file di un task, senza inviarlo.
- **Notifiche**, tutte spente finché non le accendi in **Impostazioni → Notifiche** (**Settings → Notifications**): run fallite o in attesa di comandi, approvazioni, budget, limiti di Claude e, se vuoi, ogni run finita. Arrivano nel browser (solo via HTTPS), su ntfy o su Telegram. Onyx invia e basta: non riceve comandi da questi servizi. I token sono cifrati.
- **Ricerca**: la palette (Ctrl K) cerca nei task, nelle run e nei percorsi dei file di tutti i progetti, accenti compresi.
- Con 20 progetti, 20.000 run e 2 milioni di righe di token, Mission control risponde in 181 ms (56 ms con git in cache) e Risparmi (Savings) in 400 ms (`pnpm --filter @onyx/api bench:telemetry`).

Dettagli in [docs/operations.md §13–15](docs/operations.md#13-coda-e-limite-per-progetto).

### Memoria di progetto (2.0, milestone 5)

- Dopo ogni run Onyx annota, con la run da cui vengono: i comandi utili che hanno funzionato (test, build, lint, type check), i file letti in almeno tre run, il comando dei test di un TDD finito in verde e i fallimenti che si ripetono. Le insidie restano da confermare, perché il loro testo viene dall'output dei comandi.
- **Memoria** (**Memory**) nella pagina del progetto mostra cosa ricevono le sessioni nuove (entro 800 token, regolabili) e permette di confermare, fissare, correggere, dimenticare e ripristinare i fatti, e di aggiungere note. I fatti non rivisti per 30 giorni si dimenticano, tranne quelli fissati.
- La memoria entra nel prompt di sistema delle sessioni nuove, run e terminali, e resta la stessa per tutte le riprese: la cache dei prompt non si rompe.
- **Impostazioni → Memoria del progetto → Misuralo** (**Settings → Project memory → Measure it**): metà delle sessioni nuove parte senza memoria e **Risparmi** (**Savings**) confronta token di input, file letti e turni. Finché non ci sono 10 run per gruppo la riga del registro resta *stimata* e riporta i token che la memoria aggiunge.

Dettagli in [docs/operations.md §16](docs/operations.md#16-memoria-di-progetto).

### Esperimenti sul contesto (2.0, milestone 6)

- **Risparmi → Context experiment** (**Savings → Context experiment**) accetta una **variante** accanto al pacchetto attuale e al controllo. La prima: i file che un task dichiara da modificare arrivano come firme (L2) invece che interi, perché Claude Code li rilegge comunque prima di modificarli. La tabella ha una terza colonna e un verdetto per la variante.
- **Impostazioni → Opzioni di risparmio token** (**Settings → Token saving options**):
  - *Riepiloghi finali brevi* (*Short final summaries*), acceso: le sessioni nuove chiudono con un riassunto di al massimo sei righe; il dettaglio resta nel diff.
  - *Esplora con un modello più economico* (*Explore on a cheaper model*), acceso: planner e roadmap mandano le ricerche a un sotto-agente su Haiku e la roadmap gira sul modello Builder. Il piano resta sul modello Architect.
  - *Raggruppa i task piccoli in coda* (*Group small queued tasks*), spento: fino a quattro task brevi dello stesso workspace in coda diventano una run sola, con un esito per task. Quelli che l'agente non riporta tornano in coda da soli.
- Ogni opzione ha una riga in Risparmi: *stimata* finché non ci sono abbastanza run (10 prima e 10 dopo per i riassunti, 3 piani con e 3 senza esploratore, 5 run raggruppate e 5 singole), poi *misurata*.

Dettagli in [docs/operations.md §17](docs/operations.md#17-esperimenti-e-opzioni-di-risparmio).

### GitHub e changelog (2.0, milestone 7)

Dalla pagina del progetto, **GitHub** apre una pagina con tre sezioni (serve che `origin` punti a GitHub):

- **Issue** (**Issues**): le issue aperte del repository, con etichette e autore. Quelle scelte diventano task in bozza con il link, le etichette (che decidono il tipo: bug, docs, test…) e i file citati che esistono nell'indice. Il testo dell'issue è chiuso tra due marcatori e il prompt dice all'agente di trattarlo come descrizione, non come istruzioni; il task lo segnala in giallo.
- **Pull request** (**Pull requests**): scegli un branch pubblicato e Onyx prepara titolo e descrizione dai task pubblicati, dal diff e dai TDD loop, senza modello (chiude le issue collegate con `Closes #n`). *Fai push e apri la pull request* (*Push and open the pull request*) pubblica il branch e apre la PR. Lo stato dei controlli compare qui, nel task e, se vuoi, nelle notifiche con *Check delle pull request* (*Pull request checks*); Onyx lo rilegge ogni minuto mentre girano e sempre meno spesso quando non cambia, con richieste condizionali che non consumano il limite di GitHub.
- **Changelog**: le voci dall'ultimo rilascio o tag, dai commit Conventional Commits (feat, fix, perf, refactor, docs; chore, CI e test esclusi) e dai task completati, senza doppioni. Versione proposta, testo modificabile; *Salva* (*Save*) lo mette in cima a `CHANGELOG.md`, da pubblicare con le prossime modifiche.

Nessuna di queste funzioni usa token di Claude. Il token GitHub deve avere anche **Pull requests** in lettura e scrittura, e **Issues**, **Checks** e **Commit statuses** in lettura.

Dettagli in [docs/operations.md §18](docs/operations.md#18-github-issue-pull-request-e-changelog).

### QA e merge assistito nei piani (2.0, milestone 8)

**Pianifica una funzionalità** (**Plan a feature**) ha due opzioni nuove, accese di default:

- **Rivedi ogni task prima del merge (QA)** (**Review each task before merging (QA)**): dopo i test, un revisore in sola lettura sul modello Builder confronta il diff del task con i criteri di accettazione. Ogni criterio va dimostrato con un punto del diff (file, riga, citazione): senza prova non conta. Se trova problemi, l'agente del task li corregge una volta nella stessa sessione; se restano, **Approvazioni** (**Approvals**) chiede se unire comunque o lasciar perdere il task. Il report sta nella scheda del task nella pagina del piano.
- **Lascia che Claude proponga come risolvere i conflitti** (**Let Claude propose conflict resolutions**): quando il merge di un task va in conflitto, Claude risolve i file in un worktree a parte, Onyx fa girare test e type check sulla proposta e la mette in **Approvazioni** con il diff. *Applica la risoluzione* (*Apply the resolution*) la applica, *Lo risolvo io* (*Resolve it myself*) torna alla scelta manuale di prima (riprova il merge o lascia il task).

Sono costi, non risparmi: Risparmi (Savings) li mostra come righe *misurate* con token e dollari spesi, e il piano riporta quanto è andato in QA e conflitti.

Dettagli in [docs/operations.md §19](docs/operations.md#19-qa-e-conflitti-nei-piani).

### Insights e Ideation (2.0, milestone 9)

**Insights** nella pagina del progetto:

- **Chiedi del codice** (**Ask about the code**): chi usa una funzione, dove è definita, chi importa un file e cosa importa, i file più centrali e più grandi, le dipendenze circolari. In inglese o in italiano, la risposta viene dall'indice e dal grafo, gratis e con le fonti (file e riga). Le altre domande, o un clic su *Chiedi a Claude* (*Ask Claude instead*), vanno a Claude Haiku in sola lettura con i tool `onyx`, e il costo è mostrato accanto alla risposta.
- **Ideation**: *Analizza il progetto* (*Analyse the project*) applica regole di sicurezza (eval, comandi shell e SQL costruiti con variabili, HTML grezzo, segreti nel codice, TLS disattivato, hash deboli, chiamate Python pericolose) e di prestazioni (query e await dentro i cicli, file sincroni nel codice server), esegue `npm audit` o `pnpm audit` se c'è un lockfile e cerca nel grafo cicli e file grandi da cui dipendono in molti. Tutto senza modello. *Chiedi a Claude di N punti sospetti* (*Ask Claude about N suspicious points*) manda a Haiku solo le righe segnalate con poche righe intorno; ogni risultato diventa un task in bozza con un clic o si scarta, e lo scarto vale anche per le analisi successive.

In Risparmi (Savings): le risposte dall'indice e i token che Ideation non ha mandato, *stimati* a partire da misure (token delle risposte del modello, token degli snippet contro quelli del codice analizzato).

Dettagli in [docs/operations.md §20](docs/operations.md#20-insights-e-ideation).

### Italiano, primo progetto e accessibilità (2.0, milestone 10)

- **Lingua**: la console è in italiano; l'inglese si sceglie in **Impostazioni → Lingua dell'interfaccia** o dalla palette (**Ctrl+K** → *Passa all'inglese*). La scelta vale per il browser e cambia anche i testi che arrivano dal server: verdetti e righe di Risparmi, limiti di Claude, stato dei progetti in Mission control, notifiche sul telefono, messaggi dei piani, risposte di Insights dall'indice e risultati di Ideation. Restano in inglese i prompt per Claude (cambiarli costerebbe token e cambierebbe il comportamento del modello), quello che scrive Claude, i log e i testi per GitHub.
- **Primo progetto**: con un database vuoto la home mostra *Per iniziare*, cinque passi che portano ciascuno alla pagina giusta: account Claude, progetto, workspace proposti, comandi dello stack, primo task. Spariscono da soli quando sono fatti, o con *Nascondi la guida*.
- **Errori**: gli errori noti dell'API arrivano con la causa e la soluzione suggerita (es. *Tutti gli slot degli agenti sono occupati* → aspetta la fine di una run o alza `MAX_CONCURRENT_AGENTS`).
- **Palette** (**Ctrl+K**): oltre a pagine, progetti e task, crea un progetto da una cartella o da GitHub, apre ogni scheda delle impostazioni, le sottopagine dei progetti e cambia lingua.
- **Accessibilità**: `node scripts/ui-audit.mjs --cookie "onyx_sid=…"` controlla tutte le pagine su desktop e a 375 px (axe, overflow, Lighthouse ≥ 90).

Dettagli in [docs/operations.md §21](docs/operations.md#21-lingua-primo-progetto-e-controllo-dellinterfaccia).

### Affidabilità (2.0, milestone 11)

- **Dopo un riavvio** Onyx ferma i processi degli agenti rimasti orfani, rimette in coda i task con la loro richiesta (anche il prompt di follow-up), fa ripartire i piani dai nodi non finiti e toglie i worktree che non servono più. Le run che erano in corso restano *interrotte*: le rilanci tu, perché avevano già speso token.
- **Salute**: ogni progetto in Mission control ha un semaforo (indice, git, runner dei test, spazio su disco, credenziali), con i dettagli nella pagina del progetto.
- **Log** (`/logs`): le ultime righe dell'API con filtri, senza segreti.
- **Diagnostica** (Impostazioni): un file con versioni, configurazione senza segreti, errori recenti e numeri del database, da guardare in anteprima e poi scaricare.
- **Aggiornamenti**: se la release nuova non parte si torna alla precedente con il backup del database; gli errori di git sono chiari e fermano l'aggiornamento.

Dettagli in [docs/operations.md §22](docs/operations.md#22-affidabilità-recupero-salute-log-e-diagnostica).

### Comandi bloccati

Durante una run nessuno può approvare comandi, quindi Claude Code esegue solo quelli consentiti all'agente (git in lettura, test e lint) e rifiuta gli altri. Quando succede, la run mostra i comandi rifiutati con **Consenti e continua** (**Allow and continue**): si scelgono quelli da consentire nel progetto (quelli che possono cancellare o modificare cose restano deselezionati), si risponde all'agente se ha chiesto qualcosa e il task riprende nella stessa sessione. La pagina del progetto elenca i comandi consentiti in *Comandi che gli agenti possono eseguire* (*Commands agents may run*), dove si aggiungono o tolgono. `rm -rf`, `sudo` e `git push` restano bloccati comunque.

## Context Surgeon (Fase 3)

Dalla pagina del progetto, **Context Surgeon** apre l'albero dei file con la heatmap dei token: ogni checkbox decide se un file o una directory resta visibile agli agenti. Si parte dal preset aggressivo (dipendenze, build, lockfile, generati, minificati, log) più le regole di sicurezza bloccate (`.env*`, chiavi, `.npmrc`…); i suggerimenti propongono asset binari, file di dati voluminosi e codice generato. Il pannello laterale mostra il risparmio in token e dollari, la differenza rispetto al profilo salvato e gli avvisi quando si nasconde un file centrale nel grafo. Ogni workspace può aggiungere un overlay al profilo di progetto.

A ogni run il profilo diventa:

- regole `permissions.deny` con percorsi assoluti nel `settings.json` della run (il progetto non viene modificato);
- un hook HTTP `PreToolUse` che blocca `Read`, `Grep`, `Glob`, `LS` e comandi Bash come `cat`, `head`, `grep -r` diretti a percorsi esclusi; ogni blocco compare nel feed della run, nel registro di audit e nel contatore `guardDenials`;
- un filtro su pacchetto di contesto, mappa e tool MCP.

**Misura** (**Measure**) confronta la stima con un tokenizer di riferimento (`count_tokens` se c'è una API key, altrimenti `o200k_base` in locale), **Calibra** (**Calibrate**) adatta lo stimatore al progetto, **Esporta** (**Export**) scrive il `.claudesignore` per chi usa Claude Code fuori da Onyx. Sul benchmark (`pnpm --filter @onyx/api bench:surgeon <cartella…>`) l'errore sul risparmio del preset, dopo la calibrazione, va dallo 0,0% al 12,5% su hono, httpx, fastify e Onyx.

## Progetti da GitHub

**Nuovo progetto** (**New project**), oppure **Importa da GitHub** (**Import from GitHub**) nella console, apre la scheda *Da GitHub* (*From GitHub*): incolla un token personale e scegli uno dei tuoi repository, anche privati, oppure sfoglia i repository pubblici di un utente senza token. Onyx lo clona in `ONYX_PROJECTS_DIR/<nome>`, lo registra con i workspace di dominio e avvia l'indicizzazione; la scheda *Cartella locale* (*Local folder*) registra invece una cartella già presente sul server.

Il token consigliato è *fine-grained* con **Contents** sui repository che vuoi usare ([crealo qui](https://github.com/settings/personal-access-tokens/new)): in sola lettura basta per importare, in lettura e scrittura serve per pubblicare i branch; per le pull request servono anche **Pull requests** in lettura e scrittura e **Issues**, **Checks** e **Commit statuses** in lettura; un token classico richiede lo scope `repo`. Viene salvato nel database di Onyx e non è mai restituito dall'API; in alternativa si imposta `ONYX_GITHUB_TOKEN` nell'ambiente del servizio.

## Account Claude Max, Roadmap e branch su GitHub

- **Impostazioni → Account Claude → Accedi con Claude** (**Settings → Claude account → Sign in with Claude**): si apre un terminale nella pagina con `claude setup-token`; apri il link, accedi con il tuo account Claude Max, incolla il codice nel terminale e premi Invio. Onyx salva il token e lo usa per tutti gli agenti; *Prova la connessione* (*Test connection*) lo verifica. In alternativa puoi incollare il token generato con `claude setup-token` su un altro computer.
- **Roadmap**: dalla pagina del progetto, *Roadmap* fa studiare il progetto a Claude in sola lettura e propone le prossime attività nella colonna *Suggeriti* (*Suggested*) di un Kanban. Trascini quello che ti interessa in *Da fare* (*To do*), poi in *In corso* (*In progress*) per farlo eseguire a un agente; i task finiti arrivano in *Fatto* (*Done*).
- **Branch e push**: il pannello Git mostra i file modificati dagli agenti. *Commit e push su GitHub* (*Commit and push to GitHub*) crea un branch nuovo separato da `main` (es. `onyx/20261005-coprire-login-con-test`), fa il commit e lo pubblica su GitHub, con il link per aprire la pull request. Serve un token GitHub con **Contents: read and write**; nome ed email dei commit si impostano in Impostazioni.

## Model Router e compartimenti (Fase 4)

Ogni run passa dal router, che sceglie il tier più economico adatto al task: prima le regole (pagina **Router**, modificabili e per progetto), poi un punteggio euristico su blast radius, cross-domain, file toccati, parole chiave architetturali, dimensione del contesto e fallimenti precedenti, infine, con una API key, il classificatore Haiku 4.5 quando l'euristica è incerta. La decisione e la sua motivazione compaiono nel feed della run e nella pagina del task; se una run finisce i turni, il task torna in coda sul tier superiore. Il **simulatore** prova un task senza eseguirlo; il riquadro dei costi confronta il costo per task completato con quello che si sarebbe speso con tutto su Opus.

Ogni workspace è un compartimento con la sua catena di sessioni Claude:

- quando un altro workspace modifica file, la sessione successiva parte da zero con una **nota di handoff** (≤ 1.500 token) su cosa è cambiato e cosa resta aperto, secondo la strategia `HARD`, `HANDOFF` o `SOFT`;
- oltre `maxSessionTokens` la sessione ruota con la nota;
- i file degli altri workspace sono in sola lettura (anche via Bash);
- un task con workspace "Auto" va al workspace che possiede i suoi file; se nessun workspace li possiede (o non ci sono file target) va a quello di cui parla il prompt (interfaccia, API, database, deploy…), altrimenti al primo. Il dialogo del task mostra quale sceglierà e perché.

Dalla pagina del workspace si apre un **terminale interattivo** di Claude Code (xterm.js) nello stesso compartimento: Onyx inietta `/compact` quando il contesto supera il limite e `/clear` con la nota di handoff dopo un cambio di dominio; i pulsanti fanno lo stesso a richiesta. La catena delle sessioni mostra perché ognuna è finita e la nota con cui è partita la successiva.

## TDD Auto-Loop (Fase 5)

Dalla pagina di un task, **Avvia il TDD loop** (**Start TDD loop**) fa lavorare l'agente finché i test non sono verdi, senza toccare i test:

1. Onyx esegue i test correlati ai file del task (`vitest related` / `jest --findRelatedTests`), poi l'intera suite, poi i gate (`tsc --noEmit` se c'è un `tsconfig.json`, lint se attivato). L'output a colori scorre nel terminale della pagina.
2. Se qualcosa fallisce, l'agente riceve solo un **digest** compatto (≤ 4.000 token): test, messaggio, diff atteso/ricevuto, frame del progetto e ±3 righe di codice. Riprende la stessa sessione del workspace.
3. I file di test, gli snapshot, i mock e le configurazioni di Vitest/Jest sono in sola lettura: le regole di permesso e l'hook di guardia bloccano modifiche e comandi di test; se l'agente li cambia comunque (per esempio con uno script), Onyx li ripristina dalla copia fatta all'avvio e registra la violazione.
4. Dopo 2 tentativi senza progressi il modello sale di tier (Sonnet → Opus); se gli stessi fallimenti tornano 3 volte di fila dopo l'escalation il loop si ferma come *Bloccato* (*Stalled*). Ci sono anche un limite di tentativi (default 6), un budget in dollari e un timeout per ogni esecuzione dei test.

Il runner viene rilevato da `package.json` e dai file di configurazione; nella pagina del workspace si possono fissare il runner e il comando che lo lancia (es. `pnpm --filter web exec vitest`). Durante il loop il workspace è riservato: altre run, terminali e pubblicazioni aspettano.

## Orchestrator multi-agente (Fase 6)

Dalla pagina di un progetto, **Pianifica una funzionalità** (**Plan a feature**) fa scomporre una funzionalità in task per workspace:

1. Claude studia il progetto in sola lettura (modello del tier Architect) e restituisce un piano strutturato: task, workspace, dipendenze, file probabili, criteri di accettazione e tier suggerito. Il piano compare come grafo a passi e **non parte finché non lo approvi** nella pagina del piano o in **Approvazioni** (**Approvals**).
2. All'approvazione Onyx crea il branch di lavoro `onyx/plan-AAAAMMGG-<feature>` da quello corrente. Ogni task riceve un git worktree proprio (nella directory dati di Onyx, con le dipendenze collegate) e una sessione nuova; i task indipendenti girano in parallelo, fino al numero di agenti scelto.
3. Se il progetto ha Vitest o Jest, ogni task passa il TDD loop nel suo worktree; poi Onyx fa il commit e lo unisce al branch di lavoro, un merge alla volta. Un conflitto non viene mai risolto da solo: in **Approvazioni** scegli se riprovare il merge (dopo averlo sistemato sul branch del task) o scartare il task.
4. Alla fine la suite completa e `tsc` girano sul branch unito. `main` non cambia; dalla pagina del piano **Fai il push del branch** (**Push the branch**) spinge il branch di lavoro su GitHub e offre il link per la pull request.

Un piano fermato da un errore o da un riavvio si riprende con **Riprendi** (**Resume**): i task già uniti restano, gli altri ripartono. In **Impostazioni → Budget** (**Settings → Budgets**) si impostano limiti di spesa globali o per progetto (al giorno, al mese o totali): oltre la soglia soft le nuove run aspettano un'approvazione, alla soglia hard vengono rifiutate e quelle in corso si fermano. Gli agenti `architect` e `builder` hanno anche sotto-agenti nativi di Claude Code (`explorer`, `test-writer`, `reviewer`).

## Hardening (Fase 7)

- **Backup**: Onyx copia il database ogni giorno (e prima di ogni aggiornamento o ripristino), verifica ogni copia e tiene le ultime 14. Da **Impostazioni → Backup** (**Settings → Backups**) si fa un backup, lo si verifica o lo si scarica; `onyx-restore` lo ripristina.
- **Token cifrati**: i token di Claude e GitHub salvati da Impostazioni sono cifrati nel database; la chiave sta in `secret.key` nella cartella dei dati. Copiala insieme al backup se ripristini su un'altra macchina.
- **Claude Code**: `onyx-update-claude` aggiorna la CLI e verifica che sia compatibile; se non lo è, la pagina Impostazioni dice quali opzioni mancano.
- **Tastiera**: **Ctrl+K** (⌘K) apre la palette dei comandi per pagine, progetti, task e azioni; *Vai al contenuto* (*Skip to content*) porta al contenuto.
- **Movimento**: l'orb di ogni agente mostra lo strumento in uso, il TDD loop lampeggia sui test rossi e si illumina al verde; con *riduci movimento* attivo nel sistema le animazioni restano ferme.

La guida operativa completa (dati, backup, ripristino, aggiornamenti, sicurezza, problemi comuni) è in [`docs/operations.md`](./docs/operations.md).

## Accesso dalla rete

Onyx è raggiungibile da ogni dispositivo della LAN, senza configurare indirizzi:

| Modalità | URL |
|---|---|
| Sviluppo (`pnpm dev`) | `http://<ip>:3000` (UI su `0.0.0.0:3000`, API su `0.0.0.0:4000`) |
| Produzione (container) | `http://<ip>` oppure `http://onyx.local` (Caddy su `:80`, nome pubblicato via mDNS) |

La console mostra gli indirizzi utilizzabili nella scheda "Sulla tua rete" ("On your network"). Le richieste sono accettate da qualsiasi IP o nome di rete locale (`.local`, `.lan`, nomi senza dominio…); un dominio pubblico va aggiunto a `ONYX_ALLOWED_ORIGINS`. Il firewall di esempio (`deploy/nftables/nftables.conf`) ammette tutte le reti private. Dettagli in `architecture.md` §11.8.

## Comandi

| Comando | Effetto |
|---|---|
| `./scripts/install.sh [real\|stub]` | Installa ciò che manca (pacchetti, Node.js, pnpm, Claude Code) e prepara il progetto |
| `pnpm dev` | API (`:4000`, tsx watch), web (`:3000`, Next.js dev) e bundle del server MCP in watch |
| `pnpm test` | Test di tutti i pacchetti (Vitest) |
| `pnpm typecheck` | TypeScript strict su tutti i pacchetti |
| `pnpm lint` | ESLint, inclusa la regola `onyx/no-comments` |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm build` | Bundle API e server MCP (tsup) e build standalone Next.js |
| `pnpm db:migrate` | `prisma migrate deploy` sul `DATABASE_URL` corrente |
| `pnpm --filter @onyx/graphify bench <cartella…>` | Benchmark del pacchetto di contesto su uno o più repository |
| `pnpm --filter @onyx/api bench:surgeon <cartella…>` | Errore della stima dei token del Context Surgeon rispetto a `o200k_base`, prima e dopo la calibrazione |

## Struttura

| Percorso | Ruolo |
|---|---|
| `apps/api` | Fastify 5: auth, progetti, workspace, task, run, Context Surgeon, router, compartimenti, terminali, hook interni, WebSocket, scheduler, telemetria |
| `apps/web` | Next.js 16: console, progetti, workspace con terminale, Context Surgeon, grafo, router, task, run live, telemetria, verifica del risparmio di token |
| `packages/contracts` | Schemi zod condivisi: REST, WebSocket, eventi `stream-json` e normalizzatore |
| `packages/db` | Schema Prisma 7 + SQLite, migrazioni, seed |
| `packages/agent-runtime` | Spawn della CLI, parser `stream-json`, pool con abort sul process group, terminali PTY (`node-pty`), stub |
| `packages/lean-ctx` | Parse tree-sitter (TS, TSX, JS, Python), simboli, scheletri L1/L2, estratti, mappa L0 |
| `packages/graphify` | Enumerazione repomix, resolver dei moduli, grafo, metriche, pacchetto di contesto, benchmark |
| `packages/ignore-compiler` | Policy gitignore, preset ed euristiche, compilatore verso regole di permesso, guardia dei percorsi e recinto di scrittura per l'hook |
| `packages/mcp-server` | Server MCP `onyx` (stdio) in `dist/onyx-mcp.js` e comando di statusline per i terminali in `dist/onyx-statusline.js` |
| `packages/config` | Preset TypeScript, ESLint, Prettier |
| `deploy/` | systemd, Caddy, nftables, bootstrap LXC, build/release/backup |

## Convenzioni

- Codice senza commenti: l'intento si esprime con nomi e struttura. La regola ESLint `onyx/no-comments` lo fa rispettare.
- TypeScript strict con `exactOptionalPropertyTypes` e `noUncheckedIndexedAccess`.
- Validazione zod a ogni confine: HTTP, WebSocket, output della CLI, configurazione.

## Deploy

Vedi `architecture.md` §10 e §11. In sintesi, dentro il container:

```bash
./deploy/lxc/bootstrap.sh
onyx-update
```

`onyx-update` costruisce la release e la installa; da lì in poi `onyx-start`, `onyx-stop`, `onyx-status` e `onyx-logs` gestiscono i servizi.
