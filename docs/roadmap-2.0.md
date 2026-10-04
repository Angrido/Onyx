# Onyx 2.0 — Piano

Obiettivo: fare di Onyx il centro di controllo di tutti i progetti, spendendo meno token per lo stesso lavoro.

Vincoli: web in LAN, CLI headless, un solo operatore, abbonamento Claude Max. Aperant (AGPL-3.0) è solo una fonte di idee: nessun codice né testo copiato.

Il piano parte dall'audit (`docs/audit-2.0.md`): molti risparmi di token sono correzioni di sprechi trovati lì.

## Principi

1. **Ogni risparmio è misurato o dichiarato stimato.** La pagina Savings avrà un *registro dei risparmi*: una riga per funzione con metodo (A/B, prima/dopo su run reali, stima), periodo, valore e intervallo. Senza dati reali una voce resta *stimata*.
2. **Prima misurare, poi correggere.** Dove l'effetto dipende da come si comporta la CLI reale (per esempio la cache dei prompt), la telemetria arriva prima della correzione, così il "prima" esiste.
3. **Gratis prima del modello.** Indice, grafo, git e analisi statica rispondono prima; un modello entra solo se serve, e sempre il più economico che basta.
4. **I test non spendono token.** Lo stub imita l'uso reale dei token (anche la cache), così la pipeline di misura si prova senza Claude.
5. **Ogni milestone è completa:** migrazione (nominata dopo l'ultima esistente), contratti, API, UI, test, E2E desktop e 375 px, Lighthouse e axe, documentazione, CI verde.

## Come leggere le stime

- I token si contano come **token di input equivalenti**: un token letto dalla cache vale 0,1, uno scritto in cache 1,25, uno di output 5 (rapporti del listino Anthropic).
- Con Claude Max non si paga a token, ma l'uso si consuma più in fretta con l'output, la scrittura in cache e Opus.
- Le cifre sono **ordini di grandezza** ricavati dal codice e dalle dimensioni tipiche (pacchetto fino a 24.000 token, mappa fino a 4.000, storia di una sessione 20.000–80.000). Il numero vero lo danno le misure indicate.
- **Costo:** S ≤ 1 giorno, M 2–4 giorni, L 1–2 settimane di lavoro mio.

## Riepilogo delle milestone (ordinate per impatto)

| # | Milestone | Perché qui | Effetto sui token | Costo |
|---|---|---|---|---|
| 1 | Sprechi di token: misura e correzioni | Gli sprechi più grandi sono bug, a costo quasi zero | **Alto**: da decine a centinaia di migliaia di token per sessione ripresa e per TDD loop (stima, da misurare) | M |
| 2 | Limiti di Claude Max e comandi per stack | Con Max il vincolo vero è la finestra di 5 ore e quella settimanale | Medio: meno run sprecate su comandi rifiutati o tagliate dai limiti | M |
| 3 | Sandbox degli agenti e *Allow and continue* sicuro | Prerequisito per gestire molti progetti e importare issue (input non fidato) | Basso, ma meno turni persi sui falsi positivi del guard | L |
| 4 | Mission control multi-progetto | Il cuore del "centro di controllo" | Indiretto: coda e priorità usano meglio la quota | L |
| 5 | Memoria di progetto | Riduce l'esplorazione nelle sessioni nuove | Medio-alto, da dimostrare con A/B | M |
| 6 | Esperimenti sul contesto: target come L2, output conciso, raggruppamento | Leve che vanno decise con l'A/B, non a intuito | Medio, misurato | M |
| 7 | GitHub (issue, PR, controlli) e changelog | Chiude il ciclo issue → PR senza uscire da Onyx | Neutro (deterministico dove possibile) | M |
| 8 | Pipeline con QA e merge assistito | Qualità prima del merge | Costa token (QA facoltativo); ne risparmia sui rifacimenti | L |
| 9 | Insights e Ideation | Analisi gratuite, poi un modello economico | Basso costo per risposta, mostrato | L |
| 10 | Italiano, design, onboarding, accessibilità | Usabilità quotidiana | Neutro | L |
| 11 | Affidabilità: recupero, salute, log, diagnostica | Meno interventi manuali | Basso: meno run ripetute dopo errori | M |

Le milestone 1–3 sono quelle che consiglio di fare per prime e in quest'ordine. Dalla 4 in poi l'ordine si può cambiare.

---

## Milestone 1 — Sprechi di token: misura e correzioni

| Voce | Valore per te | Effetto sui token (stima · misura) | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **1.1 Telemetria della cache persa** | Vedi per ogni run quanta cache si è persa e perché | Nessun risparmio diretto: fornisce il "prima". **Misura:** `cache_creation_input_tokens` del primo turno di ogni run ripresa (già nello stream-json), classificato per motivo: sessione nuova, modello cambiato, prefisso cambiato (hash di primer e mappa), cache scaduta (pausa oltre il TTL) | S | Lo stub oggi non simula la cache: va esteso (B27) | Unità sulla classificazione; integrazione con lo stub esteso (ripresa entro e oltre il TTL, prefisso cambiato) |
| **1.2 Prefisso stabile per sessione** (A16) | Le sessioni riprese, compresi i tentativi del TDD loop, leggono la storia dalla cache | **Stima:** in una ripresa entro il TTL con H token di storia, da ≈1,25·H a ≈0,1·H, cioè circa 1,15·H risparmiati. Con H = 40.000 sono circa 46.000 token equivalenti per ripresa; un TDD loop con 4 tentativi ne risparmia 100–200.000. **Incertezza:** se Claude Code stesso cambia il system prompt a ogni ripresa (per esempio con lo stato git), il guadagno è minore; lo dirà la 1.1. **Misura:** prima/dopo sul dato della 1.1, per tipo di run | S | La mappa congelata invecchia in una sessione lunga: la rotazione per pressione di contesto la rinnova | Unità: primer identico byte per byte tra le run della stessa sessione; integrazione: mappa cambiata solo per una sessione nuova |
| **1.3 Pacchetto non rimandato alle riprese** (A17) | Follow-up, *Allow and continue*, escalation e tentativi del TDD non ripagano il pacchetto | **Stima:** da 3.000 a 24.000 token per run ripresa. **Misura:** token consegnati per run ripresa (oggi uguali a quelli della prima run, dopo solo il delta) e input del primo turno | S | Se l'agente ha perso il contesto per un `/compact`, serve il pacchetto: lo si rimanda dopo una compattazione | Integrazione: ripresa senza pacchetto, ripresa dopo la modifica di un target con il solo delta |
| **1.4 Verifica dei nodi del piano con i fallimenti di base** (A2) | I piani paralleli funzionano su progetti con test già rossi | **Stima:** per ogni nodo colpito evita fino a 3 tentativi inutili più un'escalation a Opus, cioè 60–200.000 token. **Misura:** tentativi per nodo e token per piano completato, prima/dopo | M | Un test di base rotto che il nodo dovrebbe correggere va comunque tenuto: si ignorano solo quelli fuori dai suoi file | Integrazione con il caso dell'E2E (`fix-add` / `format`); suite finale sul branch unito sempre completa |
| **1.5 Falsi positivi del guard che fermano le run** (M11–M13) | Meno run bloccate su `find`, `grep -C`, `console.log` | **Stima:** ogni rifiuto falso costa almeno un turno, spesso la run intera. **Misura:** rifiuti del guard per regola e per run, prima/dopo, e quanti sono seguiti da un nuovo tentativo dello stesso comando | M | Ridurre i falsi positivi non deve aprire falsi negativi: test con un indice come quello di produzione | Tabelle di casi positivi e negativi in `ignore-compiler` (comprese le prove dell'audit) |
| **1.6 Stub realistico sui token** (B27) | La misura del risparmio si prova senza Claude | Strumento | S | L'uso simulato non deve diventare una "misura": in Savings le run dello stub sono escluse o marcate | Unità dello stub; l'esperimento A/B con lo stub deve vedere la differenza simulata |
| **1.7 Registro dei risparmi** in Savings | Una sola tabella: cosa fa risparmiare, quanto, misurato o stimato | Strumento | S | — | E2E della pagina, axe |

Per chiudere la milestone: le voci 1.2 e 1.3 compaiono nel registro come *stimate* finché non ci sono run reali, poi come *misurate* (prima/dopo).

## Milestone 2 — Limiti di Claude Max e comandi per stack

| Voce | Valore per te | Effetto sui token (stima · misura) | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **2.1 Quota della finestra di 5 ore e settimanale** | In testata e in Telemetry: quanto resta, quando si azzera, quale limite è più vicino | Non riduce i token; evita run tagliate a metà dal limite, che si pagano senza risultato. **Misura:** run finite per limite, prima/dopo | M | Il formato di `rate_limit_event` va confermato con una trascrizione reale (registratore `--yes`, lo lanci tu): il parser sarà tollerante e mostrerà "sconosciuto" invece di valori inventati | Fixture sintetica e, quando c'è, registrata; stub esteso con lo scenario `[stub:rate-limit]` |
| **2.2 Avvisi prima dell'esaurimento** | Avviso all'80% e al 95% (soglie modificabili), in UI e nelle notifiche della milestone 4 | — | S | — | Unità sulle soglie |
| **2.3 Rinvio dei task non urgenti** | Ogni task ha "può aspettare". Sopra una soglia della finestra, i task che possono aspettare restano in coda fino al reset; gli urgenti partono | Sposta la spesa, non la riduce; evita di consumare la quota che ti serve. **Misura:** run rimandate e partite dopo il reset | M | Coda che si blocca se il reset non arriva o non è noto: timeout e sblocco manuale | Scheduler: ammissione con quota simulata (`go`/`hold`) come per i budget (ADR-041) |
| **2.4 Comandi consentiti in base allo stack** | Alla registrazione Onyx rileva Node e il gestore (npm, pnpm, yarn, bun), Python (pip, uv, poetry, pytest), Go, Rust, make, Docker, e propone comandi precisi (`pnpm install`, `pnpm run build`, `pytest`, `go test ./...`…), non programmi interi. Mai interpreti con `-c`/`-e` | **Stima:** ogni comando rifiutato costa una run in più per *Allow and continue* (pacchetto e storia), 10–40.000 token. **Misura:** rifiuti per run e run di continuazione per progetto, prima/dopo | M | Una lista troppo larga riduce la sicurezza: rischiosi sempre deselezionati, coerenti con la milestone 3 | Unità sul rilevamento con progetti di esempio (Node, Python, Go, monorepo misti); integrazione sulla registrazione |
| **2.5 Workspace proposti dalla struttura reale** (M30) | Compartimenti, recinti e note di handoff che corrispondono al progetto (`src/`, `web/`, `server/`…) | **Stima:** meno rotazioni e note inutili; con i workspace giusti il pacchetto è più mirato. **Misura:** quota di task "Auto" che finiscono nel workspace di default, prima/dopo | M | Proposte sbagliate: si confermano prima del salvataggio | Unità con alberi di progetto tipici |

## Milestone 3 — Sandbox degli agenti e *Allow and continue* sicuro

| Voce | Valore per te | Effetto sui token | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **3.1 Utente separato per gli agenti** (A1) | Un agente ingannato da un'issue o da un file del repository non arriva a chiave, database, token o sessione operatore. È il vero confine di sicurezza; oggi il guard non lo è | Nessuno | L | Proposta: utente `onyx-agent` e gruppo condiviso sui progetti, con spawn come altro utente (`AmbientCapabilities=CAP_SETUID CAP_SETGID` solo per l'API). In alternativa bubblewrap, che però nell'LXC richiede `nesting=1`. Effetti: proprietà dei file, `safe.directory` di git, `node_modules` scrivibili. In sviluppo resta disattivabile | Integrazione in CI con un job che può creare utenti (sudo sul runner): l'agente stub prova a leggere `secret.key`, il database e `/proc/<api>/environ` e fallisce; scrive nel progetto e riesce |
| **3.2 Guard robusto** (A3–A8, B13–B16) | Il guard torna a fare il suo lavoro principale, cioè tenere fuori dal contesto ciò che non serve, con meno buchi e meno falsi positivi | Indiretto: meno letture di file esclusi, meno turni persi | M | Con la sandbox il guard non è più l'ultima difesa: si privilegiano i falsi positivi bassi | Indice come quello di produzione; tutte le prove dell'audit come casi di test |
| **3.3 *Allow and continue* sicuro** (A9, A15) | Regole proposte solo da una lista sicura, nessuna preselezione per wrapper e interpreti, il comando che ha generato ogni regola, regole per agente o per task con scadenza, rifiuti distruttivi applicati anche dall'hook | Nessuno | M | Più conferme da dare: la proposta per stack (2.4) le riduce | Unità su `suggestRules`; integrazione: `/allow` rifiuta regole non proposte |
| **3.4 Verifica a posteriori del recinto** (A8) | Le scritture fuori dal workspace che sfuggono al parser vengono annullate, come per i test nel TDD | Nessuno | M | File grandi: hash solo dei file recintati che esistono | Integrazione con `node -e` che scrive in un altro workspace |

## Milestone 4 — Mission control multi-progetto

| Voce | Valore per te | Effetto sui token | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **4.1 Home "Mission control"** | Una scheda per progetto: branch, modifiche, ahead/behind; agenti attivi e coda; ultimo TDD e ultimo esito; spesa e token di oggi e della settimana; approvazioni in attesa; stato di salute. Filtri e ordinamento | Indiretto | L | Con molti progetti, `git status` costa: cache di 30 s, aggiornamento quando cambia qualcosa | Una sola rotta aggregata con SQL (chiude A14, M21, B20); E2E con 20 progetti; Lighthouse e axe |
| **4.2 Coda globale con priorità e concorrenza per progetto** | Riordini la coda tra progetti; un progetto non occupa tutti gli slot | Usa meglio la quota (milestone 2) | M | Starvation: anzianità come spareggio | Scheduler: priorità, limiti per progetto, M6 (run doppie) risolto qui |
| **4.3 Griglia dei terminali-agente** | Fino a N terminali o run dal vivo in una griglia (N configurabile, predefinito = slot); "inietta contesto del task" in un clic | Dipende dall'uso: più agenti in parallelo consumano la finestra di 5 ore più in fretta, e la griglia lo mostra | M | Memoria del browser con molti xterm: virtualizzazione e pausa dei pannelli non visibili | E2E con 4 terminali stub; A12 (sessione persa nei terminali) risolto qui |
| **4.4 Notifiche** | Run finite o bloccate, approvazioni, budget, quota. Web Push dal browser e, in opzione, ntfy o Telegram (solo in uscita). Tutto disattivabile | — | M | Web Push richiede HTTPS (contesto sicuro): funziona con la CA interna di Caddy, non su `http://<ip>`. Nessun canale in ingresso: niente comandi da Telegram, per non aprire Onyx fuori dalla LAN | Unità sul formato dei messaggi; integrazione con un server ntfy finto |
| **4.5 Ricerca globale** | Task, run, risultati e file di tutti i progetti, dalla palette | — | M | Dimensione dell'indice FTS: solo testi brevi e percorsi | Unità FTS5; E2E dalla palette |
| **4.6 Prestazioni** (A13, M20–M24) | Interfaccia fluida anche con molti progetti e run lunghe | Nessuno | M | — | Benchmark con 20.000 run e 2 milioni di `TokenLog` sintetici |

## Milestone 5 — Memoria di progetto

| Voce | Valore per te | Effetto sui token (stima · misura) | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **5.1 Fatti stabili dalle run** | Comandi che funzionano, convenzioni, file chiave, insidie: raccolti in modo deterministico (comandi riusciti, file letti spesso, errori ricorrenti, test e gate rilevati), ognuno con la sua fonte (run, file, data) | — | M | Fatti sbagliati che si propagano: scadenza, conferma, fonte sempre visibile | Unità sull'estrazione da trascrizioni stub |
| **5.2 Curatela e limite** | Compattati sotto un limite di token (predefinito 800) e modificabili da UI; i vecchi scadono | — | S | — | E2E della pagina |
| **5.3 Iniezione nel primer** | Nel primer congelato della sessione (1.2), quindi senza rompere la cache | **Stima:** −10/−30% di file letti e turni nelle sessioni nuove. **Misura:** braccio A/B "con / senza memoria" sulle sessioni nuove (file letti, turni, token di input, esito) | S | Se la memoria non ripaga (contesto in più, esplorazione uguale), lo dice l'A/B e la si spegne | Integrazione con l'esperimento a più bracci |

## Milestone 6 — Esperimenti sul contesto

| Voce | Valore per te | Effetto sui token (stima · misura) | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **6.1 Esperimento a più bracci** | L'A/B esistente (ADR-050) diventa A/B/n: controllo, pacchetto attuale e varianti | Strumento | M | Più bracci servono più run per un verdetto: un braccio alla volta oltre al controllo | Unità sull'assegnazione e sui test statistici con più gruppi |
| **6.2 Target da modificare come L2** | Claude Code legge sempre un file prima di modificarlo, quindi i target che verranno modificati si consegnano come firme (L2); quelli solo da leggere restano completi | **Stima:** il pacchetto perde i token dei target modificati meno quelli dell'L2, tipicamente 2–15.000 per run. **Misura:** braccio A/B "target L2" contro il pacchetto attuale | S | Con le sole firme l'agente esplora di più: lo dice l'A/B | Integrazione: costruzione del pacchetto per ruolo |
| **6.3 Modelli economici per esplorazione e sotto-agenti** | Esploratori e passaggi di sola lettura (roadmap, insights, raccolta del contesto del planner) su Haiku o Sonnet | Su Max conta la quota (Opus pesa di più). **Misura:** quota Opus usata per piano, prima/dopo | S | Qualità dei piani: il planner resta sul tier Architect, cambia solo l'esplorazione | Unità sulla configurazione dei sotto-agenti |
| **6.4 Risposte concise** | Nelle run headless il riassunto finale è breve (l'output costa 5 volte l'input); il dettaglio resta nel diff | **Stima:** −20/−40% di token di output per run. **Misura:** output per tipo di run, prima/dopo | S | Riassunti troppo poveri: il limite riguarda solo il messaggio finale | Unità sul primer |
| **6.5 Raggruppamento dei task piccoli** | Con il tuo consenso, i task piccoli in coda nello stesso workspace diventano una run sola | **Stima:** −10/−30% di token per task completato sui task piccoli (prefisso, pacchetto e storia condivisi). **Misura:** token per task completato, raggruppati e no | M | Un fallimento ferma tutto il gruppo; esito per task meno preciso: ogni task ha i suoi criteri e il suo esito nel riassunto | Integrazione: gruppo con un task che fallisce |

## Milestone 7 — GitHub e changelog

| Voce | Valore per te | Effetto sui token | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **7.1 Import delle issue come task** | Scegli le issue, diventano task con link, etichette e target dedotti dall'indice | Nessuno (deterministico) | M | Il testo delle issue è input non fidato (prompt injection): dopo la milestone 3, e il task lo segnala | Integrazione con il server GitHub finto già usato nei test |
| **7.2 PR dal branch del task** | Apri la PR da Onyx, con una descrizione generata dal task, dal diff, dai test e dal QA | Deterministica di default; facoltativa con un modello economico (costo mostrato) | M | Il token deve avere Pull requests: read and write | Integrazione con il server finto |
| **7.3 Stato dei controlli della PR nel task** | Controlli rossi o verdi accanto al task, con link | Nessuno | S | Rate limit di GitHub: polling con backoff ed ETag | Integrazione |
| **7.4 Changelog** | Generato dai task completati e dai commit (Conventional Commits), con anteprima e modifica | Deterministico; ritocco facoltativo con Haiku | S | — | Unità sul raggruppamento |
| GitLab | — | — | M | Valutazione: API simile a GitHub, costo medio. **Solo se lo usi** | — |
| Linear | — | — | M | Valutazione: GraphQL e un secondo sistema di task da sincronizzare. **Scartato** salvo tua richiesta | — |

## Milestone 8 — Pipeline con QA e merge assistito

| Voce | Valore per te | Effetto sui token | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **8.1 Specifica → piano → implementazione → QA** | Un agente revisore in sola lettura confronta il diff con i criteri di accettazione; il report è nelle Approvals prima del merge | **Costa** una run per nodo (Sonnet, solo diff e criteri, 5–20.000 token stimati); risparmia i rifacimenti dopo il merge. **Misura:** rifacimenti per piano, con e senza QA | L | QA superficiale: criteri verificabili e citazioni del diff obbligatorie | Integrazione con stub: QA che boccia e che promuove |
| **8.2 Conflitti di merge risolti con l'AI** | Proposta di risoluzione con diff, applicata solo dopo la tua approvazione; resta l'alternativa manuale | Costa solo quando c'è un conflitto (file in conflitto più contesto) | M | Risoluzione sbagliata: test e `tsc` girano sulla proposta prima di mostrarla | Integrazione con il caso di conflitto già nei test |

## Milestone 9 — Insights e Ideation

| Voce | Valore per te | Effetto sui token | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **9.1 Insights** | Chat sul codice di un progetto. Prima risponde con indice, grafo e tool MCP senza modello ("dove si usa X", "chi importa Y", "file più centrali"); se non basta, Haiku in sola lettura con i tool `onyx`; costo mostrato per risposta | Molte domande a costo zero. **Misura:** quota di risposte senza modello e token per risposta | L | Risposte deterministiche che sembrano complete e non lo sono: sempre la fonte e il pulsante "chiedi al modello" | Unità sul riconoscimento delle domande; integrazione con stub |
| **9.2 Ideation** | Vulnerabilità e prestazioni: prima analisi statica gratuita (`npm audit`/`pip-audit` se presenti, regole sui pattern rischiosi, metriche del grafo, N+1 e query in loop), poi un modello solo sui punti sospetti; ogni risultato diventa un task con un clic | Il modello vede solo i punti sospetti, non il progetto. **Misura:** token per analisi | L | Falsi positivi: punteggio di confidenza e "scarta" | Progetti di esempio con problemi noti |
| Roadmap con analisi dei concorrenti | — | — | — | **Scartata:** senza fonti affidabili il modello inventerebbe; Onyx in LAN non ha una ricerca web verificabile | — |

## Milestone 10 — Italiano, design, onboarding, accessibilità

| Voce | Valore per te | Effetto sui token | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **10.1 Italiano come lingua dell'interfaccia, inglese disponibile** | Tutta la UI in italiano, scelta in Settings | Nessuno | L | Testi lunghi che rompono il layout a 375 px | E2E nelle due lingue, controllo delle stringhe mancanti in CI |
| **10.2 Sistema visivo coerente e stati vuoti** | Ogni pagina vuota dice cosa fare | Nessuno | M | — | E2E e screenshot |
| **10.3 Primo progetto guidato** | Account Claude, progetto, workspace proposti, comandi per stack, primo task | Nessuno | M | — | E2E da database vuoto |
| **10.4 Palette con tutte le azioni ed errori leggibili** | Ogni azione dalla palette; ogni errore con la soluzione suggerita | Nessuno | M | — | Unità sulla mappa degli errori |
| **10.5 Mobile e accessibilità** | 375 px completo; Lighthouse ≥ 90 e axe senza violazioni su tutte le pagine (B26 compreso) | Nessuno | M | — | Lighthouse e axe in uno script ripetibile |

## Milestone 11 — Affidabilità

| Voce | Valore per te | Effetto sui token | Costo | Rischi | Test |
|---|---|---|---|---|---|
| **11.1 Recupero automatico dei casi noti** | Sessioni perse anche nel TDD e nei terminali (M26, A12); processi orfani; worktree rimasti; nodi dei piani dopo un riavvio (A10, A11); run lasciate a metà (M4); follow-up persi (M9) | Meno run ripetute | M | — | Integrazione: riavvio a metà di un piano, di un TDD loop e di un terminale |
| **11.2 Health check per progetto** | Indice, git, runner dei test, spazio, credenziali: un semaforo sulla scheda di Mission control | Nessuno | S | — | Unità |
| **11.3 Log nella UI** | Ultime righe, filtri per livello e run, segreti mascherati | Nessuno | M | Segreti nei log: redazione testata | Unità sulla redazione |
| **11.4 Diagnostica in un clic** | Un file da mandarmi: versioni, configurazione senza segreti, readiness, errori recenti, statistiche del database | Nessuno | S | Dati personali: anteprima prima del download | Unità: nessun segreto nel pacchetto |
| **11.5 Aggiornamento più robusto** (M15, M16, M18, B6–B9) | Rollback della release se non parte, migrazioni nominate in ordine, errori di git chiari | Nessuno | S | — | CI: ordine delle migrazioni, `migrate:diff --exit-code` |

---

## Scartati o ridimensionati

| Candidato | Decisione | Motivo |
|---|---|---|
| Roadmap con analisi dei concorrenti | Scartato | Senza fonti verificabili il modello inventa; Onyx non deve uscire dalla LAN per cercare |
| Linear | Scartato salvo richiesta | Un secondo sistema di task da sincronizzare, per un solo operatore |
| GitLab | Solo se lo usi | Costo medio, utile solo con repository su GitLab |
| 12 terminali in parallelo di default | Ridimensionato | Con Max la finestra di 5 ore si esaurisce prima: il limite è configurabile e mostrato insieme alla quota |
| Comandi da Telegram | Scartato | Aprirebbe il controllo di Onyx fuori dalla LAN; le notifiche restano solo in uscita |
| Sandbox stile macOS | Sostituito | Onyx gira su Linux: utente separato o bubblewrap (3.1) |

## Domande per te prima di partire

1. **Ordine:** confermi 1 → 2 → 3, poi Mission control?
2. **Sandbox (3.1):** il container può avere `nesting=1` (per bubblewrap), oppure preferisci la soluzione con un secondo utente, senza modifiche all'LXC?
3. **HTTPS in LAN:** attiviamo la CA interna di Caddy? Serve per Web Push e mette il cookie su HTTPS.
4. **GitLab e Linear:** li usi?
5. **Trascrizioni reali:** per chiudere 1.1, 1.2 e 2.1 servono run vere con Claude. Ti preparerò una lista breve di task da lanciare tu (pochi centesimi di quota) e il registratore `--yes` per il formato di `rate_limit_event`.

## Stato

| Milestone | Stato |
|---|---|
| Fase 0 (audit e bug critici) | Fatta: `docs/audit-2.0.md`, correzioni in `e1168ea` |
| Via libera | Ordine 1 → 2 → 3; sandbox con un secondo utente; solo GitHub (niente GitLab né Linear); HTTPS non attivato: Web Push resta disponibile solo con HTTPS |
| 1–11 | **Fatte** (vedi sotto) |

### Milestone 1 — esito

| Voce | Stato | Risparmio |
|---|---|---|
| 1.1 Telemetria della cache persa | Fatta: lettura e scrittura del primo turno, motivo della perdita, card in Savings, nota nella console | Strumento (misura) |
| 1.2 Prefisso stabile per sessione | Fatta (ADR-055) | **Stimato su dati misurati**: per ogni ripresa protetta, token letti dalla cache × 1,15. Con lo stub: senza la correzione la ripresa dopo una modifica è `PREFIX_CHANGED` e riscrive ~16K token; con la correzione li rilegge. Il valore reale arriverà dalle tue run |
| 1.3 Pacchetto non rimandato | Fatta (ADR-056) | **Stimato**: token delle voci già presenti, contati per run in `ctxReusedTokens` |
| 1.4 Verifica dei nodi con i fallimenti di base | Fatta (ADR-057) | **Stimato**: nella prova E2E il piano che prima falliva dopo 3 tentativi (con escalation a Opus) ora non ne usa nessuno |
| 1.5 Falsi positivi del guard | Fatta (M11–M13) | Non quantificato: meno turni persi su comandi bloccati per errore |
| 1.6 Stub realistico | Fatto | Strumento |
| 1.7 Registro dei risparmi | Fatto | Strumento |

Da verificare con Claude reale (lo fai tu, vedi il riassunto): una ripresa dopo aver modificato dei file deve risultare *Read from the cache*; se compare spesso *Unexplained*, Claude Code cambia il proprio prompt di sistema tra le riprese e il guadagno della 1.2 è minore.

### Milestone 2 — esito

| Voce | Stato | Risparmio |
|---|---|---|
| 2.1 Quota delle finestre | Fatta (ADR-058): parser tollerante, card in Telemetry, indicatore laterale, voce nel feed. Lo stub la simula con `CLAUDE_STUB_RATE_LIMIT` invece dello scenario `[stub:rate-limit]` previsto, perché così i test cambiano il limite tra una run e l'altra | **Misurato**: run fermate dal limite (`AgentRun.quotaLimited`) in Savings |
| 2.2 Avvisi | Fatta: avviso all'80%, attesa al 90% (al posto del secondo avviso al 95%, perché da lì in poi l'avviso serve solo se trattiene qualcosa), entrambi modificabili | — |
| 2.3 Rinvio dei task non urgenti | Fatta: "Can wait", timer al reset, scadenza dei limiti senza reset, *Resume now* | **Misurato**: run rimandate e partite dopo il reset (`AgentRun.quotaDeferred`); sposta la spesa, nessun token risparmiato dichiarato |
| 2.4 Comandi per lo stack | Fatta (ADR-059) | **Stimato su dati misurati**: calo dei token delle run di continuazione rispetto ai 30 giorni precedenti |
| 2.5 Workspace dalla struttura | Fatta (ADR-059, chiude M30) | Non quantificato in Savings: il guadagno passa per pacchetti più mirati e quindi entra nella riga del contesto Onyx. La misura prevista (quota di task "Auto" finiti nel workspace di default) resta da aggiungere |

