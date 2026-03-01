# Spaztick MCP Integration Spec

## What This Is

MCP (Model Context Protocol) is an open standard that lets Claude (Desktop or Code) connect to external tool servers. Instead of sending messages through Ollama → orchestrator → tool dispatch, an MCP server exposes Spaztick's tools directly to Claude, which handles intent routing and tool selection natively — because *Claude is the LLM*.

This means Claude can talk to Spaztick in much the same way Telegram and the API do today, but without any Ollama involvement in that path.

---

## The Mental Model

**Current Telegram/API flow:**
```
User message
    → Ollama (intent router: TOOL or CHAT?)
    → Ollama (tool orchestrator: which tool + what parameters?)
    → Service layer (task_service, project_service, etc.)
    → Format response
    → Return to user
```

**Proposed MCP flow:**
```
User message (in Claude Desktop / Claude Code)
    → Claude (natively understands intent, picks tools)
    → MCP server (thin wrapper over service layer)
    → Service layer (unchanged)
    → Return result to Claude
    → Claude formats and responds to user
```

The orchestrator's two LLM calls and all the prompt engineering in `INTENT_ROUTER_PROMPT`, `TOOL_ORCHESTRATOR_PROMPT`, and `AVAILABLE_TOOLS_SECTION` become unnecessary for this path — Claude does all of that natively. The service layer (the real business logic) is reused wholesale.

---

## What Changes, What Doesn't

### Unchanged (reused as-is)
- `task_service.py` — all task CRUD logic
- `project_service.py` — all project CRUD logic
- `list_service.py` — all list logic
- `database.py` — schema, migrations, connection
- `date_utils.py` — timezone-aware natural language date resolution
- `config.py` — reads config.json for database path, timezone, user name
- `telegram_bot.py` — coexists completely unaffected
- `web_app.py` — coexists completely unaffected
- The Electron client — unaffected

### Not needed for MCP path
- `orchestrator.py` — its job (routing + tool selection) is done by Claude natively
- `ollama_client.py` — Ollama is not involved in this interface
- The intent router prompt, tool orchestrator prompt, fallback regex inference

### New
- `mcp_server.py` — a new entry point that exposes Spaztick's tools over MCP

---

## The New File: `mcp_server.py`

This file would:
1. Import from the existing service layer (`task_service`, `project_service`, `list_service`, `config`, `date_utils`)
2. Use the MCP Python SDK (`pip install mcp`) to declare tools and handle the protocol
3. Expose each tool with a name, description, and JSON Schema for its parameters
4. Execute the service call when Claude invokes the tool
5. Return a plain-text result

It does **not** need to do any LLM calls, intent routing, or prompt engineering.

### Transport Options

**SSE (Server-Sent Events)** (better for the home server setup):
- `mcp_server.py` runs as an HTTP server on a local port (e.g., 8082)
- Claude Desktop connects to it over the local network
- Better fits the existing architecture where the Python backend runs headless
- Config entry in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "spaztick": {
      "url": "http://homeserver.local:8082/sse"
    }
  }
}
```

For the home server use case, **SSE is the right choice**. It means `mcp_server.py` could be added to `run.py` alongside the web app and Telegram bot, all running on the server, all sharing the same SQLite database.

---

## Tool Mapping

Every one of the existing 16 tools maps cleanly to an MCP tool definition. Here's how they translate:

### Task Tools

| Existing tool | MCP tool name | Notes |
|---|---|---|
| `task_create` | `task_create` | Same parameters |
| `task_find` | `task_find` | Same parameters |
| `task_info` | `task_info` | Same parameters |
| `task_update` | `task_update` | Same parameters |
| `delete_task` | `delete_task` | See confirmation note below |

### Project Tools

| Existing tool | MCP tool name | Notes |
|---|---|---|
| `project_create` | `project_create` | Same |
| `project_list` | `project_list` | Same |
| `project_info` | `project_info` | Same |
| `project_archived` | `project_archived` | Same |
| `project_archive` | `project_archive` | See confirmation note |
| `project_unarchive` | `project_unarchive` | See confirmation note |
| `delete_project` | `delete_project` | See confirmation note |

### List / Tag Tools

| Existing tool | MCP tool name | Notes |
|---|---|---|
| `list_lists` | `list_lists` | Same |
| `tag_list` | `tag_list` | Same |
| `tag_rename` | `tag_rename` | See confirmation note |
| `tag_delete` | `tag_delete` | See confirmation note |

Each tool would have a proper JSON Schema for its parameters, adapted from the existing `AVAILABLE_TOOLS_SECTION` in orchestrator.py (which already contains thorough parameter descriptions).

---

## The Confirmation Pattern

The existing 2-step confirmation for destructive operations (`delete_task`, `delete_project`, `project_archive`, `tag_rename`, `tag_delete`) uses a persisted `telegram_pending_confirm.json` file. That pattern was designed for Telegram's stateless message-by-message interaction.

With Claude/MCP, there are two approaches:

### Option A: Keep the `confirm` parameter (recommended)
Keep the existing `confirm: bool` parameter on destructive tools. When Claude calls `delete_task(number=5)` without `confirm: true`, the tool returns something like:

```
Task 5 is "Buy milk" (incomplete, due today).
To confirm deletion, call this tool again with confirm=true.
```

Claude sees that response and naturally asks the user: *"Are you sure you want to delete 'Buy milk'? I'll need your confirmation before I delete it."* When the user says yes, Claude calls `delete_task(number=5, confirm=true)`.

This approach:
- Requires minimal changes to the existing service call logic
- Leverages Claude's native multi-turn conversation
- Doesn't need the `telegram_pending_confirm.json` file
- Feels natural in Claude's chat interface

### Option B: Let Claude handle confirmation entirely
Remove the `confirm` parameter and instead have `delete_task` return a description of what it *would* delete, then have Claude ask for confirmation in the conversation before calling again. The tool becomes idempotent and returns the same description on each call until a second confirmation tool (or just `confirm: true`) is invoked.

Option A is cleaner because it keeps the existing safety logic inside the service layer, where it belongs.

---

## Date Handling

The existing `date_utils.py` provides timezone-aware resolution of natural language dates ("today", "next Friday", "tomorrow+3"). This is still valuable with MCP because:

- Claude will pass dates in natural language (users say "due tomorrow")
- The MCP server should resolve these using `date_utils.py` exactly as the orchestrator does today, using the user's configured timezone from `config.json`
- This means Claude doesn't need to know the user's timezone — the MCP server handles it transparently

Alternatively, Claude can resolve dates itself and pass ISO strings — but keeping timezone resolution server-side is safer and more consistent.

---

## Response Formatting

The existing code has two formatters: one for Telegram (Markdown with emoji), one for the web API (HTML). The MCP server needs a third format: plain text or lightweight Markdown that Claude can relay verbatim or incorporate into its own response.

The simplest approach:
- Return clean, human-readable plain text
- Claude will format it naturally for the chat interface
- No HTML, no Telegram-specific Markdown, no emoji conventions required (though emoji is fine)

Example MCP response for `task_find`:
```
Tasks (3 found):

