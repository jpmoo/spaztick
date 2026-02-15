"""
AI orchestrator for Spaztick: calls Ollama, parses JSON tool calls, executes via Task Service.
AI never writes directly to the database; all mutations go through task_service.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger("orchestrator")

# Tool contract: only title required; never mention JSON to the user
SYSTEM_PROMPT = """You are the AI orchestrator for Spaztick. You do not modify the database directly.
When the user wants to create, update, complete, or list tasks, respond ONLY with a single JSON object. Do not ask for description or priority—only the task title is required. All other fields are optional.
Do not tell the user about JSON, tool calls, or formats. Never show or mention the JSON structure in your reply. Just output the JSON with no other text.

Available tools: task_create, task_update, task_complete, task_list.

task_create: Only "title" is required. Omit description, priority, dates, projects, tags if the user did not provide them. For dates use natural language: today, tomorrow, Monday, Tuesday, next week, in 3 days (they are resolved automatically). Status defaults to inbox.
Output format for create: {"name": "task_create", "parameters": {"title": "..."}} and add any optional keys the user gave (description, due_date, available_date, etc.).

task_list: {"name": "task_list", "parameters": {}}

Important: Do NOT use generic phrases as the task title. If the user only says "new task", "create a task", "add a task", "new", "task", or similar without giving an actual task title or describing what the task is, do NOT call task_create with that phrase as the title. Instead respond in plain language asking once for the task title (e.g. "What's the task?" or "What would you like to call the task?"). Only call task_create when the user has provided a real title or clearly described the task (e.g. "Buy milk", "Roast coffee due Monday").
"""

# task_create schema: required title; optional description, notes, status (inbox|active|blocked), priority (0-3), projects[], tags[], available_date, due_date
TASK_CREATE_STATUS = frozenset({"inbox", "active", "blocked"})


def _validate_task_create(params: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize task_create parameters. Raises ValueError if invalid."""
    if not isinstance(params, dict):
        raise ValueError("parameters must be an object")
    title = params.get("title")
    if not title or not str(title).strip():
        raise ValueError("title is required")
    out: dict[str, Any] = {"title": str(title).strip()}
    if "description" in params and params["description"] is not None:
        out["description"] = str(params["description"])
    if "notes" in params and params["notes"] is not None:
        out["notes"] = str(params["notes"])
    status = params.get("status")
    if status is not None:
        s = str(status).strip().lower()
        if s not in TASK_CREATE_STATUS:
            raise ValueError(f"status must be one of {sorted(TASK_CREATE_STATUS)}")
        out["status"] = s
    else:
        out["status"] = "inbox"
    if "priority" in params and params["priority"] is not None and str(params["priority"]).strip() != "":
        try:
            p = int(params["priority"])
        except (TypeError, ValueError):
            pass  # omit invalid priority; only title is required
        else:
            if 0 <= p <= 3:
                out["priority"] = p
    if "projects" in params and params["projects"] is not None:
        if not isinstance(params["projects"], list):
            raise ValueError("projects must be an array")
        out["projects"] = [str(x) for x in params["projects"] if str(x).strip()]
    if "tags" in params and params["tags"] is not None:
        if not isinstance(params["tags"], list):
            raise ValueError("tags must be an array")
        out["tags"] = [str(x) for x in params["tags"] if str(x).strip()]
    if "available_date" in params and params["available_date"] is not None:
        out["available_date"] = str(params["available_date"]).strip() or None
    if "due_date" in params and params["due_date"] is not None:
        out["due_date"] = str(params["due_date"]).strip() or None
    return out


def _extract_json_object(text: str) -> dict | None:
    """Find first balanced {...} in text and parse as JSON."""
    text = text.strip()
    if "```" in text:
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _parse_tool_call(response_text: str) -> tuple[str, dict[str, Any]] | None:
    """Extract a proper tool call from the response. Returns (name, parameters) or None. Only accepts explicit form: {"name": "task_create", "parameters": {...}}."""
    obj = _extract_json_object(response_text)
    if not obj or not isinstance(obj, dict):
        return None
    name = obj.get("name") or obj.get("tool")
    params = obj.get("parameters") or obj.get("arguments") or obj.get("params") or {}
    if not name:
        return None
    return (str(name).strip(), params if isinstance(params, dict) else {})


def _canonical_task_response(task: dict[str, Any]) -> dict[str, Any]:
    """Format task for canonical JSON response (spec)."""
    return {
        "id": task.get("id"),
        "title": task.get("title"),
        "description": task.get("description"),
        "notes": task.get("notes"),
        "status": task.get("status"),
        "priority": task.get("priority"),
        "projects": task.get("projects", []),
        "tags": task.get("tags", []),
        "available_date": task.get("available_date"),
        "due_date": task.get("due_date"),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
        "completed_at": task.get("completed_at"),
    }


def _looks_like_json(text: str) -> bool:
    """True if text looks like JSON (so we don't send it to the user)."""
    t = text.strip()
    return (t.startswith("{") and "}" in t) or (t.startswith("[") and "]" in t)