Da verificare con Claude reale: che `rate_limit_event` arrivi sul tuo account e con quali campi. La card *Claude subscription limits* deve passare da *Not reported* a un valore dopo la prima run.

### Milestone 3 — esito

| Voce | Stato | Note |
|---|---|---|
| 3.1 Utente separato | Fatta (ADR-060) | **Deviazione dal piano**: niente `AmbientCapabilities`. Un processo che passa da un utente non root a un altro conserva `CAP_SETUID`, quindi l'agente avrebbe potuto diventare root. Al loro posto sudo limitato al solo utente `onyx-agent`, che richiede di togliere `NoNewPrivileges` all'API con un drop-in. Provato in CI con un utente reale e non privilegiato |
| 3.2 Guard robusto | Fatta (ADR-061) | Pochi falsi positivi: `rm -rf dist`, `tsc --outDir dist`, `git grep` passano |
| 3.3 *Allow and continue* sicuro | Fatta (ADR-062) | Regole per task, agente o progetto, con scadenza; rifiuti distruttivi anche nell'hook |
| 3.4 Verifica a posteriori del recinto | Fatta (ADR-063) | Basata su `git status`, non su hash di tutti i file; esclude i workspace attivi in parallelo |

Effetto sui token: nessuno diretto, come previsto. Le regole strette e per task evitano run di continuazione inutili, e la riga *Commands allowed for the stack* di Savings ne misura l'andamento.

