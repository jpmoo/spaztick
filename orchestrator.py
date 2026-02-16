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

# --- Intent router: classifies user message as TOOL or CHAT ---
INTENT_ROUTER_PROMPT = """You are the Spaztick Intent Router.

Your job is to classify the user message as either:

- "TOOL"  -> The user is requesting a task or project operation.
- "CHAT"  -> The user is greeting, chatting, thanking, or asking something unrelated to tasks or projects.

You must respond with ONLY a valid JSON object in this exact format:

{"intent": "TOOL"}

or

{"intent": "CHAT"}

No other text. No explanation. No commentary.

CLASSIFICATION RULES:

Classify as TOOL if the message contains ANY of the following:

- References to tasks or projects (task, tasks, project, projects)
- Commands like list, show, get, create, add, new, update, edit, change, delete, remove
- Words like flagged, overdue, due, available, completed, done
- A task number reference (e.g., "1", "#1", "task 1") in context
- Filtering phrases (e.g., "due today", "over the next three days", "available tomorrow")
- Anything that appears to operate on stored task/project data

If there is ANY ambiguity, default to "TOOL".

Classify as CHAT only when the message clearly does not involve tasks or projects (e.g., greetings, small talk, weather, general questions unrelated to Spaztick).

Never invent tasks.
Never generate tool calls.
Only classify intent."""

# --- Chat mode: conversational reply when user is not requesting a tool ---
CHAT_MODE_PROMPT = """You are Spaztick's conversational assistant.

You are friendly, concise, and helpful.

This mode is used only when the user is chatting, greeting you, thanking you, or asking something unrelated to tasks or projects.

IMPORTANT RULES:

- Do NOT generate JSON.
- Do NOT call tools.
- Do NOT invent, describe, summarize, or list any tasks or projects.
- Do NOT fabricate any stored data.
- If the user asks something that appears to require task or project data, politely respond that you can help with that and suggest a task command.

You may:
- Greet the user.
- Answer general knowledge questions briefly.
- Offer help with tasks or projects.
- Encourage them to create, list, or manage tasks.

Tone:
- Friendly but concise.
- Not overly verbose.
- Not overly enthusiastic.
- Helpful and grounded.

Examples:

User: "Hi"
-> Respond with a friendly greeting.

User: "Thanks!"
-> Respond briefly and warmly.

User: "What's the weather?"
-> Give a short answer and optionally remind them you can help manage tasks.

User: "Tell me about my tasks"
-> Respond: "It looks like you want to work with your tasks. Try saying 'list tasks' and I'll pull them up for you."

Never invent tasks.
Never guess about stored data.
Never simulate tool output."""

# --- Tool mode: intro + available tools section ---
TOOL_ORCHESTRATOR_INTRO = """You are the Spaztick Tool Orchestrator.

You are in TOOL MODE.

Your job is to convert the user's request into EXACTLY ONE valid JSON tool call.

CRITICAL RULES:

- You must output ONLY a single JSON object.
- No prose.
- No greetings.
- No explanations.
- No markdown.
- No code blocks.
- No additional keys.
- No commentary.
- No multiple tool calls.
- Never fabricate task or project data.
- Never simulate tool results.
- Never answer conversationally.

If the user request requires a task or project operation, you MUST return exactly one tool call in this format:

{"name": "<tool_name>", "parameters": { ... }}

If the user request is unclear but appears task/project related, choose the most appropriate tool and fill parameters conservatively.

If required information is missing for creation (e.g., user says "new task" without a title), respond conversationally asking for clarification - DO NOT call a tool.

Never invent IDs, tasks, projects, or stored data.
Never generate results that come from the database.
You only generate tool calls.

Dates: If you receive a date without a year (e.g. "2/17", "March 15"), assume the year of the next occurrence of that date from today.

"""

