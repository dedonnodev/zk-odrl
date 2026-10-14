# ODRL e XACML: pro e contro

TL;DR: XACML descrive regole che producono una decisione (`Permit` o
`Deny`); ODRL descrive permessi, divieti e doveri su un asset.

## XACML 3.0

**Pro**
- Semantica di valutazione normativa, con algoritmi di combinazione
  (`deny-overrides`, `permit-overrides`, …) ed esiti `NotApplicable` e
  `Indeterminate` [1].
- Architettura di riferimento: PAP, PDP, PEP, PIP [1].
- Precedente diretto ZK+XACML con misure su Ethereum [5].

**Contro**
- Le regole producono decisioni: permessi e divieti su una risorsa vanno
  ricostruiti a partire da esse.
- XML verboso; la libreria di funzioni (stringhe, espressioni regolari,
  insiemi) è ampia e in gran parte costosa da portare in un circuito.

## ODRL 2.2

**Pro**
- Divieti di prima classe, con una strategia di conflitto esplicita per policy
  (`conflict`) [2 §2.10].
- Meccanismo dei profili: una policy dichiara i termini che usa, e un sistema
  che non conosce il profilo deve rifiutarla [2 §3].
- JSON-LD e IRI: termini non ambigui, policy legata all'asset (`target`) [2].
- Vocabolario ricco di operatori e `leftOperand` [3].

**Contro**
- Nessuna semantica di valutazione normativa: esiste solo una bozza di
  Community Group [4], quindi il profilo deve fissare la semantica (mondo chiuso,
  `conflict: prohibit`).
- Nessuna architettura prescritta: i ruoli vanno presi da XACML.
- L'elaborazione JSON-LD (contesti, espansione) aggiunge complessità e un
  rischio di rete, da eliminare con una copia locale del contesto.
- Molti costrutti dipendono da stato o eventi (`duty`, `andSequence`, `count`)
  e non sono dimostrabili con una prova sola.

## Lo stesso esempio nei due linguaggi

Regola: *i dipendenti di R&D e Admin possono stampare dal lunedì al venerdì,
mai con il badge sospeso.* In entrambe le versioni `dayOfWeek` conta da
lunedì = 0, quindi "dal lunedì al venerdì" diventa `dayOfWeek < 5`.

**XACML 3.0.** Due `Rule` e un algoritmo di combinazione. I nomi degli
attributi (`department`, `dayOfWeek`, `badgeStatus`) sono abbreviati rispetto
agli identificatori URN completi.

```xml
<Policy PolicyId="printer-3F"
        RuleCombiningAlgId="urn:oasis:names:tc:xacml:3.0:rule-combining-algorithm:deny-overrides">
  <Target>
    <AnyOf><AllOf>
      <Match MatchId="urn:oasis:names:tc:xacml:1.0:function:string-equal">
        <AttributeValue DataType="http://www.w3.org/2001/XMLSchema#string">print</AttributeValue>
        <AttributeDesignator Category="...:action-category:action"
            AttributeId="action-id" DataType="...#string" MustBePresent="true"/>
      </Match>
    </AllOf></AnyOf>
  </Target>

  <Rule RuleId="deny-suspended" Effect="Deny">
    <Condition>
      <Apply FunctionId="...:function:string-equal">
        <Apply FunctionId="...:function:string-one-and-only">
          <AttributeDesignator AttributeId="badgeStatus" .../>
        </Apply>
        <AttributeValue DataType="...#string">suspended</AttributeValue>
      </Apply>
    </Condition>
  </Rule>

  <Rule RuleId="permit-staff" Effect="Permit">
    <Condition>
      <Apply FunctionId="...:function:and">
        <Apply FunctionId="...:function:or">
          <Apply FunctionId="...:function:string-is-in">
            <AttributeValue DataType="...#string">RnD</AttributeValue>
            <AttributeDesignator AttributeId="department" .../>
          </Apply>
          <Apply FunctionId="...:function:string-is-in">
            <AttributeValue DataType="...#string">Admin</AttributeValue>
            <AttributeDesignator AttributeId="department" .../>
          </Apply>
        </Apply>
        <Apply FunctionId="...:function:integer-less-than">
          <Apply FunctionId="...:function:integer-one-and-only">
            <AttributeDesignator AttributeId="dayOfWeek" .../>
          </Apply>
          <AttributeValue DataType="...#integer">5</AttributeValue>
        </Apply>
      </Apply>
    </Condition>
  </Rule>
</Policy>
```

