# BetterKanBan

**Type:** Global Plugin (creates pre-configured collections)

A kanban board plugin with built-in dependency tracking. Create fully configured kanban boards directly from the command palette — choose between a 3-step or 4-step workflow on creation.

## Features

- Create kanban boards via command palette ("New Kanban Board")
- Choose between **3-step** (To Do → Doing → Done) or **4-step** (To Do → In Progress → In Review → Done) workflow on creation
- Keyboard navigation in menu (arrows / enter / space)
- Visual dependency tracking on board cards — see what's blocking a task and what a task is blocking
- "Depends on" property default filter on current collection. Disable for broader use.

## Installation

1. In Thymer, press `Ctrl+P` and search for **Plugins**
2. Create a new **Global Plugin**
3. Paste the contents of `customCode.js` into the Code tab
4. Paste the contents of `configuration.json` into the Configuration tab
5. Press **Preview**, then **Save**
