const SLOTS = Array.from({ length: 18 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`);

class TodayDashboard {
    constructor(plugin) {
        this.plugin        = plugin;
        this._panel        = null;
        this._refreshTimer = null;
        this._renderVer    = 0;
        this._mode         = null;
        this._selected     = null;
        this._doneTasksMap = new Map(); // session cache: guid → lineitem
    }

    _todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    _todayD() {
        return this._todayStr().replace(/-/g, ''); // "20260422"
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
            '.db-done{flex-shrink:0;cursor:pointer;align-self:center;margin-top:0!important;margin-right:0!important}' +
            '.db-task.state-done .db-task-text,.db-task.state-done .db-task-text--sel{text-decoration:line-through;opacity:.4}' +
            '.db-task.state-done .db-task-source,.db-task.state-done .db-task-source--link{opacity:.2}' +
            '.db-task-body{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;cursor:pointer}' +
            '.db-task-text{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.db-task-text--sel{flex:1;min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis;cursor:pointer}' +
            '.db-task-source{font-size:11px;opacity:.35;white-space:nowrap;flex-shrink:0}' +
            '.db-task-source--link{font-size:11px;opacity:.35;white-space:nowrap;flex-shrink:0;cursor:pointer;' +
            'text-decoration-line:underline;text-decoration-style:dotted;text-underline-offset:2px}' +
            '.db-pin,.db-unpin,.db-nav{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
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
            this._render(panel, true);
        });

        const scheduleRefresh = () => {
            if (this._refreshTimer) clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => {
                this._refreshTimer = null;
                if (!this._panel) return;
                const el = this._panel.getElement();
                if (el?.isConnected && el.querySelector('.db-root, .db-loading')) {
                    this._render(this._panel, false);
                }
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

    async _render(panel, fromCallback = false) {
        const ver = ++this._renderVer;
        const el  = panel.getElement();
        if (!el) return;

        if (!fromCallback && !el.querySelector('.db-root, .db-loading')) return;

        if (!el.querySelector('.db-root')) {
            el.innerHTML = '<div class="db-loading">Loading tasks…</div>';
        }

        const [todoResult, scheduledResult] = await Promise.all([
            this.plugin.data.searchByQuery('@task @todo',  150),
            this.plugin.data.searchByQuery('@task @today', 100),
        ]);

        const [overdueResult, dueResult] = this._mode === 'focus'
            ? [{ lines: [] }, { lines: [] }]
            : await Promise.all([
                this.plugin.data.searchByQuery('@task @overdue', 50),
                this.plugin.data.searchByQuery('@task @due',    100),
            ]);

        try {
            const doneResult = await this.plugin.data.searchByQuery('@task @done', 100);
            for (const l of (doneResult.lines || [])) {
                if (l.type === 'task' && l.props?.['db-done-date'] === today) {
                    this._doneTasksMap.set(l.guid, l);
                }
            }
        } catch (e) {
            console.warn('[Dashboard] @task @done query failed:', e);
        }

        if (ver !== this._renderVer) return;

        const overdueGuids   = new Set((overdueResult.lines   || []).filter(l => l.type === 'task').map(l => l.guid));
        const datedGuids     = new Set((dueResult.lines       || []).filter(l => l.type === 'task').map(l => l.guid));
        const scheduledGuids = new Set((scheduledResult.lines || []).filter(l => l.type === 'task').map(l => l.guid));
        const allTodos       =         (todoResult.lines      || []).filter(l => l.type === 'task');

        const today = this._todayStr();

        // Pinned tasks: meta prop set by this plugin (cross-device via Thymer sync)
        const todaySet    = new Set(allTodos.filter(l => l.props?.['db-pinned'] === today).map(l => l.guid));
        const doneTasks   = [...this._doneTasksMap.values()];

        // Time blocks from meta props
        const timeBlocks = {};
        for (const t of [...allTodos, ...doneTasks]) {
            const tb = t.props?.['db-timeblock'];
            if (tb) timeBlocks[t.guid] = tb;
        }

        const overdue     = allTodos.filter(l => overdueGuids.has(l.guid) && !todaySet.has(l.guid));
        const todayPinned = allTodos.filter(l => todaySet.has(l.guid));
        const scheduled   = allTodos.filter(l => scheduledGuids.has(l.guid) && !todaySet.has(l.guid) && !overdueGuids.has(l.guid));
        const inbox       = allTodos.filter(l => !datedGuids.has(l.guid) && !todaySet.has(l.guid) && !scheduledGuids.has(l.guid) && !overdueGuids.has(l.guid));

        if (todayPinned.length === 0 && scheduled.length === 0 && doneTasks.length === 0) this._mode = null;
        const effectiveMode = ((todayPinned.length > 0 || scheduled.length > 0 || doneTasks.length > 0) && this._mode !== 'plan') ? 'focus' : 'plan';

        const allTasks = [...allTodos, ...doneTasks];

        el.innerHTML = effectiveMode === 'focus'
            ? this._buildFocusHTML(todayPinned, scheduled, doneTasks, timeBlocks)
            : this._buildPlanHTML(overdue, todayPinned, inbox);

        this._applyTheme(el);
        this._attachListeners(el, allTasks);
        this._reapplySelection(el);
    }

    _buildFocusHTML(today, scheduled, doneTasks, timeBlocks) {
        const pinnedGuids    = new Set(today.map(t => t.guid));
        const doneGuids      = new Set(doneTasks.map(t => t.guid));
        const allFocus       = [...today, ...scheduled.filter(t => !pinnedGuids.has(t.guid))];
        const unassigned     = allFocus.filter(t => !timeBlocks[t.guid]);
        const assignedByTime = {};
        const sectionFor     = guid => pinnedGuids.has(guid) ? 'focus-pinned' : 'focus-scheduled';

        for (const task of allFocus) {
            const time = timeBlocks[task.guid];
            if (!time) continue;
            if (!assignedByTime[time]) assignedByTime[time] = [];
            assignedByTime[time].push(task);
        }
        for (const task of doneTasks) {
            const time = timeBlocks[task.guid];
            if (!time) continue;
            if (!assignedByTime[time]) assignedByTime[time] = [];
            if (!assignedByTime[time].find(t => t.guid === task.guid)) assignedByTime[time].push(task);
        }

        const unassignedDone = doneTasks.filter(t => !timeBlocks[t.guid]);

        return `<div class="db-root">
            <div class="db-mode-bar">
                <button class="db-mode-toggle" data-action="set-mode" data-mode="plan">Plan →</button>
            </div>
            ${(unassigned.length || unassignedDone.length) ? `
            <div class="db-section db-section--today">
                <div class="db-section-header">
                    <span class="db-section-title">Unscheduled</span>
                    ${unassigned.length ? `<span class="db-count">${unassigned.length}</span>` : ''}
                </div>
                ${unassigned.map(t => this._taskRow(t, sectionFor(t.guid))).join('')}
                ${unassignedDone.map(t => this._taskRow(t, 'done')).join('')}
            </div>` : ''}
            <div class="db-section">
                <div class="db-section-header">
                    <span class="db-section-title">Day Plan</span>
                </div>
                ${SLOTS.map(time => this._blockHTML(time, assignedByTime[time] || [], doneGuids)).join('')}
            </div>
        </div>`;
    }

    _blockHTML(time, tasks, doneGuids = new Set()) {
        return `<div class="db-block" data-action="select-block" data-time="${time}">
            <div class="db-block-time">${time}</div>
            <div class="db-block-body">
                ${tasks.length
                    ? tasks.map(t => this._taskRow(t, doneGuids.has(t.guid) ? 'done' : 'block')).join('')
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
            today:   'Nothing pinned — tap a task in the inbox to add it',
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
        const doneBtn = `<div class="db-done line-check-div clickable" data-action="done" data-guid="${task.guid}"></div>`;

        const isFocus = section === 'focus-pinned' || section === 'focus-scheduled' || section === 'block';

        if (section === 'done') {
            return `<div class="db-task listitem-task state-done" data-guid="${task.guid}">
                <div class="db-done line-check-div clickable" data-action="undone" data-guid="${task.guid}"></div>
                <span class="db-task-text--sel">${text}</span>
                ${source ? `<span class="db-task-source--link" data-action="open" data-guid="${task.guid}">${source}</span>` : ''}
            </div>`;
        }

        if (isFocus) {
            const actionBtn = section === 'block'
                ? `<button class="db-unpin" data-action="unassign" data-guid="${task.guid}" title="Remove from block">×</button>`
                : section === 'focus-pinned'
                    ? `<button class="db-unpin" data-action="unpin" data-guid="${task.guid}" title="Remove from Today">×</button>`
                    : '';
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <span class="db-task-text--sel" data-action="select-task" data-guid="${task.guid}">${text}</span>
                ${source ? `<span class="db-task-source--link" data-action="open" data-guid="${task.guid}">${source}</span>` : ''}
                ${actionBtn}
            </div>`;
        }

        if (section === 'today') {
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                    ${source ? `<span class="db-task-source">${source}</span>` : ''}
                </div>
                <button class="db-unpin" data-action="unpin" data-guid="${task.guid}" title="Remove from Today">×</button>
            </div>`;
        }

        if (section === 'inbox' || section === 'overdue') {
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <div class="db-task-body" data-action="pin" data-guid="${task.guid}">
                    <span class="db-task-text">${text}</span>
                    ${source ? `<span class="db-task-source">${source}</span>` : ''}
                </div>
                <button class="db-nav" data-action="open" data-guid="${task.guid}" title="Open task"><i class="ti ti-arrow-up-right"></i></button>
            </div>`;
        }

        return `<div class="db-task listitem-task" data-guid="${task.guid}">
            ${doneBtn}
            <div class="db-task-body" data-action="open" data-guid="${task.guid}">
                <span class="db-task-text">${text}</span>
                ${source ? `<span class="db-task-source">${source}</span>` : ''}
            </div>
        </div>`;
    }

    _attachListeners(el, allTasks) {
        const byGuid = new Map(allTasks.map(l => [l.guid, l]));
        const today  = this._todayStr();

        el.querySelectorAll('[data-action="done"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                btn.style.pointerEvents = 'none';
                const row = btn.closest('.db-task');
                if (row) row.classList.add('state-done');
                try {
                    await task.setTaskStatus('done');
                    await task.setMetaProperty('db-done-date', today);
                    this._doneTasksMap.set(task.guid, task);
                } catch (err) {
                    console.error('[Dashboard] done failed:', err);
                    if (row) row.classList.remove('state-done');
                    btn.style.pointerEvents = '';
                }
            });
        });

        el.querySelectorAll('[data-action="undone"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                btn.style.pointerEvents = 'none';
                try {
                    await task.setTaskStatus('none');
                    await task.setMetaProperty('db-done-date', null);
                    this._doneTasksMap.delete(task.guid);
                    const row = btn.closest('.db-task');
                    if (row) row.classList.remove('state-done');
                    if (this._panel) this._render(this._panel);
                } catch (err) {
                    console.error('[Dashboard] undone failed:', err);
                    btn.style.pointerEvents = '';
                }
            });
        });

        el.querySelectorAll('[data-action="pin"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                await task.setMetaProperty('db-pinned', today);
                if (this._panel) this._render(this._panel);
            });
        });

        el.querySelectorAll('[data-action="unpin"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                await task.setMetaProperty('db-pinned', null);
                if (this._panel) this._render(this._panel);
            });
        });

        el.querySelectorAll('[data-action="unassign"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                await task.setMetaProperty('db-timeblock', null);
                if (this._panel) this._render(this._panel);
            });
        });

        el.querySelectorAll('[data-action="select-task"]').forEach(span => {
            span.addEventListener('click', async e => {
                e.stopPropagation();
                const guid = span.dataset.guid;
                if (this._selected?.type === 'block') {
                    const time = this._selected.id;
                    this._selected = null;
                    const task = byGuid.get(guid);
                    if (task) {
                        await task.setMetaProperty('db-timeblock', time);
                        if (this._panel) this._render(this._panel);
                    }
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
            block.addEventListener('click', async e => {
                if (e.target.closest('[data-action="done"],[data-action="unassign"],[data-action="open"],[data-action="select-task"]')) return;
                const time = block.dataset.time;
                if (this._selected?.type === 'task') {
                    const guid = this._selected.id;
                    this._selected = null;
                    const task = byGuid.get(guid);
                    if (task) {
                        await task.setMetaProperty('db-timeblock', time);
                        if (this._panel) this._render(this._panel);
                    }
                } else if (this._selected?.type === 'block' && this._selected.id === time) {
                    this._selected = null;
                    this._reapplySelection(el);
                } else {
                    this._selected = { type: 'block', id: time };
                    this._reapplySelection(el);
                }
            });
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
}

class Plugin extends AppPlugin {
    onLoad() {
        new TodayDashboard(this).load();
    }
}
