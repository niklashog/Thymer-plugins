# Today's Focus Dashboard

**Type:** Global Plugin

A workspace-wide task dashboard that aggregates tasks from across your entire Thymer workspace. Operates in two modes — **Focus** for executing your day, **Plan** for deciding what matters.

## Modes

### Focus (default when tasks exist)

Shows what you're working on today, organized by time.

- **Unscheduled** — tasks pinned to today or scheduled for today that haven't been assigned a time block yet
- **Day Plan** — time slots from Early Morning through Evening; tap a task then a slot (or vice versa) to assign it

Navigate to past or future days using the `←` / `→` arrows in the header to review or plan other days.

Switch to Plan mode with the **Plan →** button in the header.

### Plan

Used to decide what goes into your day.

- **Overdue** — tasks past their due date, highlighted in red
- **Today's Focus** — tasks pinned for today
- **Inbox** — all undated todos with no scheduled date

Tap a task body in Overdue or Inbox to pin it to Today's Focus. Remove it with `×`. Switch back with the **← Focus** button.

## Task interactions

- **Circle button** — mark a task done (or undo it from the done state). Done tasks appear with strikethrough and reduced opacity.
- **Source name / arrow icon** — the source document name and `↗` icon are a single clickable area that navigates to the task's origin in Thymer.
- **× button** — unpin from Today's Focus or remove from a time block.
- **Task text** (in Focus mode) — tap to select a task, then tap a time block to assign it; tap again to deselect.

The dashboard refreshes automatically when tasks are created, updated, or completed elsewhere in the workspace.

## Installation

1. Open Thymer and go to **Settings → Plugins**
2. Create a new **Global Plugin**
3. Paste the contents of `customCode.js` into the code editor
4. Paste the contents of `configuration.json` into the configuration editor
5. Save and activate the plugin

Access the dashboard via the sidebar icon or the command palette (`Open Today's Focus`).
