# Recurrence spec: format, storage, and behavior

## Overview

- **Where recurrence is set:** Only in the Electron app (task create/edit).
- **Where completion is honored:** Marking a recurring task complete from the external API, chat, Telegram, or Electron app will:
  1. Mark the current task complete.
  2. Create a new task (duplicate) with the same recurrence rule.
  3. Set the new task’s due date to the **next occurrence** (today or in the future).
  4. Advance **available_date** by the same amount as due_date (so the offset between available and due is preserved).
  5. Link the new task to the same recurrence chain via `recurrence_parent_id`.

Recurrence is stored as a **JSON object** in the `recurrence` column (TEXT). The app stores and reads it as a string (e.g. `JSON.stringify` / `JSON.parse`). Below we define the object shape and how to interpret it for “next occurrence” and end conditions.

---

## 1. Recurrence object (JSON)

All fields except `freq` are optional. Defaults are listed where relevant.

```json
{
  "anchor": "scheduled",
  "freq": "daily",
  "interval": 1,
  "by_weekday": null,
  "monthly_rule": null,
  "yearly_month": null,
  "yearly_day": null,
  "end_condition": "never",
  "end_after_count": null,
  "end_date": null
}
```

### 1.1 Anchor (when to compute the next occurrence from)

| Value        | Meaning |
|-------------|--------|
| `"scheduled"` | Next occurrence is computed from the task’s **due date** (or available date if no due date?). Prefer due date as primary. |
| `"completed"` | Next occurrence is computed from the **completion date** (date part of `completed_at`). |

- **Storage:** `anchor`: `"scheduled"` \| `"completed"`.
- **Default:** `"scheduled"`.

### 1.2 Frequency and interval

- **Storage:** `freq`: `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"`.
- **Storage:** `interval`: positive integer = “every X days/weeks/months/years”. Default `1`.

---

### 1.3 Frequency-specific fields

#### Daily

- No extra fields. Only `freq: "daily"` and `interval` (every X days).

#### Weekly

- **Storage:** `by_weekday`: array of weekday identifiers.
  - Allowed values: `0`–`6` (Sunday = 0, Monday = 1, … Saturday = 6), **or** two-letter codes `"su"`, `"mo"`, `"tu"`, `"we"`, `"th"`, `"fr"`, `"sa"`.
  - If multiple days are chosen, the task repeats on **each** of those days every interval-weeks (e.g. every 2 weeks on Monday and Tuesday).
- **Example:** Every week on Monday and Tuesday: `"freq": "weekly", "interval": 1, "by_weekday": [1, 2]` or `["mo", "tu"]`.

#### Monthly

Two mutually exclusive options:

**Option A – Day of month (numeric)**  
- **Storage:** `monthly_rule`: `"day_of_month"`, and `monthly_day`: number 1–31.
- **Meaning:** On that day number in each month (e.g. 16 = 16th; 31 is valid and means “last day” where applicable; invalid days for a month are normalized, e.g. Feb 30 → Feb 28/29).

**Option B – Weekday of month (e.g. “second Tuesday”)**  
- **Storage:** `monthly_rule`: `"weekday_of_month"`.  
- **Storage:** `monthly_week`: `1` \| `2` \| `3` \| `4` \| `5` (1 = First, 2 = Second, 3 = Third, 4 = Fourth, 5 = Last).  
- **Storage:** `monthly_weekday`: `0`–`6` or `"su"`–`"sa"` (same as weekly).
- **Meaning:** That occurrence of that weekday in each month (e.g. Second Tuesday, Last Friday).

- **Implementation note:** For “Fifth” weekday (e.g. “last Tuesday”), use `monthly_week: 5` and `monthly_weekday`. Do not use a separate “Fifth” value; “Last” is 5.

#### Yearly

- **Storage:** `yearly_month`: 1–12 (January = 1).  
- **Storage:** `yearly_day`: 1–31 (day of month).
- **Validation:** Must be a valid day for that month (e.g. no Feb 30). February 29 is valid in leap years.
- **Meaning:** That month/day every `interval` years.

---

### 1.4 End conditions

| `end_condition`   | Meaning | Extra fields |
|-------------------|--------|---------------|
| `"never"`         | No end. | None. |
| `"after_count"`   | Stop after N **task instances**. | `end_after_count`: positive integer = total number of task instances (the first task plus each new copy). We count instances, not “recurrence events”: e.g. “after 5” means 5 tasks total; when you complete the 5th, we do not create a 6th. See "Where we count" in §3. |
| `"end_date"`      | Do not create occurrences after this date. | `end_date`: `"YYYY-MM-DD"`. |

- **Storage:** `end_condition`: `"never"` \| `"after_count"` \| `"end_date"`.
- **Storage:** `end_after_count`: integer, required when `end_condition === "after_count"`.
- **Storage:** `end_date`: string date, required when `end_condition === "end_date"`.

---

## 2. Summary of stored fields

