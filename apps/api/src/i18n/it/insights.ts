export const INSIGHTS: Record<string, string> = {
  "… and {count} more": "… e altri {count}",
  "No import cycles in the project index.": "Nessun ciclo di import nell'indice del progetto.",
  "From the import graph of the indexed files.": "Dal grafo degli import dei file indicizzati.",
  "{count} import cycle:": "{count} ciclo di import:",
  "{count} import cycles:": "{count} cicli di import:",
  "The largest files by tokens:": "I file più grandi per token:",
  "~{tokens} tokens": "~{tokens} token",
  "Token counts from the index; binary and sensitive files are left out.":
    "Conteggi di token dall'indice; i file binari e sensibili sono esclusi.",
  "The most central files (imported directly or indirectly by many others):":
    "I file più centrali (importati direttamente o indirettamente da molti altri):",
  "imported by {count} file": "importato da {count} file",
  "imported by {count} files": "importato da {count} file",
  "Ranked by the centrality of the import graph.":
    "Ordinati per centralità nel grafo degli import.",
  "`{subject}` is defined in:": "`{subject}` è definito in:",
  "{kind}, exported: `{signature}`": "{kind}, esportato: `{signature}`",
  "From the symbols of the index.": "Dai simboli dell'indice.",
  "`{subject}` is a file of the project:": "`{subject}` è un file del progetto:",
  "From the index.": "Dall'indice.",
  "`{file}` is imported by {count} file:": "`{file}` è importato da {count} file:",
  "`{file}` is imported by {count} files:": "`{file}` è importato da {count} file:",
  "No indexed file imports `{file}`.": "Nessun file indicizzato importa `{file}`.",
  "From the import graph and a text search in the importing files: dynamic imports, re-exports through strings and generated code can be missing. Ask the model when it matters.":
    "Dal grafo degli import e da una ricerca testuale nei file che importano: possono mancare import dinamici, riesportazioni tramite stringhe e codice generato. Chiedi al modello quando conta.",
  "`{file}` imports {count} project file and {packages} package ({names}):":
    "`{file}` importa {count} file del progetto e {packages} pacchetto ({names}):",
  "`{file}` imports {count} project file and {packages} packages ({names}):":
    "`{file}` importa {count} file del progetto e {packages} pacchetti ({names}):",
  "`{file}` imports {count} project files and {packages} package ({names}):":
    "`{file}` importa {count} file del progetto e {packages} pacchetto ({names}):",
  "`{file}` imports {count} project files and {packages} packages ({names}):":
    "`{file}` importa {count} file del progetto e {packages} pacchetti ({names}):",
  "`{file}` imports {count} project file:": "`{file}` importa {count} file del progetto:",
  "`{file}` imports {count} project files:": "`{file}` importa {count} file del progetto:",
  "`{subject}` is defined in {where} and used in {count} place:":
    "`{subject}` è definito in {where} e usato in {count} punto:",
  "`{subject}` is defined in {where} and used in {count} places:":
    "`{subject}` è definito in {where} e usato in {count} punti:",
  "`{subject}` is defined in {where}; no file that imports it mentions it.":
    "`{subject}` è definito in {where}; nessun file che lo importa lo menziona.",
  "Code built from strings at run time": "Codice costruito da stringhe a runtime",
  "eval and new Function run arbitrary code; with outside input this is code injection.":
    "eval e new Function eseguono codice arbitrario; con input esterno è code injection.",
  "Shell command built from variables": "Comando shell costruito da variabili",
  "A shell command assembled with interpolated values can run whatever the value contains.":
    "Un comando shell composto con valori interpolati può eseguire qualunque cosa contenga il valore.",
  "SQL built by concatenating values": "SQL costruito concatenando valori",
  "Values joined into an SQL string instead of passed as parameters allow SQL injection.":
    "I valori uniti in una stringa SQL invece di essere passati come parametri permettono la SQL injection.",
  "Raw HTML written into the page": "HTML grezzo scritto nella pagina",
  "innerHTML and dangerouslySetInnerHTML render markup as is: unescaped user content becomes XSS.":
    "innerHTML e dangerouslySetInnerHTML mostrano il markup così com'è: il contenuto utente senza escape diventa XSS.",
  "Secret written in the source": "Segreto scritto nel sorgente",
  "Keys and passwords in the code end up in git history and in every copy of the project.":
    "Chiavi e password nel codice finiscono nella cronologia di git e in ogni copia del progetto.",
  "TLS certificate checks turned off": "Verifica dei certificati TLS disattivata",
  "Without certificate checks anyone on the network path can read and change the traffic.":
    "Senza la verifica dei certificati chiunque sul percorso di rete può leggere e modificare il traffico.",
  "MD5 or SHA-1 hash": "Hash MD5 o SHA-1",
  "MD5 and SHA-1 are broken for passwords and signatures; fine only for non-security checksums.":
    "MD5 e SHA-1 non sono sicuri per password e firme; vanno bene solo per checksum non legati alla sicurezza.",
  "Math.random for a secret value": "Math.random per un valore segreto",
  "Math.random is predictable; tokens, ids and passwords need crypto.randomBytes or randomUUID.":
    "Math.random è prevedibile; token, id e password richiedono crypto.randomBytes o randomUUID.",
  "Unsafe Python call": "Chiamata Python non sicura",
  "pickle, yaml.load without a safe loader, os.system and shell=True run what the input says.":
    "pickle, yaml.load senza un loader sicuro, os.system e shell=True eseguono ciò che dice l'input.",
  "Blocking file call in server code": "Chiamata bloccante sui file nel codice server",
  "Synchronous file calls block every request while they run.":
    "Le chiamate sincrone sui file bloccano ogni richiesta finché sono in esecuzione.",
  "Query or request inside a loop": "Query o richiesta dentro un ciclo",
  "Await inside a loop": "Await dentro un ciclo",
  "One query or request per item (N+1): a single batched call is usually much faster.":
    "Una query o richiesta per elemento (N+1): una sola chiamata raggruppata di solito è molto più veloce.",
  "Each iteration waits for the previous one; independent work can run with Promise.all.":
    "Ogni iterazione attende la precedente; il lavoro indipendente può girare con Promise.all.",
  "Import cycle": "Ciclo di import",
  "Files that import each other load in a fragile order and cannot change independently.":
    "I file che si importano a vicenda si caricano in un ordine fragile e non possono cambiare in modo indipendente.",
  "Large file many others depend on": "File grande da cui dipendono molti altri",
  "Every change here risks many callers and costs agents a lot of context: splitting it helps both.":
    "Ogni modifica qui mette a rischio molti chiamanti e costa agli agenti molto contesto: dividerlo aiuta in entrambi i casi.",
  "Vulnerable dependency: {name}": "Dipendenza vulnerabile: {name}",
  "A known vulnerability is reported for this package version: update it or check whether the affected code is used.":
    "Per questa versione del pacchetto è segnalata una vulnerabilità nota: aggiornalo o verifica se il codice interessato viene usato.",
  "~{tokens} tokens, imported by {count} files": "~{tokens} token, importato da {count} file",
  "{tool} audit could not run: {error}": "Impossibile eseguire {tool} audit: {error}",
  "{tool} audit: {count} vulnerable package": "{tool} audit: {count} pacchetto vulnerabile",
  "{tool} audit: {count} vulnerable packages": "{tool} audit: {count} pacchetti vulnerabili",
  "{tool} audit returned no JSON": "{tool} audit non ha restituito JSON",
  "Dependency audit not run": "Audit delle dipendenze non eseguito",
  "No lockfile: dependency audit skipped": "Nessun lockfile: audit delle dipendenze saltato",
};
