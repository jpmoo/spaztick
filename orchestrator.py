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
When the user wants to create, update, complete, or list tasks or projects, respond ONLY with a single JSON object. Do not ask for description or priority—only the title/name is required for create. All other fields are optional.
Do not tell the user about JSON, tool calls, or formats. Never show or mention the JSON structure in your reply. Just output the JSON with no other text.

Available tools: task_create, task_list, task_info, delete_task, project_create, project_list, project_info, delete_project.

task_create: Only "title" is required. Omit description, priority, dates, projects, tags if the user did not provide them. For dates use natural language: today, tomorrow, Monday, Tuesday, next week, in 3 days (they are resolved automatically). New tasks are always incomplete; do not send status for create.
Output format: {"name": "task_create", "parameters": {"title": "..."}} and add any optional keys the user gave.

task_list: User can filter and sort. When no status is given, always assume incomplete. Pass only the parameters the user asked for.
Parameters (all optional): status (default incomplete), tag or tags (single tag or list), project or short_id (project friendly id), due_by (date: tasks due on or before, e.g. "today"), available_by (date: tasks available on or before), available_or_due_by (date: tasks that are available OR due on or before), sort_by ("due_date", "available_date", "created_at", "title").
Examples: "list tasks due today" -> {"name": "task_list", "parameters": {"due_by": "today", "status": "incomplete"}}. "list all tasks tagged work available or due today, sorted by due date" -> {"name": "task_list", "parameters": {"tag": "work", "available_or_due_by": "today", "sort_by": "due_date"}}. Dates can be natural language (today, tomorrow, Monday, YYYY-MM-DD); the app resolves them.
Output format: {"name": "task_list", "parameters": {}} with any of status, tag, project/short_id, due_by, available_by, available_or_due_by, sort_by.

