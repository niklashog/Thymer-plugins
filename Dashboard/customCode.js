const SLOTS = Array.from({ length: 18 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`);

class TodayDashboard {
    constructor(plugin) {
        this.plugin        = plugin;
        this._panel        = null;
        this._refreshTimer = null;
        this._renderVer    = 0;
        this._mode         = null; // null = auto, 'focus', 'plan'
        this._selected     = null; // { type: 'task'|'block', id: string }
    }

    load() {
        this.plugin.ui.injectCSS(
            '.db-root{padding:24px 28px;max-width:700px;margin:0 auto}' +
            '.db-section{margin-bottom:32px}' +
            '.db-section-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;' +
            'padding-bottom:8px;border-bottom:1px solid var(--db-divider,rgba(128,128,128,.15))}' +
            '.db-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;opacity:.55}' +
            '.db-section--overdue .db-section-title{color:#ef4444;opacity:1}' +
            '.db-section--overdue .db-section-header{border-color:rgba(239,68,68,.25)}' +
            '.db-count{font-size:11px;font-weight:600;opacity:.4}' +
            '.db-task{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;transition:background .1s}' +
            '.db-task:hover{background:var(--db-hover,rgba(128,128,128,.07))}' +
            '.db-task--selected{outline:1px solid rgba(128,128,128,.4);border-radius:6px}' +
            '.db-done{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
            'padding:2px;display:flex;opacity:.35;transition:opacity .15s;border-radius:50%}' +
            '.db-done:hover{opacity:1}' +
            '.db-done:disabled{opacity:.15;cursor:default}' +
            '.db-task-body{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;cursor:pointer}' +
            '.db-task-text{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.db-task-text--sel{flex:1;min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis;cursor:pointer}' +
            '.db-task-source{font-size:11px;opacity:.35;white-space:nowrap;flex-shrink:0}' +
            '.db-task-source--link{font-size:11px;opacity:.35;white-space:nowrap;flex-shrink:0;cursor:pointer;' +
            'text-decoration-line:underline;text-decoration-style:dotted;text-underline-offset:2px}' +
            '.db-pin,.db-unpin{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
            'font-size:15px;line-height:1;padding:1px 5px;opacity:.2;transition:opacity .15s;border-radius:4px}' +
            '.db-pin:hover,.db-unpin:hover{opacity:.7}' +
            '.db-empty{font-size:13px;opacity:.3;padding:4px 6px}' +
            '.db-loading{padding:28px;opacity:.35;font-size:14px}' +
            '.db-mode-bar{display:flex;justify-content:flex-end;margin-bottom:20px}' +
            '.db-mode-toggle{background:none;border:none;cursor:pointer;color:inherit;' +
            'font-size:11px;opacity:.3;padding:2px 0;transition:opacity .15s}' +
            '.db-mode-toggle:hover{opacity:.7}' +
            '.db-block{display:flex;border-radius:6px;cursor:pointer;transition:background .1s;min-height:38px}' +
            '.db-block:hover{background:var(--db-hover,rgba(128,128,128,.07))}' +
            '.db-block--selected{background:var(--db-sel,rgba(128,128,128,.1))}' +
            '.db-block-time{font-size:11px;opacity:.4;min-width:48px;padding:11px 8px 11px 6px;' +
            'flex-shrink:0;font-variant-numeric:tabular-nums;line-height:1.2;align-self:flex-start}' +
            '.db-block-body{flex:1;min-width:0;padding:2px 0}' +
            '.db-block-hint{font-size:12px;opacity:.18;padding:9px 0 9px 2px}'
        );

        this.plugin.ui.addCommandPaletteCommand({
            label: "Open Today's Focus",
            icon:  'gauge',
            onSelected: () => this._openPanel(),
        });

        this.plugin.ui.addSidebarItem({
            label:   "Today's Focus",
            icon:    'gauge',
            tooltip: "Open Today's Focus dashboard",
            onClick: () => this._openPanel(),
        });

        this.plugin.ui.registerCustomPanelType('today-dashboard', panel => {
            this._panel = panel;
            panel.setTitle("Today's Focus");
            this._render(panel);
        });

        const scheduleRefresh = () => {
            if (this._refreshTimer) clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => {
                this._refreshTimer = null;
                if (!this._panel) return;
                const el = this._panel.getElement();
                if (el?.isConnected) this._render(this._panel);
            }, 800);
        };

        this.plugin.events.on('lineitem.updated', scheduleRefresh);
        this.plugin.events.on('lineitem.created', scheduleRefresh);
        this.plugin.events.on('lineitem.deleted', scheduleRefresh);
    }

    async _openPanel() {
        let panel = this.plugin.ui.getActivePanel();
        if (!panel) panel = await this.plugin.ui.createPanel();
        if (panel) panel.navigateToCustomType('today-dashboard');
    }

    async _render(panel) {
        const ver = ++this._renderVer;
        const el  = panel.getElement();
        if (!el) return;

        if (!el.querySelector('.db-root')) {
            el.innerHTML = '<div class="db-loading">Loading tasks…</div>';
        }

        const [todoResult, overdueResult, dueResult, scheduledResult] = await Promise.all([
            this.plugin.data.searchByQuery('@task @todo',    500),
            this.plugin.data.searchByQuery('@task @overdue', 200),
            this.plugin.data.searchByQuery('@task @due',     300),
            this.plugin.data.searchByQuery('@task @today',   200),
        ]);

        if (ver !== this._renderVer) return;

        const todayGuids     = new Set(this._loadTodayGuids());
        const overdueGuids   = new Set((overdueResult.lines   || []).filter(l => l.type === 'task').map(l => l.guid));
        const datedGuids     = new Set((dueResult.lines       || []).filter(l => l.type === 'task').map(l => l.guid));
        const scheduledGuids = new Set((scheduledResult.lines || []).filter(l => l.type === 'task').map(l => l.guid));
        const allTodos       =         (todoResult.lines      || []).filter(l => l.type === 'task');

        const allTodoSet      = new Set(allTodos.map(l => l.guid));
        const cleanTodayGuids = [...todayGuids].filter(g => allTodoSet.has(g));
        if (cleanTodayGuids.length !== todayGuids.size) this._saveTodayGuids(cleanTodayGuids);
        const todaySet = new Set(cleanTodayGuids);

        const overdue   = allTodos.filter(l => overdueGuids.has(l.guid));
        const today     = allTodos.filter(l => todaySet.has(l.guid) && !overdueGuids.has(l.guid));
        const scheduled = allTodos.filter(l => scheduledGuids.has(l.guid) && !overdueGuids.has(l.guid) && !todaySet.has(l.guid));
        const inbox     = allTodos.filter(l => !datedGuids.has(l.guid) && !todaySet.has(l.guid) && !scheduledGuids.has(l.guid));

        // Clean stale time block assignments
        const timeBlocks = this._loadTimeBlocks();
        const focusGuids = new Set([...today.map(l => l.guid), ...scheduled.map(l => l.guid)]);
        let tbDirty = false;
        for (const guid of Object.keys(timeBlocks)) {
            if (!focusGuids.has(guid)) { delete timeBlocks[guid]; tbDirty = true; }
        }
        if (tbDirty) this._saveTimeBlocks(timeBlocks);

        if (today.length === 0 && scheduled.length === 0) this._mode = null;
        const effectiveMode = ((today.length > 0 || scheduled.length > 0) && this._mode !== 'plan') ? 'focus' : 'plan';

        el.innerHTML = effectiveMode === 'focus'
            ? this._buildFocusHTML(today, scheduled)
            : this._buildPlanHTML(overdue, today, inbox);

        this._applyTheme(el);
        this._attachListeners(el, allTodos);
        this._reapplySelection(el);
    }

    _buildFocusHTML(today, scheduled) {
        const pinnedGuids = new Set(today.map(t => t.guid));
        const allFocus = [
            ...today,
            ...scheduled.filter(t => !pinnedGuids.has(t.guid)),
        ];

        const timeBlocks    = this._loadTimeBlocks();
        const unassigned    = allFocus.filter(t => !timeBlocks[t.guid]);
        const assignedByTime = {};
        for (const task of allFocus) {
            const time = timeBlocks[task.guid];
            if (!time) continue;
            if (!assignedByTime[time]) assignedByTime[time] = [];
            assignedByTime[time].push(task);
        }

        const sectionFor = guid => pinnedGuids.has(guid) ? 'focus-pinned' : 'focus-scheduled';

        return `<div class="db-root">
            <div class="db-mode-bar">
                <button class="db-mode-toggle" data-action="set-mode" data-mode="plan">Plan →</button>
            </div>
            ${unassigned.length ? `
            <div class="db-section db-section--today">
                <div class="db-section-header">
                    <span class="db-section-title">Unscheduled</span>
                    <span class="db-count">${unassigned.length}</span>
                </div>
                ${unassigned.map(t => this._taskRow(t, sectionFor(t.guid))).join('')}
            </div>` : ''}
            <div class="db-section">
                <div class="db-section-header">
                    <span class="db-section-title">Day Plan</span>
                </div>
                ${SLOTS.map(time => this._blockHTML(time, assignedByTime[time] || [])).join('')}
            </div>
        </div>`;
    }

    _blockHTML(time, tasks) {
        return `<div class="db-block" data-action="select-block" data-time="${time}">
            <div class="db-block-time">${time}</div>
            <div class="db-block-body">
                ${tasks.length
                    ? tasks.map(t => this._taskRow(t, 'block')).join('')
                    : `<div class="db-block-hint">tap to select</div>`
                }
            </div>
        </div>`;
    }

    _buildPlanHTML(overdue, today, inbox) {
        return `<div class="db-root">
            <div class="db-mode-bar">
                <button class="db-mode-toggle" data-action="set-mode" data-mode="focus">← Focus</button>
            </div>
            ${this._section('Overdue',       overdue, 'overdue')}
            ${this._section("Today's Focus", today,   'today')}
            ${this._section('Inbox',         inbox,   'inbox')}
        </div>`;
    }

    _section(title, tasks, type) {
        const empty = {
            overdue: 'No overdue tasks',
            today:   'Nothing pinned — add tasks from the inbox',
            inbox:   'No undated tasks',
        }[type];

        return `<div class="db-section db-section--${type}">
            <div class="db-section-header">
                <span class="db-section-title">${title}</span>
                ${tasks.length ? `<span class="db-count">${tasks.length}</span>` : ''}
            </div>
            ${tasks.length
                ? tasks.map(t => this._taskRow(t, type)).join('')
                : `<div class="db-empty">${empty}</div>`
            }
        </div>`;
    }

    _taskRow(task, section) {
        const text   = this._escape(this._getText(task));
        const source = this._escape(task.record?.getName() || '');
        const focus  = section === 'focus-pinned' || section === 'focus-scheduled' || section === 'block';

        let actionBtn = '';
        if (section === 'block') {
            actionBtn = `<button class="db-unpin" data-action="unassign" data-guid="${task.guid}" title="Remove from block">×</button>`;
        } else if (section === 'today' || section === 'focus-pinned') {
            actionBtn = `<button class="db-unpin" data-action="unpin" data-guid="${task.guid}" title="Remove from Today">×</button>`;
        } else if (section === 'inbox') {
            actionBtn = `<button class="db-pin" data-action="pin" data-guid="${task.guid}" title="Add to Today">+</button>`;
        }

        const doneBtn = `<button class="db-done" data-action="done" data-guid="${task.guid}" title="Mark done">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <circle cx="7.5" cy="7.5" r="6.25" stroke="currentColor" stroke-width="1.25"/>
            </svg>
        </button>`;

        if (focus) {
            return `<div class="db-task" data-guid="${task.guid}">
                ${doneBtn}
                <span class="db-task-text--sel" data-action="select-task" data-guid="${task.guid}">${text}</span>
                ${source ? `<span class="db-task-source--link" data-action="open" data-guid="${task.guid}">${source}</span>` : ''}
                ${actionBtn}
            </div>`;
        }

        return `<div class="db-task" data-guid="${task.guid}">
            ${doneBtn}
            <div class="db-task-body" data-action="open" data-guid="${task.guid}">
                <span class="db-task-text">${text}</span>
                ${source ? `<span class="db-task-source">${source}</span>` : ''}
            </div>
            ${actionBtn}
        </div>`;
    }

    _attachListeners(el, allTasks) {
        const byGuid = new Map(allTasks.map(l => [l.guid, l]));

        el.querySelectorAll('[data-action="done"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                btn.disabled = true;
                console.log('[Dashboard] proto methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(task)));
                try {
                    await task.setTaskStatus('done');
                    console.log('[Dashboard] setTaskStatus done — ok');
                } catch (err) {
                    console.error('[Dashboard] setTaskStatus failed:', err);
                }
                this._removeFromToday(btn.dataset.guid);
            });
        });

        el.querySelectorAll('[data-action="pin"]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); this._addToToday(btn.dataset.guid); });
        });

        el.querySelectorAll('[data-action="unpin"]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); this._removeFromToday(btn.dataset.guid); });
        });

        el.querySelectorAll('[data-action="unassign"]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); this._unassignTask(btn.dataset.guid); });
        });

        el.querySelectorAll('[data-action="open"]').forEach(node => {
            node.addEventListener('click', e => {
                e.stopPropagation();
                const task = byGuid.get(node.dataset.guid);
                if (!task?.record) return;
                const panel = this.plugin.ui.getActivePanel();
                if (panel) panel.navigateTo({
                    type: 'edit_panel',
                    rootId: task.record.guid,
                    subId: null,
                    workspaceGuid: this.plugin.getWorkspaceGuid(),
                });
            });
        });

        el.querySelectorAll('[data-action="select-task"]').forEach(span => {
            span.addEventListener('click', e => {
                e.stopPropagation();
                const guid = span.dataset.guid;
                if (this._selected?.type === 'block') {
                    const time = this._selected.id;
                    this._selected = null;
                    this._assignTask(guid, time);
                } else if (this._selected?.type === 'task' && this._selected.id === guid) {
                    this._selected = null;
                    this._reapplySelection(el);
                } else {
                    this._selected = { type: 'task', id: guid };
                    this._reapplySelection(el);
                }
            });
        });

        el.querySelectorAll('[data-action="select-block"]').forEach(block => {
            block.addEventListener('click', e => {
                if (e.target.closest('[data-action="done"],[data-action="unassign"],[data-action="open"],[data-action="select-task"]')) return;
                const time = block.dataset.time;
                if (this._selected?.type === 'task') {
                    const guid = this._selected.id;
                    this._selected = null;
                    this._assignTask(guid, time);
                } else if (this._selected?.type === 'block' && this._selected.id === time) {
                    this._selected = null;
                    this._reapplySelection(el);
                } else {
                    this._selected = { type: 'block', id: time };
                    this._reapplySelection(el);
                }
            });
        });

        el.querySelectorAll('[data-action="set-mode"]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._mode = btn.dataset.mode;
                if (this._panel) this._render(this._panel);
            });
        });
    }

    _reapplySelection(el) {
        el.querySelectorAll('.db-task--selected').forEach(e => e.classList.remove('db-task--selected'));
        el.querySelectorAll('.db-block--selected').forEach(e => e.classList.remove('db-block--selected'));
        if (!this._selected) return;
        if (this._selected.type === 'task') {
            el.querySelector(`.db-task[data-guid="${this._selected.id}"]`)?.classList.add('db-task--selected');
        } else {
            el.querySelector(`.db-block[data-time="${this._selected.id}"]`)?.classList.add('db-block--selected');
        }
    }

    _applyTheme(el) {
        const startNode = document.querySelector('.panel') || document.body;
        let node = startNode;
        while (node) {
            const c = getComputedStyle(node).backgroundColor;
            if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') break;
            node = node.parentElement;
        }
        const fg  = getComputedStyle(node || startNode).color;
        const rgb = (fg.match(/\d+/g) || ['150', '150', '150']).slice(0, 3).join(',');
        const root = el.querySelector('.db-root');
        if (root) {
            root.style.setProperty('--db-hover',   `rgba(${rgb},.07)`);
            root.style.setProperty('--db-divider', `rgba(${rgb},.12)`);
            root.style.setProperty('--db-sel',     `rgba(${rgb},.1)`);
        }
    }

    _getText(lineItem) {
        return (lineItem.segments || [])
            .map(s => {
                if (typeof s.text === 'string') return s.text;
                if (s.text && typeof s.text === 'object') return s.text.title || s.text.link || '';
                return '';
            })
            .join('') || '(untitled)';
    }

    _escape(str) {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _loadTodayGuids() {
        try { return JSON.parse(localStorage.getItem('db-today') || '[]'); }
        catch { return []; }
    }

    _saveTodayGuids(guids) {
        localStorage.setItem('db-today', JSON.stringify(guids));
    }

    _loadTimeBlocks() {
        try { return JSON.parse(localStorage.getItem('db-timeblocks') || '{}'); }
        catch { return {}; }
    }

    _saveTimeBlocks(blocks) {
        localStorage.setItem('db-timeblocks', JSON.stringify(blocks));
    }

    _addToToday(guid) {
        const guids = this._loadTodayGuids();
        if (!guids.includes(guid)) {
            this._saveTodayGuids([...guids, guid]);
            if (this._panel) this._render(this._panel);
        }
    }

    _removeFromToday(guid) {
        this._saveTodayGuids(this._loadTodayGuids().filter(g => g !== guid));
        if (this._panel) this._render(this._panel);
    }

    _assignTask(guid, time) {
        const blocks = this._loadTimeBlocks();
        blocks[guid] = time;
        this._saveTimeBlocks(blocks);
        if (this._panel) this._render(this._panel);
    }

    _unassignTask(guid) {
        const blocks = this._loadTimeBlocks();
        delete blocks[guid];
        this._saveTimeBlocks(blocks);
        if (this._panel) this._render(this._panel);
    }
}

class Plugin extends AppPlugin {
    onLoad() {
        new TodayDashboard(this).load();
    }
}