def _format_task_created_for_telegram(task: dict[str, Any]) -> str:
    """Format a created task as a user-friendly message for Telegram."""
    title = (task.get("title") or "").strip() or "(no title)"
    status = task.get("status") or "inbox"
    due = task.get("due_date")
    num = task.get("number")
    prefix = f"Task #{num} created: " if num is not None else "Task created: "
    msg = prefix + f"{title} [{status}]"
    if due:
        msg += f" — due {due}"
    return msg + "."


def _format_task_list_for_telegram(tasks: list[dict[str, Any]], max_show: int = 50) -> str:
    """Format a list of tasks as a user-friendly message for Telegram."""
    if not tasks:
        return "No tasks yet."
    total = len(tasks)
    show = tasks[:max_show]
    lines = [f"Tasks ({total}):"]
    for i, t in enumerate(show, 1):
        title = (t.get("title") or "").strip() or "(no title)"
        status = t.get("status") or "inbox"
        due = t.get("due_date")
        num = t.get("number")
        label = f"#{num}" if num is not None else str(i)
        part = f"{label}. {title} [{status}]"
        if due:
            part += f" — due {due}"
        lines.append(part)
    if total > max_show:
        lines.append(f"... and {total - max_show} more.")
    return "\n".join(lines)


def _format_history(history: list[dict[str, str]]) -> str:
    """Format conversation history for the prompt."""
    if not history:
        return ""
    lines = []
    for h in history:
        role = (h.get("role") or "user").lower()
        content = (h.get("content") or "").strip()
        if role == "user":
            lines.append(f"User: {content}")
        else:
            lines.append(f"Assistant: {content}")
    return "\n".join(lines) + "\n\n"


def run_orchestrator(
    user_message: str,
    ollama_base_url: str,
    model: str,
    system_prefix: str,
    history: list[dict[str, str]] | None = None,
) -> tuple[str, bool]:
    """
    Run the orchestrator. Returns (response_text, tool_used).
    tool_used is True when task_create or task_list was successfully executed (caller should clear history).
    """
    import httpx

    full_system = (system_prefix.strip() + "\n\n" + SYSTEM_PROMPT).strip() if system_prefix else SYSTEM_PROMPT
    history_block = _format_history(history or [])
    prompt = (history_block + "User: " + user_message).strip()
    payload = {
        "model": model,
        "prompt": prompt,
        "system": full_system,
        "stream": False,
    }
    url = f"{ollama_base_url.rstrip('/')}/api/generate"
    logger.info(
        "LLM request url=%s model=%s prompt_len=%d system_len=%d user_msg=%s",
        url, model, len(prompt), len(full_system),
        repr(user_message[:300] + ("..." if len(user_message) > 300 else "")),
    )
    try:
        r = httpx.post(url, json=payload, timeout=120.0)
        r.raise_for_status()
        data = r.json()
        response_text = data.get("response", "")
        eval_duration = data.get("eval_duration")
        logger.info(
            "LLM response len=%d eval_duration=%s response=%s",
            len(response_text),
            eval_duration,
            repr(response_text[:1000] + ("..." if len(response_text) > 1000 else "")),
        )
    except Exception as e:
        logger.exception("LLM request failed")
        return (f"Error calling the model: {e}", False)

    parsed = _parse_tool_call(response_text)
    if parsed:
        logger.info("LLM tool_call parsed name=%s parameters=%s", parsed[0], json.dumps(parsed[1]))
    else:
        logger.info("LLM response is not a tool call, returning as-is")
    if not parsed:
        text = response_text.strip() or "I didn't understand. You can ask me to create a task or list your tasks."
        if _looks_like_json(text):
            return ("I didn't understand. Try: \"Create a task: [title]\" or \"List my tasks\".", False)
        return (text, False)

    name, params = parsed
    if name == "task_list":
        try:
            from task_service import list_tasks as svc_list_tasks
            tasks = svc_list_tasks(limit=500)
        except Exception as e:
            return (f"Error listing tasks: {e}", False)
        return (_format_task_list_for_telegram(tasks), True)
    if name != "task_create":
        fallback = f"Tool '{name}' is not implemented yet. You can create a task or list tasks."
        text = response_text.strip() or fallback
        return (fallback if _looks_like_json(text) else text, False)

    try:
        validated = _validate_task_create(params)
    except ValueError as e:
        return (f"Invalid task_create parameters: {e}", False)

    tz_name = "UTC"
    try:
        from config import load as load_config
        tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
    except Exception:
        pass
    from date_utils import resolve_task_dates
    validated = resolve_task_dates(validated, tz_name)

    try:
        from task_service import create_task as svc_create_task
        task = svc_create_task(
            title=validated["title"],
            description=validated.get("description"),
            notes=validated.get("notes"),
            status=validated.get("status", "inbox"),
            priority=validated.get("priority"),
            available_date=validated.get("available_date"),
            due_date=validated.get("due_date"),
            projects=validated.get("projects"),
            tags=validated.get("tags"),
        )
    except Exception as e:
        return (f"Error creating task: {e}", False)

    return (_format_task_created_for_telegram(task), True)
