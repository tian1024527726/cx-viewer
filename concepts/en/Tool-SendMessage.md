# SendMessage

## Definition

Sends messages between agents within a team. Used for direct communication, broadcasting, and protocol messages (shutdown requests/responses, plan approval).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Recipient: teammate name, or `"*"` for broadcast to all |
| `message` | string / object | Yes | Plain text message or structured protocol object |
| `summary` | string | No | A 5-10 word preview shown in the UI |

## Message Types

### Plain Text
Direct messages between teammates for coordination, status updates, and task discussions.

### Shutdown Request
Asks a teammate to gracefully shut down: `{ type: "shutdown_request", reason: "..." }`

### Shutdown Response
Teammate approves or rejects a shutdown: `{ type: "shutdown_response", approve: true/false }`

### Plan Approval Response
Approves or rejects a teammate's plan: `{ type: "plan_approval_response", approve: true/false }`

## Broadcast vs Direct

- **Direct** (`to: "teammate-name"`): Send to a specific teammate — preferred for most communication
- **Broadcast** (`to: "*"`): Send to all teammates — use sparingly, only for critical team-wide announcements

## Related Tools

| Tool | Purpose |
|------|---------|
| `TeamCreate` | Create a new team |
| `TeamDelete` | Remove team when done |
| `Agent` | Spawn teammates that join the team |
| `TaskCreate` / `TaskUpdate` / `TaskList` | Manage the shared task list |

## Significance in cc-viewer

SendMessage calls represent inter-agent communication within a team session. In the tool usage statistics, high SendMessage counts indicate active team coordination. In the request timeline, SendMessage exchanges show how agents collaborate — passing results, requesting help, and coordinating shutdown sequences.