# Available tools section (unchanged from original)
AVAILABLE_TOOLS_SECTION = """
Available tools: task_create, task_list, task_info, task_update, delete_task, project_create, project_list, project_info, delete_project, list_view, list_lists.

task_create: Only "title" is required. Omit description, priority, dates, projects, tags, flagged if the user did not provide them. New tasks are incomplete and not flagged by default. For dates use natural language: today, tomorrow, Monday, Tuesday, next week, in 3 days (they are resolved automatically). Optional "flagged": true to create a flagged task.
Output format: {"name": "task_create", "parameters": {"title": "..."}} and add any optional keys the user gave (e.g. flagged, due_date).

task_list: "List tasks", "list my tasks", "show tasks", "gimme tasks in X available tomorrow", etc. must be answered with the task_list JSON only. Any request that asks for tasks (optionally in a project, available/due on a date) is a task_list call. For project filter use short_id only (e.g. 1off), never full project name. User can filter and sort.
Never include completed tasks unless the user explicitly asks for them (e.g. "completed", "done", "finished") or asks for "all" tasks. When no status is given, always use status "incomplete". Do not send status "complete" unless the user clearly asked for completed/done tasks or "all tasks".
Parameters (all optional): status (default incomplete; use "complete" only when user asks for completed/done tasks, or "all" for both), tag or tags, project or short_id, due_by, available_by, available_or_due_by, completed_by (date: tasks completed on or before), completed_after (date: tasks completed on or after), title_contains (substring search in title), overdue, sort_by ("due_date", "available_date", "created_at", "completed_at", "title"), flagged (true/false), priority (number 0-3, or label: "high"/"medium high"/"medium low"/"low", or color: "red"/"orange"/"yellow"/"green"; 3=high=red, 2=medium high=orange, 1=medium low=yellow, 0=low=green).
Overdue semantics: A task due today is NOT overdue unless the user says "overdue tomorrow" or asks on a later date. Use overdue (not due_by) when the user asks for "overdue" or "overdue tasks". overdue: true or overdue: "today" → tasks due yesterday or earlier; overdue: "tomorrow" → tasks due today or earlier.
Dates: "today", "tomorrow", "yesterday", "now" (use "today")—app resolves them.
Examples: "list overdue tasks" -> {"name": "task_list", "parameters": {"overdue": true, "status": "incomplete"}}. "overdue tomorrow" -> {"name": "task_list", "parameters": {"overdue": "tomorrow", "status": "incomplete"}}. "list tasks due today" -> {"name": "task_list", "parameters": {"due_by": "today", "status": "incomplete"}}. "gimme tasks in 1off available tomorrow" -> {"name": "task_list", "parameters": {"short_id": "1off", "available_by": "tomorrow", "status": "incomplete"}}. "list flagged tasks" -> {"name": "task_list", "parameters": {"flagged": true, "status": "incomplete"}}.
Output format: {"name": "task_list", "parameters": {}} with any of status, tag, project/short_id, due_by, available_by, available_or_due_by, completed_by, completed_after, title_contains, overdue, sort_by, flagged, priority. Priority: use 0-3, or "high"/"medium high"/"medium low"/"low", or "red"/"orange"/"yellow"/"green". E.g. "high priority tasks" -> priority "high" or 3; "red priority" -> 3; "priority 2" -> 2.

task_info: User identifies the task by its friendly id (number). "Tell me about 1", "about task 1", "task #1", "task 1", or just "1" after discussing tasks/projects always means task_info with that number. Never answer with general knowledge about the number—always call task_info.
Output format: {"name": "task_info", "parameters": {"number": 1}} (use the number the user said).

task_update: Change one task by number. You can update any attribute: status, flagged, due_date, available_date, title, description, notes, priority, projects (list—replaces task's projects), remove_projects (list—remove these projects from the task; use for "remove task N from project X"), tags (list—replaces task's tags). Required: number. Optional: status, flagged, due_date, available_date, title, description, notes, priority (0-3 or label "high"/"medium high"/"medium low"/"low" or color "red"/"orange"/"yellow"/"green"), projects (array), remove_projects (array), tags (array). Dates: natural language. Use remove_projects when the user says to remove the task from a project; do not use projects for that.
Examples: "mark task 1 complete" -> {"name": "task_update", "parameters": {"number": 1, "status": "complete"}}. "remove task 1 from 1off" or "take task 1 off project 1off" -> {"name": "task_update", "parameters": {"number": 1, "remove_projects": ["1off"]}}. "add task 1 to 1off" -> {"name": "task_update", "parameters": {"number": 1, "projects": ["1off"]}} (or add to existing: send projects with current + new). "task 1 due tomorrow" -> {"name": "task_update", "parameters": {"number": 1, "due_date": "tomorrow"}}. "task 2 tags work urgent" -> {"name": "task_update", "parameters": {"number": 2, "tags": ["work", "urgent"]}}.
Output format: {"name": "task_update", "parameters": {"number": N, ...}} with only the fields being changed.

delete_task: User identifies the task by its friendly id (the task number, e.g. 1 or #1). First call without confirm to show a confirmation message; when the user confirms (e.g. "yes"), call again with "confirm": true to perform the delete.
Output format: {"name": "delete_task", "parameters": {"number": 1}} or {"name": "delete_task", "parameters": {"number": 1, "confirm": true}}. Use "number" (the task's friendly id from task_list).

project_create: Only "title" is required (the project name). Omit description if the user did not provide it. New projects default to open (active) status; do not send status for create.
Output format: {"name": "project_create", "parameters": {"title": "..."}} and add optional "description" if the user gave it.

project_list: "List projects", "list my projects", "show projects" must be answered with project_list JSON only. Output: {"name": "project_list", "parameters": {}}

project_info: User identifies the project by short_id only (e.g. "1off", "work"). Returns full project details and tasks. In this chat we never use full project names—only short_id.
Output format: {"name": "project_info", "parameters": {"short_id": "1off"}}.

delete_project: User identifies the project by short_id only (e.g. "1off", "work"). First call without confirm; when the user confirms (e.g. "yes"), call again with "confirm": true. In this chat we never use full project names—only short_id.
Output format: {"name": "delete_project", "parameters": {"short_id": "1off"}} or {"name": "delete_project", "parameters": {"short_id": "1off", "confirm": true}}.

list_view: Show tasks from a saved list. Use when the user says "view list X", "show tasks on list X", "list tasks on list X", or asks for tasks from a named list. X is always the list's short_id (e.g. "test", "work"). Tasks are returned in the list's configured sort order (same as in the app). Prefer list_view over task_list whenever the user asks for a specific list by name or short_id.
Parameters: list_id (the list's short_id). In this chat we never refer to lists by full name—only by short_id.
Output format: {"name": "list_view", "parameters": {"list_id": "test"}}.

list_lists: List all saved lists with their short_ids. Use when the user asks to list saved lists, show lists, or see list short names (e.g. "list lists", "show my lists").
Output format: {"name": "list_lists", "parameters": {}}.

In this chat we refer to: tasks by number only (e.g. 1, 2); projects by short_id only (e.g. 1off, work); lists by short_id only (e.g. test, inbox). Never use full display names for projects or lists. When the user asks about a task or project by number/short_id (e.g. "about 1", "about project 1off", "view list test"), output the corresponding tool JSON—do not answer with general knowledge.

Important for task_create: Do NOT use generic phrases as the task title. If the user only says "new task", "create a task", "add a task", or similar without giving an actual title, respond in plain language asking once for the task title (conversational reply, no JSON). Only call task_create when they have given a real title (e.g. "Buy milk").
Same for project_create: only call when they have given a real project name. Otherwise reply conversationally.
"""

