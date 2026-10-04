# Onyx

Pannello di controllo orchestratore per **Claude Code**: accoda task, avvia agenti headless come processi figli, ne mostra l'output in tempo reale e traccia token e costi. Gira in un container LXC Debian 13 su Proxmox VE.

L'architettura completa (topologia, schema dati, rete, roadmap) è in [`architecture.md`](./architecture.md).

## Stato

| Fase | Contenuto | Stato |
|---|---|---|
| 0 | Infrastruttura LXC e rete | Documentata in `architecture.md` §10–11, script in `deploy/` |
| 1 | Monorepo, database, Agent Runtime, API, console web | **Completata** |
| 2 | Lean-ctx (scheletri AST con tree-sitter), Graphify (grafo delle importazioni), server MCP `onyx`, vista Graph | **Completata** (manca solo la prova con un modello reale, vedi `architecture.md` §16) |
| 3 | Context Surgeon: profili di contesto, regole di permesso compilate, hook di guardia, calibrazione dei token | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 4 | Model Router, compartimenti di sessione con handoff, recinti di scrittura, terminali interattivi con `/clear` e `/compact` | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 5 | TDD Auto-Loop: test Vitest/Jest in PTY, digest dei fallimenti, anti-cheat, gate, escalation su stallo | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 6 | Orchestrator multi-agente: planner, approvazione del piano, DAG, git worktree in parallelo, merge assistito, sub-agenti nativi, budget, centro approvazioni | **Completata** (manca solo la prova con la CLI reale, vedi `architecture.md` §16) |
| 7 | Hardening: token cifrati, backup e ripristino testati, aggiornamento e verifica di Claude Code, firme di movimento, accessibilità, palette dei comandi, Lighthouse ≥ 90 | **Completata** (manca solo la registrazione delle trascrizioni reali, vedi `architecture.md` §16) |

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
| `onyx-use-claude` | Passa alla CLI Claude Code vera (la installa se manca) e riavvia Onyx: serve per collegare il tuo account Claude da Settings. `onyx use-stub` torna al simulatore |
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

Con Claude Code reale (modalità predefinita) l'account si collega da **Settings → Sign in with Claude**; in alternativa si imposta **una sola** credenziale tra `ANTHROPIC_API_KEY` e `CLAUDE_CODE_OAUTH_TOKEN` in `apps/api/.env`. Con il simulatore la pagina Settings lo segnala: il link di accesso dello stub non è un vero link di claude.ai e viene rifiutato ("Invalid request format"); `onyx use-claude` passa alla CLI vera senza reinstallare. `./scripts/dev-setup.sh [real|stub]` rigenera solo `.env`, database e progetto demo.

## Contesto Onyx (Fase 2)

Ogni progetto viene indicizzato alla registrazione e dopo ogni run: tree-sitter estrae simboli e import, repomix enumera i file e segnala quelli con segreti, Graphify costruisce il grafo delle importazioni e ne calcola centralità, cicli e blast radius. A ogni run l'agente riceve:

- nel system prompt, una mappa compatta del progetto (file più centrali con i loro export);
- nel primo messaggio, un pacchetto di contesto: i file target completi, gli estratti dei simboli importati dalle dipendenze, le righe in cui i dipendenti usano i target;
- il server MCP `onyx` con `expand_symbol`, `file_skeleton`, `deps` e `search_symbols`, per leggere solo ciò che serve.

Sui benchmark (`pnpm --filter @onyx/graphify bench <cartella…>`) il pacchetto costa dal 46% all'81% in meno del contesto naive "file target + dipendenze dirette". La pagina del progetto mostra lo stato dell'indice e porta alla vista Graph; la console della run mostra il contesto inviato e le chiamate ai tool `onyx`.

### Il risparmio è reale?

La pagina **Savings** lo dice con un verdetto e separa ciò che è misurato da ciò che è stimato:

