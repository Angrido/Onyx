# Onyx

Pannello di controllo orchestratore per **Claude Code**: accoda task, avvia agenti headless come processi figli, ne mostra l'output in tempo reale e traccia token e costi. Gira in un container LXC Debian 13 su Proxmox VE.

L'architettura completa (topologia, schema dati, rete, roadmap) è in [`architecture.md`](./architecture.md).

## Stato

| Fase | Contenuto | Stato |
|---|---|---|
| 0 | Infrastruttura LXC e rete | Documentata in `architecture.md` §10–11, script in `deploy/` |
| 1 | Monorepo, database, Agent Runtime, API, console web | **Completata** |
| 2–7 | Lean-ctx, Graphify, Context Surgeon, Model Router, TDD Auto-Loop, orchestrazione multi-agente | Da fare |

## Requisiti

- Node.js 22 LTS (≥ 22.18, serve il type stripping nativo per lo stub di Claude)
- pnpm 10 (`corepack enable`)
- Claude Code CLI solo per le run reali; per sviluppo e test basta lo stub incluso

## Avvio rapido in sviluppo

```bash
corepack enable
pnpm install
./scripts/dev-setup.sh stub
pnpm dev
```

Apri http://localhost:3000, crea l'utente operatore, registra il progetto demo (`.onyx-data/projects/demo`) e lancia un task.

In modalità `stub` gli agenti sono simulati da `packages/agent-runtime/bin/claude-stub.ts`, che rigioca trascrizioni `stream-json` registrate: nessun token consumato. Nel prompt si può scegliere lo scenario con un marcatore, ad esempio `[stub:hang]` (run che non termina, per provare l'abort), `[stub:crash]`, `[stub:error-max-turns]`, `[stub:quick]`.

Per usare Claude Code reale: `./scripts/dev-setup.sh real`, poi imposta **una sola** credenziale tra `ANTHROPIC_API_KEY` e `CLAUDE_CODE_OAUTH_TOKEN` in `apps/api/.env`.

## Comandi

| Comando | Effetto |
|---|---|
| `pnpm dev` | API (`:4000`, tsx watch) e web (`:3000`, Next.js dev) in parallelo |
| `pnpm test` | Test di tutti i pacchetti (Vitest) |
| `pnpm typecheck` | TypeScript strict su tutti i pacchetti |
| `pnpm lint` | ESLint, inclusa la regola `onyx/no-comments` |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm build` | Bundle API (tsup) e build standalone Next.js |
| `pnpm db:migrate` | `prisma migrate deploy` sul `DATABASE_URL` corrente |

## Struttura

| Percorso | Ruolo |
|---|---|
| `apps/api` | Fastify 5: auth, progetti, workspace, task, run, WebSocket, scheduler, telemetria |
| `apps/web` | Next.js 15: console, progetti, task, run live, telemetria |
| `packages/contracts` | Schemi zod condivisi: REST, WebSocket, eventi `stream-json` e normalizzatore |
| `packages/db` | Schema Prisma 7 + SQLite, migrazioni, seed |
| `packages/agent-runtime` | Spawn della CLI, parser `stream-json`, pool con abort sul process group, stub |
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