### Milestone 4 — esito

| Voce | Stato | Note |
|---|---|---|
| 4.1 Mission control | Fatta (ADR-065) | Una rotta con un numero fisso di query; git in cache 30 s, al massimo quattro `git status` alla volta. 181 ms con 20 progetti e 20.000 run, 56 ms con git in cache |
| 4.2 Coda globale | Fatta (ADR-064) | Anzianità: un livello ogni 30 minuti. Limite per progetto rigido e spento di default (un limite che presta gli slot liberi non lascerebbe posto agli altri progetti). M6 era già chiuso con la 4.6 |
| 4.3 Griglia degli agenti | Fatta (ADR-066, chiude A12) | Pausa dei pannelli fuori vista invece della virtualizzazione: lo snapshot dello schermo basta a riprendere. Trovato e corretto nell'E2E: con l'output raggruppato della 4.6 un nuovo iscritto riceveva due volte le ultime righe |
| 4.4 Notifiche | Fatta (ADR-067) | Web Push senza dipendenze, verificato sull'esempio della RFC 8291; ntfy e Telegram solo in uscita. Web Push resta inutilizzabile finché Onyx gira su HTTP |
| 4.5 Ricerca globale | Fatta (ADR-068) | **Deviazione**: l'indice FTS5 non sta nelle migrazioni Prisma (le tabelle ombra risultano come differenze di schema); lo crea l'API all'avvio, con versione |
| 4.6 Prestazioni | Fatta (chiude A13, A14, M6, M20–M24, B20) | Benchmark `bench:telemetry` con 20.000 run e 2 milioni di `TokenLog` |

