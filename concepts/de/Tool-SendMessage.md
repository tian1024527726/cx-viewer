# SendMessage

## Definition

Sendet Nachrichten zwischen Agenten innerhalb eines Teams. Wird für direkte Kommunikation, Broadcasting und Protokollnachrichten (Shutdown-Anfragen/-Antworten, Plan-Genehmigung) verwendet.

## Parameter

| Parameter | Typ | Erforderlich | Beschreibung |
|-----------|-----|--------------|--------------|
| `to` | string | Ja | Empfänger: Teammitglied-Name oder `"*"` für Broadcast an alle |
| `message` | string / object | Ja | Klartextnachricht oder strukturiertes Protokollobjekt |
| `summary` | string | Nein | Eine 5-10 Wörter umfassende Vorschau in der UI |

## Nachrichtentypen

### Klartext
Direktnachrichten zwischen Teammitgliedern zur Koordination, Statusaktualisierung und Aufgabenbesprechung.

### Shutdown-Anfrage
Fordert ein Teammitglied zum geordneten Herunterfahren auf: `{ type: "shutdown_request", reason: "..." }`

### Shutdown-Antwort
Teammitglied genehmigt oder lehnt das Herunterfahren ab: `{ type: "shutdown_response", approve: true/false }`

### Plan-Genehmigungs-Antwort
Genehmigt oder lehnt den Plan eines Teammitglieds ab: `{ type: "plan_approval_response", approve: true/false }`

## Broadcast vs. Direkt

- **Direkt** (`to: "Teammitglied-Name"`): An ein bestimmtes Teammitglied senden — bevorzugt für die meiste Kommunikation
- **Broadcast** (`to: "*"`): An alle Teammitglieder senden — nur sparsam für kritische teamweite Ankündigungen verwenden

## Verwandte Tools

| Tool | Zweck |
|------|-------|
| `TeamCreate` | Neues Team erstellen |
| `TeamDelete` | Team nach Abschluss entfernen |
| `Agent` | Teammitglieder starten, die dem Team beitreten |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Gemeinsame Aufgabenliste verwalten |

## Bedeutung in cc-viewer

SendMessage-Aufrufe stellen die Kommunikation zwischen Agenten innerhalb einer Teamsitzung dar. In der Toolnutzungsstatistik weisen hohe SendMessage-Zahlen auf aktive Teamkoordination hin. In der Anfrage-Timeline zeigen SendMessage-Austausche, wie Agenten zusammenarbeiten — Ergebnisse weiterleiten, Hilfe anfordern und Shutdown-Sequenzen koordinieren.
