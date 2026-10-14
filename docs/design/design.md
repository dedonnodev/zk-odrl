# Documento di progetto ZK-ODRL

Questo documento fissa la specifica di codifica fra policy e circuito:
parametri del circuito, larghezza dei valori, layout degli slot e preimage del
`policyHash`. Le fasi di implementazione consultano queste decisioni invece di
prenderle.

Il sottoinsieme ODRL accettato, la tabella di codifica degli attributi, la
policy di riferimento e la tabella di copertura sono in
[profilo-odrl.md](profilo-odrl.md). Il confronto dei ruoli con XACML
(PAP, PDP, PEP, PIP) è in [../odrl-vs-xacml.md](../odrl-vs-xacml.md).

Convenzione sulle evidenze: ogni numero di prestazioni è marcato
*verificato* (con il comando che lo ha prodotto) oppure *supposto*.


## 2. Parametri del circuito

Il circuito è unico e generico, `OdrlPolicy`: la policy è un input, non è
compilata nel circuito. Modificare una policy non richiede quindi né un nuovo trusted setup né un nuovo verifier.

| Parametro | Valore | Significato |
|---|---|---|
| `N` | 4 | slot per regola: N per il permesso e N per la proibizione |
| `K` | 4 | voci massime di un insieme (`isAnyOf`, `isNoneOf`) |
| `E` | 6 | valori valutabili: 4 attributi più `dayOfWeek` e `dateTime` |


**Motivazione di K = 4.** La policy di riferimento usa un insieme di 2 valori.
Per ogni sottoinsieme di un enum con al più 8 valori, il sottoinsieme stesso
o il suo complemento ha al più 4 elementi, quindi si scrive con `isAnyOf` o
`isNoneOf`; gli enum
del profilo hanno al più 4 valori. Per `dayOfWeek` i "giorni feriali" si
scrivono `lt 5`, e un insieme di 5 o più giorni ha un complemento di al più 2.
Il limite superiore è K ≤ 13, perché l'hash di uno slot ha `K + 3` input e
Poseidon di circomlib ne accetta al più 16. Ogni voce costa un'uguaglianza e
un range check per slot, per cui K resta piccolo.

**N negli esperimenti.** La campagna sperimentale ricompila il circuito con
N ∈ {1, 2, 4, 8, 16}; la struttura del `policyHash` (§6) funziona per ogni N.


## 3. Larghezza dei valori e range check

Tutti gli attributi, le soglie, i valori degli insiemi e i tempi sono interi
senza segno a **64 bit**. Il circuito applica `Num2Bits(64)` all'ingresso,
prima di qualsiasi comparatore, a:

- i 4 attributi;
- `now`;
- tutte le voci `val[j]` di tutti gli slot, di entrambe le regole.