• Task 5 – Buy milk [incomplete] due: today (overdue) [hous]
• Task 12 – Call dentist [incomplete] due: tomorrow [personal]
• Task 17 – Review contract [incomplete] due: Mar 5 [work]
```

Claude receives this, can summarize it, ask follow-up questions, suggest next steps, etc.

---

## Configuration

The MCP server needs to read from `config.json` (already done by `config.py`), specifically:

| Config key | Used for |
|---|---|
| `database_path` | Opening the SQLite database |
| `user_timezone` | Date resolution in `date_utils.py` |
| `user_name` | Optional personalization in responses |

It does **not** need:
- Ollama settings (no LLM calls)
- Telegram settings
- `api_key` (MCP has its own auth model via the transport)
- `web_ui_port`

---

## Integration with `run.py`

The MCP SSE server could be added to `run.py` as a fourth component alongside the web app, Telegram bot, and cron scheduler:

```
run.py starts:
  1. Load config + init database (existing)
  2. Start Telegram bot subprocess (existing)
  3. Start cron schedulers (existing)
  4. Start MCP SSE server on mcp_port (new, e.g., port 8082)
  5. Start FastAPI web app (existing, blocking)
```

Or it could run as a completely standalone script (`python mcp_server.py`), which is simpler for getting started.

---

## New Dependencies

Only one new dependency: the MCP Python SDK.

```
pip install mcp
```

The SDK handles the protocol (JSON-RPC over stdio or SSE), tool declaration, schema validation, and the request/response lifecycle. The server code itself would be relatively small — mostly wiring up the service layer calls.

---

## What This Unlocks

Once the MCP server is running, Claude in any MCP-capable client (Claude Desktop, Claude Code) can:

- Create, find, update, and complete tasks using natural conversation
- Switch between projects and lists naturally
- Handle complex requests like "show me all overdue tasks in the house project and mark the ones under 10 minutes as available today" — Claude handles the multi-step reasoning, calling tools sequentially
- Use its broader context and reasoning: "Based on my task list, what should I focus on today?"
- Ask follow-up questions, suggest tags or projects, notice patterns
- Combine task data with other MCP tools (e.g., calendar, email) in a single conversation

The key difference from Telegram is that Claude maintains the full conversation context natively and can reason across multiple tool calls without the orchestrator needing to manage history or re-routing.

---

## Rough Implementation Outline

```
mcp_server.py
├── Imports: mcp SDK, task_service, project_service, list_service, date_utils, config
├── Load config (database_path, timezone, user_name)
├── Initialize MCP server instance
├── Define 16 tool handlers (one per existing tool):
│   ├── @tool("task_create") → calls task_service.create_task()
│   ├── @tool("task_find")   → calls task_service.find_tasks()
│   ├── @tool("task_info")   → calls task_service.get_task()
│   ├── @tool("task_update") → calls task_service.update_task()
│   ├── @tool("delete_task") → calls task_service.delete_task() (with confirm pattern)
│   ├── @tool("project_*")   → calls project_service.*()
│   ├── @tool("list_lists")  → calls list_service.get_all_lists()
│   └── @tool("tag_*")       → calls task_service.tag_*()
├── Plain-text response formatters (simpler than existing HTML/Telegram formatters)
└── Start SSE or stdio server
```

Total estimated new code: ~300–500 lines, most of it boilerplate tool declarations and response formatting. The service layer does all the real work.

---

## Summary

| Aspect | Effort |
|---|---|
| New file (`mcp_server.py`) | Medium — ~300–500 lines of new code |
| Service layer changes | Minimal to none |
| Orchestrator changes | None (not used in MCP path) |
| Config changes | Possibly add `mcp_port` |
| `run.py` changes | Small (optionally launch MCP server) |
| New dependencies | Just `pip install mcp` |
| Existing interfaces | Fully preserved and unaffected |

The existing architecture is actually well-suited for this: the service layer is clean, the tools are already well-defined, and the separation between "AI layer" and "business logic layer" means the MCP server slots in without disrupting anything.
