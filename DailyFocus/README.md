# Daily Focus

**Type:** Global Plugin

Daily Focus collects tasks from across your Thymer workspace and turns them into a simple daily workflow:

- **Plan** decides what belongs in your day.
- **Focus** shows what you are working on today.
- **Peek** opens Daily Focus over your current note so you can check or plan without switching context.

## Screenshots

| Plan desktop | Focus desktop | Plan mobile | Focus mobile |
|---|---|---|---|
| ![Plan desktop](images/newplan.png) | ![Focus desktop](images/newfocus.png) | ![Plan mobile](images/newplanmobile.png) | ![Focus mobile](images/newfocusmobile.png) |

## Installation

1. Open Thymer and go to **Settings -> Plugins**.
2. Create a new **Global Plugin**.
3. Paste the contents of `customCode.js` into the code editor.
4. Paste the contents of `configuration.json` into the configuration editor.
5. Save and activate the plugin.

Open Daily Focus from the sidebar icon or from the command palette with `Open Daily Focus`.

## Quick Start

1. Open **Daily Focus**.
2. Go to **Plan**.
3. Click tasks in **Overdue** or **Inbox** to add them to **Today's Focus**.
4. Go to **Focus**.
5. Click a task to assign it to a time block, or check it off when done.

## Peek

Peek opens Daily Focus in a modal over your current note. Use it when you want to quickly check Focus, plan the day, or review upcoming work without leaving the page you are editing.

Open it from the command palette:

```text
Daily Focus: Peek
```

The Peek view includes a Focus / Plan switch, so you can move between planning and execution without navigating away from your current context.

## Plan

Plan is where you decide what matters.

- **Overdue** shows tasks past their due date.
- **Today's Focus** shows tasks pinned for the selected day.
- **Inbox** shows unscheduled tasks and, depending on the Upcoming menu, future dated tasks.
- Click a task in Overdue or Inbox to pin it to Today's Focus.
- Use the date arrows to plan future days.

Date ranges such as `this week`, `this month`, and `this year` stay in Plan Inbox instead of appearing automatically in Focus. Plan sorts exact dates first, then ranges by start date, then undated tasks.

## Focus

Focus is where you work through the day.

- **Unscheduled** shows tasks pinned to today without a time block.
- **Day Plan** groups tasks into time blocks from Early Morning through Evening.
- Click a task to open the scheduling panel, then choose a time block.
- Click the active time block again to remove the assignment.
- Check off tasks when done.

Future days show a preview of recurring tasks. Past days show recurring task history: completed occurrences appear struck through, missed occurrences appear dimmed.

## Filtering Plan

The Plan search box filters only **Overdue** and **Inbox**. It does not hide tasks already pinned to Today's Focus.

The **Upcoming** menu above Inbox controls how many future dated tasks are included before search filters are applied. It includes exact due dates and date ranges such as `Week 19` or `Sep 2026`.

- Choose `All` when you want filters such as `due:5 weeks` to search without a date-window limit.
- Choose `None` to show only the regular Inbox without extra upcoming dated tasks.

Filters can be combined in one search. Every filter must match for a task to stay visible.

| Syntax | Matches |
|---|---|
| `weekly on Medium` | Visible task row text, as one phrase |
| `!draft` | Excludes rows containing `draft` |
| `@articles` | Source links containing `articles` |
| `!@articles` | Excludes source links containing `articles` |
| `@client work` | Source links containing `client work` |
| `@"client work"` | Same as above, useful when you want the source phrase to be explicit |
| `due:next week` | Tasks due next week |
| `due:4 weeks` | Tasks due from today through four weeks from today |
| `!due:next week` | Excludes tasks due next week |

Plain text and `!text` search the whole visible row, including task text, due date chip, and source name. Source filters use `@` and `!@`, so they only match the source link.

`@` and `due:` accept phrases with spaces. They keep reading until the next operator starts:

```text
@client work due:next week !published
```

