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

**Is it working?** elenca i controlli: contesto attivo, quota di run che ricevono un pacchetto, peso delle riletture, stima netta positiva, stato dell'esperimento. Cache dei prompt (misurata) e routing dei modelli (stimato) sono in fondo alla pagina, separati, perché non dipendono dal pacchetto.

Nella console di una run il risparmio diventa netto a fine run (*Net saving*) e una riga indica i file riletti; le run di controllo sono marcate *control*.
