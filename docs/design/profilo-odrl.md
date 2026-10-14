# Profilo ODRL del prototipo ZK-ODRL

Questo documento fissa il sottoinsieme di ODRL 2.2 che il prototipo accetta: la
struttura ammessa di una policy, i `leftOperand` e gli operatori supportati, la
codifica degli attributi in elementi di campo, la semantica di decisione e la
tabella di copertura costrutto per costrutto. Il compilatore di policy rifiuta
con un errore esplicito tutto ciò che sta fuori da questo profilo.

La codifica dettagliata nel circuito (slot, larghezze dei valori,
`policyHash`) è in [design.md](design.md). Il confronto dei ruoli con XACML è in
[../odrl-vs-xacml.md](../odrl-vs-xacml.md).

Riferimenti normativi: ODRL Information Model 2.2 (in seguito *Model*,
<https://www.w3.org/TR/odrl-model/>) e ODRL Vocabulary & Expression 2.2 (in
seguito *Vocab*, <https://www.w3.org/TR/odrl-vocab/>), entrambi W3C
Recommendation del 15 febbraio 2018.

## 1. Identificatori del profilo

| Elemento | Valore |
|---|---|
| IRI del profilo (proprietà `profile`) | `https://github.com/dedonnodev/zk-odrl/profile` |
| Prefisso dei termini del profilo | `zk:` → `https://github.com/dedonnodev/zk-odrl/profile#` |
| Prefisso delle istanze negli esempi | `ex:` → `http://example.com/` (come negli esempi W3C) |
| `@context` ammesso | `["http://www.w3.org/ns/odrl.jsonld", {"zk": "…profile#", "ex": "http://example.com/"}]` |

L'IRI del profilo è un identificatore e non è garantito che sia
dereferenziabile. Il compilatore usa una copia locale del contesto
`odrl.jsonld` e non scarica nulla dalla rete: una policy con un `@context`
diverso da quello sopra è fuori profilo.

I `leftOperand` del profilo hanno IRI propri (`zk:department`, …) perché nel
contesto ODRL la proprietà `leftOperand` è di tipo `@vocab` e il contesto non
definisce un `@vocab`: un nome nudo come `"department"` non si espanderebbe in
un IRI del profilo.

## 2. Struttura ammessa di una policy

| Regola | Motivo |
|---|---|
| `@type` è `Set` (*Model* §2.1.1) | Una policy di controllo accessi non è un accordo bilaterale (`Agreement`) né un'offerta: `Set` non impone parti. |
| `uid` obbligatorio, IRI e non blank node (`_:…`) | Richiesto da *Model* §2.1 per ogni `Policy`; un blank node non identifica la policy fuori dal documento. |
| `profile` obbligatorio e uguale all'IRI della §1 | Obbligatorio per una policy conforme a un profilo (*Model* §3.2). |
| `conflict` obbligatorio e uguale a `prohibit` | Il default di *Model* §2.10 è `invalid`, che annullerebbe l'intera policy in caso di conflitto; il profilo vuole *deny-overrides*. |
| Esattamente una `permission` | Un solo insieme di condizioni di accesso per risorsa, quanto serve al caso d'uso. |
| Zero o una `prohibition` | Esprime le esclusioni (es. badge sospeso) come regola ODRL di prima classe. |
| `target` e insieme di `action` uguali in `permission` e `prohibition` | Così la proibizione è sempre in conflitto con il permesso e `conflict: prohibit` si applica senza ragionare su `includedIn`/`implies`. |
| Esattamente un `target` per regola; una o più `action` | La risorsa on-chain (`resourceId`) è la coppia (`target`, `action`): una policy con più azioni sullo stesso `target` si compila in una policy registrata per ogni coppia, così un permesso di stampa non vale per un'altra operazione dello stesso dispositivo. Un'azione ripetuta conta una volta sola. |
| `assignee` facoltativo; se presente è l'IRI del registro dell'issuer, `ex:registry/employees` (`http://example.com/registry/employees`) | La parte autorizzata è "un dipendente di cui l'issuer attesta gli attributi". |
| Proprietà condivise a livello di policy (*Model* §2.7.1) | Ammesse per `target`, `action`, `assignee`; il compilatore le espande nelle regole prima di validare, come raccomanda la specifica. |
| Ogni altra proprietà | Fuori profilo: vedi la §10. |

## 3. Semantica di decisione

L'accesso è concesso se e solo se:

```
permOK  AND  NOT prohHit
```

dove `permOK` vale 1 se i vincoli del permesso sono soddisfatti secondo il loro
modo di combinazione (§6), e `prohHit` vale 1 se esiste una proibizione e i suoi
vincoli sono soddisfatti.

- **`conflict: prohibit`.** Una proibizione attiva prevale sempre sul permesso
  (*Model* §2.10). È l'unica strategia del profilo ed è cablata nel circuito.
- **Closed-world deny.** ODRL non definisce un esito "nega": un permesso con
  vincoli non soddisfatti è inattivo (bozza *ODRL Formal
  Semantics* del W3C ODRL Community Group,
  <https://w3c.github.io/odrl/formal-semantics/#sectionPermissions>). Il profilo
  adotta l'ipotesi del mondo chiuso: tutto ciò che non è esplicitamente permesso è
  negato. Sono quindi negati il permesso inattivo, la risorsa senza policy
  registrata, la policy fuori profilo e la richiesta senza prova valida.
- **Valutazione in un istante.** Ogni decisione è valutata in un solo istante,
  il `now` pubblico della richiesta (§8); il profilo non ha memoria tra
  richieste, salvo l'estensione `count` della §11.

## 4. LeftOperand supportati

| `leftOperand` | Origine del valore | Tipo | Dominio |
|---|---|---|---|
| `zk:department` | attestato dall'issuer | enum | 1..4 |
| `zk:role` | attestato dall'issuer | enum | 1..3 |
| `zk:clearanceLevel` | attestato dall'issuer | intero | 0..5 |
| `zk:badgeStatus` | attestato dall'issuer | enum | 1..2 |
| `zk:dayOfWeek` | derivato da `now` nel circuito | intero | 0..6, lunedì = 0 |
| `dateTime` (*Vocab* §4.5.6) | `now` pubblico | istante, secondi UTC | < 2^64 |

Gli attributi attestati restano privati: sono input privati del circuito e
non compaiono mai nei segnali pubblici. `dayOfWeek` e `dateTime` dipendono solo
da `now`, che è pubblico per costruzione (vedi la §8). ODRL non ha un
`leftOperand` per il giorno della settimana (`timeInterval`, *Vocab* §4.5.29,
descrive un periodo ricorrente fra due esecuzioni, non un calendario), quindi
il profilo definisce `zk:dayOfWeek`.

## 5. Operatori supportati

| Operatore (*Vocab* §3.16) | Codice | Ammesso su | Forma del `rightOperand` |
|---|---|---|---|
| `eq` | 1 | enum, intero | un valore |
| `neq` | 2 | enum, intero | un valore |
| `lt` | 3 | intero, `dateTime` | un valore |
| `lteq` | 4 | intero, `dateTime` | un valore |
| `gt` | 5 | intero, `dateTime` | un valore |
| `gteq` | 6 | intero, `dateTime` | un valore |
| `isAnyOf` | 7 | enum, intero | insieme di 1..K valori distinti |
| `isNoneOf` | 8 | enum, intero | insieme di 1..K valori distinti |

Il codice 0 è `noop` e marca uno slot inutilizzato; non corrisponde a nessun
operatore ODRL. Con i parametri del prototipo, K = 4 (motivato in
[design.md](design.md)).

Restrizioni per tipo, tutte controllate dal compilatore:

- **Enum:** solo `eq`, `neq`, `isAnyOf`, `isNoneOf`. Un ordinamento fra
  dipartimenti o ruoli non ha significato e i codici interi sono arbitrari.
- **`dateTime`:** solo `lt`, `lteq`, `gt`, `gteq`. L'uguaglianza al secondo
  con l'istante della richiesta non esprime alcuna regola utile.
- **Valori:** interi senza segno sotto 2^64. Niente negativi né decimali: una
  soglia decimale va scalata a intero nella definizione dell'attributo.

Forme del `rightOperand` in JSON-LD compatto:

| Tipo | Forma |
|---|---|
| enum | `{"@id": "zk:department/RnD"}` (IRI della tabella di codifica) |
| intero | `{"@value": "3", "@type": "xsd:integer"}`; il numero JSON `3` solo se intero e ≤ 2^53 − 1 |
| `dateTime` | `{"@value": "2027-01-01T00:00:00Z", "@type": "xsd:dateTime"}` |
| insieme | array JSON dei valori sopra, senza duplicati |

Nel contesto ODRL `rightOperand` non ha coercizione di tipo: un valore enum
scritto come stringa nuda sarebbe un letterale e non un IRI, quindi il profilo
richiede la forma `{"@id": …}`. Il compilatore rifiuta `rightOperandReference`
(§10).

Un numero JSON è accettato solo se è un intero non superiore a 2^53 − 1;
un valore più grande va scritto nella forma tipata con la stringa
(`{"@value": "…", "@type": "xsd:integer"}`) e un numero non intero è
rifiutato. Il motivo: `JSON.parse` e `jsonld` leggono i numeri come double
IEEE-754, che oltre 2^53 − 1 non rappresentano più tutti gli interi, per cui
una soglia a 64 bit verrebbe arrotondata in silenzio prima di arrivare al
compilatore.

## 6. Combinazione dei vincoli

Ogni regola combina i propri vincoli con **un solo** operatore logico, su un
solo livello:

| Modo | Codice | Soddisfatta quando | Sorgente ODRL |
|---|---|---|---|
| `and` | 1 | tutti i vincoli abilitati sono veri | lista `constraint` (congiunzione implicita, *Model* §2.5) oppure un `LogicalConstraint` con `and` |
| `or` | 2 | almeno un vincolo abilitato è vero | `LogicalConstraint` con `or` (*Vocab* §3.17.1) |
| `xone` | 3 | esattamente un vincolo abilitato è vero | `LogicalConstraint` con `xone` (*Vocab* §3.17.2) |

Il modo fa parte del `policyHash` (vedi [design.md](design.md)): un prover non
può trasformare un `and` in un `or`.

Una regola senza vincoli ha modo `and` e nessuno slot abilitato, quindi è
sempre soddisfatta: un permesso senza vincoli concede l'accesso a ogni membro
del registro.

### Serializzazione dei vincoli logici

*Model* §2.5.2 stabilisce che un `LogicalConstraint` confronta **vincoli
esistenti**, e l'Esempio 15 di *Model* §2.5.4 li riferisce per IRI dentro un
`@list`, definendoli altrove. Il profilo segue la stessa forma: gli operandi
sono riferimenti `{"@id": …}` a nodi `Constraint` con `uid`, e i nodi stanno
nello stesso documento, dentro un `@graph`. Il compilatore risolve i
riferimenti solo all'interno del documento.

Esempio (policy di prova, non quella di riferimento; file
`policies/archive.jsonld`):

```json
{
  "@context": [
    "http://www.w3.org/ns/odrl.jsonld",
    { "zk": "https://github.com/dedonnodev/zk-odrl/profile#",
      "ex": "http://example.com/" }
  ],
  "@graph": [
    {
      "@type": "Set",
      "uid": "ex:policy/archive",
      "profile": "https://github.com/dedonnodev/zk-odrl/profile",
      "conflict": "prohibit",
      "permission": [{
        "target": "ex:resource/archive",
        "action": "use",
        "constraint": [{
          "@type": "LogicalConstraint",
          "or": { "@list": [
            { "@id": "ex:policy/archive/c1" },
            { "@id": "ex:policy/archive/c2" }
          ] }
        }]
      }]
    },
    {
      "@type": "Constraint",
      "uid": "ex:policy/archive/c1",
      "leftOperand": "zk:role",
      "operator": "eq",
      "rightOperand": { "@id": "zk:role/manager" }
    },
    {
      "@type": "Constraint",
      "uid": "ex:policy/archive/c2",
      "leftOperand": "zk:clearanceLevel",
      "operator": "gteq",
      "rightOperand": { "@value": "3", "@type": "xsd:integer" }
    }
  ]
}
```

Regole di validazione dei vincoli logici:

- la lista `constraint` di una regola contiene **o** soli `Constraint`
  (congiunzione implicita) **o** un solo `LogicalConstraint`; la forma mista
  equivale a un'espressione su due livelli ed è fuori profilo;
- gli operandi sono `Constraint` semplici: un operando che è a sua volta un
  `LogicalConstraint` (annidamento) è fuori profilo;
- ogni operando è un'istanza distinta (*Model* §2.5.2) e ogni `Constraint` del
  `@graph` è riferito da esattamente un operando;
- un riferimento che non si risolve nel documento è un errore.

Gli operandi non vanno messi anche nella lista `constraint` della regola:
lì sarebbero in congiunzione con il vincolo logico.

## 7. Tabella di codifica

Ogni valore che entra nel circuito è un elemento del campo scalare di BN254,
qui sempre un intero sotto 2^64. La tabella sta in un unico file condiviso,
`vocab/attributes.json`, letto sia dal compilatore di policy sia dall'issuer:
se i due codificassero in modo diverso, nessuna prova risulterebbe valida. Il
file usa IRI completi; la posizione di un operando nell'array `operands` è il
suo indice nel vettore dei valori valutabili, e l'IRI di un valore enum è
`<IRI dell'operando>/<nome>`.

**Regola per gli enum.** I valori di un enum sono gli interi `1..n`; **lo 0 è
riservato** e non è mai un valore valido. Uno 0 in un attributo enum indica
quindi un errore di codifica.

| Attributo | IRI del valore | Codice |
|---|---|---|
| `zk:department` | `zk:department/RnD` | 1 |
| | `zk:department/Admin` | 2 |
| | `zk:department/Sales` | 3 |
| | `zk:department/Operations` | 4 |
| `zk:role` | `zk:role/employee` | 1 |
| | `zk:role/manager` | 2 |
| | `zk:role/contractor` | 3 |
| `zk:badgeStatus` | `zk:badgeStatus/active` | 1 |
| | `zk:badgeStatus/suspended` | 2 |
| `zk:clearanceLevel` | intero, nessuna tabella | 0..5 |
| `zk:dayOfWeek` | intero, nessuna tabella | 0..6 (lunedì 0, domenica 6) |
| `dateTime` | `xsd:dateTime` con fuso | secondi Unix UTC |

**Indici degli operandi.** Ogni `leftOperand` ha un indice nel vettore dei
valori valutabili del circuito:

| Indice | `leftOperand` |
|---|---|
| 0 | `zk:department` |
| 1 | `zk:role` |
| 2 | `zk:clearanceLevel` |
| 3 | `zk:badgeStatus` |
| 4 | `zk:dayOfWeek` |
| 5 | `dateTime` |

**Risorse.** Ogni coppia (`target`, `action`) ha un `resourceId` intero, a
partire da 1 (lo 0 è riservato), nella stessa tabella. Il `resourceId` entra
anche nel `policyHash` (vedi [design.md](design.md)), quindi una policy
registrata vale solo per la propria coppia:

| `target` | `action` | `resourceId` |
|---|---|---|
| `ex:resource/printer-3F` | `print` | 1 |
| `ex:resource/printer-3F` | `reproduce` | 2 (policy di prova) |
| `ex:resource/archive` | `use` | 3 (policy di prova) |

I codici sono parte del formato: cambiarli cambia i `policyHash` registrati e
la codifica degli attributi attestati.

## 8. Tempo

- **`dateTime` è in secondi UTC.** Un `rightOperand` `xsd:dateTime` deve avere
  un fuso esplicito (`Z` oppure `±hh:mm`) e il compilatore lo converte in
  secondi Unix UTC. Un valore senza fuso, oppure un `xsd:date`, è ambiguo e
  viene rifiutato; *Vocab* §4.5.6 raccomanda già il fuso. Sono rifiutate anche
  le frazioni di secondo: troncarle allargherebbe di un secondo una soglia
  `gteq`, e arrotondarle dipenderebbe dall'operatore.
- **L'istante valutato è `now`,** un input pubblico scelto dal prover al
  momento della prova e controllato dal contratto rispetto a
  `block.timestamp` con tolleranza di 300 s (`TOLERANCE`). Ne segue, in
  generale, che ogni limite superiore sul tempo può essere superato di al più
  `TOLERANCE`: vale per il confine venerdì→sabato di `dayOfWeek lt 5` come per
  la scadenza di un `dateTime lt T` o `lteq T`.
- **`zk:dayOfWeek = (now / 86400 + 3) mod 7`,** con divisione intera e lunedì
  = 0: il 1° gennaio 1970 era un giovedì (3). Il tempo Unix ignora i secondi
  intercalari, quindi ogni giorno dura esattamente 86400 s.
- **Il giorno cambia alle 00:00 UTC,** cioè alle 01:00 (ora solare) o alle
  02:00 (ora legale) italiane. Una regola "da lunedì a venerdì" vale quindi, in
  ora italiana, dalle 01:00/02:00 del lunedì alle 01:00/02:00 del sabato. È un
  limite dichiarato del profilo: gestire un fuso nel circuito richiederebbe le
  regole dell'ora legale come dati della policy.
- **Niente vincoli sull'ora del giorno.** Per semplicità il profilo vincola il
  giorno della settimana e non l'orario di lavoro. Un `zk:hourOfDay = (now /
  3600) mod 24` riuserebbe lo stesso meccanismo: un valore derivato in più e
  due slot (`gteq`, `lt`) nella policy.


## 9. Policy di riferimento: la stampante

Caso d'uso: la stampante del terzo piano è utilizzabile dai dipendenti di R&D
e dell'Amministrazione nei giorni feriali; chi ha il badge sospeso non può
stampare in nessun caso.

```json
{
  "@context": [
    "http://www.w3.org/ns/odrl.jsonld",
    { "zk": "https://github.com/dedonnodev/zk-odrl/profile#",
      "ex": "http://example.com/" }
  ],
  "@type": "Set",
  "uid": "ex:policy/printer-3F",
  "profile": "https://github.com/dedonnodev/zk-odrl/profile",
  "conflict": "prohibit",
  "permission": [{
    "target": "ex:resource/printer-3F",
    "action": "print",
    "constraint": [
      {
        "leftOperand": "zk:department",
        "operator": "isAnyOf",
        "rightOperand": [
          { "@id": "zk:department/RnD" },
          { "@id": "zk:department/Admin" }
        ]
      },
      {
        "leftOperand": "zk:dayOfWeek",
        "operator": "lt",
        "rightOperand": { "@value": "5", "@type": "xsd:integer" }
      }
    ]
  }],
  "prohibition": [{
    "target": "ex:resource/printer-3F",
    "action": "print",
    "constraint": [{
      "leftOperand": "zk:badgeStatus",
      "operator": "eq",
      "rightOperand": { "@id": "zk:badgeStatus/suspended" }
    }]
  }]
}
```

La policy usa 2 dei 4 slot del permesso e 1 dei 4 slot della proibizione. Gli
attributi `role` e `clearanceLevel` non compaiono: servono alle policy di prova
(per esempio un intervallo su un valore privato).

Codifica negli slot (`idx`, `op`, `len`, `val[0..3]`):

| Regola | Slot | `idx` | `op` | `len` | `val` |
|---|---|---|---|---|---|
| permission, modo `and` (1) | 0 | 0 (`department`) | 7 (`isAnyOf`) | 2 | `[1, 2, 0, 0]` |
| | 1 | 4 (`dayOfWeek`) | 3 (`lt`) | 1 | `[5, 0, 0, 0]` |
| | 2, 3 | 0 | 0 (`noop`) | 0 | `[0, 0, 0, 0]` |
| prohibition, modo `and` (1), `prohActive = 1` | 0 | 3 (`badgeStatus`) | 1 (`eq`) | 1 | `[2, 0, 0, 0]` |
| | 1, 2, 3 | 0 | 0 (`noop`) | 0 | `[0, 0, 0, 0]` |

Esiti attesi con la policy registrata per `resourceId = 1`:

| Richiedente | Esito | Dove fallisce |
|---|---|---|
| R&D, badge attivo, mercoledì | concesso | — |
| Sales, badge attivo, mercoledì | negato | `isAnyOf` falso: la prova non è generabile |
| R&D, badge attivo, sabato | negato | `dayOfWeek lt 5` falso |
| R&D, badge sospeso, mercoledì | negato | proibizione attiva |

## 10. Tabella di copertura ODRL → circuito

Legenda dello stato:

- **supportato**: il compilatore lo accetta e il circuito lo valuta (o lo
  valuta il contratto, dove indicato);
- **fuori profilo**: dimostrabile in un circuito in linea di principio, escluso
  solo per ambito e tempi del prototipo;
- **non dimostrabile**: non esprimibile come predicato su dati attestati
  valutato in un singolo istante, quindi fuori dalla portata di una prova ZK
  per sua natura.

### Policy e regole

| Costrutto | Stato | Motivo |
|---|---|---|
| `Set` (*Model* §2.1.1) | supportato | È il tipo di policy del profilo. |
| `Offer`, `Agreement`, `Ticket`, `Request`, `Assertion`, `Privacy` | fuori profilo | Esprimono rapporti fra parti che il controllo accessi del prototipo non modella. |
| `uid`, `profile` | supportato | Obbligatori; identificano policy e sottoinsieme. |
| `conflict: prohibit` (*Model* §2.10) | supportato | Cablato nel circuito come `permOK AND NOT prohHit`. |
| `conflict: perm`, `conflict: invalid` | fuori profilo | Una sola strategia nel circuito; `perm` renderebbe inutile la proibizione. |
| `inheritFrom` (*Model* §2.9) | fuori profilo | L'ereditarietà si risolverebbe nel compilatore, ma moltiplica i casi di conflitto. |
| `permission` (*Model* §2.6.1) | supportato | Una per policy, fino a N vincoli. |
| `prohibition` (*Model* §2.6.2) | supportato | Zero o una per policy, fino a N vincoli, attivata da `prohActive`. |
| più `permission` o più `prohibition` | fuori profilo | Richiederebbe un OR fra regole nel circuito; fattibile, ma raddoppia gli slot. |
| `duty` su `permission` (*Model* §2.6.5) | non dimostrabile | È un'azione da compiere, spesso dopo l'accesso o fuori dal sistema: una prova attesta uno stato, non un comportamento futuro. |
| `obligation` (*Model* §2.6.4) | non dimostrabile | Stesso motivo del `duty`, a livello di policy. |
| `consequence` (*Model* §2.6.6) | non dimostrabile | Dipende dal mancato adempimento di un dovere, osservabile solo dopo. |
| `remedy` (*Model* §2.6.7) | non dimostrabile | Azione riparatoria successiva alla violazione di una proibizione. |
| `target` | supportato | Con l'azione forma la coppia mappata su `resourceId`, che entra nel `policyHash` ed è controllata dal contratto. |
| `action` | supportato | Una o più per regola; ogni coppia (`target`, `action`) diventa una policy registrata con il proprio `resourceId`. |
| `includedIn` / `implies` fra azioni | fuori profilo | Il profilo evita la gerarchia imponendo la stessa azione su permesso e proibizione. |
| `assignee` | supportato | Solo come registro dell'issuer, cioè l'insieme dei dipendenti di cui attesta gli attributi. |
| `assigner` | supportato | Metadato ammesso e ignorato: non condiziona la decisione. |
| `AssetCollection`, `partOf` di asset (*Model* §2.2.2) | fuori profilo | Si risolverebbe scegliendo la policy della risorsa, prima della prova; non serve al caso d'uso. |
| `PartyCollection` diversa dal registro | fuori profilo | Il prototipo ha un solo registro e un solo issuer. |
| `refinement` di `action`, asset o parte (*Model* §2.5.4-2.5.6) | fuori profilo | Restringe la semantica dell'azione o delle collezioni, non le condizioni sul richiedente. |
| `rightOperandReference` | fuori profilo | Il valore va dereferenziato al momento della valutazione e non sarebbe nel `policyHash` registrato. |
| `unit` | fuori profilo | Richiede conversioni di unità nel compilatore. |
| `status` | non dimostrabile | Porta lo stato d'uso accumulato fra un uso e l'altro (per esempio le esecuzioni già avvenute), come `count`. |
| `dataType` | supportato | Solo `xsd:integer` e `xsd:dateTime`, tramite letterali tipati. |

### Operatori (*Vocab* §3.16)

| Operatore | Stato | Motivo |
|---|---|---|
| `eq` | supportato | Codice 1, uguaglianza su valori a 64 bit. |
| `neq` | supportato | Codice 2, negazione di `eq`. |
| `lt` | supportato | Codice 3, comparatore a 64 bit su valori con range check. |
| `lteq` | supportato | Codice 4, negazione di `gt`. |
| `gt` | supportato | Codice 5, comparatore a 64 bit. |
| `gteq` | supportato | Codice 6, negazione di `lt`. |
| `isAnyOf` | supportato | Codice 7, OR di uguaglianze su al più K valori pubblici. |
| `isNoneOf` | supportato | Codice 8, negazione di `isAnyOf`. |
| `isA` | fuori profilo | Richiede una gerarchia di classi; il compilatore potrebbe espanderla in `isAnyOf` sulle istanze. |
| `isPartOf` | fuori profilo | Gli attributi del registro sono scalari; con una gerarchia nota si ridurrebbe a `isAnyOf`. |
| `hasPart` | fuori profilo | Presuppone un attributo a valori insieme, che il profilo non ha. |
| `isAllOf` | fuori profilo | Presuppone un attributo a valori insieme, come `hasPart`. |

### Vincoli logici (*Vocab* §3.17)

| Costrutto | Stato | Motivo |
|---|---|---|
| `and` | supportato | Modo 1; è anche la lettura della lista `constraint`. |
| `or` | supportato | Modo 2, un livello: somma dei risultati abilitati ≥ 1. |
| `xone` | supportato | Modo 3, un livello: somma dei risultati abilitati = 1. |
| `andSequence` | non dimostrabile | Richiede che i vincoli siano soddisfatti in un ordine temporale, cioè una storia di eventi; una prova attesta un solo istante. |
| vincoli logici annidati | fuori profilo | Servirebbe un albero logico nel circuito; il modo piatto per regola copre il caso d'uso. |
| vincoli semplici e logici misti nella stessa regola | fuori profilo | Equivale a due livelli di logica. |

### LeftOperand (*Vocab* §4.5)

| `leftOperand` | Stato | Motivo |
|---|---|---|
| `dateTime` | supportato | Confrontato con `now` pubblico, in secondi UTC. |
| `zk:department`, `zk:role`, `zk:clearanceLevel`, `zk:badgeStatus` | supportato | Attributi privati attestati dall'issuer. |
| `zk:dayOfWeek` | supportato | Derivato da `now` nel circuito. |
| `count` | non dimostrabile | Conta le esecuzioni passate, cioè uno stato fra un uso e l'altro (§11). |
| `meteredTime` | non dimostrabile | Tempo d'uso accumulato su più sessioni: uno stato che nessuno attesta. |
| `elapsedTime` | non dimostrabile | Durata continua dell'uso, nota solo alla fine dell'uso. |
| `timeInterval` | non dimostrabile | Periodo dall'esecuzione precedente: richiede di sapere quando è avvenuta, come `count`. |
| `delayPeriod` | non dimostrabile | Ritardo rispetto a un evento esterno di cui il circuito non ha un'attestazione. |
| `event` | non dimostrabile | Dipende da un evento esterno non attestato. |
| `payAmount` | non dimostrabile | Riguarda un pagamento, cioè un'azione esterna di tipo `duty`. |
| `policyUsage` (*Vocab* §4.6.1, `rightOperand`) | fuori profilo | Coincide con `now`, ma serve solo insieme a `event`. |
| `purpose` | fuori profilo | Lo dichiara il richiedente; avrebbe senso solo se attestato. |
| `recipient` | fuori profilo | Parte che riceve l'esito dell'azione; non è il segnale pubblico `recipient` del circuito. |
| `spatial`, `spatialCoordinates`, `virtualLocation`, `systemDevice`, `deliveryChannel` | fuori profilo | Contesto della richiesta: servirebbe un'attestazione del luogo o del dispositivo, oggi assente. |
| `industry`, `language`, `media`, `product`, `fileFormat`, `resolution`, `version` | fuori profilo | Proprietà dell'asset o dell'uso, non del richiedente. |
| `absolutePosition`, `absoluteSpatialPosition`, `absoluteTemporalPosition`, `relativePosition`, `relativeSpatialPosition`, `relativeTemporalPosition`, `absoluteSize`, `relativeSize`, `percentage`, `unitOfCount` | fuori profilo | Descrivono parti o dimensioni dell'asset, non il richiedente. |

## 11. Cosa non è dimostrabile e cosa è solo fuori profilo

La distinzione conta per la domanda della tesi, cioè se le prove ZK funzionano su ODRL
come su XACML.

**Non dimostrabile per principio.** Una prova ZK attesta che, in un istante,
dati attestati soddisfano un predicato. Restano fuori:

- **`duty`, `obligation`, `consequence`, `remedy`:** sono azioni nel mondo,
  spesso successive all'accesso o esterne al sistema. Come gli *obligation* di
  XACML, vanno all'enforcement (PEP), non alla prova.
- **`andSequence`:** esprime un ordine temporale fra eventi; un singolo
  istante non contiene una sequenza.
- **`count`** (e allo stesso modo `status`, `meteredTime`, `timeInterval`): richiede di
  ricordare gli usi precedenti. La prova da sola non ha memoria, quindi lo
  stato deve stare altrove.


**Fuori profilo solo per ambito.** Annidamento di vincoli logici, più regole
per policy, `isA`/`isPartOf`/`hasPart`/`isAllOf`, `inheritFrom`,
`refinement`, gli altri tipi di policy e i `leftOperand` di contesto sono tutti
esprimibili in un circuito: con un albero logico, più slot, attributi a
insieme, oppure con un'espansione nel compilatore. Restano fuori perché il
prototipo ha un solo caso d'uso e tempi stretti, non per un limite della
crittografia.
