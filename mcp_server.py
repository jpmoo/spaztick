#!/usr/bin/env python3
"""
MCP server for Spaztick: exposes the same 16 tools as the API/Telegram path.
Claude (Desktop or Code) connects via SSE; no Ollama involved.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def _run_tool(name: str, params: dict) -> str:
    """Execute one tool via the orchestrator with response_format='mcp'. Returns plain text."""
    from orchestrator import run_orchestrator
    text, _success, _pending, _ = run_orchestrator(
        "",
        "http://localhost",
        "dummy",
        "",
        response_format="mcp",
        override_parsed=(name, params),
    )
    return text


def _tool_task_create(
    title: str,
    description: str | None = None,
    notes: str | None = None,
    available_date: str | None = None,
    due_date: str | None = None,
    project: str | None = None,
    short_id: str | None = None,
    projects: list[str] | None = None,
    tags: list[str] | None = None,
    priority: str | int | None = None,
    flagged: bool | None = None,
) -> str:
    """Create a task. Required: title. Optional: description, notes, available_date, due_date, project/short_id, projects, tags, priority, flagged."""
    params: dict = {"title": title}
    if description is not None:
        params["description"] = description
    if notes is not None:
        params["notes"] = notes
    if available_date is not None:
        params["available_date"] = available_date
    if due_date is not None:
        params["due_date"] = due_date
    if project is not None:
        params["project"] = project
    if short_id is not None:
        params["short_id"] = short_id
    if projects is not None:
        params["projects"] = projects
    if tags is not None:
        params["tags"] = tags
    if priority is not None:
        params["priority"] = priority
    if flagged is not None:
        params["flagged"] = flagged
    return _run_tool("task_create", params)


def _tool_task_find(
    status: str | None = None,
    when: str | None = None,
    term: str | None = None,
    tag: str | None = None,
    tags: list[str] | None = None,
    short_id: str | None = None,
    project: str | None = None,
    projects: list[str] | None = None,
    list_id: str | None = None,
    flagged: bool | None = None,
    priority: str | int | None = None,
    blocked_by_task: int | None = None,
    blocking_task: int | None = None,
) -> str:
    """List or search tasks. All params optional. Use when for due/available/overdue, short_id for project, list_id for saved list."""
    params: dict = {}
    if status is not None:
        params["status"] = status
    if when is not None:
        params["when"] = when
    if term is not None:
        params["term"] = term
    if tag is not None:
        params["tag"] = tag
    if tags is not None:
        params["tags"] = tags
    if short_id is not None:
        params["short_id"] = short_id
    if project is not None:
        params["project"] = project
    if projects is not None:
        params["projects"] = projects
    if list_id is not None:
        params["list_id"] = list_id
    if flagged is not None:
        params["flagged"] = flagged
    if priority is not None:
        params["priority"] = priority
    if blocked_by_task is not None:
        params["blocked_by_task"] = blocked_by_task
    if blocking_task is not None:
        params["blocking_task"] = blocking_task
    return _run_tool("task_find", params)


def _tool_task_info(number: int) -> str:
    """Get details for one task by its friendly number (e.g. 1)."""
    return _run_tool("task_info", {"number": number})


def _tool_task_update(
    number: int,
    status: str | None = None,
    flagged: bool | None = None,
    due_date: str | None = None,
    available_date: str | None = None,
    title: str | None = None,
    description: str | None = None,
    notes: str | None = None,
    priority: str | int | None = None,
    projects: list[str] | None = None,
    remove_projects: list[str] | None = None,
    tags: list[str] | None = None,
) -> str:
    """Update a task by number. Required: number. Optional: status, flagged, due_date, available_date, title, description, notes, priority, projects, remove_projects, tags."""
    params: dict = {"number": number}
    if status is not None:
        params["status"] = status
    if flagged is not None:
        params["flagged"] = flagged
    if due_date is not None:
        params["due_date"] = due_date
    if available_date is not None:
        params["available_date"] = available_date
    if title is not None:
        params["title"] = title
    if description is not None:
        params["description"] = description
    if notes is not None:
        params["notes"] = notes
    if priority is not None:
        params["priority"] = priority
    if projects is not None:
        params["projects"] = projects
    if remove_projects is not None:
        params["remove_projects"] = remove_projects
    if tags is not None:
        params["tags"] = tags
    return _run_tool("task_update", params)


def _tool_delete_task(number: int, confirm: bool = False) -> str:
    """Delete a task by number. Call without confirm first; then with confirm=true after user confirms."""
    return _run_tool("delete_task", {"number": number, "confirm": confirm})


def _tool_project_create(title: str, description: str | None = None) -> str:
    """Create a project. Required: title. Optional: description."""
    params: dict = {"title": title}
    if description is not None:
        params["description"] = description
    return _run_tool("project_create", params)


def _tool_project_list() -> str:
    """List active (non-archived) projects."""
    return _run_tool("project_list", {})


def _tool_project_info(short_id: str) -> str:
    """Get project details and tasks by short_id (e.g. 1off, work)."""
    return _run_tool("project_info", {"short_id": short_id})


def _tool_project_archived() -> str:
    """List archived projects."""
    return _run_tool("project_archived", {})


def _tool_project_archive(short_id: str, confirm: bool = False) -> str:
    """Archive a project by short_id. Call with confirm=true after user confirms."""
    return _run_tool("project_archive", {"short_id": short_id, "confirm": confirm})


def _tool_project_unarchive(short_id: str, confirm: bool = False) -> str:
    """Unarchive a project by short_id. Call with confirm=true after user confirms."""
    return _run_tool("project_unarchive", {"short_id": short_id, "confirm": confirm})


def _tool_delete_project(short_id: str, confirm: bool = False) -> str:
    """Delete a project by short_id. Call with confirm=true after user confirms."""
    return _run_tool("delete_project", {"short_id": short_id, "confirm": confirm})


def _tool_list_lists() -> str:
    """List all saved lists with their short_ids."""
    return _run_tool("list_lists", {})


def _tool_tag_list() -> str:
    """List all tags and how many tasks have each tag."""
    return _run_tool("tag_list", {})


def _tool_tag_rename(old_tag: str, new_tag: str, confirm: bool = False) -> str:
    """Rename a tag everywhere. Call with confirm=true after user confirms."""
    return _run_tool("tag_rename", {"old_tag": old_tag, "new_tag": new_tag, "confirm": confirm})


def _tool_tag_delete(tag: str, confirm: bool = False) -> str:
    """Remove a tag from all tasks. Call with confirm=true after user confirms."""
    return _run_tool("tag_delete", {"tag": tag, "confirm": confirm})


def main() -> None:
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("Spaztick", json_response=True)

    mcp.tool(name="task_create")(_tool_task_create)
    mcp.tool(name="task_find")(_tool_task_find)
    mcp.tool(name="task_info")(_tool_task_info)
    mcp.tool(name="task_update")(_tool_task_update)
    mcp.tool(name="delete_task")(_tool_delete_task)
    mcp.tool(name="project_create")(_tool_project_create)
    mcp.tool(name="project_list")(_tool_project_list)
    mcp.tool(name="project_info")(_tool_project_info)
    mcp.tool(name="project_archived")(_tool_project_archived)
    mcp.tool(name="project_archive")(_tool_project_archive)
    mcp.tool(name="project_unarchive")(_tool_project_unarchive)
    mcp.tool(name="delete_project")(_tool_delete_project)
    mcp.tool(name="list_lists")(_tool_list_lists)
    mcp.tool(name="tag_list")(_tool_tag_list)
    mcp.tool(name="tag_rename")(_tool_tag_rename)
    mcp.tool(name="tag_delete")(_tool_tag_delete)

    # Port from config or default 8082
    try:
        from config import load as load_config
        cfg = load_config()
        port = int(getattr(cfg, "mcp_port", None) or 8082)
        host = str(getattr(cfg, "mcp_host", None) or "0.0.0.0")
    except Exception:
        port = 8082
        host = "0.0.0.0"

    mcp.run(transport="streamable-http", host=host, port=port)


if __name__ == "__main__":
    main()