This means:

- source contains `client work`
- due date is next week
- row does not contain `published`

Supported due-date words:

- `today`, `tomorrow`, `yesterday`
- `this week`, `next week`
- `this month`, `next month`
- `this year`, `next year`
- this year's calendar months, for example `may`, `june`, `september`, or `dec`
- week windows, for example `2 weeks`, `four weeks`, or `12 weeks`
- `in 10 days`, `two days from now`

Due filters match real task dates and date ranges. For example, `due:next week` matches tasks with exact dates next week and tasks whose date range overlaps next week.

Week windows are inclusive from today. For example, `due:4 weeks` shows tasks due any time from today through four weeks from today.

Month names are not inclusive windows. For example, `due:dec` and `due:december` show tasks due in December this year, not every task due before December. Broad year ranges such as `Year 2026` are not treated as December tasks.

Examples:

```text
weekly on Medium @articles
```

Find rows containing `weekly on Medium` from sources containing `articles`.

```text
@client work due:this month !invoice
```

Find tasks from `client work`, due this month, excluding rows containing `invoice`.

```text
due:5 weeks
```

Find tasks due from today through five weeks from today.

```text
due:september
```

Find tasks due in September this year.

## Recurring Tasks

Recurring tasks are managed from the menu.

Each recurring task is one task that moves forward when completed. Daily Focus does not create copies. Checking off a recurring task advances its scheduled date to the next occurrence and makes it ready for next time.

Open **Recurring tasks** to choose a frequency:

- daily
- weekly
- monthly
- yearly

Past recurring occurrences appear in Focus history as completed or missed traces.

## Ignore List

Use the Ignore list to hide tasks from Plan and Focus without deleting them. Ignored tasks can be restored later.

## Common Actions

| Action | What it does |
|---|---|
| Checkbox | Mark a task done, or undo from the done state |
| Task row in Plan | Pin the task to Today's Focus |
| Task row in Focus | Open the scheduling panel |
| Repeat icon | Mark a task as recurring or remove its recurring schedule |
| Source name / arrow | Open the task in its source document |
| Pin icon | Remove a task from Today's Focus |
| Date arrows | Move between days |

Daily Focus refreshes automatically when tasks are created, updated, completed, deleted, or restored elsewhere in the workspace.

## Commands

Daily Focus adds these command palette actions:

- `Open Daily Focus`
- `Daily Focus: Open Focus`
- `Daily Focus: Open Plan`
- `Daily Focus: Open Recurring Tasks`
- `Daily Focus: Open Ignore List`
- `Daily Focus: Open Settings`
- `Daily Focus: Peek`

## Performance Diagnostics

Daily Focus includes optional console timing for large workspaces. It is off by default.

To collect a report:

1. Open browser developer tools.
2. Run `DailyFocusPerf.enable()` in the console.
3. Reload Thymer.
4. Open Daily Focus, switch between Focus and Plan, and use the Upcoming menu once.
5. Run `copy(DailyFocusPerf.report())` in the console.
6. Paste the copied JSON into the bug report.
7. Run `DailyFocusPerf.disable()` when finished.

The report contains render timings, search timings, and task counts. It does not include task text or note content.

## Known Issues

**Mobile browser: blank screen after clearing cache or browser data**

If you clear your browser cache and browser data while the plugin is installed, the mobile browser may fail to load all panels and meta-properties required to run plugins on the next visit.

**Fix:** switch your mobile browser to desktop mode, navigate around a little, then switch back to mobile mode.

## Recent Changes

### 2026-05-01

- Faster cached Plan renders by caching per-render task data and avoiding expensive record lookups.
- Faster initial task fetch by deriving scheduled, due, and overdue buckets from the `@todo` result.
- Added optional performance diagnostics with `DailyFocusPerf`.
- Added richer Plan filters for text, source names, exclusions, and due dates.
- Added broader Upcoming ranges, including `This year` and `All`.
