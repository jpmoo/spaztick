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
Available tools: task_create, task_list, task_when, task_find, task_info, task_update, delete_task, project_create, project_list, project_info, project_archived, project_archive, project_unarchive, delete_project, list_view, list_lists, tag_list, tag_rename, tag_delete.

task_create: Use when the user says "add task", "create task", "new task" with a title. Required: title. Optional: due_date, available_date, project or short_id (single project by short_id, e.g. hous, 1off), projects (array of short_ids), tags (array), priority, description, notes, flagged. You MAY include as many optional parameters as the user provides. Parse the full phrase: "add task roast coffee due today in hous" -> title "roast coffee", due_date "today", project "hous". "create task buy milk in 1off" -> title "buy milk", short_id "1off". Use natural language for dates (today, tomorrow, next week). Output: {"name": "task_create", "parameters": {"title": "...", "due_date": "today", "short_id": "hous"}} with every option the user mentioned.

CRITICAL: When the user asks for TASKS with a date or time bound (due, available, overdue, this week, next week, today, tomorrow, within the next N days), use task_when—NOT task_list and NEVER tag_list. tag_list returns tag names and counts; use tag_list ONLY when the user explicitly asks to "list tags", "show tags", "what tags", or "tag counts". Any request for "tasks due X", "tasks available Y", "overdue tasks", "give me tasks due within the next week" is task_when.

task_when: Use for ANY date-bounded task question. Single required parameter: when (string). Natural-language dates are parsed broadly: "due Friday" / "due by Friday" / "due this week" (on or before that day or end of week), "due before next Friday" (strictly before), "available today" / "available now" (only tasks that have an available_date on or before today—i.e. on my plate today), "available tomorrow", "overdue", "due in 5 days", "next week", "end of month", etc. For BOTH available and due in one query use "available X and due Y" in a single when string. Combine when with other filters: tag, tags, short_id, priority (3=top), etc.
Output format: {"name": "task_when", "parameters": {"when": "..."}} and add optional filters.
Examples: "Tasks due Friday" -> {"name": "task_when", "parameters": {"when": "due Friday"}}. "Show tasks available today and due friday" -> {"name": "task_when", "parameters": {"when": "available today and due friday"}}. "Tasks due before next Friday" -> {"name": "task_when", "parameters": {"when": "due before next Friday"}}. "Tasks available today" -> {"name": "task_when", "parameters": {"when": "available today"}}. "Tasks due within the next 5 days tagged Robert" -> {"name": "task_when", "parameters": {"when": "due in 5 days", "tag": "Robert"}}. "Overdue tasks" -> {"name": "task_when", "parameters": {"when": "overdue"}}.

task_list: Use when the user asks for tasks WITHOUT a date bound (e.g. "list my tasks", "show tasks in 1off", "flagged tasks") or when they want completed/by date filters (completed_by, completed_after). For any "due X", "available X", "overdue", "this week", "next week" use task_when instead.
Never include completed tasks unless the user explicitly asks for them (e.g. "completed", "done", "finished") or asks for "all" tasks. When no status is given, always use status "incomplete". Do not send status "complete" unless the user clearly asked for completed/done tasks or "all tasks".
Parameters (all optional): status (default incomplete; use "complete" only when user asks for completed/done tasks, or "all" for both), tag (single) or tags (array of tag names), tag_mode ("any" = task has any of the tags [OR], "all" = task has all tags [AND]; default "any"), project or short_id (single; use "inbox" for tasks with no project), projects or short_ids (array of short_ids), project_mode ("any" = task in any of the projects [OR], "all" = task in all [AND]; default "any"), due_by, available_by, available_or_due_by, completed_by (date: tasks completed on or before), completed_after (date: tasks completed on or after), title_contains (substring search in title), overdue, sort_by ("due_date", "available_date", "created_at", "completed_at", "title"), flagged (true/false), priority (number 0-3, or label: "high"/"medium high"/"medium low"/"low", or color: "red"/"orange"/"yellow"/"green"; 3=high=red, 2=medium high=orange, 1=medium low=yellow, 0=low=green).
Overdue semantics: A task due today is NOT overdue unless the user says "overdue tomorrow" or asks on a later date. Use overdue (not due_by) when the user asks for "overdue" or "overdue tasks". overdue: true or overdue: "today" -> tasks due yesterday or earlier; overdue: "tomorrow" -> tasks due today or earlier.
Dates: "today", "tomorrow", "yesterday", "now" (use "today")—app resolves them.
Examples: "list overdue tasks" -> {"name": "task_when", "parameters": {"when": "overdue"}}. "list inbox tasks" or "tasks in inbox" -> {"name": "task_list", "parameters": {"short_id": "inbox", "status": "incomplete"}}. "list tasks due today" -> {"name": "task_when", "parameters": {"when": "due today"}}. "gimme tasks in 1off available tomorrow" -> {"name": "task_when", "parameters": {"when": "available tomorrow", "short_id": "1off"}}. "list flagged tasks" -> {"name": "task_list", "parameters": {"flagged": true, "status": "incomplete"}}.
Output format: {"name": "task_list", "parameters": {}} with any of status, tag, tags (array), tag_mode ("any"/"all"), project/short_id (or "inbox"), projects/short_ids (array), project_mode ("any"/"all"), due_by, available_by, available_or_due_by, completed_by, completed_after, title_contains, overdue, sort_by, flagged, priority. E.g. "tasks with tag work or urgent" -> {"tags": ["work", "urgent"], "tag_mode": "any"}. "tasks in 1off and work" -> {"short_ids": ["1off", "work"], "project_mode": "all"}. Priority: use 0-3, or "high"/"medium high"/"medium low"/"low", or "red"/"orange"/"yellow"/"green".

