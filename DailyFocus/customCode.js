const SLOTS = [
    { time: '08:00', label: 'Early morning' },
    { time: '10:00', label: 'Morning' },
    { time: '12:00', label: 'Lunchtime' },
    { time: '14:00', label: 'Early afternoon' },
    { time: '16:00', label: 'Afternoon' },
    { time: '18:00', label: 'Sundown' },
    { time: '20:00', label: 'Early evening' },
    { time: '22:00', label: 'Evening' },
    { time: '00:00', label: 'Good night' },
];

class TodayDashboard {
    constructor(plugin) {
        this.plugin        = plugin;
        this._panel        = null;
        this._refreshTimer = null;
        this._renderVer    = 0;
        this._mode         = null;
        this._selected     = null;
        this._doneTasksMap = new Map();
        this._viewDate     = null;
    }

    _todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    _todayD() {
        return this._todayStr().replace(/-/g, '');
    }

    _viewDateStr() {
        return this._viewDate || this._todayD();
    }

    _offsetDate(dateStr, days) {
        const d = new Date(+dateStr.slice(0,4), +dateStr.slice(4,6)-1, +dateStr.slice(6,8));
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }

    _viewDateLabel() {
        const v = this._viewDateStr();
        const t = this._todayD();
        if (v === t) return 'Today';
        if (v === this._offsetDate(t, -1)) return 'Yesterday';
        if (v === this._offsetDate(t,  1)) return 'Tomorrow';
        const d = new Date(+v.slice(0,4), +v.slice(4,6)-1, +v.slice(6,8));
        return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    }

    _parseTimeblock(val) {
        if (!val || val.length < 9 || val[8] !== ':') return null;
        return { date: val.slice(0, 8), time: val.slice(9) };
    }