Effetto sui token: nessuno diretto, quindi niente righe nuove in Savings. Il limite per progetto e la coda ordinata distribuiscono meglio la finestra di 5 ore, e la griglia mostra quanti agenti la stanno consumando.

Da verificare sulla macchina vera: Web Push via HTTPS con la CA interna di Caddy su un telefono (operations.md §14) e un bot Telegram reale.

### Milestone 5 — esito

| Voce | Stato | Risparmio |
|---|---|---|
| 5.1 Fatti stabili dalle run | Fatta (ADR-069): comandi riusciti, file letti spesso, comando dei test di un TDD verde, fallimenti ripetuti, ognuno con run e data. Le convenzioni non si ricavano in modo deterministico: restano alle note dell'operatore | — |
| 5.2 Curatela e limite | Fatta: pagina Memory, limite di 800 token, scadenza di 30 giorni, fissaggio, modifica, note, ripristino | — |
| 5.3 Iniezione nel primer | Fatta: nelle sessioni nuove di run e terminali, congelata per sessione | **Stimato**: −10/−30% di file letti e turni nelle sessioni nuove, finché l'esperimento non ha 10 run per gruppo; **misurato**: i token che la memoria aggiunge e, con l'esperimento, il confronto di token, file letti e turni |

Effetto sui token: la memoria costa i suoi token (in media 50–150 nelle prove con lo stub) a ogni sessione nuova e ne risparmia solo se evita esplorazione. Lo dice l'esperimento; se risulta *costs more* o *no difference*, conviene spegnerla.