**ODRL 2.2.** Un permesso e un divieto sullo stesso asset e sulla stessa
azione. Il divieto vince perché la policy dichiara `conflict: prohibit`.

```json
{
  "@context": "http://www.w3.org/ns/odrl.jsonld",
  "@type": "Set",
  "uid": "http://example.com/policy/printer-3F",
  "conflict": "prohibit",
  "permission": [{
    "target": "http://example.com/resource/printer-3F",
    "action": "print",
    "constraint": [
      { "leftOperand": "http://example.com/department",
        "operator": "isAnyOf",
        "rightOperand": ["RnD", "Admin"] },
      { "leftOperand": "http://example.com/dayOfWeek",
        "operator": "lt",
        "rightOperand": 5 }
    ]
  }],
  "prohibition": [{
    "target": "http://example.com/resource/printer-3F",
    "action": "print",
    "constraint": [
      { "leftOperand": "http://example.com/badgeStatus",
        "operator": "eq",
        "rightOperand": "suspended" }
    ]
  }]
}
```

La versione completa, che il compilatore accetta, è `policies/printer.jsonld`:
usa il profilo del progetto, con `leftOperand` e valori come IRI.

Due differenze si vedono a colpo d'occhio. In ODRL permesso e divieto sono
oggetti distinti, e l'insieme `RnD`, `Admin` è un solo vincolo con
`isAnyOf`. In XACML il divieto è una `Rule` come le altre, il confronto è una
composizione di funzioni e l'insieme va costruito a mano.

## Cosa conta per lo ZK

Per una prova ZK i due linguaggi si riducono alla stessa cosa: vincoli su
attributi, combinati con operatori logici e valutati in un istante. Ciò che
una prova non può attestare è dello stesso tipo in entrambi: le `obligation`
di XACML e i `duty` di ODRL sono azioni da compiere e vanno all'enforcement
(PEP), non alla prova. ODRL aggiunge costrutti che richiedono memoria fra un
accesso e l'altro (`andSequence`, `count`, `meteredTime`, `timeInterval`).

I costi di ODRL (semantica da fissare, architettura da prendere altrove,
JSON-LD) si pagano una volta sola, nel profilo e nel compilatore. In cambio un
sottoinsieme dichiarato del linguaggio permette di valutare ogni policy con un
unico circuito generico, in cui la policy è un input.

## Fonti

1. OASIS, *eXtensible Access Control Markup Language (XACML) Version 3.0*,
   OASIS Standard, 2013.
   <https://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html>
2. W3C, *ODRL Information Model 2.2*, Recommendation, 2018.
   <https://www.w3.org/TR/odrl-model/>
3. W3C, *ODRL Vocabulary & Expression 2.2*, Recommendation, 2018.
   <https://www.w3.org/TR/odrl-vocab/>
4. W3C ODRL Community Group, *ODRL Formal Semantics*, bozza.
   <https://w3c.github.io/odrl/formal-semantics/>
5. D. Di Francesco Maesa, A. Lisi, P. Mori, L. Ricci, G. Boschi, *Self
   sovereign and blockchain based access control: Supporting attributes
   privacy with zero knowledge*, Journal of Network and Computer Applications
   212 (2023) 103577. <https://doi.org/10.1016/j.jnca.2022.103577>