- **stima netta**: pacchetto, mappa ed espansioni MCP contro la lettura completa di target e dipendenze, meno i file che l'agente ha riletto comunque con `Read` (succede sempre prima di modificarli);
- **misura**: con *Run the experiment* una quota delle sessioni nuove (default 25%) parte senza contesto Onyx; i due gruppi si confrontano sui token reali riportati da Claude, con un test statistico. Le run di controllo costano come senza Onyx, quindi l'esperimento è spento di default;
- **controlli** su copertura del pacchetto, riletture e stima netta, con i file più riletti; cache dei prompt e routing sono mostrati a parte.

Dettagli in [docs/operations.md §10](docs/operations.md#10-il-risparmio-di-token-funziona).

### Comandi bloccati

Durante una run nessuno può approvare comandi, quindi Claude Code esegue solo quelli consentiti all'agente (git in lettura, test e lint) e rifiuta gli altri. Quando succede, la run mostra i comandi rifiutati con **Allow and continue**: si scelgono quelli da consentire nel progetto (quelli che possono cancellare o modificare cose restano deselezionati), si risponde all'agente se ha chiesto qualcosa e il task riprende nella stessa sessione. La pagina del progetto elenca i comandi consentiti in *Commands agents may run*, dove si aggiungono o tolgono. `rm -rf`, `sudo` e `git push` restano bloccati comunque.

## Context Surgeon (Fase 3)

Dalla pagina del progetto, **Context Surgeon** apre l'albero dei file con la heatmap dei token: ogni checkbox decide se un file o una directory resta visibile agli agenti. Si parte dal preset aggressivo (dipendenze, build, lockfile, generati, minificati, log) più le regole di sicurezza bloccate (`.env*`, chiavi, `.npmrc`…); i suggerimenti propongono asset binari, file di dati voluminosi e codice generato. Il pannello laterale mostra il risparmio in token e dollari, la differenza rispetto al profilo salvato e gli avvisi quando si nasconde un file centrale nel grafo. Ogni workspace può aggiungere un overlay al profilo di progetto.

A ogni run il profilo diventa:

- regole `permissions.deny` con percorsi assoluti nel `settings.json` della run (il progetto non viene modificato);
- un hook HTTP `PreToolUse` che blocca `Read`, `Grep`, `Glob`, `LS` e comandi Bash come `cat`, `head`, `grep -r` diretti a percorsi esclusi; ogni blocco compare nel feed della run, nel registro di audit e nel contatore `guardDenials`;
- un filtro su pacchetto di contesto, mappa e tool MCP.

**Measure** confronta la stima con un tokenizer di riferimento (`count_tokens` se c'è una API key, altrimenti `o200k_base` in locale), **Calibrate** adatta lo stimatore al progetto, **Export** scrive il `.claudesignore` per chi usa Claude Code fuori da Onyx. Sul benchmark (`pnpm --filter @onyx/api bench:surgeon <cartella…>`) l'errore sul risparmio del preset, dopo la calibrazione, va dallo 0,0% al 12,5% su hono, httpx, fastify e Onyx.

## Progetti da GitHub

**New project** (o **Import from GitHub** nella console) apre la scheda *From GitHub*: incolla un token personale e scegli uno dei tuoi repository, anche privati, oppure sfoglia i repository pubblici di un utente senza token. Onyx lo clona in `ONYX_PROJECTS_DIR/<nome>`, lo registra con i workspace di dominio e avvia l'indicizzazione; la scheda *Local folder* registra invece una cartella già presente sul server.

Il token consigliato è *fine-grained* con **Contents** sui repository che vuoi usare ([crealo qui](https://github.com/settings/personal-access-tokens/new)): in sola lettura basta per importare, in lettura e scrittura serve per pubblicare i branch; un token classico richiede lo scope `repo`. Viene salvato nel database di Onyx e non è mai restituito dall'API; in alternativa si imposta `ONYX_GITHUB_TOKEN` nell'ambiente del servizio.

## Account Claude Max, Roadmap e branch su GitHub

- **Settings → Claude account → Sign in with Claude**: si apre un terminale nella pagina con `claude setup-token`; apri il link, accedi con il tuo account Claude Max, incolla il codice nel terminale e premi Invio. Onyx salva il token e lo usa per tutti gli agenti (*Test connection* lo verifica). In alternativa puoi incollare il token generato con `claude setup-token` su un altro computer.
- **Roadmap**: dalla pagina del progetto, *Roadmap* fa studiare il progetto a Claude in sola lettura e propone le prossime attività nella colonna *Suggested* di un Kanban. Trascini quello che ti interessa in *To do*, poi in *In progress* per farlo eseguire a un agente; i task finiti arrivano in *Done*.
- **Branch e push**: il pannello Git mostra i file modificati dagli agenti. *Commit and push to GitHub* crea un branch nuovo separato da `main` (es. `onyx/20261005-coprire-login-con-test`), fa il commit e lo pubblica su GitHub, con il link per aprire la pull request. Serve un token GitHub con **Contents: read and write**; nome ed email dei commit si impostano in Settings.

## Model Router e compartimenti (Fase 4)

Ogni run passa dal router, che sceglie il tier più economico adatto al task: prima le regole (pagina **Router**, modificabili e per progetto), poi un punteggio euristico su blast radius, cross-domain, file toccati, parole chiave architetturali, dimensione del contesto e fallimenti precedenti, infine, con una API key, il classificatore Haiku 4.5 quando l'euristica è incerta. La decisione e la sua motivazione compaiono nel feed della run e nella pagina del task; se una run finisce i turni, il task torna in coda sul tier superiore. Il **simulatore** prova un task senza eseguirlo; il riquadro dei costi confronta il costo per task completato con quello che si sarebbe speso con tutto su Opus.

Ogni workspace è un compartimento con la sua catena di sessioni Claude:

- quando un altro workspace modifica file, la sessione successiva parte da zero con una **nota di handoff** (≤ 1.500 token) su cosa è cambiato e cosa resta aperto, secondo la strategia `HARD`, `HANDOFF` o `SOFT`;
- oltre `maxSessionTokens` la sessione ruota con la nota;
- i file degli altri workspace sono in sola lettura (anche via Bash);
- un task con workspace "Auto" va al workspace che possiede i suoi file; se nessun workspace li possiede (o non ci sono file target) va a quello di cui parla il prompt (interfaccia, API, database, deploy…), altrimenti al primo. Il dialogo del task mostra quale sceglierà e perché.

Dalla pagina del workspace si apre un **terminale interattivo** di Claude Code (xterm.js) nello stesso compartimento: Onyx inietta `/compact` quando il contesto supera il limite e `/clear` con la nota di handoff dopo un cambio di dominio; i pulsanti fanno lo stesso a richiesta. La catena delle sessioni mostra perché ognuna è finita e la nota con cui è partita la successiva.

## TDD Auto-Loop (Fase 5)

Dalla pagina di un task, **Start TDD loop** fa lavorare l'agente finché i test non sono verdi, senza toccare i test:

1. Onyx esegue i test correlati ai file del task (`vitest related` / `jest --findRelatedTests`), poi l'intera suite, poi i gate (`tsc --noEmit` se c'è un `tsconfig.json`, lint se attivato). L'output a colori scorre nel terminale della pagina.
2. Se qualcosa fallisce, l'agente riceve solo un **digest** compatto (≤ 4.000 token): test, messaggio, diff atteso/ricevuto, frame del progetto e ±3 righe di codice. Riprende la stessa sessione del workspace.
3. I file di test, gli snapshot, i mock e le configurazioni di Vitest/Jest sono in sola lettura: le regole di permesso e l'hook di guardia bloccano modifiche e comandi di test; se l'agente li cambia comunque (per esempio con uno script), Onyx li ripristina dalla copia fatta all'avvio e registra la violazione.
4. Dopo 2 tentativi senza progressi il modello sale di tier (Sonnet → Opus); se gli stessi fallimenti tornano 3 volte di fila dopo l'escalation il loop si ferma come *Stalled*. Ci sono anche un limite di tentativi (default 6), un budget in dollari e un timeout per ogni esecuzione dei test.

Il runner viene rilevato da `package.json` e dai file di configurazione; nella pagina del workspace si possono fissare il runner e il comando che lo lancia (es. `pnpm --filter web exec vitest`). Durante il loop il workspace è riservato: altre run, terminali e pubblicazioni aspettano.

## Orchestrator multi-agente (Fase 6)

Dalla pagina di un progetto, **Plan a feature** fa scomporre una funzionalità in task per workspace:

1. Claude studia il progetto in sola lettura (modello del tier Architect) e restituisce un piano strutturato: task, workspace, dipendenze, file probabili, criteri di accettazione e tier suggerito. Il piano compare come grafo a passi e **non parte finché non lo approvi** nella pagina del piano o in **Approvals**.
2. All'approvazione Onyx crea il branch di lavoro `onyx/plan-AAAAMMGG-<feature>` da quello corrente. Ogni task riceve un git worktree proprio (nella directory dati di Onyx, con le dipendenze collegate) e una sessione nuova; i task indipendenti girano in parallelo, fino al numero di agenti scelto.
3. Se il progetto ha Vitest o Jest, ogni task passa il TDD loop nel suo worktree; poi Onyx fa il commit e lo unisce al branch di lavoro, un merge alla volta. Un conflitto non viene mai risolto da solo: in **Approvals** scegli se riprovare il merge (dopo averlo sistemato sul branch del task) o scartare il task.
4. Alla fine la suite completa e `tsc` girano sul branch unito. `main` non cambia; dalla pagina del piano **Push the branch** spinge il branch di lavoro su GitHub e offre il link per la pull request.

Un piano fermato da un errore o da un riavvio si riprende con **Resume**: i task già uniti restano, gli altri ripartono. In **Settings → Budgets** si impostano limiti di spesa globali o per progetto (al giorno, al mese o totali): oltre la soglia soft le nuove run aspettano un'approvazione, alla soglia hard vengono rifiutate e quelle in corso si fermano. Gli agenti `architect` e `builder` hanno anche sotto-agenti nativi di Claude Code (`explorer`, `test-writer`, `reviewer`).

## Hardening (Fase 7)

- **Backup**: Onyx copia il database ogni giorno (e prima di ogni aggiornamento o ripristino), verifica ogni copia e tiene le ultime 14. Da **Settings → Backups** si fa un backup, lo si verifica o lo si scarica; `onyx-restore` lo ripristina.
- **Token cifrati**: i token di Claude e GitHub salvati da Settings sono cifrati nel database; la chiave sta in `secret.key` nella cartella dei dati. Copiala insieme al backup se ripristini su un'altra macchina.
- **Claude Code**: `onyx-update-claude` aggiorna la CLI e verifica che sia compatibile; se non lo è, Settings dice quali opzioni mancano.
- **Tastiera**: **Ctrl+K** (⌘K) apre la palette dei comandi per pagine, progetti, task e azioni; *Skip to content* porta al contenuto.
- **Movimento**: l'orb di ogni agente mostra lo strumento in uso, il TDD loop lampeggia sui test rossi e si illumina al verde; con *riduci movimento* attivo nel sistema le animazioni restano ferme.

La guida operativa completa (dati, backup, ripristino, aggiornamenti, sicurezza, problemi comuni) è in [`docs/operations.md`](./docs/operations.md).

## Accesso dalla rete

Onyx è raggiungibile da ogni dispositivo della LAN, senza configurare indirizzi:

| Modalità | URL |
|---|---|
| Sviluppo (`pnpm dev`) | `http://<ip>:3000` (UI su `0.0.0.0:3000`, API su `0.0.0.0:4000`) |
| Produzione (container) | `http://<ip>` oppure `http://onyx.local` (Caddy su `:80`, nome pubblicato via mDNS) |

La console mostra gli indirizzi utilizzabili nella scheda "On your network". Le richieste sono accettate da qualsiasi IP o nome di rete locale (`.local`, `.lan`, nomi senza dominio…); un dominio pubblico va aggiunto a `ONYX_ALLOWED_ORIGINS`. Il firewall di esempio (`deploy/nftables/nftables.conf`) ammette tutte le reti private. Dettagli in `architecture.md` §11.8.

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
