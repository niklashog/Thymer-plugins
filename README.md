# Thymer Plugins

A collection of plugins for [Thymer](https://thymer.com).

> Looking for a theme? Check out [Catppuccin Mocha for Thymer](https://github.com/niklashog/Thymer-Catppuccin-Mocha).

---

## Plugins

### BetterKanBan

**Type:** Global Plugin (creates pre-configured collections)

A kanban board plugin with built-in dependency tracking. Create fully configured kanban boards directly from the command palette — choose between a 3-step or 4-step workflow on creation.

**Features:**
- Create kanban boards via command palette ("New Imagine Board")
- Choose between **3-step** (To Do → Doing → Done) or **4-step** (To Do → In Progress → In Review → Done) workflow on creation
- Visual dependency tracking on board cards — see what's blocking a task and what a task is blocking
- "Depends on" property filtered to the board's own tasks

**Installation:**
1. In Thymer, press `Ctrl+P` and search for **Plugins**
2. Create a new **Global Plugin**
3. Paste the contents of `customCode.js` into the Code tab
4. Paste the contents of `configuration.json` into the Configuration tab
5. Press **Preview**, then **Save**

---

### Coinflip

**Type:** Global Plugin

Heads or tails? Flip a coin from your status bar.

**Features:**
- Coin flip button in the status bar
- Command palette commands: **Coin Flip: Toss Coin** and **Coin Flip: Reset Counter**

**Installation:**
1. In Thymer, press `Ctrl+P` and search for **Plugins**
2. Create a new **Global Plugin**
3. Paste the contents of `custom_code.js` into the Code tab
4. Paste the contents of `configuration.json` into the Configuration tab
5. Press **Preview**, then **Save**

> [Read up](https://en.wikipedia.org/wiki/Flipism) on flipism — the true way to make your most important choices in life.
