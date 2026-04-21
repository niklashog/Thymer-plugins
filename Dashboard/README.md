# Dashboard

**Type:** Global Plugin

A workspace-wide task dashboard that aggregates tasks from across your entire Thymer workspace and lets you manage them in one place.

## Features

- **Overdue** — tasks past their due date, highlighted in red
- **Today's Focus** — tasks you've manually pinned for today, persisted across sessions
- **Inbox** — all undated todos without a scheduled date

Pin any inbox task to Today's Focus with `+`, remove it with `×`. Mark tasks done with the circle button. Click a task to open it in its source document.

The dashboard updates automatically when tasks are created, updated, or completed.

## Installation

1. Open Thymer and go to **Settings → Plugins**
2. Create a new **Global Plugin**
3. Paste the contents of `customCode.js` into the code editor
4. Paste the contents of `configuration.json` into the configuration editor
5. Save and activate the plugin

The dashboard is accessible via the sidebar or the command palette (`Open Dashboard`).