Da verificare con Claude reale: accendere l'esperimento (Settings → Project memory → Measure it) e guardare Savings dopo una ventina di sessioni nuove.

### Milestone 6 — esito

| Voce | Stato | Risparmio |
|---|---|---|
| 6.1 Esperimento a più bracci | Fatta (ADR-070): controllo, pacchetto e una variante alla volta | Strumento |
| 6.2 Target da modificare come L2 | Fatta: solo i file del campo *Files* del task; quelli dedotti restano interi | **Stimato**: token non mandati, contati alla consegna. **Misurato** quando l'A/B ha il verdetto (10 run per braccio) |
| 6.3 Esplorazione economica | Fatta (ADR-072): esploratore su Haiku per planner e roadmap, roadmap sul modello Builder. **Deviazione**: insights non esiste ancora (milestone 9) e prenderà la stessa opzione | **Stimato** finché non ci sono 3 piani con e 3 senza; poi **misurato**: costo del modello del planner per piano |
| 6.4 Risposte concise | Fatta (ADR-071): riassunto finale di al massimo sei righe, congelato per sessione | **Stimato** (−20/−40% di output) finché non ci sono 10 run prima e 10 dopo; poi **misurato** come confronto prima/dopo, non A/B |
| 6.5 Raggruppamento dei task piccoli | Fatta (ADR-073), spenta di default. Un task fallito non ferma il gruppo: fallisce solo lui, e quelli non riportati tornano in coda | **Stimato** (−10/−30% per task) finché non ci sono 5 run raggruppate e 5 singole; poi **misurato**: token per task completato |