TOOL_ORCHESTRATOR_PROMPT = TOOL_ORCHESTRATOR_INTRO + AVAILABLE_TOOLS_SECTION


# task_create schema: required title; optional description, notes, priority (0-3 or label high/medium high/medium low/low or color red/orange/yellow/green), projects[], tags[], available_date, due_date, flagged (default false). Status is always incomplete on create.
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


def _parse_priority(value: Any) -> int | None:
    """Parse priority from number (0-3), label (high, medium high, medium low, low), or color (red, orange, yellow, green). Returns 0-3 or None."""
    if value is None:
        return None
    if isinstance(value, int) and 0 <= value <= 3:
        return value
    s = str(value).strip().lower()
    if not s:
        return None
    try:
        n = int(s)
        return n if 0 <= n <= 3 else None
    except ValueError:
        pass
    # Labels: 3=high, 2=medium high, 1=medium low, 0=low
    if s in ("high", "highest", "top"):
        return 3
    if s in ("medium high", "medium-high", "med high", "mediumhigh"):
        return 2
    if s in ("medium low", "medium-low", "med low", "mediumlow"):
        return 1
    if s in ("low", "lowest"):
        return 0
    # Colors: red=3, orange=2, yellow=1, green=0
    if s == "red":
        return 3
    if s == "orange":
        return 2
    if s == "yellow":
        return 1
    if s == "green":
        return 0
    return None


def _validate_task_list_params(params: dict[str, Any], tz_name: str = "UTC") -> dict[str, Any]:
    """Normalize task_list parameters: default status incomplete, resolve dates and project short_id. Overdue = due_by (reference date - 1 day)."""
    from datetime import date, timedelta
    from date_utils import resolve_relative_date
    out: dict[str, Any] = {}
    raw_status = (params.get("status") or "incomplete")
    raw_status = str(raw_status).strip().lower() if raw_status else "incomplete"
    if raw_status == "all":
        out["status"] = None  # no filter: return incomplete and complete
    elif raw_status in ("incomplete", "complete"):
        out["status"] = raw_status
    else:
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
    # Overdue: tasks due before reference date → due_by = (reference - 1 day). "overdue" or "overdue today" → due_by yesterday; "overdue tomorrow" → due_by today.
    if "overdue" in params and params.get("overdue") is not None:
        ref = params.get("overdue")
        if ref is True or (isinstance(ref, str) and str(ref).strip().lower() in ("true", "1", "today", "now", "")):
            ref = "today"
        else:
            ref = str(ref).strip() if ref else "today"
        resolved_ref = resolve_relative_date(ref, tz_name)
        if resolved_ref:
            try:
                d = date.fromisoformat(resolved_ref)
                out["due_by"] = (d - timedelta(days=1)).isoformat()
            except (ValueError, TypeError):
                pass
    for key in ("due_by", "available_by", "available_or_due_by", "completed_by", "completed_after"):
        if key in out:
            continue  # already set (e.g. from overdue)
        val = params.get(key)
        if val is None or not str(val).strip():
            continue
        resolved = resolve_relative_date(str(val).strip(), tz_name)
        if resolved:
            out[key] = resolved
    if params.get("title_contains") is not None and str(params["title_contains"]).strip():
        out["title_contains"] = str(params["title_contains"]).strip()
    if params.get("sort_by") and str(params["sort_by"]).strip():
        out["sort_by"] = str(params["sort_by"]).strip()
    if "flagged" in params:
        f = params["flagged"]
        if f is True or (isinstance(f, str) and str(f).strip().lower() in ("true", "1", "yes")) or f == 1:
            out["flagged"] = True
        elif f is False or (isinstance(f, str) and str(f).strip().lower() in ("false", "0", "no")) or f == 0:
            out["flagged"] = False
    if "priority" in params and params["priority"] is not None:
        p = _parse_priority(params["priority"])
        if p is not None:
            out["priority"] = p
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
        p = _parse_priority(params["priority"])
        if p is not None:
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
    if "flagged" in params:
        f = params["flagged"]
        if f is True or (isinstance(f, str) and str(f).strip().lower() in ("true", "1", "yes")) or f == 1:
            out["flagged"] = True
        else:
            out["flagged"] = False
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


