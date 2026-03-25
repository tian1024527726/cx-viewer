# SendMessage

## Definicja

Wysyła wiadomości między agentami w zespole. Służy do bezpośredniej komunikacji, rozgłaszania oraz wiadomości protokołowych (żądania/odpowiedzi zamknięcia, zatwierdzanie planów).

## Parametry

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `to` | string | Tak | Odbiorca: nazwa członka zespołu lub `"*"` dla rozgłoszenia do wszystkich |
| `message` | string / object | Tak | Wiadomość tekstowa lub strukturalny obiekt protokołowy |
| `summary` | string | Nie | Podgląd 5-10 słów wyświetlany w interfejsie |

## Typy wiadomości

### Tekst
Bezpośrednie wiadomości między członkami zespołu do koordynacji, aktualizacji statusu i dyskusji o zadaniach.

### Żądanie zamknięcia
Prosi członka zespołu o uporządkowane zamknięcie: `{ type: "shutdown_request", reason: "..." }`

### Odpowiedź na zamknięcie
Członek zespołu zatwierdza lub odrzuca zamknięcie: `{ type: "shutdown_response", approve: true/false }`

### Odpowiedź zatwierdzenia planu
Zatwierdza lub odrzuca plan członka zespołu: `{ type: "plan_approval_response", approve: true/false }`

## Rozgłaszanie vs. bezpośrednie

- **Bezpośrednie** (`to: "nazwa-członka"`): Wyślij do konkretnego członka — preferowane dla większości komunikacji
- **Rozgłaszanie** (`to: "*"`): Wyślij do wszystkich członków — używać oszczędnie, tylko dla krytycznych ogłoszeń zespołowych

## Powiązane narzędzia

| Narzędzie | Przeznaczenie |
|-----------|---------------|
| `TeamCreate` | Utwórz nowy zespół |
| `TeamDelete` | Usuń zespół po zakończeniu |
| `Agent` | Uruchom członków zespołu dołączających do zespołu |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Zarządzanie wspólną listą zadań |

## Znaczenie w cc-viewer

Wywołania SendMessage reprezentują komunikację między agentami w sesji zespołu. W statystykach użycia narzędzi wysoka liczba SendMessage wskazuje na aktywną koordynację zespołu. Na osi czasu żądań wymiany SendMessage pokazują, jak agenci współpracują — przekazują wyniki, proszą o pomoc i koordynują sekwencje zamykania.
