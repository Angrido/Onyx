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
| 5–7 | TDD Auto-Loop, orchestrazione multi-agente, hardening | Da fare |

## Requisiti

- Linux (Debian, Ubuntu, Fedora, Arch, openSUSE) o macOS, x64 o arm64
- Node.js 22 LTS (≥ 22.18, serve il type stripping nativo per lo stub di Claude)
- pnpm 10.28 (la versione fissata in `package.json`)
- git, curl, un compilatore C/C++ con make e Python 3 per i binding nativi quando manca un binario precompilato
- Claude Code CLI solo per le run reali; per sviluppo e test basta lo stub incluso

Non serve installarli a mano: lo fa `scripts/install.sh`.

## Avvio rapido in sviluppo

```bash
git clone https://github.com/Angrido/Onyx.git
cd Onyx
./scripts/install.sh
pnpm dev
```

`scripts/install.sh` installa solo ciò che manca e si può rilanciare quando si vuole:

| Passo | Cosa fa |
|---|---|
| Pacchetti di sistema | git, curl, certificati, toolchain C/C++, Python 3, SQLite con `apt`, `dnf`, `pacman` o `zypper`; su macOS controlla gli Xcode Command Line Tools |
| Node.js 22 | Se manca o è più vecchio di 22.18: da NodeSource su Debian/Ubuntu, altrimenti (o se NodeSource non è raggiungibile) la build ufficiale di nodejs.org verificata con SHA-256, in `/usr/local` oppure in `~/.local` senza permessi di amministratore |
| pnpm | Attiva con corepack la versione fissata in `package.json` (ripiego: `npm install -g`) |
| Claude Code | Solo con `--with-claude` o in modalità `real` |
| Progetto | `pnpm install --frozen-lockfile` e `scripts/dev-setup.sh` (database, progetto demo, `.env`) |

Opzioni: `./scripts/install.sh real` per usare Claude Code vero, `--tools-only` per installare solo gli strumenti, `--with-claude` per aggiungere la CLI. Va lanciato come utente normale: chiede `sudo` solo per i pacchetti di sistema. Se installa Node in una cartella che non è in testa al `PATH`, alla fine stampa la riga da aggiungere al profilo della shell.

Apri http://localhost:3000 **oppure, da qualsiasi altro dispositivo della rete, `http://<ip-della-macchina>:3000`** (lo script stampa gli indirizzi). Crea l'utente operatore, registra il progetto demo (`.onyx-data/projects/demo`) e lancia un task.