task_find: Find tasks by a search term in title, description, or tag. Use when the user says "find tasks about X", "search for tasks with dogs", "tasks about meetings", "tasks tagged work", or similar. The term is matched in title, description, and tag (so one term finds all matching tasks).
Required parameter: term (the search string, e.g. "dogs", "work", "meetings").
Output format: {"name": "task_find", "parameters": {"term": "..."}}.

task_info: User identifies the task by its friendly id (number). "Tell me about 1", "about task 1", "task #1", "task 1", or just "1" after discussing tasks/projects always means task_info with that number. Never answer with general knowledge about the number—always call task_info.
Output format: {"name": "task_info", "parameters": {"number": 1}} (use the number the user said).

task_update: Change one task by number. You can update any attribute: status, flagged, due_date, available_date, title, description, notes, priority, projects (list—replaces task's projects), remove_projects (list—remove these projects from the task; use for "remove task N from project X"), tags (list—replaces task's tags). Required: number. Optional: status, flagged, due_date, available_date, title, description, notes, priority (0-3 or label "high"/"medium high"/"medium low"/"low" or color "red"/"orange"/"yellow"/"green"), projects (array), remove_projects (array), tags (array). Dates: natural language. Use remove_projects when the user says to remove the task from a project; do not use projects for that.
Examples: "mark task 1 complete" -> {"name": "task_update", "parameters": {"number": 1, "status": "complete"}}. "remove task 1 from 1off" or "take task 1 off project 1off" -> {"name": "task_update", "parameters": {"number": 1, "remove_projects": ["1off"]}}. "add task 1 to 1off" -> {"name": "task_update", "parameters": {"number": 1, "projects": ["1off"]}} (or add to existing: send projects with current + new). "task 1 due tomorrow" -> {"name": "task_update", "parameters": {"number": 1, "due_date": "tomorrow"}}. "task 2 tags work urgent" -> {"name": "task_update", "parameters": {"number": 2, "tags": ["work", "urgent"]}}.
Output format: {"name": "task_update", "parameters": {"number": N, ...}} with only the fields being changed.