| Field              | Type     | Required | Notes |
|--------------------|----------|----------|--------|
| `anchor`           | string   | no       | `"scheduled"` \| `"completed"`, default `"scheduled"`. |
| `freq`             | string   | yes      | `"daily"` \| `"weekly"` \| `"monthly"` \| `"yearly"`. |
| `interval`         | number   | no       | Positive integer, default 1. |
| `by_weekday`       | array    | for weekly | 0–6 or "su"–"sa". |
| `monthly_rule`     | string   | for monthly | `"day_of_month"` \| `"weekday_of_month"`. |
| `monthly_day`      | number   | if day_of_month | 1–31. |
| `monthly_week`     | number   | if weekday_of_month | 1–4 = First–Fourth, 5 = Last. |
| `monthly_weekday`  | number/string | if weekday_of_month | 0–6 or "su"–"sa". |
| `yearly_month`     | number   | for yearly | 1–12. |
| `yearly_day`       | number   | for yearly | 1–31, validated for month/leap. |
| `end_condition`    | string   | no       | `"never"` \| `"after_count"` \| `"end_date"`, default `"never"`. |
| `end_after_count` | number   | if after_count | Positive integer = max task instances in chain (first + recurrences). Count is of existing tasks, not completions; see §3. |
| `end_date`         | string   | if end_date | `YYYY-MM-DD`. |

---

## 3. Interpreting the recurrence (next occurrence)

- **Reference date:**  
  - If `anchor === "completed"`: use the **date part** of `completed_at` of the task being completed.  
  - If `anchor === "scheduled"`: use the task’s **due_date** (or, if missing, **available_date**; if both missing, fall back to completion date).

- **Algorithm:** Given the recurrence object and the reference date, compute the **next occurrence date** that is:
  - On or after the reference date (or “today” if you want to avoid past dates).
  - Consistent with the rule (daily/weekly/monthly/yearly + interval + by_weekday / monthly / yearly options).
  - Before or on `end_date` if `end_condition === "end_date"`.
  - Within the remaining count if `end_condition === "after_count"` (see "Where we count" below).

- **Where we count (end_after_count):** We count **existing task instances** in the chain, not completions. In `complete_recurring_task`, **before** creating the next instance: count how many tasks already have the same `recurrence_parent_id` (including the task we just marked complete). If that count is already ≥ `end_after_count`, do not create a new task. So the limit is "at most N tasks in this recurrence chain." The chain head is the task whose id equals its own `recurrence_parent_id` (the first recurring task); every new instance gets that same `recurrence_parent_id`. No separate "completed count" or stored counter is required—just `SELECT COUNT(*) FROM tasks WHERE recurrence_parent_id = ?`.

- **Advancing available_date:** When creating the next instance, set:
  - `due_date` = next occurrence date.
  - `available_date` = previous task’s available_date + (next_due - previous_due). If the previous task had no available_date, the new task can have no available_date, or you can use “same day as due” as a simple default.

---

## 4. UI choices (Electron app)

- **Anchor:** Radio or toggle: “Recur from scheduled date” / “Recur from completed date”.
- **Frequency:** Daily / Weekly / Monthly / Yearly.
- **Interval:** Number input: “Every X days/weeks/months/years” (X ≥ 1).
- **Weekly:** Multi-select for days of week (e.g. checkboxes Mon–Sun).
- **Monthly:** Either:
  - “On day [1–31] of each month”, or
  - “On [First|Second|Third|Fourth|Last] [Sun|Mon|…|Sat] of each month”.
- **Yearly:** Month dropdown + day of month (1–31), with validation (and leap-year for Feb 29).
- **End:** Radio: “Never end” / “After [N] occurrences” / “Don’t repeat after [date]” (with date picker).

These map directly to the JSON fields above.

---

## 5. Validation rules (save time)

- `freq` required and one of the four values.
- `interval` if present must be ≥ 1.
- **Weekly:** `by_weekday` must be non-empty array of valid weekday values.
- **Monthly day_of_month:** `monthly_day` 1–31.
- **Monthly weekday_of_month:** `monthly_week` 1–5, `monthly_weekday` valid.
- **Yearly:** `yearly_month` 1–12, `yearly_day` valid for that month (and Feb 29 only in leap years).
- **End:** If `end_condition === "after_count"`, `end_after_count` required and ≥ 1. If `end_condition === "end_date"`, `end_date` required and valid `YYYY-MM-DD`.

---

## 6. Backend / task_service

- **Storage:** Keep storing `recurrence` as a JSON string (current behavior).
- **complete_recurring_task:** Replace the “add 1 day” placeholder with:
  1. Parse recurrence JSON.
  2. Determine reference date from `anchor` (scheduled vs completed).
  3. Compute next occurrence date using the rule and end conditions.
  4. If no next occurrence (e.g. past end_date or count exhausted), do not create a new task; only mark current complete.
  5. If next occurrence exists: create new task with due_date = next occurrence, available_date advanced by same delta, same recurrence object and recurrence_parent_id.

A separate doc or code comments can detail the exact “next occurrence” algorithm for each frequency (e.g. daily: ref + interval days; weekly: next matching weekday; monthly: next matching day or weekday-of-month; yearly: next matching month/day with leap-year check).