Effetto sui token: tutte le righe sono stimate finché non arrivano run vere. Con lo stub i meccanismi funzionano (esploratore registrato per modello, gruppo con esiti per task, firme consegnate), ma i numeri dello stub non dicono nulla sul risparmio reale.

Da verificare con Claude reale: con quale nome Claude Code espone la delega ai sotto-agenti (Onyx consente sia `Task` sia `Agent`) e se `modelUsage` riporta Haiku a parte; che un gruppo di task risponda con le righe `TASK n:`; i verdetti della variante e delle opzioni dopo abbastanza run.

### Milestone 7 — esito

| Voce | Stato | Note |
|---|---|---|
| 7.1 Issue come task | Fatta (ADR-074) | Task in bozza, testo recintato e segnalato; target dai file citati che esistono nell'indice |
| 7.2 PR dal branch | Fatta (ADR-075) | Descrizione deterministica. **Deviazione**: niente versione scritta da un modello economico: la descrizione ha già i dati e sarebbe solo un costo. Il QA entra nella descrizione con la milestone 8 |
| 7.3 Stato dei controlli | Fatta (ADR-075) | Polling con ETag e backoff (1–15 minuti), notifica facoltativa su rosso e ritorno al verde |
| 7.4 Changelog | Fatta (ADR-076) | Deterministico, modificabile, scritto in `CHANGELOG.md` senza commit né tag. **Deviazione**: niente ritocco con Haiku, per lo stesso motivo della 7.2 |
| GitLab, Linear | Non fatti | Come concordato: solo GitHub |