task_info: User identifies the task by its friendly id (number, e.g. 1 or #1). Returns full task details and lists parent tasks (dependencies) and subtasks (tasks that depend on this one).
Output format: {"name": "task_info", "parameters": {"number": 1}}.

delete_task: User identifies the task by its friendly id (the task number, e.g. 1 or #1). First call without confirm to show a confirmation message; when the user confirms (e.g. "yes"), call again with "confirm": true to perform the delete.
Output format: {"name": "delete_task", "parameters": {"number": 1}} or {"name": "delete_task", "parameters": {"number": 1, "confirm": true}}. Use "number" (the task's friendly id from task_list).

project_create: Only "title" is required (the project name). Omit description if the user did not provide it. New projects default to open (active) status; do not send status for create.
Output format: {"name": "project_create", "parameters": {"title": "..."}} and add optional "description" if the user gave it.

project_list: {"name": "project_list", "parameters": {}}

project_info: User identifies the project by its friendly id (short_id, e.g. "1off" or "work"). Returns full project details and a list of all tasks in the project, each with their subtasks (tasks that depend on them).
Output format: {"name": "project_info", "parameters": {"short_id": "1off"}}.

delete_project: User identifies the project by its friendly id (short_id, e.g. "1off" or "work"). First call without confirm to show a confirmation message; when the user confirms (e.g. "yes"), call again with "confirm": true to perform the delete. Deleting a project removes it from all tasks that use it; some tasks may end up with no project assignments.
Output format: {"name": "delete_project", "parameters": {"short_id": "1off"}} or {"name": "delete_project", "parameters": {"short_id": "1off", "confirm": true}}. Use "short_id" (the project's friendly id from project_list).

Important for task_create: Do NOT use generic phrases as the task title. If the user only says "new task", "create a task", "add a task", "new", "task", or similar without giving an actual task title or describing what the task is, do NOT call task_create with that phrase as the title. Instead respond in plain language asking once for the task title. Only call task_create when the user has provided a real title or clearly described the task (e.g. "Buy milk", "Roast coffee due Monday").
Same for project_create: only call when the user has provided a real project name (e.g. "Work", "1-Off Tasks"), not generic phrases like "new project" or "a project".
"""

# task_create schema: required title; optional description, notes, priority (0-3), projects[], tags[], available_date, due_date. Status is always incomplete on create.
TASK_CREATE_STATUS = frozenset({"incomplete"})

# project_create: required title (project name); optional description. Status defaults to active (open).
PROJECT_CREATE_STATUS = frozenset({"active", "archived"})


def _parse_task_number(params: dict[str, Any]) -> int | None:
    """Parse task friendly id (number) from params. Accepts number, task_number; value can be int or string like '1' or '#1'."""
    raw = params.get("number") or params.get("task_number")
    if raw is None:
        return None
    if isinstance(raw, int):
        return raw
    s = str(raw).strip().lstrip("#")
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _validate_task_list_params(params: dict[str, Any], tz_name: str = "UTC") -> dict[str, Any]:
    """Normalize task_list parameters: default status incomplete, resolve dates and project short_id."""
    from date_utils import resolve_relative_date
    out: dict[str, Any] = {}
    out["status"] = (params.get("status") or "incomplete").strip().lower() if params.get("status") else "incomplete"
    if out["status"] not in ("incomplete", "complete"):
        out["status"] = "incomplete"
    tag = params.get("tag") or (params.get("tags") or [])
    if isinstance(tag, list):
        tag = tag[0] if tag else None
    if tag and str(tag).strip():
        out["tag"] = str(tag).strip()
    project = params.get("project") or params.get("short_id")
    if project and str(project).strip():
        try:
            from project_service import get_project_by_short_id
            p = get_project_by_short_id(str(project).strip())
            if p:
                out["project_id"] = p["id"]
        except Exception:
            pass
    for key in ("due_by", "available_by", "available_or_due_by"):
        val = params.get(key)
        if val is None or not str(val).strip():
            continue
        resolved = resolve_relative_date(str(val).strip(), tz_name)
        if resolved:
            out[key] = resolved
    if params.get("sort_by") and str(params["sort_by"]).strip():
        out["sort_by"] = str(params["sort_by"]).strip()
    return out


def _parse_confirm(params: dict[str, Any]) -> bool:
    """True if user confirmed (confirm: true or yes)."""
    c = params.get("confirm")
    if c is True:
        return True
    if isinstance(c, str) and c.strip().lower() in ("true", "yes", "1"):
        return True
    return False


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
        out["status"] = "incomplete"
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


def _validate_project_create(params: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize project_create parameters. Raises ValueError if invalid. Uses 'title' as project name."""
    if not isinstance(params, dict):
        raise ValueError("parameters must be an object")
    title = params.get("title") or params.get("name")
    if not title or not str(title).strip():
        raise ValueError("title is required")
    out: dict[str, Any] = {"title": str(title).strip()}
    if "description" in params and params["description"] is not None:
        out["description"] = str(params["description"]).strip() or None
    status = params.get("status")
    if status is not None:
        s = str(status).strip().lower()
        if s == "open":
            s = "active"
        if s not in PROJECT_CREATE_STATUS:
            raise ValueError(f"status must be one of {sorted(PROJECT_CREATE_STATUS)}")
        out["status"] = s
    else:
        out["status"] = "active"
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
    status = task.get("status") or "incomplete"
    due = task.get("due_date")
    num = task.get("number")
    prefix = f"Task #{num} created: " if num is not None else "Task created: "
    msg = prefix + f"{title} [{status}]"
    if due:
        msg += f" — due {due}"
    return msg + "."


def _format_task_list_for_telegram(tasks: list[dict[str, Any]], max_show: int = 50) -> str:
    """Format a list of tasks as a user-friendly message for Telegram. Uses task number (friendly id) only."""
    if not tasks:
        return "No tasks yet."
    total = len(tasks)
    show = tasks[:max_show]
    lines = [f"Tasks ({total}):"]
    for t in show:
        title = (t.get("title") or "").strip() or "(no title)"
        status = t.get("status") or "incomplete"
        due = t.get("due_date")
        num = t.get("number")
        label = f"#{num}" if num is not None else (t.get("id") or "")[:8]
        part = f"{label}. {title} [{status}]"
        if due:
            part += f" — due {due}"
        lines.append(part)
    if total > max_show:
        lines.append(f"... and {total - max_show} more.")
    return "\n".join(lines)


def _format_project_created_for_telegram(project: dict[str, Any]) -> str:
    """Format a created project as a user-friendly message for Telegram."""
    name = (project.get("name") or "").strip() or "(no name)"
    short_id = project.get("short_id")
    status = project.get("status") or "active"
    prefix = f"Project {short_id} created: " if short_id else "Project created: "
    return prefix + f"{name} [{status}]."


def _format_task_info_text(task: dict[str, Any], parent_tasks: list[dict[str, Any]], subtasks: list[dict[str, Any]]) -> str:
    """User-friendly full task description with parents and subtasks."""
    num = task.get("number")
    label = f"#{num}" if num is not None else task.get("id", "")[:8]
    title = (task.get("title") or "").strip() or "(no title)"
    lines = [f"Task {label}: {title}", f"Status: {task.get('status') or 'incomplete'}"]
    if task.get("priority") is not None:
        lines.append(f"Priority: {task['priority']}")
    if task.get("description"):
        lines.append(f"Description: {task['description'].strip()}")
    if task.get("notes"):
        lines.append(f"Notes: {task['notes'].strip()}")
    if task.get("available_date"):
        lines.append(f"Available: {task['available_date']}")
    if task.get("due_date"):
        lines.append(f"Due: {task['due_date']}")
    if task.get("projects"):
        lines.append(f"Projects: {', '.join(task['projects'])}")
    if task.get("tags"):
        lines.append(f"Tags: {', '.join(task['tags'])}")
    if parent_tasks:
        parent_parts = [f"#{t.get('number')} {((t.get('title') or '').strip() or '(no title)')}" for t in parent_tasks if t.get("number") is not None]
        if not parent_parts:
            parent_parts = [t.get("id", "")[:8] for t in parent_tasks]
        lines.append("Depends on (parent tasks): " + ", ".join(parent_parts))
    if subtasks:
        sub_parts = [f"#{t.get('number')} {((t.get('title') or '').strip() or '(no title)')}" for t in subtasks if t.get("number") is not None]
        if not sub_parts:
            sub_parts = [t.get("id", "")[:8] for t in subtasks]
        lines.append("Subtasks (tasks that depend on this): " + ", ".join(sub_parts))
    else:
        lines.append("Subtasks: (none)")
    if task.get("created_at"):
        lines.append(f"Created: {task['created_at']}")
    if task.get("updated_at"):
        lines.append(f"Updated: {task['updated_at']}")
    if task.get("completed_at"):
        lines.append(f"Completed: {task['completed_at']}")
    return "\n".join(lines)


def _format_project_info_text(
    project: dict[str, Any],
    tasks_with_subtasks: list[tuple[dict[str, Any], list[dict[str, Any]]]],
) -> str:
    """User-friendly full project description with tasks and their subtasks."""
    short_id = project.get("short_id") or project.get("id", "")[:8]
    name = (project.get("name") or "").strip() or "(no name)"
    lines = [
        f"Project {short_id}: {name}",
        f"Status: {project.get('status') or 'active'}",
    ]
    if project.get("description"):
        lines.append(f"Description: {project['description'].strip()}")
    if project.get("created_at"):
        lines.append(f"Created: {project['created_at']}")
    if project.get("updated_at"):
        lines.append(f"Updated: {project['updated_at']}")
    lines.append("")
    if not tasks_with_subtasks:
        lines.append("Tasks: (none)")
        return "\n".join(lines)
    lines.append("Tasks:")
    for task, subtasks in tasks_with_subtasks:
        num = task.get("number")
        label = f"#{num}" if num is not None else task.get("id", "")[:8]
        title = (task.get("title") or "").strip() or "(no title)"
        status = task.get("status") or "incomplete"
        due = f" — due {task['due_date']}" if task.get("due_date") else ""
        lines.append(f"  {label}. {title} [{status}]{due}")
        if subtasks:
            sub_parts = [f"#{t.get('number')} {((t.get('title') or '').strip() or '(no title)')}" for t in subtasks if t.get("number") is not None]
            if not sub_parts:
                sub_parts = [t.get("id", "")[:8] for t in subtasks]
            lines.append("    Subtasks: " + ", ".join(sub_parts))
        else:
            lines.append("    (no subtasks)")
    return "\n".join(lines)


def _format_project_list_for_telegram(projects: list[dict[str, Any]], max_show: int = 50) -> str:
    """Format a list of projects as a user-friendly message for Telegram. Uses short_id (friendly id) only."""
    if not projects:
        return "No projects yet."
    total = len(projects)
    show = projects[:max_show]
    lines = [f"Projects ({total}):"]
    for p in show:
        name = (p.get("name") or "").strip() or "(no name)"
        short_id = p.get("short_id") or (p.get("id") or "")[:8]
        status = p.get("status") or "active"
        lines.append(f"{short_id}. {name} [{status}]")
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
    tool_used is True when a mutating tool (task_create, task_list, project_create, project_list, delete_task, delete_project) was successfully executed (caller should clear history). For delete_* without confirm, tool_used is False so the user can confirm in the next message.
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
        text = response_text.strip() or "I didn't understand. You can ask me to create or list tasks or projects."
        if _looks_like_json(text):
            return ("I didn't understand. Try: \"Create a task: [title]\", \"List my tasks\", \"Delete task #1\", \"Create a project: [name]\", \"List my projects\", or \"Delete project 1off\".", False)
        return (text, False)

    name, params = parsed
    if name == "project_info":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("project_info requires short_id (the project's friendly id, e.g. 1off or work).", False)
        try:
            from project_service import get_project_by_short_id
            from task_service import list_tasks as svc_list_tasks, get_tasks_that_depend_on
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (f"Error loading project: {e}", False)
        if not project:
            return (f"No project with id \"{short_id}\". List projects to see short_ids.", False)
        try:
            tasks = svc_list_tasks(project_id=project["id"], limit=500)
            tasks_with_subtasks: list[tuple[dict[str, Any], list[dict[str, Any]]]] = [
                (t, get_tasks_that_depend_on(t["id"])) for t in tasks
            ]
            return (_format_project_info_text(project, tasks_with_subtasks), True)
        except Exception as e:
            return (f"Error loading project tasks: {e}", False)
    if name == "project_list":
        try:
            from project_service import list_projects
            projects = list_projects()
        except Exception as e:
            return (f"Error listing projects: {e}", False)
        return (_format_project_list_for_telegram(projects), True)
    if name == "project_create":
        try:
            validated = _validate_project_create(params)
        except ValueError as e:
            return (f"Invalid project_create parameters: {e}", False)
        try:
            from project_service import create_project
            project = create_project(
                name=validated["title"],
                description=validated.get("description"),
                status=validated.get("status", "active"),
            )
        except Exception as e:
            return (f"Error creating project: {e}", False)
        return (_format_project_created_for_telegram(project), True)
    if name == "delete_project":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("delete_project requires short_id (the project's friendly id, e.g. 1off or work).", False)
        try:
            from project_service import get_project_by_short_id, delete_project
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (f"Error looking up project: {e}", False)
        if not project:
            return (f"No project with id \"{short_id}\". List projects to see short_ids.", False)
        if not _parse_confirm(params):
            name_str = (project.get("name") or "").strip() or short_id
            return (
                f"Delete project {short_id} ({name_str})? It will be removed from all tasks that use it; "
                "some tasks may end up with no project assignments. Reply \"yes\" to confirm.",
                False,
            )
        try:
            delete_project(project["id"])
        except Exception as e:
            return (f"Error deleting project: {e}", False)
        return (f"Project {short_id} deleted. It has been removed from all tasks.", True)
    if name == "delete_task":
        num = _parse_task_number(params)
        if num is None:
            return ("delete_task requires number (the task's friendly id, e.g. 1 or #1). List tasks to see numbers.", False)
        try:
            from task_service import get_task_by_number, delete_task
            task = get_task_by_number(num)
        except Exception as e:
            return (f"Error looking up task: {e}", False)
        if not task:
            return (f"No task #{num}. List tasks to see numbers.", False)
        if not _parse_confirm(params):
            title = (task.get("title") or "").strip() or "(no title)"
            return (f"Delete task #{num} ({title})? This cannot be undone. Reply \"yes\" to confirm.", False)
        try:
            delete_task(task["id"])
        except Exception as e:
            return (f"Error deleting task: {e}", False)
        return (f"Task #{num} deleted.", True)
    if name == "task_info":
        num = _parse_task_number(params)
        if num is None:
            return ("task_info requires number (the task's friendly id, e.g. 1 or #1). List tasks to see numbers.", False)
        try:
            from task_service import get_task_by_number, get_task, get_tasks_that_depend_on
            task = get_task_by_number(num)
        except Exception as e:
            return (f"Error loading task: {e}", False)
        if not task:
            return (f"No task #{num}. List tasks to see numbers.", False)
        try:
            parent_tasks: list[dict[str, Any]] = []
            for dep_id in task.get("depends_on") or []:
                pt = get_task(dep_id)
                if pt:
                    parent_tasks.append(pt)
            subtasks = get_tasks_that_depend_on(task["id"])
            return (_format_task_info_text(task, parent_tasks, subtasks), True)
        except Exception as e:
            return (f"Error loading task details: {e}", False)
    if name == "task_list":
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        try:
            validated = _validate_task_list_params(params, tz_name)
            from task_service import list_tasks as svc_list_tasks
            tasks = svc_list_tasks(
                limit=500,
                status=validated.get("status"),
                project_id=validated.get("project_id"),
                tag=validated.get("tag"),
                due_by=validated.get("due_by"),
                available_by=validated.get("available_by"),
                available_or_due_by=validated.get("available_or_due_by"),
                sort_by=validated.get("sort_by"),
            )
        except Exception as e:
            return (f"Error listing tasks: {e}", False)
        return (_format_task_list_for_telegram(tasks), True)
    if name != "task_create":
        fallback = f"Tool '{name}' is not implemented yet. You can create, list, info, or delete tasks and projects."
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
            status=validated.get("status", "incomplete"),
            priority=validated.get("priority"),
            available_date=validated.get("available_date"),
            due_date=validated.get("due_date"),
            projects=validated.get("projects"),
            tags=validated.get("tags"),
        )
    except Exception as e:
        return (f"Error creating task: {e}", False)

    return (_format_task_created_for_telegram(task), True)