    load() {
        this.plugin.ui.injectCSS(
            '.db-root{width:100%;height:100%;box-sizing:border-box;padding:0 32px 32px;}' +
            '.db-section{margin-bottom:32px}' +
            '.db-section-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;' +
            'padding-bottom:8px;border-bottom:1px solid var(--db-divider,rgba(128,128,128,.15))}' +
            '.db-section-title{font-size:13px;font-weight:600;opacity:.55}' +
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
            '.db-task-source-wrap{display:inline-flex;align-items:center;flex-shrink:0;cursor:pointer;gap:2px;padding-right:4px}' +
            '.db-task-source--link{font-size:11px;color:var(--ed-link-color);white-space:nowrap;' +
            'text-decoration-line:underline;text-decoration-style:dotted;text-underline-offset:2px}' +
            '.db-task-source-wrap:hover .db-task-source--link{color:var(--ed-link-hover-color)}' +
            '.db-pin,.db-unpin,.db-nav,.db-ignore,.db-unignore{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
            'font-size:15px;line-height:1;padding:1px 5px;opacity:.2;transition:opacity .15s;border-radius:4px}' +
            '.db-pin:hover,.db-unpin:hover,.db-nav:hover,.db-ignore:hover,.db-unignore:hover{opacity:.7}' +
            '.db-task--ignored{opacity:.35}' +
            '.db-icon-hover{display:none}' +
            '.db-ignore:hover .db-icon-default,.db-unignore:hover .db-icon-default{display:none}' +
            '.db-ignore:hover .db-icon-hover,.db-unignore:hover .db-icon-hover{display:inline}' +
            '.db-menu-wrap{position:relative;flex-shrink:0}' +
            '.db-hamburger{background:none;border:none;cursor:pointer;color:inherit;font-size:18px;' +
            'line-height:1;padding:1px 5px;opacity:.3;transition:opacity .15s;border-radius:4px}' +
            '.db-hamburger:hover{opacity:.7}' +
            '.db-dropdown{position:absolute;top:calc(100% + 4px);left:0;background:var(--db-bg,white);' +
            'border:1px solid var(--db-divider,rgba(128,128,128,.15));border-radius:8px;padding:4px;' +
            'min-width:160px;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,.12)}' +
            '.db-dropdown-item{display:block;width:100%;text-align:left;background:none;border:none;' +
            'cursor:pointer;color:inherit;font-size:13px;padding:7px 10px;border-radius:4px;transition:background .1s}' +
            '.db-dropdown-item:hover{background:var(--db-hover,rgba(128,128,128,.07))}' +
            '.db-src-icon{display:inline-flex;align-items:center;justify-content:center}' +
            '.db-empty{font-size:13px;opacity:.3;padding:12px 6px}' +
            '.db-loading{padding:28px;opacity:.35;font-size:14px}' +
            '.db-header{display:flex;align-items:center;gap:8px;padding:24px 32px 28px;width:100%;box-sizing:border-box}' +
            '.db-header-crumb{font-size:16px;opacity:.4;font-weight:500;padding:2px 0}' +
            '.db-header-sep{font-size:16px;opacity:.2;margin:0 4px;padding:2px 0}' +
            '.db-mode-toggle{background:none;border:none;cursor:pointer;color:var(--ed-link-color);' +
            'font-size:14px;padding:2px 0;margin-left:auto;transition:color .15s}' +
            '.db-mode-toggle:hover{color:var(--ed-link-hover-color)}' +
            '' +
            '.db-block{display:flex;border-radius:6px;cursor:pointer;transition:background .1s;' +
            'min-height:52px;margin-bottom:4px}' +
            '.db-block:hover{background:var(--db-hover,rgba(128,128,128,.07))}' +
            '.db-block--selected{background:var(--db-sel,rgba(128,128,128,.1))}' +
            '.db-block-time{flex-shrink:0;align-self:flex-start;min-width:210px;padding:3px 0 4px}' +
            '.db-block-time-inner{display:flex;align-items:center;gap:6px;font-size:13px;opacity:.4;' +
            'padding:5px 6px;min-height:30px}' +
            '.db-block-label{width:140px;flex-shrink:0}' +
            '.db-block-clock{font-variant-numeric:tabular-nums;flex-shrink:0}' +
            '.db-block-body{flex:1;min-width:0;padding:1px 0 4px}' +
            '.db-block-hint{font-size:12px;opacity:.18;padding:11px 0 14px 2px}' +
            '.db-day-nav{display:flex;align-items:center;gap:8px}' +
            '.db-day-nav-btn{background:none;border:none;cursor:pointer;color:var(--ed-link-color);font-size:16px;' +
            'padding:2px 6px;transition:color .15s;border-radius:4px}' +
            '.db-day-nav-btn:hover:not(:disabled){color:var(--ed-link-hover-color)}' +
            '.db-day-nav-btn:disabled{opacity:.2;cursor:default}' +
            '.db-day-nav-label{font-size:15px;font-weight:500;opacity:.6;min-width:88px;text-align:center}' +
            '@media(max-width:600px){' +
            '.db-root{padding:12px 1% 12px 1%;max-width:100%}' +
            '.db-header{padding:10px 1% 16px}' +
            '.db-block{flex-direction:column;min-height:0;margin-bottom:8px}' +
            '.db-block-time{padding:4px 6px 0;min-width:0;width:100%}' +
            '.db-block-time-inner{padding:4px 0;min-height:0}' +
            '.db-block-body{padding:0 6px 10px 6px;width:100%}' +
            '.db-block-hint{padding:4px 0 8px 2px}' +
            '.db-task-text,.db-task-text--sel{white-space:normal;overflow:visible;text-overflow:unset}' +
            '.db-task-source,.db-task-source--link,.db-task-source-wrap{display:none}' +
            '.db-src-icon{display:inline-flex;align-items:center;justify-content:center;opacity:.3}' +
            '.db-src-icon:hover{opacity:.7}' +
            '.db-unpin{display:none}' +
            '}'
        );

        this.plugin.ui.addCommandPaletteCommand({
            label: "Open Daily Focus",
            icon:  'gauge',
            onSelected: () => this._openPanel(),
        });

        this.plugin.ui.addSidebarItem({
            label:   "Daily Focus",
            icon:    'gauge',
            tooltip: "Open Daily Focus",
            onClick: () => this._openPanel(),
        });

        this.plugin.ui.registerCustomPanelType('today-dashboard', panel => {
            this._panel = panel;
            panel.setTitle("Daily Focus");
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

        const today          = this._todayStr();
        const viewDate       = this._viewDateStr();
        const viewDateHyphen = `${viewDate.slice(0,4)}-${viewDate.slice(4,6)}-${viewDate.slice(6,8)}`;
        const isViewingToday = viewDate === this._todayD();

        const [todoResult, scheduledResult] = await Promise.all([
            this.plugin.data.searchByQuery('@task @todo',  150),
            this.plugin.data.searchByQuery('@task @today', 100),
        ]);

        const [overdueResult, dueResult] = (this._mode === 'focus' || this._mode === 'ignore-list')
            ? [{ lines: [] }, { lines: [] }]
            : await Promise.all([
                this.plugin.data.searchByQuery('@task @overdue', 50),
                this.plugin.data.searchByQuery('@task @due',    100),
            ]);

        let doneLinesAll = [];
        try {
            const doneResult = await this.plugin.data.searchByQuery('@task @done', 100);
            doneLinesAll = (doneResult.lines || []).filter(l => l.type === 'task');
            for (const l of doneLinesAll) {
                if (l.props?.['db-done-date'] === today) {
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
        const allTodosRaw    =         (todoResult.lines      || []).filter(l => l.type === 'task');
        const ignoredTasks   = allTodosRaw.filter(l =>  l.props?.['db-ignored']);
        const allTodos       = allTodosRaw.filter(l => !l.props?.['db-ignored']);

        const todaySet   = new Set(allTodos.filter(l => l.props?.['db-pinned'] === today).map(l => l.guid));
        const doneTasks  = isViewingToday
            ? [...this._doneTasksMap.values()]
            : doneLinesAll.filter(l => l.props?.['db-done-date'] === viewDateHyphen);
        const viewPinned = allTodos.filter(l => l.props?.['db-pinned'] === viewDateHyphen);

        // Time blocks — date-stamped format "YYYYMMDD:HH:MM", only show for the viewed date
        const timeBlocks = {};
        for (const t of [...allTodos, ...doneTasks]) {
            const parsed = this._parseTimeblock(t.props?.['db-timeblock']);
            if (parsed && parsed.date === viewDate) timeBlocks[t.guid] = parsed.time;
        }

        const overdue     = allTodos.filter(l => overdueGuids.has(l.guid) && !todaySet.has(l.guid));
        const todayPinned = allTodos.filter(l => todaySet.has(l.guid));
        const scheduled   = allTodos.filter(l => scheduledGuids.has(l.guid) && !todaySet.has(l.guid) && !overdueGuids.has(l.guid));
        const inbox       = allTodos.filter(l => !datedGuids.has(l.guid) && !todaySet.has(l.guid) && !scheduledGuids.has(l.guid) && !overdueGuids.has(l.guid));

        const hasAnyTasks = todayPinned.length > 0 || scheduled.length > 0 || doneTasks.length > 0;
        const effectiveMode = this._mode === 'ignore-list' ? 'ignore-list'
            : (this._mode === 'plan' || (!hasAnyTasks && this._mode !== 'focus')) ? 'plan'
            : 'focus';

        const allTasks = [...allTodos, ...doneTasks];

        el.innerHTML = effectiveMode === 'ignore-list'
            ? this._buildIgnoreListHTML(allTodos, ignoredTasks)
            : effectiveMode === 'focus'
                ? this._buildFocusHTML(todayPinned, scheduled, doneTasks, timeBlocks, allTasks, viewPinned)
                : this._buildPlanHTML(overdue, todayPinned, inbox, ignoredTasks.length);

        this._applyTheme(el);
        this._attachListeners(el, allTasks, ignoredTasks);
        this._reapplySelection(el);
    }

    _menuHTML() {
        return `<div class="db-menu-wrap">
            <button class="db-hamburger" data-action="toggle-menu"><i class="ti ti-menu-2"></i></button>
            <div class="db-dropdown" hidden>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="manage">Ignore list</button>
            </div>
        </div>`;
    }

    _buildFocusHTML(today, scheduled, doneTasks, timeBlocks, allTasks, viewPinned) {
        const isToday        = this._viewDateStr() === this._todayD();
        const pinnedGuids    = new Set(today.map(t => t.guid));
        const doneGuids      = new Set(doneTasks.map(t => t.guid));
        const taskByGuid     = new Map(allTasks.map(t => [t.guid, t]));
        const assignedByTime = {};
        const sectionFor     = guid => pinnedGuids.has(guid) ? 'focus-pinned' : 'focus-scheduled';

        if (isToday) {
            const allFocus = [...today, ...scheduled.filter(t => !pinnedGuids.has(t.guid))];
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
        } else {
            for (const [guid, time] of Object.entries(timeBlocks)) {
                const task = taskByGuid.get(guid);
                if (!task) continue;
                if (!assignedByTime[time]) assignedByTime[time] = [];
                assignedByTime[time].push(task);
            }
        }

        const allFocusToday  = isToday ? [...today, ...scheduled.filter(t => !pinnedGuids.has(t.guid))] : [];
        const unassigned     = isToday
            ? allFocusToday.filter(t => !timeBlocks[t.guid])
            : viewPinned.filter(t => !timeBlocks[t.guid]);
        const unassignedDone = isToday ? doneTasks.filter(t => !timeBlocks[t.guid]) : [];

        return `<div class="db-header">
                ${this._menuHTML()}
                <span class="db-header-crumb">Focus</span>
                <span class="db-header-sep">/</span>
                <div class="db-day-nav">
                    <button class="db-day-nav-btn" data-action="prev-day">←</button>
                    <span class="db-day-nav-label">${this._viewDateLabel()}</span>
                    <button class="db-day-nav-btn" data-action="next-day" ${isToday ? 'disabled' : ''}>→</button>
                </div>
                <button class="db-mode-toggle" data-action="set-mode" data-mode="plan">Plan →</button>
            </div>
            <div class="db-root">
            ${(unassigned.length || unassignedDone.length) ? `
            <div class="db-section db-section--today">
                <div class="db-section-header">
                    <span class="db-section-title">Unscheduled</span>
                    ${unassigned.length ? `<span class="db-count">${unassigned.length}</span>` : ''}
                </div>
                <div class="db-block">
                    <div class="db-block-time"><div class="db-block-time-inner"><span class="db-block-label">When time is right</span></div></div>
                    <div class="db-block-body">
                        ${unassigned.map(t => this._taskRow(t, sectionFor(t.guid))).join('')}
                        ${unassignedDone.map(t => this._taskRow(t, 'done')).join('')}
                    </div>
                </div>
            </div>` : ''}
            <div class="db-section">
                <div class="db-section-header">
                    <span class="db-section-title">Day Plan</span>
                </div>
                ${SLOTS.map(s => this._blockHTML(s.time, s.label, assignedByTime[s.time] || [], doneGuids)).join('')}
            </div>
        </div>`; // closes db-root — db-topbar is a sibling, no wrapper needed
    }

    _blockHTML(time, label, tasks, doneGuids = new Set()) {
        return `<div class="db-block" data-action="select-block" data-time="${time}">
            <div class="db-block-time"><div class="db-block-time-inner"><span class="db-block-label">${label}</span><span>→</span><span class="db-block-clock">${time}</span></div></div>
            <div class="db-block-body">
                ${tasks.length
                    ? tasks.map(t => this._taskRow(t, doneGuids.has(t.guid) ? 'done' : 'block')).join('')
                    : `<div class="db-block-hint">tap to select</div>`
                }
            </div>
        </div>`;
    }

    _buildPlanHTML(overdue, today, inbox, ignoredCount = 0) {
        return `<div class="db-header">
                ${this._menuHTML()}
                <span class="db-header-crumb">Plan</span>
                <button class="db-mode-toggle" data-action="set-mode" data-mode="focus">← Focus</button>
            </div>
            <div class="db-root">
            ${this._section('Overdue',       overdue, 'overdue')}
            ${this._section("Today's Focus", today,   'today')}
            ${this._section('Inbox',         inbox,   'inbox')}
        </div>`;
    }

    _buildIgnoreListHTML(activeTasks, ignoredTasks) {
        return `<div class="db-header">
                ${this._menuHTML()}
                <span class="db-header-crumb">Ignore list</span>
                <button class="db-mode-toggle" data-action="set-mode" data-mode="plan">← Plan</button>
            </div>
            <div class="db-root">
                <div class="db-section">
                    <div class="db-section-header">
                        <span class="db-section-title">Tasks</span>
                        ${activeTasks.length ? `<span class="db-count">${activeTasks.length}</span>` : ''}
                    </div>
                    ${activeTasks.length
                        ? activeTasks.map(t => this._ignoreListTaskRow(t, false)).join('')
                        : `<div class="db-empty">No active tasks</div>`
                    }
                </div>
                ${ignoredTasks.length ? `
                <div class="db-section">
                    <div class="db-section-header">
                        <span class="db-section-title">${ignoredTasks.length} already ignored</span>
                    </div>
                    ${ignoredTasks.map(t => this._ignoreListTaskRow(t, true)).join('')}
                </div>` : ''}
            </div>`;
    }

    _ignoreListTaskRow(task, isIgnored) {
        const text   = this._escape(this._getText(task));
        const source = this._escape(task.record?.getName() || '');
        return `<div class="db-task listitem-task${isIgnored ? ' db-task--ignored' : ''}" data-guid="${task.guid}">
            <div class="db-task-body">
                <span class="db-task-text">${text}</span>
            </div>
            ${source ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>` : ''}
            <button class="${isIgnored ? 'db-unignore' : 'db-ignore'}" data-action="${isIgnored ? 'unignore' : 'ignore'}" data-guid="${task.guid}" title="${isIgnored ? 'Restore task' : 'Ignore task'}"><i class="ti ${isIgnored ? 'ti-eye-off' : 'ti-eye'} db-icon-default"></i><i class="ti ${isIgnored ? 'ti-eye' : 'ti-eye-off'} db-icon-hover"></i></button>
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
        const text    = this._escape(this._getText(task));
        const source  = this._escape(task.record?.getName() || '');
        const isToday = this._viewDateStr() === this._todayD();
        const doneBtn = `<div class="db-done line-check-div clickable" data-action="done" data-guid="${task.guid}"></div>`;

        if (!isToday) {
            const isDone = section === 'done';
            return `<div class="db-task listitem-task${isDone ? ' state-done' : ''}" data-guid="${task.guid}">
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                </div>
                ${source ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>` : ''}
            </div>`;
        }

        const isFocus = section === 'focus-pinned' || section === 'focus-scheduled' || section === 'block';

        if (section === 'done') {
            return `<div class="db-task listitem-task state-done" data-guid="${task.guid}">
                <div class="db-done line-check-div clickable" data-action="undone" data-guid="${task.guid}"></div>
                <span class="db-task-text--sel">${text}</span>
                ${source ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>` : ''}
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
                ${source ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>` : ''}
                ${actionBtn}
            </div>`;
        }

        if (section === 'today') {
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                </div>
                ${source ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>` : ''}
                <button class="db-unpin" data-action="unpin" data-guid="${task.guid}" title="Remove from Today">×</button>
            </div>`;
        }

        if (section === 'inbox' || section === 'overdue') {
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <div class="db-task-body" data-action="pin" data-guid="${task.guid}">
                    <span class="db-task-text">${text}</span>
                </div>
                ${source ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>` : ''}
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

    _attachListeners(el, allTasks, ignoredTasks = []) {
        const byGuid = new Map([...allTasks, ...ignoredTasks].map(l => [l.guid, l]));
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
                this._mode = 'plan';
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
                        await task.setMetaProperty('db-timeblock', this._viewDateStr() + ':' + time);
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
                if (e.target.closest('[data-action="done"],[data-action="unassign"],[data-action="open"],[data-action="select-task"],[data-action="prev-day"],[data-action="next-day"]')) return;
                const time = block.dataset.time;
                if (this._selected?.type === 'task') {
                    const guid = this._selected.id;
                    this._selected = null;
                    const task = byGuid.get(guid);
                    if (task) {
                        await task.setMetaProperty('db-timeblock', this._viewDateStr() + ':' + time);
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
                    itemGuid: task.guid,
                    highlight: true,
                    workspaceGuid: this.plugin.getWorkspaceGuid(),
                });
            });
        });