In modalità `stub` gli agenti sono simulati da `packages/agent-runtime/bin/claude-stub.ts`, che rigioca trascrizioni `stream-json` registrate: nessun token consumato. Nel prompt si può scegliere lo scenario con un marcatore, ad esempio `[stub:hang]` (run che non termina, per provare l'abort), `[stub:crash]`, `[stub:error-max-turns]`, `[stub:quick]`, `[stub:mcp]`, che avvia il vero server MCP `onyx` della run ed espande il primo simbolo del pacchetto di contesto, oppure `[stub:guard] read:dist/app.js grep:logs bash:{cat .env}`, che prova quelle letture passando dal vero hook di guardia.

Per usare Claude Code reale: `./scripts/install.sh real`, poi imposta **una sola** credenziale tra `ANTHROPIC_API_KEY` e `CLAUDE_CODE_OAUTH_TOKEN` in `apps/api/.env`. `./scripts/dev-setup.sh [stub|real]` rigenera solo `.env`, database e progetto demo.

## Contesto Onyx (Fase 2)

Ogni progetto viene indicizzato alla registrazione e dopo ogni run: tree-sitter estrae simboli e import, repomix enumera i file e segnala quelli con segreti, Graphify costruisce il grafo delle importazioni e ne calcola centralità, cicli e blast radius. A ogni run l'agente riceve:

- nel system prompt, una mappa compatta del progetto (file più centrali con i loro export);
- nel primo messaggio, un pacchetto di contesto: i file target completi, gli estratti dei simboli importati dalle dipendenze, le righe in cui i dipendenti usano i target;
- il server MCP `onyx` con `expand_symbol`, `file_skeleton`, `deps` e `search_symbols`, per leggere solo ciò che serve.

Sui benchmark (`pnpm --filter @onyx/graphify bench <cartella…>`) il pacchetto costa dal 46% all'81% in meno del contesto naive "file target + dipendenze dirette". La pagina del progetto mostra lo stato dell'indice e porta alla vista Graph; la console della run mostra il contesto inviato e le chiamate ai tool `onyx`.

## Context Surgeon (Fase 3)

Dalla pagina del progetto, **Context Surgeon** apre l'albero dei file con la heatmap dei token: ogni checkbox decide se un file o una directory resta visibile agli agenti. Si parte dal preset aggressivo (dipendenze, build, lockfile, generati, minificati, log) più le regole di sicurezza bloccate (`.env*`, chiavi, `.npmrc`…); i suggerimenti propongono asset binari, file di dati voluminosi e codice generato. Il pannello laterale mostra il risparmio in token e dollari, la differenza rispetto al profilo salvato e gli avvisi quando si nasconde un file centrale nel grafo. Ogni workspace può aggiungere un overlay al profilo di progetto.

A ogni run il profilo diventa:

- regole `permissions.deny` con percorsi assoluti nel `settings.json` della run (il progetto non viene modificato);
- un hook HTTP `PreToolUse` che blocca `Read`, `Grep`, `Glob`, `LS` e comandi Bash come `cat`, `head`, `grep -r` diretti a percorsi esclusi; ogni blocco compare nel feed della run, nel registro di audit e nel contatore `guardDenials`;
- un filtro su pacchetto di contesto, mappa e tool MCP.

**Measure** confronta la stima con un tokenizer di riferimento (`count_tokens` se c'è una API key, altrimenti `o200k_base` in locale), **Calibrate** adatta lo stimatore al progetto, **Export** scrive il `.claudesignore` per chi usa Claude Code fuori da Onyx. Sul benchmark (`pnpm --filter @onyx/api bench:surgeon <cartella…>`) l'errore sul risparmio del preset, dopo la calibrazione, va dallo 0,0% al 12,5% su hono, httpx, fastify e Onyx.

## Progetti da GitHub

**New project** (o **Import from GitHub** nella console) apre la scheda *From GitHub*: incolla un token personale e scegli uno dei tuoi repository, anche privati, oppure sfoglia i repository pubblici di un utente senza token. Onyx lo clona in `ONYX_PROJECTS_DIR/<nome>`, lo registra con i workspace di dominio e avvia l'indicizzazione; la scheda *Local folder* registra invece una cartella già presente sul server.

Il token consigliato è *fine-grained* con accesso in sola lettura a **Contents** sui repository che vuoi importare ([crealo qui](https://github.com/settings/personal-access-tokens/new)); un token classico richiede lo scope `repo` per i privati. Viene salvato nel database di Onyx e non è mai restituito dall'API; in alternativa si imposta `ONYX_GITHUB_TOKEN` nell'ambiente del servizio.

## Model Router e compartimenti (Fase 4)

Ogni run passa dal router, che sceglie il tier più economico adatto al task: prima le regole (pagina **Router**, modificabili e per progetto), poi un punteggio euristico su blast radius, cross-domain, file toccati, parole chiave architetturali, dimensione del contesto e fallimenti precedenti, infine, con una API key, il classificatore Haiku 4.5 quando l'euristica è incerta. La decisione e la sua motivazione compaiono nel feed della run e nella pagina del task; se una run finisce i turni, il task torna in coda sul tier superiore. Il **simulatore** prova un task senza eseguirlo; il riquadro dei costi confronta il costo per task completato con quello che si sarebbe speso con tutto su Opus.

Ogni workspace è un compartimento con la sua catena di sessioni Claude:

- quando un altro workspace modifica file, la sessione successiva parte da zero con una **nota di handoff** (≤ 1.500 token) su cosa è cambiato e cosa resta aperto, secondo la strategia `HARD`, `HANDOFF` o `SOFT`;
- oltre `maxSessionTokens` la sessione ruota con la nota;
- i file degli altri workspace sono in sola lettura (anche via Bash);
- un task con workspace "Auto" va al workspace che possiede i suoi file.

Dalla pagina del workspace si apre un **terminale interattivo** di Claude Code (xterm.js) nello stesso compartimento: Onyx inietta `/compact` quando il contesto supera il limite e `/clear` con la nota di handoff dopo un cambio di dominio; i pulsanti fanno lo stesso a richiesta. La catena delle sessioni mostra perché ognuna è finita e la nota con cui è partita la successiva.

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
| `./scripts/install.sh [stub\|real]` | Installa ciò che manca (pacchetti, Node.js, pnpm, Claude Code) e prepara il progetto |
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
| `apps/web` | Next.js 15: console, progetti, workspace con terminale, Context Surgeon, grafo, router, task, run live, telemetria |
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
./deploy/scripts/build.sh /tmp/onyx-release
./deploy/scripts/release.sh /tmp/onyx-release
```
