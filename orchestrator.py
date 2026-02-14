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

# Tool contract from Spaztick_task_create_Tool_Specification
SYSTEM_PROMPT = """You are the AI orchestrator for Spaztick.
You do not directly modify the database.
You must respond ONLY with a valid JSON tool call when the user intends to create, update, complete, or list tasks.

Available tools:
- task_create
- task_update
- task_complete
- task_list

When creating a task:
- title is required.
- description is optional.
- notes must be Markdown if present.
- status defaults to "inbox" unless explicitly specified.
- priority must be an integer between 0 and 3.
- projects must be an array of project IDs.
- tags must be an array of strings.
- available_date and due_date must be ISO format (YYYY-MM-DD).

If insufficient information is provided, ask a clarification question instead of calling a tool.

Respond with exactly one JSON object in this form when calling a tool:
{"name": "task_create", "parameters": {"title": "...", ...}}
Use "parameters" for the task_create arguments (title, description, notes, status, priority, projects, tags, available_date, due_date).
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
    if "priority" in params and params["priority"] is not None:
        try:
            p = int(params["priority"])
        except (TypeError, ValueError):
            raise ValueError("priority must be an integer between 0 and 3")
        if p < 0 or p > 3:
            raise ValueError("priority must be between 0 and 3")
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
    """Extract a single JSON tool call from the response. Returns (name, parameters) or None."""
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


def run_orchestrator(user_message: str, ollama_base_url: str, model: str, system_prefix: str) -> str:
    """
    Run the orchestrator: send user message to Ollama with system prompt; if response is a
    valid task_create tool call, validate, create task via Task Service, return canonical JSON.
    Otherwise return the LLM response as-is (e.g. clarification question).
    """
    import httpx

    full_system = (system_prefix.strip() + "\n\n" + SYSTEM_PROMPT).strip() if system_prefix else SYSTEM_PROMPT
    payload = {
        "model": model,
        "prompt": user_message,
        "system": full_system,
        "stream": False,
    }
    url = f"{ollama_base_url.rstrip('/')}/api/generate"
    logger.info(
        "LLM request url=%s model=%s prompt_len=%d system_len=%d prompt=%s",
        url, model, len(user_message), len(full_system),
        repr(user_message[:500] + ("..." if len(user_message) > 500 else "")),
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
        return f"Error calling the model: {e}"

    parsed = _parse_tool_call(response_text)
    if parsed:
        logger.info("LLM tool_call parsed name=%s parameters=%s", parsed[0], json.dumps(parsed[1]))
    else:
        logger.info("LLM response is not a tool call, returning as-is")
    if not parsed:
        return response_text.strip() or "I didn't understand. You can ask me to create a task (give at least a title)."

    name, params = parsed
    if name != "task_create":
        # Future: task_update, task_complete, task_list
        return response_text.strip() or f"Tool '{name}' is not implemented yet. You can say 'Create a task: ...' to use task_create."

    try:
        validated = _validate_task_create(params)
    except ValueError as e:
        return f"Invalid task_create parameters: {e}"

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
        return f"Error creating task: {e}"

    canonical = _canonical_task_response(task)
    return json.dumps(canonical, indent=2)
