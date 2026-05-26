# Spaztick HTTP API

How to call Spaztick over HTTP: base URL, authentication, and the routes used by the Electron app and other clients.

## Base URL

- Default (when you run `python run.py` or `python -m web_app`): **`http://localhost:8081`**
- Replace the host and port if you changed the listener or use a reverse proxy (Tailscale, Caddy, etc.).

All paths below are relative to that base (e.g. `http://localhost:8081/api/external/tasks`).

## Two API surfaces

| Surface | Path prefix | Authentication |
|--------|-------------|----------------|
| **External API** | `/api/external/...` | **`X-API-Key`** header required if an API key is set in config |
| **Local / web UI API** | `/api/...` (no `external`) | No API key; intended for same-machine use and the bundled config UI |

Use **`/api/external/...`** for scripts, the Electron client, and remote access. If `api_key` is empty in `config.json`, external routes return **403** (“External API disabled”).

## Authentication (external API)

1. Open the web config UI → set **API key** → **Save config**.
2. Send the same value on every request:

```http
X-API-Key: your-secret-key-here
```

**Example (curl):**

```bash
export SPZT_BASE="http://localhost:8081"
export SPZT_KEY="your-secret-key-here"

curl -sS -H "X-API-Key: $SPZT_KEY" "$SPZT_BASE/api/external/tasks?limit=10"
```

**401** — missing or wrong key. **403** — API key not configured on the server.

---

## External API reference

Unless noted, methods expect/return **JSON**. `GET` requests have no body unless stated.

### Tasks

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/external/tasks` | Query params (all optional): `status`, `project_id`, `inbox`, `tag`, `due_by`, `due_before`, `available_by`, `available_by_required`, `title_contains`, `search`, `q`, `sort_by`, `flagged`, `priority`, `limit` (default 500, max 1000). `project_id` may be a project **short_id**. Use `inbox=true` or `project_id=inbox` for tasks with no project. |
| `GET` | `/api/external/tasks/{id_or_number}` | Task by UUID or friendly **number** (e.g. `3`). |
| `POST` | `/api/external/tasks` | Body: `title` (required), plus optional `notes`, `description` (deprecated; mapped to `notes`), `status`, `priority`, `available_date`, `due_date`, `projects`, `tags`, `flagged`, `recurrence`. |
| `PUT` | `/api/external/tasks/{task_id}` | Partial update; body fields optional. Supports `projects`, `tags` (replaces all tags), `recurrence`, etc. |
| `DELETE` | `/api/external/tasks/{task_id}` | Deletes the task. |
| `POST` | `/api/external/tasks/{id_or_number}/dependencies` | Body: `depends_on_task_id` **or** `depends_on_task_number` — add a dependency (this task blocked until that task completes). |
| `DELETE` | `/api/external/tasks/{id_or_number}/dependencies/{depends_on_task_id}` | Remove that dependency. |
| `POST` | `/api/external/tasks/normalize-priorities` | Sets null priorities to `0`; returns `{"updated": n}`. |

### Projects

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/external/projects` | Query: optional `status`. |
| `GET` | `/api/external/projects/{project_id}` | By id or **short_id**. |
| `POST` | `/api/external/projects` | Body: `name` or `title`, optional `description`, `status`. |
| `PUT` | `/api/external/projects/{project_id}` | Body: optional `name`, `description`, `status`. |
| `DELETE` | `/api/external/projects/{project_id}` | |

### Saved lists

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/external/lists` | All saved lists. |
| `GET` | `/api/external/lists/{list_id}` | By list **short_id** or id. |
| `GET` | `/api/external/lists/{list_id}/tasks` | Query: `limit` (default 500). Runs the list query in the server timezone. |
| `POST` | `/api/external/lists` | Body: `name`, required `query_definition`, optional `description`, `sort_definition`, `id`. |
| `PUT` | `/api/external/lists/{list_id}` | Optional `name`, `description`, `query_definition`, `sort_definition`, `telegram_send_cron`. |
| `DELETE` | `/api/external/lists/{list_id}` | |

### Tags and calendar helper

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/external/tags` | List of `{ "tag", "count" }` for each tag. |
| `GET` | `/api/external/calendar-feed` | Query: **`url`** (required, **https** only). Proxies the ICS feed; returns plain text. |

### Archive (completed-task archival)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/external/settings/archive-cron` | `{"archive_cron": "..."}`. |
| `PUT` | `/api/external/settings/archive-cron` | Body: `{"archive_cron": "..."}`. |
| `POST` | `/api/external/settings/archive-cron/run` | Runs archive job now; returns `{"archived": n}`. |

### Chat (orchestrator + Ollama tools)

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/api/external/chat` | Body: `{"message": "...", "model": null}` — same tool flow as Telegram. Optional `model` overrides config. Response: `{"response": "...", "tool_used": bool, "source": "ai"|"fallback"}`. Destructive tools may require a second message `yes` / `confirm` / `y` with the same API key for confirmation. |

---

## Local API (no API key)

These routes are **not** under `/api/external/` and do not use `X-API-Key`. Examples:

- `GET /api/tasks`, `GET/PUT/DELETE /api/tasks/{id}` — tasks
- `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/{id}`
- `GET /api/config`, `PUT /api/config`
- `GET /api/models`, `GET /api/telegram-status`, `POST /api/restart-telegram`

Use them only on trusted networks; prefer **`/api/external/...`** with an API key for automation and remote clients.

---

## Health check

No dedicated health endpoint is required; a lightweight check:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$SPZT_BASE/"
```

External API check (expect **401** without a key, or **200** with JSON when the key is valid):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -H "X-API-Key: $SPZT_KEY" "$SPZT_BASE/api/external/tags"
```

---

## Related

- **MCP (Claude tools):** see [README.md](README.md) (MCP section) — different URL path (`/mcp`), not the REST API above.
- **Implementation:** route definitions live in `web_app.py` (search for `/api/external/`).