def _validate_task_update(params: dict[str, Any], tz_name: str = "UTC") -> dict[str, Any]:
    """Validate and normalize task_update parameters. number required; optional status, flagged, due_date, available_date, title, description, notes, priority, projects (list), remove_projects (list), tags (list). Raises ValueError if number missing."""
    if not isinstance(params, dict):
        raise ValueError("parameters must be an object")
    num = _parse_task_number(params)
    if num is None:
        raise ValueError("number is required (task's friendly id, e.g. 1)")
    out: dict[str, Any] = {"number": num}
    status = params.get("status")
    if status is not None:
        s = str(status).strip().lower()
        if s in ("done", "complete", "completed", "finished"):
            out["status"] = "complete"
        elif s in ("reopen", "incomplete", "open", "in progress"):
            out["status"] = "incomplete"
        elif s in ("incomplete", "complete"):
            out["status"] = s
    if "flagged" in params:
        f = params["flagged"]
        if f is True or (isinstance(f, str) and str(f).strip().lower() in ("true", "1", "yes")) or f == 1:
            out["flagged"] = True
        else:
            out["flagged"] = False
    for key in ("due_date", "available_date", "title", "description", "notes"):
        if key in params and params[key] is not None:
            val = str(params[key]).strip() or None
            if val is not None or key in ("due_date", "available_date"):
                out[key] = val if val else None
    if "priority" in params and params["priority"] is not None and str(params["priority"]).strip() != "":
        p = _parse_priority(params["priority"])
        if p is not None:
            out["priority"] = p
    if "projects" in params and params["projects"] is not None:
        if not isinstance(params["projects"], list):
            raise ValueError("projects must be an array of project short_ids or ids")
        out["projects"] = [str(x).strip() for x in params["projects"] if str(x).strip()]
    if "remove_projects" in params and params["remove_projects"] is not None:
        if not isinstance(params["remove_projects"], list):
            raise ValueError("remove_projects must be an array of project short_ids or ids")
        out["remove_projects"] = [str(x).strip() for x in params["remove_projects"] if str(x).strip()]
    if "tags" in params and params["tags"] is not None:
        if not isinstance(params["tags"], list):
            raise ValueError("tags must be an array of strings")
        out["tags"] = [str(x).strip() for x in params["tags"] if str(x).strip()]
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


def _extract_list_identifier_from_message(user_message: str) -> str | None:
    """Extract a list short_id from phrases like 'view test list', 'view list test', 'show me my tasks on list test'. Returns the short_id (e.g. 'test') or None."""
    if not user_message or not isinstance(user_message, str):
        return None
    msg = user_message.strip()
    if not msg:
        return None
    # view X list / view list X / show X list / show list X (X = word or short_id)
    m = re.search(r"\b(?:view|show)\s+(?:list\s+)?([a-z0-9_-]+)\s+list\b", msg, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"\b(?:view|show)\s+list\s+([a-z0-9_-]+)\b", msg, re.I)
    if m:
        return m.group(1).strip()
    # show me my tasks on list X / tasks on list X
    m = re.search(r"\b(?:tasks?\s+)?on\s+list\s+([a-z0-9_-]+)\b", msg, re.I)
    if m:
        return m.group(1).strip()
    # open/display list X
    m = re.search(r"\b(?:open|display)\s+list\s+([a-z0-9_-]+)\b", msg, re.I)
    if m:
        return m.group(1).strip()
    return None


def _infer_tool_from_user_message(user_message: str) -> tuple[str, dict[str, Any]] | None:
    """If the user message is clearly a list/show tasks or list/show projects command, return (tool_name, params) so we can run the tool even when the model replied conversationally. Conservative: only list/show tasks/projects (bare or with trailing filter words)."""
    if not user_message or not isinstance(user_message, str):
        return None
    msg = user_message.strip().lower()
    if not msg:
        return None
    # View/show a specific list by name or short_id (must come before generic "show lists")
    list_id = _extract_list_identifier_from_message(user_message)
    if list_id:
        return ("list_view", {"list_id": list_id})
    # List/show tasks — match at start (allows "list tasks", "list tasks due today", "gimme tasks in 1off")
    if re.match(r"^(list|show|get|gimme|display|what are my|give me)\s+(my\s+)?tasks?\b", msg):
        return ("task_list", {"status": "incomplete"})
    if re.match(r"^tasks\s*$", msg) or re.match(r"^my tasks\s*$", msg):
        return ("task_list", {"status": "incomplete"})
    # List/show projects
    if re.match(r"^(list|show|get|gimme|display)\s+(my\s+)?projects?\b", msg):
        return ("project_list", {})
    if re.match(r"^projects\s*$", msg) or re.match(r"^my projects\s*$", msg):
        return ("project_list", {})
    # List/show saved lists (list_lists)
    if re.match(r"^(list|show|get|display)\s+(my\s+)?lists?\b", msg):
        return ("list_lists", {})
    if re.match(r"^lists\s*$", msg) or re.match(r"^my lists\s*$", msg) or re.match(r"^what lists\b", msg):
        return ("list_lists", {})
    return None


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