        const hamburger = el.querySelector('[data-action="toggle-menu"]');
        const dropdown  = el.querySelector('.db-dropdown');
        if (hamburger && dropdown) {
            hamburger.addEventListener('click', e => {
                e.stopPropagation();
                dropdown.hidden = !dropdown.hidden;
                if (!dropdown.hidden) {
                    document.addEventListener('click', () => { dropdown.hidden = true; }, { once: true });
                }
            });
        }

        el.querySelectorAll('[data-action="ignore"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                await task.setMetaProperty('db-ignored', 'true');
                if (this._panel) this._render(this._panel);
            });
        });

        el.querySelectorAll('[data-action="unignore"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const task = byGuid.get(btn.dataset.guid);
                if (!task) return;
                await task.setMetaProperty('db-ignored', null);
                if (this._panel) this._render(this._panel);
            });
        });

        el.querySelectorAll('[data-action="set-mode"]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._mode = btn.dataset.mode;
                if (this._panel) this._render(this._panel);
            });
        });

        el.querySelector('[data-action="prev-day"]')?.addEventListener('click', e => {
            e.stopPropagation();
            this._viewDate = this._offsetDate(this._viewDateStr(), -1);
            if (this._panel) this._render(this._panel);
        });

        el.querySelector('[data-action="next-day"]')?.addEventListener('click', e => {
            e.stopPropagation();
            this._viewDate = this._offsetDate(this._viewDateStr(), 1);
            if (this._panel) this._render(this._panel);
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
        const bg  = getComputedStyle(node || startNode).backgroundColor;
        const fg  = getComputedStyle(node || startNode).color;
        const rgb = (fg.match(/\d+/g) || ['150', '150', '150']).slice(0, 3).join(',');
        el.style.setProperty('--db-bg', bg);
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
