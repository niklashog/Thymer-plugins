# Daily Focus Dashboard

**Type:** Global Plugin

A workspace-wide task dashboard that aggregates tasks from across your entire Thymer workspace. Operates in two modes — **Focus** for executing your day, **Plan** for deciding what matters.

## Screenshots

| Plan | Focus | History | Future |
|---|---|---|---|
| ![Plan mode](images/newplanview.png) | ![Focus mode](images/newfocusview.png) | ![History](images/newwithhistory.png) | ![Future](images/newplanyourtomorrow.png) |

## Modes

### Focus

Shows what you're working on today, organized by time.

- **Unscheduled** — tasks pinned to today or scheduled for today without a time block
- **Day Plan** — time slots from Early Morning through Evening; tap a task then a slot (or vice versa) to assign it

Navigate to past or future days with `←` / `→`. Future days show a dimmed preview of tasks that would recur on that day. Past days show a completion history for recurring tasks — completed occurrences appear with strikethrough, missed ones appear dimmed. Switch to Plan with the **Plan →** button.

### Plan

Used to decide what goes into your day.

- **Overdue** — tasks past their due date, highlighted in red
- **Today's Focus** — tasks pinned for today
- **Inbox** — all undated todos; use **Hide/Show recurring** to filter recurring tasks out

Tap a task in Overdue or Inbox to pin it to Today's Focus. Remove it with `×`. Navigate forward to future dates with `←` / `→`. Switch back with **← Focus**.

### Recurring tasks

Accessible via the ☰ menu. Lists all tasks marked as recurring. Tap a row to expand and set its schedule — choose a frequency (daily / weekly / monthly / yearly) and, where applicable, a day. Remove the recurring setting via the trash icon.

Each recurring task exists as a single task forever — no copies are created. Checking it off advances the scheduled date to the next occurrence and resets it to undone, ready for next time. Past occurrences are tracked as ghost traces in the Focus history view.

### Ignore list

Accessible via the ☰ menu. Hide tasks from Plan and Focus without deleting them. Ignored tasks are listed separately and can be restored at any time with a single click.

## Menu

A hamburger menu (☰) sits in the top left corner of every view:

- **Focus** — switch to Focus mode
- **Plan** — switch to Plan mode
- **Recurring tasks** — manage recurring schedules
- **Ignore list** — hide tasks from Plan and Focus

## Task interactions

- **Checkbox** — mark a task done (or undo from the done state). Done tasks appear with strikethrough and reduced opacity. For recurring tasks, checking off advances the date to the next occurrence instead of marking permanently done.
- **Repeat icon** — mark a task as recurring (defaults to daily) or remove its recurring schedule.
- **Source name / ↗ icon** — navigates directly to the task in its source document, scrolling to and highlighting it.
- **× button** — unpin from Today's Focus or remove from a time block.
- **Task text** (Focus mode) — tap to select a task, then tap a time block to assign it; tap again to deselect.

The dashboard refreshes automatically when tasks are created, updated, or completed elsewhere in the workspace.

## Changelog

### 2026-04-26
- **Fix** — journal transclusions now work correctly across multiple workspaces or accounts open in the same browser

### 2026-04-25 (recurring rethink)
- **One task forever** — recurring tasks no longer create copies on each occurrence; a single task advances to the next date when checked off
- **Ghost traces** — past days in Focus show recurring history: completed occurrences appear with strikethrough, missed ones appear dimmed
- **Bounded history** — missed ghost traces only appear from the date a recurring schedule was first set, not retroactively
- **Journal transclusion removed for recurring** — recurring completions are tracked in-plugin rather than via journal transclusions

### 2026-04-25
- **Instant UI** — panel opens immediately, no loading delay
- **Recurring preview** — future dates show a dimmed ghost of tasks that would recur that day
- **UI overhaul** — new design across all views
- **Journal transclusion** — completing a task automatically adds a transclusion to today's journal page
- **Native due dates** — recurring tasks show their scheduled date natively in Thymer; set immediately when configuring a recurring schedule

### 2026-04-24
- **Recurring tasks (experimental)** — mark tasks as recurring (daily / weekly / monthly / yearly); auto-generates occurrences and catches up in the background
- **Recurring tasks view** — accessible via ☰; tap a row to expand and edit its schedule

### 2026-04-23
- Added **☰ menu** — sits in the top left corner of every view, starting point for plugin settings and tools
- Added **Ignore list** — accessible via the ☰ menu. Hide tasks from Plan and Focus without deleting them. Restore at any time from the same view.
- **Source navigation** now scrolls to and highlights the specific task in its source document, not just the page

## Installation

1. Open Thymer and go to **Settings → Plugins**
2. Create a new **Global Plugin**
3. Paste the contents of `customCode.js` into the code editor
4. Paste the contents of `configuration.json` into the configuration editor
5. Save and activate the plugin

Access the dashboard via the sidebar icon or the command palette (`Open Daily Focus`).