delete_task: User identifies the task by its friendly id (the task number, e.g. 1 or #1). First call without confirm to show a confirmation message; when the user confirms (e.g. "yes"), call again with "confirm": true to perform the delete.
Output format: {"name": "delete_task", "parameters": {"number": 1}} or {"name": "delete_task", "parameters": {"number": 1, "confirm": true}}. Use "number" (the task's friendly id from task_list).

project_create: Only "title" is required (the project name). Omit description if the user did not provide it. New projects default to open (active) status; do not send status for create.
Output format: {"name": "project_create", "parameters": {"title": "..."}} and add optional "description" if the user gave it.

project_list: "List projects", "list my projects", "show projects" must be answered with project_list JSON only. Returns only active (non-archived) projects. Output: {"name": "project_list", "parameters": {}}

project_info: User identifies the project by short_id only (e.g. "1off", "work"). Returns full project details and tasks. In this chat we never use full project names—only short_id.
Output format: {"name": "project_info", "parameters": {"short_id": "1off"}}.

project_archived: "List archived projects", "show archived projects" must be answered with project_archived JSON only. Returns projects that have been archived, by archive date (newest first).
Output format: {"name": "project_archived", "parameters": {}}.

project_archive: Archive a project by short_id (e.g. "1off", "work"). First call without confirm; when the user confirms (e.g. "yes"), call again with "confirm": true.
Output format: {"name": "project_archive", "parameters": {"short_id": "1off"}} or {"name": "project_archive", "parameters": {"short_id": "1off", "confirm": true}}.

project_unarchive: Unarchive a project by short_id. First call without confirm; when the user confirms (e.g. "yes"), call again with "confirm": true.
Output format: {"name": "project_unarchive", "parameters": {"short_id": "1off"}} or {"name": "project_unarchive", "parameters": {"short_id": "1off", "confirm": true}}.

delete_project: User identifies the project by short_id only (e.g. "1off", "work"). First call without confirm; when the user confirms (e.g. "yes"), call again with "confirm": true. In this chat we never use full project names—only short_id.
Output format: {"name": "delete_project", "parameters": {"short_id": "1off"}} or {"name": "delete_project", "parameters": {"short_id": "1off", "confirm": true}}.

list_view: Show tasks from a saved list. Use when the user says "view list X", "show tasks on list X", "list tasks on list X", or asks for tasks from a named list. X is always the list's short_id (e.g. "test", "work"). Tasks are returned in the list's configured sort order (same as in the app). Prefer list_view over task_list whenever the user asks for a specific list by name or short_id.
Parameters: list_id (the list's short_id). In this chat we never refer to lists by full name—only by short_id.
Output format: {"name": "list_view", "parameters": {"list_id": "test"}}.

list_lists: List all saved lists with their short_ids. Use when the user asks to list saved lists, show lists, or see list short names (e.g. "list lists", "show my lists").
Output format: {"name": "list_lists", "parameters": {}}.

tag_list: List all tag NAMES and how many tasks have each tag. Use ONLY when the user explicitly asks to "list tags", "show tags", "what tags do I have", or "tag counts". Never use tag_list when the user asks for TASKS (e.g. "tasks due next week" is task_when, not tag_list).
Output format: {"name": "tag_list", "parameters": {}}.

tag_rename: Rename a tag everywhere (task tags, and #tag in titles/notes). First call without confirm; when the user confirms (e.g. "yes"), call again with "confirm": true.
Parameters: old_tag (string), new_tag (string).
Output format: {"name": "tag_rename", "parameters": {"old_tag": "work", "new_tag": "workflow"}} or with "confirm": true.

tag_delete: Remove a tag from all tasks (from task tags and remove #tag from titles/notes). First call without confirm; when the user confirms (e.g. "yes"), call again with "confirm": true.
Parameters: tag (string).
Output format: {"name": "tag_delete", "parameters": {"tag": "work"}} or with "confirm": true.

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
    # Tags: single "tag" or list "tags" with optional "tag_mode" ("any" = OR, "all" = AND)
    tag = params.get("tag")
    tags_raw = params.get("tags") or []
    if isinstance(tags_raw, str):
        tags_raw = [tags_raw] if tags_raw.strip() else []
    if tag is not None and str(tag).strip() and not tags_raw:
        tags_raw = [str(tag).strip()]
    if tags_raw:
        out["tags"] = [str(t).strip() for t in tags_raw if str(t).strip()]
        tag_mode = (params.get("tag_mode") or "any").strip().lower()
        out["tag_mode"] = "all" if tag_mode == "all" else "any"
    elif tag and str(tag).strip():
        out["tag"] = str(tag).strip()
    # Projects: single "project"/"short_id" or list "projects"/"short_ids" with optional "project_mode" ("any" = OR, "all" = AND)
    project = params.get("project") or params.get("short_id")
    projects_raw = params.get("projects") or params.get("short_ids") or []
    if isinstance(projects_raw, str):
        projects_raw = [projects_raw] if projects_raw.strip() else []
    if project is not None and str(project).strip() and not projects_raw:
        projects_raw = [str(project).strip()]
    if projects_raw:
        resolved_ids: list[str] = []
        for raw in projects_raw:
            raw = str(raw).strip()
            if not raw:
                continue
            if raw.lower() == "inbox":
                out["inbox"] = True
                resolved_ids = []
                break
            try:
                from project_service import get_project_by_short_id
                p = get_project_by_short_id(raw)
                if p:
                    resolved_ids.append(p["id"])
            except Exception:
                pass
        if not out.get("inbox") and resolved_ids:
            out["project_ids"] = resolved_ids
            project_mode = (params.get("project_mode") or "any").strip().lower()
            out["project_mode"] = "all" if project_mode == "all" else "any"
    elif project and str(project).strip():
        raw = str(project).strip()
        if raw.lower() == "inbox":
            out["inbox"] = True
        else:
            try:
                from project_service import get_project_by_short_id
                p = get_project_by_short_id(raw)
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
    for key in ("due_by", "due_before", "available_by", "available_or_due_by", "completed_by", "completed_after"):
        if key in out:
            continue  # already set (e.g. from overdue)
        val = params.get(key)
        if val is None or not str(val).strip():
            continue
        resolved = resolve_relative_date(str(val).strip(), tz_name)
        if resolved:
            out[key] = resolved
    if params.get("available_by_required") in (True, 1) or (isinstance(params.get("available_by_required"), str) and str(params.get("available_by_required")).strip().lower() in ("true", "1", "yes")):
        out["available_by_required"] = True
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


def _parse_when_to_task_list_params(when: str, tz_name: str = "UTC") -> dict[str, Any]:
    """
    Parse a natural-language "when" expression into task_list date/overdue params.
    Uses date_utils.parse_date_condition for broad NL support: "due Friday", "due before next Friday",
    "available today" (with available_by_required so only tasks with an available date on or before today), etc.
    """
    from date_utils import parse_date_condition
    out = parse_date_condition(when, tz_name)
    if out:
        return out
    # Fallback: try legacy resolve_relative_date for bare phrases
    from date_utils import resolve_relative_date
    raw = str(when).strip().lower()
    date_expr = re.sub(r"^(due|available)\s+", "", raw).strip()
    date_expr = re.sub(r"^due\s+within\s+", "within ", date_expr)
    resolved = resolve_relative_date(date_expr, tz_name)
    if resolved:
        if raw.startswith("available"):
            return {"available_by": resolved, "available_by_required": False}
        return {"due_by": resolved}
    return {}


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
    if "project" in params and params["project"] is not None and str(params["project"]).strip():
        ref = str(params["project"]).strip()
        if ref.lower() != "inbox":
            out["projects"] = out.get("projects") or []
            out["projects"].append(ref)
    if "short_id" in params and params["short_id"] is not None and str(params["short_id"]).strip():
        ref = str(params["short_id"]).strip()
        if ref.lower() != "inbox":
            out["projects"] = out.get("projects") or []
            if ref not in out["projects"]:
                out["projects"].append(ref)
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
        raw = params["tags"]
        if isinstance(raw, str):
            raw = [raw] if raw.strip() else []
        if not isinstance(raw, list):
            raise ValueError("tags must be an array of strings or a single string")
        out["tags"] = [str(x).strip() for x in raw if str(x).strip()]
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


def _infer_add_task_from_message(user_message: str) -> tuple[str, dict[str, Any]] | None:
    """Parse 'add task X due Y in Z' / 'make a task X due Y in Z' style messages into task_create params. Returns (task_create, params) or None."""
    if not user_message or not isinstance(user_message, str):
        return None
    raw = user_message.strip()
    m = re.search(r"^(?:add|create|make(?:\s+a)?)\s+task\s+(.+)$", raw, re.I)
    if not m:
        return None
    rest = m.group(1).strip()
    if not rest:
        return None
    title = rest
    due_phrase = None
    project = None
    in_m = re.search(r"\s+in\s+([a-z0-9_-]+)\s*$", rest, re.I)
    if in_m:
        project = in_m.group(1).strip()
        rest = rest[: in_m.start()].strip()
    due_m = re.search(r"\s+due\s+(.+)$", rest, re.I)
    if due_m:
        due_phrase = due_m.group(1).strip()
        rest = rest[: due_m.start()].strip()
    title = rest.strip()
    if not title:
        return None
    params: dict[str, Any] = {"title": title}
    if due_phrase:
        params["due_date"] = due_phrase
    if project:
        params["short_id"] = project
    return ("task_create", params)


def _infer_tool_from_user_message(user_message: str) -> tuple[str, dict[str, Any]] | None:
    """If the user message is clearly a list/show tasks or list/show projects command, return (tool_name, params) so we can run the tool even when the model replied conversationally. Conservative: only list/show tasks/projects (bare or with trailing filter words)."""
    if not user_message or not isinstance(user_message, str):
        return None
    msg = user_message.strip().lower()
    if not msg:
        return None
    # Add/create task with inline details (e.g. "add task roast coffee due today in hous")
    inferred = _infer_add_task_from_message(user_message)
    if inferred:
        return inferred
    # View/show a specific list by name or short_id (must come before generic "show lists")
    list_id = _extract_list_identifier_from_message(user_message)
    if list_id:
        return ("list_view", {"list_id": list_id})
    # Find/search tasks by term (before generic list tasks)
    m = re.search(r"\b(?:find|search\s+for|look\s+for)\s+(?:tasks?\s+)(?:about|with|containing|matching)\s+(.+?)(?:\s*[.?]?\s*)$", msg, re.I | re.S)
    if m:
        return ("task_find", {"term": m.group(1).strip()})
    m = re.search(r"\btasks?\s+(?:about|with|containing|tagged)\s+(.+?)(?:\s*[.?]?\s*)$", msg, re.I | re.S)
    if m:
        return ("task_find", {"term": m.group(1).strip()})
    m = re.search(r"^(?:find|search)\s+(.+?)(?:\s*[.?]?\s*)$", msg, re.I | re.S)
    if m and "task" in msg:
        return ("task_find", {"term": m.group(1).strip()})
    # Date-bounded task requests -> task_when (so we never return bare task_list and drop the date)
    if re.search(r"tasks?\s+due\s+within\s+the\s+next\s+week", msg, re.I):
        return ("task_when", {"when": "due within the next week", "status": "incomplete"})
    m = re.search(r"tasks?\s+due\s+in\s+the\s+next\s+(\d+)\s*days?", msg, re.I)
    if m:
        return ("task_when", {"when": f"due in {m.group(1)} days", "status": "incomplete"})
    if re.search(r"tasks?\s+due\s+in\s+(\d+)\s*days?", msg, re.I):
        m = re.search(r"tasks?\s+due\s+in\s+(\d+)\s*days?", msg, re.I)
        if m:
            return ("task_when", {"when": f"due in {m.group(1)} days", "status": "incomplete"})
    if re.search(r"(?:list|show|get|give me|gimme)\s+(?:my\s+)?tasks?\s+due\s+today", msg, re.I) or re.search(r"tasks?\s+due\s+today", msg, re.I):
        return ("task_when", {"when": "due today", "status": "incomplete"})
    if re.search(r"tasks?\s+due\s+tomorrow", msg, re.I):
        return ("task_when", {"when": "due tomorrow", "status": "incomplete"})
    if re.search(r"tasks?\s+due\s+next\s+week", msg, re.I):
        return ("task_when", {"when": "due next week", "status": "incomplete"})
    if re.search(r"(?:list|show|get)?\s*overdue\s+tasks?", msg, re.I) or re.search(r"tasks?\s+overdue", msg, re.I):
        return ("task_when", {"when": "overdue", "status": "incomplete"})
    if re.search(r"tasks?\s+available\s+", msg, re.I):
        am = re.search(r"available\s+(today|tomorrow|next\s+week)", msg, re.I)
        if am:
            return ("task_when", {"when": "available " + am.group(1), "status": "incomplete"})
        am = re.search(r"available\s+in\s+(\d+)\s*days?", msg, re.I)
        if am:
            return ("task_when", {"when": f"available in {am.group(1)} days", "status": "incomplete"})
        return ("task_when", {"when": "available tomorrow", "status": "incomplete"})
    if re.search(r"(?:list|show|get|give me|gimme)\s+(?:my\s+)?tasks?\s+due\b", msg, re.I):
        return ("task_when", {"when": "due within the next week", "status": "incomplete"})
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
    # List/show archived projects
    if re.match(r"^(list|show|get|gimme|display)\s+(my\s+)?archived\s+projects?\b", msg):
        return ("project_archived", {})
    if re.match(r"^archived\s+projects?\s*$", msg):
        return ("project_archived", {})
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
    """Format task list for external API/Telegram: status (□/■) flag (★ if set) title (number) in {short_ids or inbox} [🟡/🔴] due_date."""
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
        flag_str = "★" if flagged else ""
        title = (t.get("title") or "").strip() or "(no title)"
        num = t.get("number")
        num_str = f"({num})" if num is not None else f"({(t.get('id') or '')[:8]})"
        # in {short_id, short_id} or inbox
        if get_project and t.get("projects"):
            short_ids = []
            for pid in t["projects"]:
                p = get_project(pid)
                if p:
                    short_id = (p.get("short_id") or "").strip() or (p.get("id") or "")[:8]
                    if short_id:
                        short_ids.append(short_id)
            in_projects = ", ".join(short_ids) if short_ids else "inbox"
        else:
            in_projects = "inbox"
        # no circle / yellow (due today) / red (overdue) + due_date
        due_part = ""
        if t.get("due_date"):
            due = t["due_date"]
            due_friendly = _friendly_date(due, tz_name)
            if due < today:
                due_part = f" 🔴 {due_friendly}"
            elif due == today:
                due_part = f" 🟡 {due_friendly}"
            else:
                due_part = f" {due_friendly}"
        part = f"{status_icon}{' ' + flag_str if flag_str else ''} {title} {num_str} in {in_projects}{due_part}"
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


def _format_recurrence_short(rec: Any) -> str | None:
    """Format recurrence dict as a short human-readable string for API/chat/Telegram."""
    if not rec or not isinstance(rec, dict):
        return None
    freq = rec.get("freq") or "daily"
    interval = rec.get("interval") or 1
    parts = []
    if interval != 1:
        parts.append(f"every {interval}")
    freq_label = freq.capitalize()
    if freq == "weekly" and rec.get("by_weekday"):
        days = rec["by_weekday"]
        day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        try:
            resolved = [day_names[int(d)] if isinstance(d, int) else str(d)[:2].capitalize() for d in days]
        except (ValueError, TypeError):
            resolved = [str(d) for d in days]
        parts.append(f"Weekly on {', '.join(resolved)}")
    elif freq == "monthly":
        if rec.get("monthly_rule") == "day_of_month" and rec.get("monthly_day") is not None:
            parts.append(f"Monthly on day {rec['monthly_day']}")
        elif rec.get("monthly_rule") == "weekday_of_month":
            week_num = rec.get("monthly_week")
            week_labels = {1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Last"}
            wd = rec.get("monthly_weekday")
            day_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
            wd_str = day_names[int(wd)] if isinstance(wd, int) and 0 <= wd <= 6 else str(wd)
            parts.append(f"Monthly on {week_labels.get(week_num, week_num)} {wd_str}")
        else:
            parts.append(freq_label)
    elif freq == "yearly" and rec.get("yearly_month") is not None and rec.get("yearly_day") is not None:
        months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        m = rec["yearly_month"]
        parts.append(f"Yearly on {months[m] if 1 <= m <= 12 else m}/{rec['yearly_day']}")
    else:
        parts.append(freq_label)
    end = rec.get("end_condition") or "never"
    if end == "after_count" and rec.get("end_after_count") is not None:
        parts.append(f", {rec['end_after_count']} times")
    elif end == "end_date" and rec.get("end_date"):
        parts.append(f", until {rec['end_date']}")
    anchor = rec.get("anchor") or "scheduled"
    if anchor == "completed":
        parts.append(" (from completed date)")
    return " ".join(parts) if parts else "Recurring"


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
    rec_str = _format_recurrence_short(task.get("recurrence"))
    if rec_str:
        lines.append(f"Recurrence: {rec_str}")
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


def _format_archived_project_list_for_telegram(projects: list[dict[str, Any]], tz_name: str, max_show: int = 50) -> str:
    """Format archived projects (ordered by updated_at DESC) for Telegram."""
    if not projects:
        return "No archived projects."
    total = len(projects)
    show = projects[:max_show]
    lines = [f"Archived projects ({total}):"]
    for p in show:
        name = (p.get("name") or "").strip() or "(no name)"
        short_id = p.get("short_id") or (p.get("id") or "")[:8]
        updated = p.get("updated_at") or ""
        if updated:
            try:
                updated = _format_datetime_info(updated, tz_name)
            except Exception:
                pass
        else:
            updated = "—"
        lines.append(f"{short_id}. {name} (archived {updated})")
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
) -> tuple[str, bool, dict[str, Any] | None, bool]:
    """
    Run the orchestrator. Returns (response_text, tool_used, pending_confirm, used_fallback).
    pending_confirm is set when delete_task/delete_project was run without confirm (caller can execute it when user says "yes").
    tool_used is True when a mutating tool was successfully executed (caller should clear history). For delete_* without confirm, tool_used is False.
    used_fallback is True when the tool was inferred from the user message (quick-add) rather than chosen by the AI.
    """
    used_fallback = False
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
        return (f"Error calling the model: {e}", False, None, used_fallback)
    logger.info("Intent router classified as: %s", intent)

    if intent == "CHAT":
        try:
            chat_prompt = _prompt_with_user()
            response_text = _call_ollama(CHAT_MODE_PROMPT, chat_prompt, url, model)
        except Exception as e:
            logger.exception("Chat mode call failed")
            return (f"Error calling the model: {e}", False, None, used_fallback)
        text = response_text.strip() or "I didn't understand. You can ask me to list or create tasks and projects."
        return (text, False, None, used_fallback)

    # Step 2: TOOL — get tool call from orchestrator, then execute
    full_system = (system_prefix.strip() + "\n\n" + TOOL_ORCHESTRATOR_PROMPT).strip() if system_prefix else TOOL_ORCHESTRATOR_PROMPT
    tool_prompt = _prompt_with_user()
    logger.info("Tool mode request prompt_len=%d system_len=%d", len(tool_prompt), len(full_system))
    try:
        response_text = _call_ollama(full_system, tool_prompt, url, model)
    except Exception as e:
        logger.exception("Tool orchestrator call failed")
        return (f"Error calling the model: {e}", False, None, used_fallback)

    parsed = _parse_tool_call(response_text)
    if parsed:
        logger.info("LLM tool_call parsed name=%s parameters=%s", parsed[0], json.dumps(parsed[1]))
    else:
        inferred = _infer_tool_from_user_message(user_message)
        if inferred:
            logger.info("LLM did not return tool call; inferred from user message: name=%s parameters=%s", inferred[0], json.dumps(inferred[1]))
            parsed = inferred
            used_fallback = True
        else:
            logger.info("LLM response is not a tool call, returning as-is")
    if not parsed:
        text = response_text.strip() or "I didn't understand. You can ask me to create or list tasks or projects."
        if _looks_like_json(text):
            return ("I didn't understand. Try: \"Create a task: [title]\", \"List my tasks\", \"Delete task 1\", \"Create a project: [name]\", \"List my projects\", or \"Delete project 1off\".", False, None, used_fallback)
        return (text, False, None, used_fallback)

    name, params = parsed
    if name == "project_info":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("project_info requires short_id (the project's friendly id, e.g. 1off or work).", False, None, used_fallback)
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
            return (f"Error loading project: {e}", False, None, used_fallback)
        if not project:
            return (f"No project with id \"{short_id}\". List projects to see short_ids.", False, None, used_fallback)
        try:
            tasks = svc_list_tasks(project_id=project["id"], limit=500)
            tasks_with_subtasks: list[tuple[dict[str, Any], list[dict[str, Any]]]] = [
                (t, get_tasks_that_depend_on(t["id"])) for t in tasks
            ]
            return (_format_project_info_text(project, tasks_with_subtasks, tz_name), True, None, used_fallback)
        except Exception as e:
            return (f"Error loading project tasks: {e}", False, None, used_fallback)
    if name == "project_list":
        try:
            from project_service import list_projects
            projects = list_projects(status="active")
        except Exception as e:
            return (f"Error listing projects: {e}", False, None, used_fallback)
        return (_format_project_list_for_telegram(projects), True, None, used_fallback)
    if name == "project_archived":
        try:
            from project_service import list_projects
            projects = list_projects(status="archived")
        except Exception as e:
            return (f"Error listing archived projects: {e}", False, None, used_fallback)
        return (_format_archived_project_list_for_telegram(projects, tz_name), True, None, used_fallback)
    if name == "project_archive":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("project_archive requires short_id (e.g. 1off or work).", False, None, used_fallback)
        try:
            from project_service import get_project_by_short_id, update_project
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (f"Error looking up project: {e}", False, None, used_fallback)
        if not project:
            return (f"No project with id \"{short_id}\". List projects to see short_ids.", False, None, used_fallback)
        if project.get("status") == "archived":
            return (f"Project {short_id} is already archived.", True, None, used_fallback)
        if not _parse_confirm(params):
            name_str = (project.get("name") or "").strip() or short_id
            return (
                f"Archive project {short_id} ({name_str})? It will be hidden from the project list until you unarchive it. Reply \"yes\" to confirm.",
                False,
                {"tool": "project_archive", "short_id": short_id},
                used_fallback,
            )
        try:
            update_project(project["id"], status="archived")
        except ValueError as e:
            return (str(e), False, None, used_fallback)
        except Exception as e:
            return (f"Error archiving project: {e}", False, None, used_fallback)
        return (f"Project {short_id} archived. It is now hidden from the project list.", True, None, used_fallback)
    if name == "project_unarchive":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("project_unarchive requires short_id (e.g. 1off or work).", False, None, used_fallback)
        try:
            from project_service import get_project_by_short_id, update_project
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (f"Error looking up project: {e}", False, None, used_fallback)
        if not project:
            return (f"No project with id \"{short_id}\". List archived projects to see short_ids.", False, None, used_fallback)
        if project.get("status") != "archived":
            return (f"Project {short_id} is not archived.", True, None, used_fallback)
        if not _parse_confirm(params):
            name_str = (project.get("name") or "").strip() or short_id
            return (
                f"Unarchive project {short_id} ({name_str})? It will appear in the project list again. Reply \"yes\" to confirm.",
                False,
                {"tool": "project_unarchive", "short_id": short_id},
                used_fallback,
            )
        try:
            update_project(project["id"], status="active")
        except Exception as e:
            return (f"Error unarchiving project: {e}", False, None, used_fallback)
        return (f"Project {short_id} unarchived. It is back in the project list.", True, None, used_fallback)
    if name == "project_create":
        try:
            validated = _validate_project_create(params)
        except ValueError as e:
            return (f"Invalid project_create parameters: {e}", False, None, used_fallback)
        try:
            from project_service import create_project
            project = create_project(
                name=validated["title"],
                description=validated.get("description"),
                status=validated.get("status", "active"),
            )
        except Exception as e:
            return (f"Error creating project: {e}", False, None, used_fallback)
        return (_format_project_created_for_telegram(project), True, None, used_fallback)
    if name == "delete_project":
        short_id = (params.get("short_id") or params.get("project_id") or "").strip()
        if not short_id:
            return ("delete_project requires short_id (the project's friendly id, e.g. 1off or work).", False, None, used_fallback)
        try:
            from project_service import get_project_by_short_id, delete_project
            project = get_project_by_short_id(short_id)
        except Exception as e:
            return (f"Error looking up project: {e}", False, None, used_fallback)
        if not project:
            return (f"No project with id \"{short_id}\". List projects to see short_ids.", False, None, used_fallback)
        if not _parse_confirm(params):
            name_str = (project.get("name") or "").strip() or short_id
            return (
                f"Delete project {short_id} ({name_str})? It will be removed from all tasks that use it; "
                "some tasks may end up with no project assignments. Reply \"yes\" to confirm.",
                False,
                {"tool": "delete_project", "short_id": short_id},
                used_fallback,
            )
        try:
            delete_project(project["id"])
        except Exception as e:
            return (f"Error deleting project: {e}", False, None, used_fallback)
        return (f"Project {short_id} deleted. It has been removed from all tasks.", True, None, used_fallback)
    if name == "delete_task":
        num = _parse_task_number(params)
        if num is None:
            return ("delete_task requires number (the task's friendly id, e.g. 1). List tasks to see numbers.", False, None, used_fallback)
        try:
            from task_service import get_task_by_number, delete_task
            task = get_task_by_number(num)
        except Exception as e:
            return (f"Error looking up task: {e}", False, None, used_fallback)
        if not task:
            return (f"No task {num}. List tasks to see numbers.", False, None, used_fallback)
        if not _parse_confirm(params):
            title = (task.get("title") or "").strip() or "(no title)"
            return (f"Delete task {num} ({title})? This cannot be undone. Reply \"yes\" to confirm.", False, {"tool": "delete_task", "number": num}, used_fallback)
        try:
            delete_task(task["id"])
        except Exception as e:
            return (f"Error deleting task: {e}", False, None, used_fallback)
        return (f"Task {num} deleted.", True, None, used_fallback)
    if name == "task_info":
        num = _parse_task_number(params)
        if num is None:
            return ("task_info requires number (the task's friendly id, e.g. 1). List tasks to see numbers.", False, None, used_fallback)
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
            return (f"Error loading task: {e}", False, None, used_fallback)
        if not task:
            return (f"No task {num}. List tasks to see numbers.", False, None, used_fallback)
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
            return (_format_task_info_text(task, parent_tasks, subtasks, project_labels, tz_name), True, None, used_fallback)
        except Exception as e:
            return (f"Error loading task details: {e}", False, None, used_fallback)
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
                project_ids=validated.get("project_ids"),
                project_mode=validated.get("project_mode") or "any",
                inbox=validated.get("inbox") or False,
                tag=validated.get("tag"),
                tags=validated.get("tags"),
                tag_mode=validated.get("tag_mode") or "any",
                due_by=validated.get("due_by"),
                due_before=validated.get("due_before"),
                available_by=validated.get("available_by"),
                available_by_required=validated.get("available_by_required") or False,
                available_or_due_by=validated.get("available_or_due_by"),
                completed_by=validated.get("completed_by"),
                completed_after=validated.get("completed_after"),
                title_contains=validated.get("title_contains"),
                sort_by=validated.get("sort_by"),
                flagged=validated.get("flagged"),
                priority=validated.get("priority"),
            )
        except Exception as e:
            return (f"Error listing tasks: {e}", False, None, used_fallback)
        return (_format_task_list_for_telegram(tasks, 50, tz_name), True, None, used_fallback)
    if name == "task_when":
        when = (params.get("when") or "").strip()
        if not when:
            return ("task_when requires a 'when' expression (e.g. 'due within the next week', 'available tomorrow', 'overdue').", False, None, used_fallback)
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        when_params = _parse_when_to_task_list_params(when, tz_name)
        if not when_params:
            return (f"Could not parse date from \"{when}\". Try: due today, due tomorrow, due within the next week, available tomorrow, overdue.", False, None, used_fallback)
        merged = dict(params)
        merged.pop("when", None)
        merged.setdefault("status", "incomplete")
        merged.update(when_params)
        try:
            validated = _validate_task_list_params(merged, tz_name)
            from task_service import list_tasks as svc_list_tasks
            tasks = svc_list_tasks(
                limit=500,
                status=validated.get("status"),
                project_id=validated.get("project_id"),
                project_ids=validated.get("project_ids"),
                project_mode=validated.get("project_mode") or "any",
                inbox=validated.get("inbox") or False,
                tag=validated.get("tag"),
                tags=validated.get("tags"),
                tag_mode=validated.get("tag_mode") or "any",
                due_by=validated.get("due_by"),
                due_before=validated.get("due_before"),
                available_by=validated.get("available_by"),
                available_by_required=validated.get("available_by_required") or False,
                available_or_due_by=validated.get("available_or_due_by"),
                completed_by=validated.get("completed_by"),
                completed_after=validated.get("completed_after"),
                title_contains=validated.get("title_contains"),
                sort_by=validated.get("sort_by"),
                flagged=validated.get("flagged"),
                priority=validated.get("priority"),
            )
        except Exception as e:
            return (f"Error listing tasks: {e}", False, None, used_fallback)
        return (_format_task_list_for_telegram(tasks, 50, tz_name), True, None, used_fallback)
    if name == "task_find":
        term = (params.get("term") or params.get("query") or "").strip()
        if not term:
            return ("task_find requires a search term (e.g. \"dogs\", \"work\").", False, None, used_fallback)
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        try:
            from task_service import list_tasks as svc_list_tasks
            tasks = svc_list_tasks(limit=500, q=term, status="incomplete")
        except Exception as e:
            return (f"Error searching tasks: {e}", False, None, used_fallback)
        header = f"Tasks matching \"{term}\":\n"
        return (header + _format_task_list_for_telegram(tasks, 50, tz_name), True, None, used_fallback)
    if name == "list_view":
        list_id = (params.get("list_id") or params.get("name") or "").strip()
        if not list_id:
            # Try to extract list short_id from user message (e.g. "View test list", "show tasks on list test")
            extracted = _extract_list_identifier_from_message(user_message)
            if extracted:
                list_id = extracted
            else:
                return ("list_view requires list_id (the list's short_id). Use list_lists to see short_ids.", False, None, used_fallback)
        try:
            from list_service import get_list, run_list
        except Exception as e:
            return (f"Error loading list service: {e}", False, None, used_fallback)
        lst = get_list(list_id)
        if not lst:
            return (f"List \"{list_id}\" not found. Use list_lists to see short_ids.", False, None, used_fallback)
        tz_name = "UTC"
        try:
            from config import load as load_config
            tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
        except Exception:
            pass
        try:
            tasks = run_list(list_id, limit=500, tz_name=tz_name)
        except Exception as e:
            return (f"Error running list: {e}", False, None, used_fallback)
        list_label = (lst.get("name") or "").strip() or list_id
        short_id = (lst.get("short_id") or "").strip()
        if short_id:
            header = f"List: {list_label} ({short_id})\n"
        else:
            header = f"List: {list_label}\n"
        return (header + _format_task_list_for_telegram(tasks, 50, tz_name), True, None, used_fallback)
    if name == "list_lists":
        try:
            from list_service import list_lists as list_lists_svc
        except Exception as e:
            return (f"Error loading list service: {e}", False, None, used_fallback)
        try:
            lists = list_lists_svc()
        except Exception as e:
            return (f"Error listing lists: {e}", False, None, used_fallback)
        if not lists:
            return ("No saved lists yet. Create one via the app or API to view lists here.", True, None, used_fallback)
        lines = ["Lists:"]
        for lst in lists:
            name_part = (lst.get("name") or "").strip() or "(no name)"
            short = (lst.get("short_id") or "").strip()
            if short:
                lines.append(f"• {name_part} ({short})")
            else:
                lines.append(f"• {name_part}")
        return ("\n".join(lines), True, None, used_fallback)
    if name == "tag_list":
        try:
            from task_service import tag_list as svc_tag_list
            items = svc_tag_list()
        except Exception as e:
            return (f"Error listing tags: {e}", False, None, used_fallback)
        if not items:
            return ("No tags yet. Tags come from task tags or #tag in task titles/notes.", True, None, used_fallback)
        lines = ["Tags (task count):"]
        for item in items:
            lines.append(f"• {item['tag']}: {item['count']} task(s)")
        return ("\n".join(lines), True, None, used_fallback)
    if name == "tag_rename":
        old_tag = (params.get("old_tag") or "").strip()
        new_tag = (params.get("new_tag") or "").strip()
        if not old_tag:
            return ("tag_rename requires old_tag.", False, None, used_fallback)
        if not new_tag:
            return ("tag_rename requires new_tag.", False, None, used_fallback)
        if old_tag == new_tag:
            return ("old_tag and new_tag are the same.", True, None, used_fallback)
        try:
            from task_service import tag_list
            tags = tag_list()
            count = next((x["count"] for x in tags if x["tag"] == old_tag), 0)
        except Exception:
            count = 0
        if not _parse_confirm(params):
            return (
                f"Rename tag \"{old_tag}\" to \"{new_tag}\"? This will update task tags and any #{old_tag} in titles/notes ({count} task(s)). Reply \"yes\" to confirm.",
                False,
                {"tool": "tag_rename", "old_tag": old_tag, "new_tag": new_tag},
                used_fallback,
            )
        try:
            from task_service import tag_rename as svc_tag_rename
            n = svc_tag_rename(old_tag, new_tag)
            return (f"Tag \"{old_tag}\" renamed to \"{new_tag}\". Updated {n} task(s).", True, None, used_fallback)
        except ValueError as e:
            return (str(e), False, None, used_fallback)
        except Exception as e:
            return (f"Error renaming tag: {e}", False, None, used_fallback)
    if name == "tag_delete":
        tag = (params.get("tag") or "").strip()
        if not tag:
            return ("tag_delete requires tag.", False, None, used_fallback)
        try:
            from task_service import tag_list
            tags = tag_list()
            count = next((x["count"] for x in tags if x["tag"] == tag), 0)
        except Exception:
            count = 0
        if not _parse_confirm(params):
            return (
                f"Delete tag \"{tag}\"? It will be removed from all task tags and any #{tag} in titles/notes ({count} task(s)). Reply \"yes\" to confirm.",
                False,
                {"tool": "tag_delete", "tag": tag},
                used_fallback,
            )
        try:
            from task_service import tag_delete as svc_tag_delete
            svc_tag_delete(tag)
            return (f"Tag \"{tag}\" removed from all tasks.", True, None, used_fallback)
        except ValueError as e:
            return (str(e), False, None, used_fallback)
        except Exception as e:
            return (f"Error deleting tag: {e}", False, None, used_fallback)
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
            return (str(e), False, None, used_fallback)
        from date_utils import resolve_task_dates
        validated = resolve_task_dates(validated, tz_name)
        num = validated.pop("number")
        try:
            from task_service import get_task_by_number, update_task, complete_recurring_task, remove_task_project, add_task_project, remove_task_tag, add_task_tag
            task = get_task_by_number(num)
        except Exception as e:
            return (f"Error looking up task: {e}", False, None, used_fallback)
        if not task:
            return (f"No task {num}. List tasks to see numbers.", False, None, used_fallback)
        task_id = task["id"]
        scalar_keys = ("status", "flagged", "due_date", "available_date", "title", "description", "notes", "priority")
        kwargs = {k: v for k, v in validated.items() if k in scalar_keys and v is not None}
        has_projects = "projects" in validated
        has_remove_projects = "remove_projects" in validated and validated["remove_projects"]
        has_tags = "tags" in validated
        if not kwargs and not has_projects and not has_remove_projects and not has_tags:
            return ("Nothing to update. Specify status, flagged, due_date, available_date, title, description, notes, priority, projects, remove_projects, or tags.", False, None, used_fallback)
        # When marking a recurring task complete, create next instance and mark current complete
        if kwargs.get("status") == "complete" and task.get("recurrence"):
            try:
                complete_recurring_task(task_id)
            except Exception as e:
                return (f"Error completing recurring task: {e}", False, None, used_fallback)
            kwargs = {k: v for k, v in kwargs.items() if k != "status"}
        if kwargs:
            try:
                updated = update_task(task_id, **kwargs)
            except Exception as e:
                return (f"Error updating task: {e}", False, None, used_fallback)
            if not updated:
                return (f"Task {num} not found.", False, None, used_fallback)
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
                return (f"Error updating task projects: {e}", False, None, used_fallback)
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
                return (f"Error removing task from project(s): {e}", False, None, used_fallback)
        if has_tags:
            try:
                for tag in task.get("tags") or []:
                    remove_task_tag(task_id, tag)
                for tag in validated["tags"]:
                    if tag:
                        add_task_tag(task_id, tag)
            except Exception as e:
                return (f"Error updating task tags: {e}", False, None, used_fallback)
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
        return (msg, True, None, used_fallback)
    if name != "task_create":
        fallback = f"Tool '{name}' is not implemented yet. You can create, list, info, update, or delete tasks and projects."
        text = response_text.strip() or fallback
        return (fallback if _looks_like_json(text) else text, False, None, used_fallback)

    try:
        validated = _validate_task_create(params)
    except ValueError as e:
        return (f"Invalid task_create parameters: {e}", False, None, used_fallback)

    tz_name = "UTC"
    try:
        from config import load as load_config
        tz_name = getattr(load_config(), "user_timezone", "") or "UTC"
    except Exception:
        pass
    from date_utils import resolve_task_dates
    validated = resolve_task_dates(validated, tz_name)

    project_ids = None
    if validated.get("projects"):
        try:
            from project_service import get_project_by_short_id
            project_ids = []
            for ref in validated["projects"]:
                ref = str(ref).strip()
                if not ref or ref.lower() == "inbox":
                    continue
                p = get_project_by_short_id(ref)
                if p:
                    project_ids.append(p["id"])
                else:
                    project_ids.append(ref)
        except Exception:
            project_ids = validated.get("projects")

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
            projects=project_ids,
            tags=validated.get("tags"),
            flagged=bool(validated.get("flagged", False)),
        )
    except Exception as e:
        return (f"Error creating task: {e}", False, None, used_fallback)

    return (_format_task_created_for_telegram(task, tz_name), True, None, used_fallback)