Effetto sui token: nessuno, come previsto; niente righe nuove in Savings.

Da verificare su GitHub vero: permessi del token, apertura di una PR e lettura dei controlli di un repository con CI.

### Milestone 8 — esito

| Voce | Stato | Token |
|---|---|---|
| 8.1 QA prima del merge | Fatta (ADR-077): revisore in sola lettura sul Builder, prova dal diff obbligatoria, una rilavorazione, poi Approvals. **Deviazione**: un report positivo non passa da Approvals (il piano si fermerebbe a ogni nodo); resta visibile nella pagina del piano | **Costo misurato** (riga *QA before merging*): con lo stub ~0,004 $ a revisione, la prima ~0,036 $ per la scrittura della cache. **Non misurato**: i rifacimenti evitati dopo il merge, perché Onyx non vede cosa succede dopo; la riga conta i problemi trovati e corretti prima |
| 8.2 Conflitti risolti con l'AI | Fatta (ADR-078): proposta in un worktree a parte, test e type check sulla proposta, diff in Approvals e nella pagina del piano, alternativa manuale | **Costo misurato** (riga *Merge conflicts resolved by Claude*), solo quando c'è un conflitto |

Effetto sui token: aumenta la spesa dei piani che usano le opzioni; Savings la mostra come costo, con il numero di problemi presi prima del merge e di conflitti risolti.