def _call_ollama(system: str, prompt: str, url: str, model: str, timeout: float = 120.0) -> str:
    """Call Ollama /api/generate with the given system and prompt. Returns response text or raises."""
    import httpx
    logger.info("LLM request → url=%s model=%s\n--- system ---\n%s\n--- prompt ---\n%s", url, model, system, prompt)
    payload = {"model": model, "prompt": prompt, "system": system, "stream": False}
    r = httpx.post(url, json=payload, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    response_text = data.get("response", "")
    logger.info("LLM response ←\n%s", response_text)
    return response_text


def _parse_intent(response_text: str) -> str:
    """Parse intent router response. Returns 'TOOL' or 'CHAT'. Defaults to 'TOOL' on parse failure."""
    obj = _extract_json_object(response_text or "")
    if not obj or not isinstance(obj, dict):
        return "TOOL"
    intent = obj.get("intent")
    if isinstance(intent, str):
        i = intent.strip().upper()
        if i == "CHAT":
            return "CHAT"
    return "TOOL"


def _friendly_date(iso_date: str | None, tz_name: str) -> str:
    """Today/yesterday/tomorrow or m/d for chat/Telegram."""
    try:
        from date_utils import format_date_friendly
        return format_date_friendly(iso_date, tz_name)
    except Exception:
        return str(iso_date or "")


def _format_datetime_info(iso_datetime: str | None, tz_name: str) -> str:
    """m/d/yyyy, h:mm am/pm for created/updated info."""
    try:
        from date_utils import format_datetime_info
        return format_datetime_info(iso_datetime, tz_name)
    except Exception:
        return str(iso_datetime or "")


def _format_task_created_for_telegram(task: dict[str, Any], tz_name: str = "UTC") -> str:
    """Format a created task as a user-friendly message for Telegram."""
    title = (task.get("title") or "").strip() or "(no title)"
    status = task.get("status") or "incomplete"
    due = task.get("due_date")
    num = task.get("number")
    prefix = f"Task {num} created: " if num is not None else "Task created: "
    msg = prefix + f"{title} [{status}]"
    if due:
        msg += f" — due {_friendly_date(due, tz_name)}"
    return msg + "."


def _format_task_list_for_telegram(tasks: list[dict[str, Any]], max_show: int = 50, tz_name: str = "UTC") -> str:
    """Format task list: □/■ [★] title (#n) [avail] [🟡/🔴] due [name (short_id)...]. Due/avail as today/yesterday/tomorrow or m/d. 🟡 due today, 🔴 overdue."""
    if not tasks:
        return "No tasks yet."
    try:
        from date_utils import resolve_relative_date
        today = resolve_relative_date("today", tz_name)
    except Exception:
        from datetime import date
        today = date.today().isoformat()
    if not today:
        from datetime import date
        today = date.today().isoformat()
    total = len(tasks)
    show = tasks[:max_show]
    lines = [f"Tasks ({total}):"]
    try:
        from project_service import get_project
    except ImportError:
        get_project = None
    for t in show:
        flagged = t.get("flagged") in (1, True, "1")
        status = t.get("status") or "incomplete"
        status_icon = "■" if status == "complete" else "□"
        title = (t.get("title") or "").strip() or "(no title)"
        num = t.get("number")
        friendly_id = f"({num})" if num is not None else f"({(t.get('id') or '')[:8]})"
        part = f"{status_icon}{'★' if flagged else ''} {title} {friendly_id}"
        if t.get("available_date"):
            part += f" avail {_friendly_date(t['available_date'], tz_name)}"
        if t.get("due_date"):
            due = t["due_date"]
            due_friendly = _friendly_date(due, tz_name)
            if due < today:
                part += f" 🔴 due {due_friendly}"
            elif due == today:
                part += f" 🟡 due {due_friendly}"
            else:
                part += f" due {due_friendly}"
        project_parts = []
        if get_project and t.get("projects"):
            for pid in t["projects"]:
                p = get_project(pid)
                if p:
                    name = (p.get("name") or "").strip() or "(no name)"
                    short_id = (p.get("short_id") or "").strip() or p.get("id", "")[:8]
                    project_parts.append(f"{name} ({short_id})")
        if project_parts:
            part += " " + " ".join(project_parts)
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


def _format_task_info_text(
    task: dict[str, Any],
    parent_tasks: list[dict[str, Any]],
    subtasks: list[dict[str, Any]],
    project_labels: list[str] | None = None,
    tz_name: str = "UTC",
) -> str:
    """User-friendly full task description with parents and subtasks. project_labels = [short_id: name] per project. Dates/times in tz as m/d/yyyy, h:mm am/pm."""
    num = task.get("number")
    label = str(num) if num is not None else task.get("id", "")[:8]
    title = (task.get("title") or "").strip() or "(no title)"
    lines = [f"Task {label}: {title}", f"Status: {task.get('status') or 'incomplete'}"]
    if task.get("priority") is not None:
        lines.append(f"Priority: {task['priority']}")
    if task.get("description"):
        lines.append(f"Description: {task['description'].strip()}")
    if task.get("notes"):
        lines.append(f"Notes: {task['notes'].strip()}")
    if task.get("available_date"):
        lines.append(f"Available: {_friendly_date(task['available_date'], tz_name)}")
    if task.get("due_date"):
        lines.append(f"Due: {_friendly_date(task['due_date'], tz_name)}")
    if project_labels:
        lines.append(f"Projects: {', '.join(project_labels)}")
    elif task.get("projects"):
        lines.append(f"Projects: {', '.join(task['projects'])}")
    if task.get("tags"):
        lines.append(f"Tags: {', '.join(task['tags'])}")
    if parent_tasks:
        parent_parts = [f"{t.get('number')} {((t.get('title') or '').strip() or '(no title)')}" for t in parent_tasks if t.get("number") is not None]
        if not parent_parts:
            parent_parts = [t.get("id", "")[:8] for t in parent_tasks]
        lines.append("Depends on (parent tasks): " + ", ".join(parent_parts))
    if subtasks:
        sub_parts = [f"{t.get('number')} {((t.get('title') or '').strip() or '(no title)')}" for t in subtasks if t.get("number") is not None]
        if not sub_parts:
            sub_parts = [t.get("id", "")[:8] for t in subtasks]
        lines.append("Subtasks (tasks that depend on this): " + ", ".join(sub_parts))
    else:
        lines.append("Subtasks: (none)")
    if task.get("created_at"):
        lines.append(f"Created: {_format_datetime_info(task['created_at'], tz_name)}")
    if task.get("updated_at"):
        lines.append(f"Updated: {_format_datetime_info(task['updated_at'], tz_name)}")
    if task.get("completed_at"):
        lines.append(f"Completed: {_format_datetime_info(task['completed_at'], tz_name)}")
    return "\n".join(lines)


def _format_project_info_text(
    project: dict[str, Any],
    tasks_with_subtasks: list[tuple[dict[str, Any], list[dict[str, Any]]]],
    tz_name: str = "UTC",
) -> str:
    """User-friendly full project description with tasks and their subtasks. Created/updated as m/d/yyyy, h:mm am/pm."""
    short_id = project.get("short_id") or project.get("id", "")[:8]
    name = (project.get("name") or "").strip() or "(no name)"
    lines = [
        f"Project {short_id}: {name}",
        f"Status: {project.get('status') or 'active'}",
    ]
    if project.get("description"):
        lines.append(f"Description: {project['description'].strip()}")
    if project.get("created_at"):
        lines.append(f"Created: {_format_datetime_info(project['created_at'], tz_name)}")
    if project.get("updated_at"):
        lines.append(f"Updated: {_format_datetime_info(project['updated_at'], tz_name)}")
    lines.append("")
    if not tasks_with_subtasks:
        lines.append("Tasks: (none)")
        return "\n".join(lines)
    lines.append("Tasks:")
    for task, subtasks in tasks_with_subtasks:
        num = task.get("number")
        label = str(num) if num is not None else task.get("id", "")[:8]
        title = (task.get("title") or "").strip() or "(no title)"
        status = task.get("status") or "incomplete"
        due = f" — due {_friendly_date(task.get('due_date'), tz_name)}" if task.get("due_date") else ""
        lines.append(f"  {label}. {title} [{status}]{due}")
        if subtasks:
            sub_parts = [f"{t.get('number')} {((t.get('title') or '').strip() or '(no title)')}" for t in subtasks if t.get("number") is not None]
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
) -> tuple[str, bool, dict[str, Any] | None]:
    """
    Run the orchestrator. Returns (response_text, tool_used, pending_confirm).
    pending_confirm is set when delete_task/delete_project was run without confirm (caller can execute it when user says "yes").
    tool_used is True when a mutating tool was successfully executed (caller should clear history). For delete_* without confirm, tool_used is False.
    """
    url = f"{ollama_base_url.rstrip('/')}/api/generate"
    # When history is empty (caller can disable conversation history), only the current user message is sent.
    history_list = history or []
    history_block = _format_history(history_list)
    # Avoid appending user_message twice: caller often passes history that already includes the current message.
    last_is_current = (
        len(history_list) > 0
        and (history_list[-1].get("role") or "user").lower() == "user"
        and (history_list[-1].get("content") or "").strip() == user_message.strip()
    )
    def _prompt_with_user() -> str:
        return (history_block + "User: " + user_message).strip() if not last_is_current else history_block.strip()

    # Step 1: Classify intent (TOOL vs CHAT)
    try:
        intent_response = _call_ollama(INTENT_ROUTER_PROMPT, user_message.strip(), url, model)
        intent = _parse_intent(intent_response)
    except Exception as e:
        logger.exception("Intent router call failed")
        return (f"Error calling the model: {e}", False, None)
    logger.info("Intent router classified as: %s", intent)

    if intent == "CHAT":
        try:
            chat_prompt = _prompt_with_user()
            response_text = _call_ollama(CHAT_MODE_PROMPT, chat_prompt, url, model)
        except Exception as e:
            logger.exception("Chat mode call failed")
            return (f"Error calling the model: {e}", False, None)
        text = response_text.strip() or "I didn't understand. You can ask me to list or create tasks and projects."
        return (text, False, None)

    # Step 2: TOOL — get tool call from orchestrator, then execute
    full_system = (system_prefix.strip() + "\n\n" + TOOL_ORCHESTRATOR_PROMPT).strip() if system_prefix else TOOL_ORCHESTRATOR_PROMPT
    tool_prompt = _prompt_with_user()
    logger.info("Tool mode request prompt_len=%d system_len=%d", len(tool_prompt), len(full_system))
    try:
        response_text = _call_ollama(full_system, tool_prompt, url, model)
    except Exception as e:
        logger.exception("Tool orchestrator call failed")
        return (f"Error calling the model: {e}", False, None)

    parsed = _parse_tool_call(response_text)
    if parsed:
        logger.info("LLM tool_call parsed name=%s parameters=%s", parsed[0], json.dumps(parsed[1]))
    else:
        inferred = _infer_tool_from_user_message(user_message)
        if inferred:
            logger.info("LLM did not return tool call; inferred from user message: name=%s parameters=%s", inferred[0], json.dumps(inferred[1]))
            parsed = inferred
        else:
            logger.info("LLM response is not a tool call, returning as-is")
    if not parsed:
        text = response_text.strip() or "I didn't understand. You can ask me to create or list tasks or projects."
        if _looks_like_json(text):
            return ("I didn't understand. Try: \"Create a task: [title]\", \"List my tasks\", \"Delete task 1\", \"Create a project: [name]\", \"List my projects\", or \"Delete project 1off\".", False, None)
        return (text, False, None)

    name, params = parsed
    if name == "project_info":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("project_info requires short_id (the project's friendly id, e.g. 1off or work).", False, None)
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        try:
            from project_service import get_project_by_short_id
            from task_service import list_tasks as svc_list_tasks, get_tasks_that_depend_on
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (f"Error loading project: {e}", False, None)
        if not project:
            return (f"No project with id \"{short_id}\". List projects to see short_ids.", False, None)
        try:
            tasks = svc_list_tasks(project_id=project["id"], limit=500)
            tasks_with_subtasks: list[tuple[dict[str, Any], list[dict[str, Any]]]] = [
                (t, get_tasks_that_depend_on(t["id"])) for t in tasks
            ]
            return (_format_project_info_text(project, tasks_with_subtasks, tz_name), True, None)
        except Exception as e:
            return (f"Error loading project tasks: {e}", False, None)
    if name == "project_list":
        try:
            from project_service import list_projects
            projects = list_projects()
        except Exception as e:
            return (f"Error listing projects: {e}", False, None)
        return (_format_project_list_for_telegram(projects), True, None)
    if name == "project_create":
        try:
            validated = _validate_project_create(params)
        except ValueError as e:
            return (f"Invalid project_create parameters: {e}", False, None)
        try:
            from project_service import create_project
            project = create_project(
                name=validated["title"],
                description=validated.get("description"),
                status=validated.get("status", "active"),
            )
        except Exception as e:
            return (f"Error creating project: {e}", False, None)
        return (_format_project_created_for_telegram(project), True, None)
    if name == "delete_project":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("delete_project requires short_id (the project's friendly id, e.g. 1off or work).", False, None)
        try:
            from project_service import get_project_by_short_id, delete_project
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (f"Error looking up project: {e}", False, None)
        if not project:
            return (f"No project with id \"{short_id}\". List projects to see short_ids.", False, None)
        if not _parse_confirm(params):
            name_str = (project.get("name") or "").strip() or short_id
            return (
                f"Delete project {short_id} ({name_str})? It will be removed from all tasks that use it; "
                "some tasks may end up with no project assignments. Reply \"yes\" to confirm.",
                False,
                {"tool": "delete_project", "short_id": short_id},
            )
        try:
            delete_project(project["id"])
        except Exception as e:
            return (f"Error deleting project: {e}", False, None)
        return (f"Project {short_id} deleted. It has been removed from all tasks.", True, None)
    if name == "delete_task":
        num = _parse_task_number(params)
        if num is None:
            return ("delete_task requires number (the task's friendly id, e.g. 1). List tasks to see numbers.", False, None)
        try:
            from task_service import get_task_by_number, delete_task
            task = get_task_by_number(num)
        except Exception as e:
            return (f"Error looking up task: {e}", False, None)
        if not task:
            return (f"No task {num}. List tasks to see numbers.", False, None)
        if not _parse_confirm(params):
            title = (task.get("title") or "").strip() or "(no title)"
            return (f"Delete task {num} ({title})? This cannot be undone. Reply \"yes\" to confirm.", False, {"tool": "delete_task", "number": num})
        try:
            delete_task(task["id"])
        except Exception as e:
            return (f"Error deleting task: {e}", False, None)
        return (f"Task {num} deleted.", True, None)
    if name == "task_info":
        num = _parse_task_number(params)
        if num is None:
            return ("task_info requires number (the task's friendly id, e.g. 1). List tasks to see numbers.", False, None)
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        try:
            from task_service import get_task_by_number, get_task, get_tasks_that_depend_on
            task = get_task_by_number(num)
        except Exception as e:
            return (f"Error loading task: {e}", False, None)
        if not task:
            return (f"No task {num}. List tasks to see numbers.", False, None)
        try:
            from project_service import get_project
            parent_tasks: list[dict[str, Any]] = []
            for dep_id in task.get("depends_on") or []:
                pt = get_task(dep_id)
                if pt:
                    parent_tasks.append(pt)
            subtasks = get_tasks_that_depend_on(task["id"])
            project_labels: list[str] = []
            for pid in task.get("projects") or []:
                p = get_project(pid)
                if p:
                    short_id = (p.get("short_id") or "").strip() or p.get("id", "")[:8]
                    name = (p.get("name") or "").strip() or "(no name)"
                    project_labels.append(f"{short_id}: {name}")
            return (_format_task_info_text(task, parent_tasks, subtasks, project_labels, tz_name), True, None)
        except Exception as e:
            return (f"Error loading task details: {e}", False, None)
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
                completed_by=validated.get("completed_by"),
                completed_after=validated.get("completed_after"),
                title_contains=validated.get("title_contains"),
                sort_by=validated.get("sort_by"),
                flagged=validated.get("flagged"),
                priority=validated.get("priority"),
            )
        except Exception as e:
            return (f"Error listing tasks: {e}", False, None)
        return (_format_task_list_for_telegram(tasks, 50, tz_name), True, None)
    if name == "list_view":
        list_id = (params.get("list_id") or params.get("name") or "").strip()
        if not list_id:
            # Try to extract list short_id from user message (e.g. "View test list", "show tasks on list test")
            extracted = _extract_list_identifier_from_message(user_message)
            if extracted:
                list_id = extracted
            else:
                return ("list_view requires list_id (the list's short_id). Use list_lists to see short_ids.", False, None)
        try:
            from list_service import get_list, run_list
        except Exception as e:
            return (f"Error loading list service: {e}", False, None)
        lst = get_list(list_id)
        if not lst:
            return (f"List \"{list_id}\" not found. Use list_lists to see short_ids.", False, None)
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        try:
            tasks = run_list(list_id, limit=500, tz_name=tz_name)
        except Exception as e:
            return (f"Error running list: {e}", False, None)
        list_label = (lst.get("name") or "").strip() or list_id
        short_id = (lst.get("short_id") or "").strip()
        if short_id:
            header = f"List: {list_label} ({short_id})\n"
        else:
            header = f"List: {list_label}\n"
        return (header + _format_task_list_for_telegram(tasks, 50, tz_name), True, None)
    if name == "list_lists":
        try:
            from list_service import list_lists as list_lists_svc
        except Exception as e:
            return (f"Error loading list service: {e}", False, None)
        try:
            lists = list_lists_svc()
        except Exception as e:
            return (f"Error listing lists: {e}", False, None)
        if not lists:
            return ("No saved lists yet. Create one via the app or API to view lists here.", True, None)
        lines = ["Lists:"]
        for lst in lists:
            name_part = (lst.get("name") or "").strip() or "(no name)"
            short = (lst.get("short_id") or "").strip()
            if short:
                lines.append(f"• {name_part} ({short})")
            else:
                lines.append(f"• {name_part}")
        return ("\n".join(lines), True, None)
    if name == "task_update":
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        try:
            validated = _validate_task_update(params, tz_name)
        except ValueError as e:
            return (str(e), False, None)
        from date_utils import resolve_task_dates
        validated = resolve_task_dates(validated, tz_name)
        num = validated.pop("number")
        try:
            from task_service import get_task_by_number, update_task, remove_task_project, add_task_project, remove_task_tag, add_task_tag
            task = get_task_by_number(num)
        except Exception as e:
            return (f"Error looking up task: {e}", False, None)
        if not task:
            return (f"No task {num}. List tasks to see numbers.", False, None)
        task_id = task["id"]
        scalar_keys = ("status", "flagged", "due_date", "available_date", "title", "description", "notes", "priority")
        kwargs = {k: v for k, v in validated.items() if k in scalar_keys and v is not None}
        has_projects = "projects" in validated
        has_remove_projects = "remove_projects" in validated and validated["remove_projects"]
        has_tags = "tags" in validated
        if not kwargs and not has_projects and not has_remove_projects and not has_tags:
            return ("Nothing to update. Specify status, flagged, due_date, available_date, title, description, notes, priority, projects, remove_projects, or tags.", False, None)
        if kwargs:
            try:
                updated = update_task(task_id, **kwargs)
            except Exception as e:
                return (f"Error updating task: {e}", False, None)
            if not updated:
                return (f"Task {num} not found.", False, None)
        if has_projects:
            try:
                from project_service import get_project_by_short_id
                for pid in task.get("projects") or []:
                    remove_task_project(task_id, pid)
                for ref in validated["projects"]:
                    if not ref:
                        continue
                    p = get_project_by_short_id(ref)
                    project_id = p["id"] if p else ref
                    add_task_project(task_id, str(project_id))
            except Exception as e:
                return (f"Error updating task projects: {e}", False, None)
        elif has_remove_projects:
            try:
                from project_service import get_project_by_short_id
                current_ids = list(task.get("projects") or [])
                to_remove_ids = set()
                for ref in validated["remove_projects"]:
                    if not ref:
                        continue
                    p = get_project_by_short_id(ref)
                    pid = p["id"] if p else ref
                    to_remove_ids.add(str(pid))
                new_ids = [pid for pid in current_ids if str(pid) not in to_remove_ids]
                for pid in task.get("projects") or []:
                    remove_task_project(task_id, pid)
                for pid in new_ids:
                    add_task_project(task_id, str(pid))
            except Exception as e:
                return (f"Error removing task from project(s): {e}", False, None)
        if has_tags:
            try:
                for tag in task.get("tags") or []:
                    remove_task_tag(task_id, tag)
                for tag in validated["tags"]:
                    if tag:
                        add_task_tag(task_id, tag)
            except Exception as e:
                return (f"Error updating task tags: {e}", False, None)
        parts = []
        if "status" in kwargs:
            parts.append("complete" if kwargs["status"] == "complete" else "reopened")
        if "flagged" in kwargs:
            parts.append("flagged" if kwargs["flagged"] else "unflagged")
        if "due_date" in kwargs:
            parts.append(f"due {kwargs['due_date']}")
        if "available_date" in kwargs:
            parts.append(f"available {kwargs['available_date']}")
        if "title" in kwargs:
            parts.append("title updated")
        if "description" in kwargs or "notes" in kwargs or "priority" in kwargs:
            parts.append("updated")
        if has_projects:
            parts.append("projects updated")
        if has_remove_projects:
            parts.append("removed from project(s)")
        if has_tags:
            parts.append("tags updated")
        msg = f"Task {num} " + (", ".join(parts) if parts else "updated") + "."
        return (msg, True, None)
    if name != "task_create":
        fallback = f"Tool '{name}' is not implemented yet. You can create, list, info, update, or delete tasks and projects."
        text = response_text.strip() or fallback
        return (fallback if _looks_like_json(text) else text, False, None)

    try:
        validated = _validate_task_create(params)
    except ValueError as e:
        return (f"Invalid task_create parameters: {e}", False, None)

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
            flagged=validated.get("flagged", False, None),
        )
    except Exception as e:
        return (f"Error creating task: {e}", False, None)

    return (_format_task_created_for_telegram(task, tz_name), True, None)