Il motivo: `LessThan(n)` di circomlib presuppone ingressi sotto `2^n` ma non lo
verifica. Su un valore più grande la sottrazione si avvolge nel campo e il
confronto dà un risultato sbagliato, che un prover malevolo può sfruttare.
Bastano 64 bit per i secondi Unix (fino a ben oltre l'anno 10^11) e per ogni
enum, e i comparatori restano piccoli; la larghezza piena del campo (254 bit) è
esclusa anche perché `Num2Bits(254)` ammette due decomposizioni dello stesso
valore.

Altri controlli d'ingresso:

| Segnale | Vincolo |
|---|---|
| `idx` di ogni slot | `idx ∈ {0..E-1}`: il selettore `Σ_j IsEqual(idx, j)` deve valere 1 |
| `op` di ogni slot | `op ∈ {0..8}`: stesso schema sui 9 codici |
| `len` di ogni slot | `Num2Bits(8)` e `len ≤ K` |
| `mode` di ogni regola | `mode ∈ {1, 2, 3}` |
| `prohActive` | booleano: `prohActive · (prohActive − 1) = 0` |

Che i valori enum rientrino nei domini della tabella (per esempio
`clearanceLevel ≤ 5`) è responsabilità di chi attesta gli attributi: il
circuito garantisce solo i 64 bit.

## 4. Valori valutabili

Il circuito costruisce il vettore `env[E]`, a cui gli slot accedono per indice:

| Indice | Valore | Origine | Visibilità |
|---|---|---|---|
| 0 | `department` | attributo attestato | privato |
| 1 | `role` | attributo attestato | privato |
| 2 | `clearanceLevel` | attributo attestato | privato |
| 3 | `badgeStatus` | attributo attestato | privato |
| 4 | `dayOfWeek` | derivato da `now` | funzione di un valore pubblico |
| 5 | `dateTime` | `now` | pubblico |

La tabella degli indici e dei codici enum è in
[profilo-odrl.md §7](profilo-odrl.md#7-tabella-di-codifica) e nel file
`vocab/attributes.json`, fonte unica per compilatore e issuer.


## 5. Layout degli slot

Ogni regola (permesso, proibizione) ha N slot e un modo di combinazione. Ogni
slot ha quattro campi:

| Campo | Contenuto |
|---|---|
| `idx` | indice in `env[]` del `leftOperand` |
| `op` | codice operatore |
| `len` | numero di voci significative di `val` |
| `val[K]` | soglia oppure insieme; le voci da `len` in poi valgono 0 |

| Codice `op` | Operatore | Risultato `r` dello slot, con `x = env[idx]` |
|---|---|---|
| 0 | `noop` | slot disabilitato |
| 1 | `eq` | `x == val[0]` |
| 2 | `neq` | `1 − eq` |
| 3 | `lt` | `LessThan(64)(x, val[0])` |
| 4 | `lteq` | `1 − gt` |
| 5 | `gt` | `LessThan(64)(val[0], x)` |
| 6 | `gteq` | `1 − lt` |
| 7 | `isAnyOf` | `Σ_{j < len} (x == val[j]) ≥ 1` |
| 8 | `isNoneOf` | `1 − isAnyOf` |

Ogni slot calcola tutti i comparatori e sceglie il risultato con un mux
guidato da `op`; due soli `LessThan(64)` per slot bastano per i quattro
confronti d'ordine.

**Forma canonica** (prodotta dal compilatore, fissata dai vettori di test):

| Tipo di slot | `idx` | `op` | `len` | `val` |
|---|---|---|---|---|
| disabilitato | 0 | 0 | 0 | tutti 0 |
| confronto | indice | 1..6 | 1 | `[soglia, 0, …, 0]` |
| insieme | indice | 7 o 8 | 1..K | valori distinti in ordine crescente, poi 0 |

L'ordine crescente rende lo slot, e quindi il `policyHash`, indipendente da
come l'insieme è scritto nella policy: `[Admin, RnD]` e `[RnD, Admin]` danno
lo stesso hash.

**Flag di abilitazione.** Non è un campo separato: `en = 1 − IsZero(op)`. Sta
quindi nel preimage del `policyHash` attraverso `op`, e non può esistere un
flag incoerente con l'operatore.

**Padding degli insiemi.** Le voci oltre `len` sono 0 e il circuito le esclude
con una maschera per indice, `active_j = (j < len)`, con `len` dentro il
preimage. Uno 0 come sentinella non basterebbe: lo 0 è riservato negli enum ma
è un valore valido per gli interi (`dayOfWeek = 0` è lunedì,
`clearanceLevel = 0` esiste). Senza maschera, `dayOfWeek isAnyOf [2, 4]`
riempito con zeri accetterebbe il lunedì.

**Modo di combinazione** (codici 1 `and`, 2 `or`, 3 `xone`). Con
`S = Σ_i en_i · r_i` e `A = Σ_i en_i`:

```
and:   ruleOK = (S == A)
or:    ruleOK = (S ≥ 1)
xone:  ruleOK = (S == 1)
```

**Decisione.**

```
permOK  = ruleOK(permesso)
prohHit = prohActive · ruleOK(proibizione)
permOK · (1 − prohHit) === 1
```

Se la policy non ha proibizione: `prohActive = 0`, slot tutti disabilitati,
modo `and`. `prohActive` serve perché una regola `and` senza slot abilitati è
vera, e senza il flag una proibizione assente negherebbe tutto.

Se la policy non è soddisfatta, il vincolo finale non ha soluzione: il witness
non si genera e non esiste una prova da inviare.

## 6. Preimage del `policyHash`

Ogni campo che configura la valutazione sta nel preimage dell'unico segnale
`policyHash`. Gli slot sono input privati del circuito: se anche un solo campo
(un operatore, una soglia, `len`, il modo, `prohActive`) ne restasse fuori, il
prover potrebbe sceglierlo a piacere, per esempio disabilitando gli slot, e
dimostrare di soddisfare una policy che non soddisfa.

Ordine, con `H_n` = Poseidon a n input (circomlib nel circuito, `poseidon-lite`
in JS):

```
per ogni regola R ∈ {perm, proh}, per i = 0 .. N-1:
    s_i(R) = H_{K+3}(idx_i, op_i, len_i, val_i[0], …, val_i[K-1])

ruleHash(R):
    h_0     = mode(R)
    h_{i+1} = H_2(h_i, s_i(R))        per i = 0 .. N-1
    ruleHash(R) = h_N

policyHash = H_4(ruleHash(perm), ruleHash(proh), prohActive, resourceId)
```

| Livello | Campi, in ordine |
|---|---|
| slot | `idx`, `op`, `len`, `val[0]` … `val[K-1]` |
| regola | `mode`, poi gli hash degli slot da 0 a N−1 in catena |
| policy | hash del permesso, hash della proibizione, `prohActive`, `resourceId` |

Ragioni della forma:

- **Catena invece di un hash unico.** Con N = 4 e K = 4 i campi sono 60, oltre i
  16 input di Poseidon. La catena di `H_2` funziona per ogni N, compreso
  N = 16 degli esperimenti, ed è la stessa in JS e nel circuito.
- **Slot disabilitati inclusi.** Anche gli slot `noop` entrano nel preimage
  con la loro forma canonica: il prover non può riusare uno slot libero.
- **`resourceId` incluso.** Il `resourceId` identifica la coppia (`target`,
  `action`) nella tabella di `vocab/attributes.json`. Metterlo nel preimage
  lega la policy alla propria coppia: un hash registrato per la stampa non
  può essere riusato per un'altra azione o risorsa, nemmeno per errore
  dell'owner. Non costa segnali in più, perché `resourceId` è già un input
  pubblico. Una policy con più azioni sullo stesso `target` si compila in una
  policy registrata per ogni coppia.

Un test fissa il vettore "policy → slot → hash" della stampante e lo controlla
sia in JS sia nel circuito; chiunque può ricalcolare l'hash dalla policy
pubblicata e dal `resourceId` della tabella, e confrontarlo con quello
registrato on-chain per quel `resourceId`.