Da verificare con Claude reale: che il revisore citi davvero il diff e non bocci a vuoto, il costo per task con diff veri, la qualità delle risoluzioni su conflitti reali.

### Milestone 9 — esito

| Voce | Stato | Token |
|---|---|---|
| 9.1 Insights | Fatta (ADR-079): sette tipi di domanda dall'indice con fonti e avviso sui limiti, Haiku in sola lettura per il resto e su richiesta, costo per risposta | **Misurato**: quota di risposte senza modello e token per risposta del modello. **Stimato**: token risparmiati = risposte dall'indice × mediana dei token di una risposta del modello (8.000 finché non ce n'è una) |
| 9.2 Ideation | Fatta (ADR-080): regole di sicurezza e prestazioni, audit npm/pnpm, cicli e hotspot, Claude solo sui punti sospetti, task o scarto ricordato. **Deviazione**: niente `pip-audit`, perché installa i pacchetti da controllare | **Misurato**: token degli snippet e del codice analizzato, costo della revisione. **Stimato**: token non mandati = codice analizzato − snippet |
| Roadmap con analisi dei concorrenti | Scartata, come previsto | — |

Effetto sui token: con lo stub, nell'E2E una domanda dall'indice costa 0 e la stessa fatta a Haiku 14.000 token (con la scrittura della cache); la revisione di 4 punti sospetti ha letto 810 token di snippet. Su un progetto così piccolo gli snippet non costano meno del codice, e la riga lo dice.

Da verificare con Claude reale: qualità e costo delle risposte di Haiku con i tool `onyx`, affidabilità dei verdetti sui punti sospetti.

### Milestone 10 — esito

| Voce | Stato | Token |
|---|---|---|
| 10.1 Italiano, inglese a scelta | Fatta (ADR-081): console e testi del server in italiano, inglese da Impostazioni o dalla palette; controllo delle chiavi in CI per web e API. **Deviazione**: restano in inglese prompt, testi scritti da Claude, errori dell'API (tradotti dal web), log, contenuti per GitHub e i testi salvati con valori dentro | Nessuno: i prompt non cambiano |
| 10.2 Stati vuoti | Fatta: ogni pagina vuota dice cosa fare (verificato da database vuoto, con screenshot) | — |
| 10.3 Primo progetto guidato | Fatta (ADR-083): cinque passi calcolati dallo stato reale | — |
| 10.4 Palette ed errori | Fatta (ADR-082, ADR-084): creazione, impostazioni, sottopagine e lingua dalla palette; 23 regole che danno causa e soluzione. **Deviazione**: la palette apre il modulo dell'azione invece di eseguirla, per non saltare anteprime e conferme | — |
| 10.5 Mobile e accessibilità | Fatta (ADR-085): `scripts/ui-audit.mjs`, 36/36 con Lighthouse ≥ 90, accessibilità 100, axe senza violazioni, nessun overflow a 375 px | — |

Nessun effetto sui token: la milestone non cambia nulla di quello che arriva a Claude.

### Milestone 11 — esito

| Voce | Stato | Token |
|---|---|---|
| 11.1 Recupero automatico | Fatta (ADR-086, ADR-087): A10, A11, M4, M9, M17 (lato codice), M26; registro dei processi e pulizia dei worktree. **Deviazione**: le run in corso al momento del riavvio non ripartono da sole (hanno già speso token e il loro stato a metà va guardato); i TDD loop si chiudono e se ne avvia uno nuovo | **Stimato**: meno run ripetute dopo un riavvio (nodi che ripartono con il loro prompt e worktree, follow-up non persi); non c'è una riga in Risparmi perché non c'è un confronto misurabile |
| 11.2 Salute per progetto | Fatta (ADR-088) | Nessuno: nessun modello |
| 11.3 Log nella UI | Fatta (ADR-089) | Nessuno |
| 11.4 Diagnostica | Fatta (ADR-089) | Nessuno |
| 11.5 Aggiornamento più robusto | Fatta (ADR-090): M15, M16, M18, B6–B9 | Nessuno |

Resta aperto: il login con `claude setup-token` e il test delle credenziali non sono nel registro dei processi; una run in attesa dell'indice non mostra il motivo in coda; planner e roadmap occupano ancora il loro slot mentre aspettano l'indice.

Da verificare sulla macchina vera: `release.sh` con systemd e un rollback reale, `onyx-update` da root su un checkout di un altro utente (`runuser`).

