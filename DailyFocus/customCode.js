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
        this._panel          = null;
        this._refreshTimer   = null;
        this._renderVer      = 0;
        this._mode           = null;
        this._selected       = null;
        this._doneTasksMap   = new Map();
        this._viewDate       = null;
        this._hideRecurring  = true; // [RECURRING] remove when Thymer ships native recurring
        this._themeCache     = null;
        this._listenerAbort  = null;
        this._todayCache     = null;
    }

    _todayStr() {
        if (!this._todayCache) {
            const d = new Date();
            this._todayCache = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        }
        return this._todayCache;
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

    _viewDateHyphen() {
        const v = this._viewDateStr();
        return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
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
            '.db-pin,.db-unpin,.db-nav,.db-ignore,.db-unignore,.db-recurring-btn{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
            'font-size:15px;line-height:1;padding:1px 5px;opacity:.2;transition:opacity .15s;border-radius:4px}' +
            '.db-pin:hover,.db-unpin:hover,.db-nav:hover,.db-ignore:hover,.db-unignore:hover,.db-recurring-btn:hover{opacity:.7}' +
            // [RECURRING-START] button styling — remove when Thymer ships native recurring
            '.db-recurring-btn{display:inline-flex;align-items:center;gap:2px}' +
            '.db-recurring-btn--active{opacity:.6;color:var(--ed-link-color)}' +
            '.db-task--recurring-preview{opacity:.55}' +
            '.db-recurring-btn--active:hover{opacity:1}' +
            '.db-freq-menu-wrap{position:relative;flex-shrink:0;display:inline-flex;align-items:center}' +
            '.db-freq-menu-btn{background:none;border:none;cursor:pointer;font-size:15px;color:inherit;' +
            'opacity:.25;padding:1px 5px;border-radius:4px;transition:opacity .15s;line-height:1}' +
            '.db-freq-menu-btn:hover{opacity:.7}' +
            '.db-freq-dropdown{position:absolute;top:calc(100% + 4px);right:0;background:var(--db-bg,white);' +
            'border:1px solid var(--db-divider,rgba(128,128,128,.15));border-radius:8px;padding:4px;' +
            'min-width:120px;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,.12)}' +
            '.db-freq-dropdown-item{display:block;width:100%;text-align:left;background:none;border:none;' +
            'cursor:pointer;color:inherit;font-size:13px;padding:7px 10px;border-radius:4px;transition:background .1s}' +
            '.db-freq-dropdown-item:hover{background:var(--db-hover,rgba(128,128,128,.07))}' +
            '.db-freq-dropdown-item--active{font-weight:600;color:var(--ed-link-color)}' +
            '.db-recurring-filter{background:none;border:none;cursor:pointer;font-size:12px;color:inherit;' +
            'opacity:.35;padding:2px 4px;border-radius:4px;transition:opacity .15s;white-space:nowrap}' +
            '.db-recurring-filter:hover{opacity:.6}' +
            '.db-recurring-filter--active{opacity:.6;color:var(--ed-link-color)}' +
            '.db-recurring-notice{font-size:12px;opacity:.6;padding:4px 6px 12px;display:flex;align-items:center;gap:5px}' +
            '.db-recurring-notice-btn{background:none;border:none;cursor:pointer;color:var(--ed-link-color);' +
            'font-size:12px;padding:0;text-decoration-line:underline;text-decoration-style:dotted;text-underline-offset:2px}' +
            '.db-recurring-notice-btn:hover{color:var(--ed-link-hover-color)}' +
            '.db-recurring-wrap{display:flex;flex-direction:column}' +
            '.db-day-picker{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 6px 10px 6px}' +
            '.db-picker-label{font-size:11px;opacity:.4;flex-shrink:0}' +
            '.db-day-btn{background:none;border:1px solid var(--db-divider,rgba(128,128,128,.15));border-radius:4px;' +
            'cursor:pointer;font-size:11px;font-weight:600;padding:3px 7px;color:inherit;opacity:.45;transition:all .1s}' +
            '.db-day-btn:hover{opacity:.8}' +
            '.db-day-btn--active{background:var(--ed-link-color);color:white;opacity:1;border-color:transparent}' +
            '.db-day-select{background:var(--db-bg,white);border:1px solid var(--db-divider,rgba(128,128,128,.15));' +
            'border-radius:4px;cursor:pointer;font-size:11px;padding:3px 6px;color:inherit;outline:none}' +
            // [RECURRING-END]
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
            '.db-header{display:flex;align-items:center;padding:24px 32px 28px;width:100%;box-sizing:border-box}' +
            '.db-header-left{display:flex;align-items:center;gap:8px;flex:1}' +
            '.db-header-right{display:flex;align-items:center;justify-content:flex-end;flex:1}' +
            '.db-header-crumb{font-size:16px;opacity:.4;font-weight:500;padding:2px 0}' +
            '.db-header-sep{font-size:16px;opacity:.2;margin:0 4px;padding:2px 0}' +
            '.db-mode-toggle{background:none;border:none;cursor:pointer;color:var(--ed-link-color);' +
            'font-size:14px;padding:2px 0;transition:color .15s}' +
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
            '.db-day-nav-label[data-action="go-today"]{cursor:pointer;opacity:1;color:var(--ed-link-color);transition:color .15s}' +
            '.db-day-nav-label[data-action="go-today"]:hover{color:var(--ed-link-hover-color)}' +
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

        this.plugin.events.on('lineitem.updated', async ev => {
            // [RECURRING-START] native completion detection — remove when Thymer ships native recurring
            if (ev.status === 'done') {
                try {
                    const task = await ev.getLineItem();
                    if (task?.props?.['db-recurring-freq'] && !task.props?.['db-recurring-next']) {
                        await this._createNextOccurrence(task);
                    }
                } catch (e) {
                    console.warn('[Dashboard] recurring check failed:', e);
                }
            }
            // [RECURRING-END]
            scheduleRefresh();
        });
        this.plugin.events.on('lineitem.created', scheduleRefresh);
        this.plugin.events.on('lineitem.deleted', scheduleRefresh);

    }

    async _openPanel() {
        let panel = this.plugin.ui.getActivePanel();
        if (!panel) panel = await this.plugin.ui.createPanel();
        if (panel) panel.navigateToCustomType('today-dashboard');
    }

    async _render(panel, fromCallback = false) {
        this._todayCache = null;
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
        if (this._mode !== 'recurring-list' && this._mode !== 'ignore-list') {
            try {
                const doneResult = await this.plugin.data.searchByQuery('@task @done', 100);
                doneLinesAll = (doneResult.lines || []).filter(l => l.type === 'task');
            } catch (e) {
                console.warn('[Dashboard] @task @done query failed:', e);
            }
        }

        if (ver !== this._renderVer) return;

        for (const l of doneLinesAll) {
            if (l.props?.['db-done-date'] === today) {
                this._doneTasksMap.set(l.guid, l);
            }
        }

        const overdueGuids   = new Set((overdueResult.lines   || []).filter(l => l.type === 'task').map(l => l.guid));
        const datedGuids     = new Set((dueResult.lines       || []).filter(l => l.type === 'task').map(l => l.guid));
        const scheduledGuids = new Set((scheduledResult.lines || []).filter(l => l.type === 'task').map(l => l.guid));
        const allTodosRaw    =         (todoResult.lines      || []).filter(l => l.type === 'task');
        const ignoredTasks   = allTodosRaw.filter(l =>  l.props?.['db-ignored']);
        const allTodos       = allTodosRaw.filter(l => !l.props?.['db-ignored']);

        const todaySet       = new Set(allTodos.filter(l => l.props?.['db-pinned'] === today).map(l => l.guid));
        const doneTasks      = isViewingToday
            ? [...this._doneTasksMap.values()]
            : doneLinesAll.filter(l => l.props?.['db-done-date'] === viewDateHyphen);
        const viewPinned     = allTodos.filter(l => l.props?.['db-pinned'] === viewDateHyphen);
        const viewPinnedSet  = new Set(viewPinned.map(l => l.guid));

        // Time blocks — date-stamped format "YYYYMMDD:HH:MM", only show for the viewed date
        const timeBlocks = {};
        for (const t of [...allTodos, ...doneTasks]) {
            const parsed = this._parseTimeblock(t.props?.['db-timeblock']);
            if (parsed && parsed.date === viewDate) timeBlocks[t.guid] = parsed.time;
        }

        const overdue = [], planOverdue = [], todayPinned = [], scheduled = [], inbox = [], planInbox = [];
        for (const l of allTodos) {
            const isOverdue   = overdueGuids.has(l.guid);
            const isPinned    = todaySet.has(l.guid);
            const isScheduled = scheduledGuids.has(l.guid);
            const isDated     = datedGuids.has(l.guid);
            const hasPinProp  = !!l.props?.['db-pinned'];
            if (isOverdue && !isPinned)                                overdue.push(l);
            if (isOverdue && !hasPinProp)                              planOverdue.push(l);
            if (isPinned)                                              todayPinned.push(l);
            if (isScheduled && !isPinned && !isOverdue)                scheduled.push(l);
            if (!isDated && !isPinned && !isScheduled && !isOverdue)   inbox.push(l);
            if (!isDated && !hasPinProp && !isScheduled && !isOverdue) planInbox.push(l);
        }

        const hasAnyTasks = todayPinned.length > 0 || scheduled.length > 0 || doneTasks.length > 0;
        const effectiveMode = this._mode === 'ignore-list' ? 'ignore-list'
            : this._mode === 'recurring-list' ? 'recurring-list'
            : (this._mode === 'plan' || (!hasAnyTasks && this._mode !== 'focus')) ? 'plan'
            : 'focus';

        // [RECURRING-START] unconfigured count + future preview for plan and focus
        const unconfiguredRecurring = allTodosRaw.filter(l =>
            l.props?.['db-recurring-freq'] &&
            l.props['db-recurring-freq'] !== 'daily' &&
            !l.props?.['db-recurring-day']
        ).length;
        const recurringPreview = viewDate > this._todayD()
            ? allTodos.filter(t =>
                t.props?.['db-recurring-freq'] &&
                !viewPinnedSet.has(t.guid) &&
                this._wouldRecurOn(t, viewDate)
              )
            : [];
        // [RECURRING-END]

        const allTasks = [...allTodos, ...doneTasks];

        el.innerHTML = effectiveMode === 'ignore-list'
            ? this._buildIgnoreListHTML(allTodos, ignoredTasks)
            : effectiveMode === 'recurring-list'
                ? this._buildRecurringHTML(allTodosRaw.filter(l => l.props?.['db-recurring-freq']))
                : effectiveMode === 'focus'
                    ? this._buildFocusHTML(todayPinned, scheduled, doneTasks, timeBlocks, allTasks, viewPinned, recurringPreview)
                    : this._buildPlanHTML(planOverdue, viewPinned, planInbox, ignoredTasks.length, unconfiguredRecurring, this._hideRecurring, recurringPreview);

        this._applyTheme(el);
        if (this._listenerAbort) this._listenerAbort.abort();
        this._listenerAbort = new AbortController();
        this._attachListeners(el, allTasks, ignoredTasks, this._listenerAbort.signal);
        this._reapplySelection(el);
    }

    _menuHTML() {
        return `<div class="db-menu-wrap">
            <button class="db-hamburger" data-action="toggle-menu"><i class="ti ti-menu-2"></i></button>
            <div class="db-dropdown" hidden>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="focus">Focus</button>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="plan">Plan</button>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="recurring-list">Recurring tasks</button>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="ignore-list">Ignore list</button>
            </div>
        </div>`;
    }

    _buildFocusHTML(today, scheduled, doneTasks, timeBlocks, allTasks, viewPinned, recurringPreview = []) {
        const isToday        = this._viewDateStr() === this._todayD();
        const pinnedGuids         = new Set(today.map(t => t.guid));
        const doneGuids           = new Set(doneTasks.map(t => t.guid));
        const recurringPreviewSet = new Set(recurringPreview.map(t => t.guid));
        const taskByGuid          = new Map(allTasks.map(t => [t.guid, t]));
        const assignedByTime      = {};
        const sectionFor          = guid => recurringPreviewSet.has(guid) ? 'recurring-preview' : pinnedGuids.has(guid) ? 'focus-pinned' : 'focus-scheduled';
        const allFocusToday       = isToday ? [...today, ...scheduled.filter(t => !pinnedGuids.has(t.guid))] : [];

        if (isToday) {
            for (const task of allFocusToday) {
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

        const unassigned     = isToday
            ? allFocusToday.filter(t => !timeBlocks[t.guid])
            : [...viewPinned.filter(t => !timeBlocks[t.guid]), ...recurringPreview];
        const unassignedDone = isToday ? doneTasks.filter(t => !timeBlocks[t.guid]) : [];

        return `<div class="db-header">
                <div class="db-header-left">
                    ${this._menuHTML()}
                    <span class="db-header-crumb">Focus</span>
                    <span class="db-header-sep">/</span>
                </div>
                <div class="db-day-nav">
                    <button class="db-day-nav-btn" data-action="prev-day">←</button>
                    <span class="db-day-nav-label"${this._viewDateStr() !== this._todayD() ? ' data-action="go-today" title="Go to today"' : ''}>${this._viewDateLabel()}</span>
                    <button class="db-day-nav-btn" data-action="next-day">→</button>
                </div>
                <div class="db-header-right">
                    <button class="db-mode-toggle" data-action="set-mode" data-mode="plan">Plan →</button>
                </div>
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

    _buildPlanHTML(overdue, today, inbox, ignoredCount = 0, unconfiguredRecurring = 0, hideRecurring = false, recurringPreview = []) {
        // [RECURRING-START] filter + notice — remove when Thymer ships native recurring
        const visInbox      = hideRecurring ? inbox.filter(t => !t.props?.['db-recurring-freq']) : inbox;
        const toggleBtn     = `<button class="db-recurring-filter${hideRecurring ? ' db-recurring-filter--active' : ''}" data-action="toggle-recurring-filter" style="margin-left:auto">${hideRecurring ? 'Show recurring' : 'Hide recurring'}</button>`;
        const recurringNotice = unconfiguredRecurring > 0
            ? `<div class="db-recurring-notice"><i class="ti ti-info-circle"></i>${unconfiguredRecurring} recurring task${unconfiguredRecurring > 1 ? 's' : ''} need${unconfiguredRecurring === 1 ? 's' : ''} a schedule — <button class="db-recurring-notice-btn" data-action="set-mode" data-mode="recurring-list">configure →</button></div>`
            : '';
        // [RECURRING-END]
        const dateLabel  = this._viewDateLabel();
        const focusTitle = dateLabel === 'Today' ? "Today's Focus" : `${dateLabel}'s Focus`;
        return `<div class="db-header">
                <div class="db-header-left">
                    ${this._menuHTML()}
                    <span class="db-header-crumb">Plan</span>
                    <span class="db-header-sep">/</span>
                </div>
                <div class="db-day-nav">
                    <button class="db-day-nav-btn" data-action="prev-day" ${this._viewDateStr() <= this._todayD() ? 'disabled' : ''}>←</button>
                    <span class="db-day-nav-label"${this._viewDateStr() !== this._todayD() ? ' data-action="go-today" title="Go to today"' : ''}>${dateLabel}</span>
                    <button class="db-day-nav-btn" data-action="next-day">→</button>
                </div>
                <div class="db-header-right">
                    <button class="db-mode-toggle" data-action="set-mode" data-mode="focus">← Focus</button>
                </div>
            </div>
            <div class="db-root">
            ${this._section('Overdue',  overdue,  'overdue')}
            ${this._sectionMixed(focusTitle, today, 'today', recurringPreview, 'recurring-preview')}
            ${recurringNotice}
            ${this._section('Inbox',    visInbox, 'inbox', toggleBtn)}
        </div>`;
    }

    _buildIgnoreListHTML(activeTasks, ignoredTasks) {
        return `<div class="db-header">
                <div class="db-header-left">
                    ${this._menuHTML()}
                    <span class="db-header-crumb">Ignore list</span>
                    <span class="db-header-sep">/</span>
                </div>
                <div class="db-header-right">
                    <button class="db-mode-toggle" data-action="set-mode" data-mode="focus">← Focus</button>
                </div>
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

    _buildRecurringHTML(recurringTasks) {
        const GROUPS = ['daily', 'weekly', 'monthly', 'yearly'];
        const LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
        const sortByDay = tasks => [...tasks].sort((a, b) => {
            const da = a.props?.['db-recurring-day'];
            const db = b.props?.['db-recurring-day'];
            if (!da && !db) return 0;
            if (!da) return 1;
            if (!db) return -1;
            return da.localeCompare(db, undefined, { numeric: true });
        });
        const grouped = GROUPS.map(freq => ({
            freq,
            tasks: sortByDay(recurringTasks.filter(t => t.props?.['db-recurring-freq'] === freq)),
        })).filter(g => g.tasks.length > 0);

        const sections = grouped.length
            ? grouped.map(g => `
                <div class="db-section">
                    <div class="db-section-header">
                        <span class="db-section-title">${LABELS[g.freq]}</span>
                        <span class="db-count">${g.tasks.length}</span>
                    </div>
                    ${g.tasks.map(t => this._recurringTaskRow(t)).join('')}
                </div>`).join('')
            : `<div class="db-empty">No recurring tasks — use the repeat button on any task to set a frequency</div>`;

        return `<div class="db-header">
                <div class="db-header-left">
                    ${this._menuHTML()}
                    <span class="db-header-crumb">Recurring tasks</span>
                    <span class="db-header-sep">/</span>
                </div>
                <div class="db-header-right">
                    <button class="db-mode-toggle" data-action="set-mode" data-mode="focus">← Focus</button>
                </div>
            </div>
            <div class="db-root">${sections}</div>`;
    }

    _recurringTaskRow(task) {
        const text   = this._escape(this._getText(task));
        const source     = this._escape(task.record?.getName() || '');
        const sourceHTML = source
            ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>`
              // WIP: open-in-panel button goes here — blocked on Thymer SDK (createPanel + navigateTo doesn't open native record view)
            : '';
        const freq   = task.props?.['db-recurring-freq'];
        const day    = task.props?.['db-recurring-day'] || null;
        const FREQS     = ['daily', 'weekly', 'monthly', 'yearly'];
        const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
        const dateLabel  = this._getTaskDate(task);
        const freqMenu   = `<div class="db-freq-menu-wrap">
            <button class="db-freq-menu-btn" data-action="open-freq-menu" data-guid="${task.guid}" title="Options"><i class="ti ti-dots"></i></button>
            <div class="db-freq-dropdown" hidden>
                ${FREQS.map(f => `<button class="db-freq-dropdown-item${freq === f ? ' db-freq-dropdown-item--active' : ''}" data-action="set-freq" data-guid="${task.guid}" data-freq="${f}">${FREQ_LABEL[f]}</button>`).join('')}
                <button class="db-freq-dropdown-item" style="opacity:.5;margin-top:4px" data-action="remove-recurring" data-guid="${task.guid}">Remove recurring</button>
            </div>
        </div>`;
        return `<div class="db-recurring-wrap">
            <div class="db-task listitem-task" data-guid="${task.guid}">
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                    ${dateLabel ? `<span class="db-task-source">${dateLabel}</span>` : ''}
                </div>
                ${sourceHTML}
                ${freqMenu}
            </div>
            ${this._dayPickerHTML(task.guid, freq, day)}
        </div>`;
    }

    _dayPickerHTML(guid, freq, day) {
        if (freq === 'daily') return '';
        if (freq === 'weekly') {
            const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
            const active = day ? parseInt(day) : null;
            const btns   = DAYS.map((label, i) => {
                const iso = i + 1;
                return `<button class="db-day-btn${active === iso ? ' db-day-btn--active' : ''}" data-action="set-recur-day" data-guid="${guid}" data-day="${iso}">${label}</button>`;
            }).join('');
            return `<div class="db-day-picker">${btns}</div>`;
        }
        if (freq === 'monthly') {
            const activeDay = day ? parseInt(day) : 0;
            const options   = Array.from({length: 31}, (_, i) => i + 1)
                .map(d => `<option value="${d}"${activeDay === d ? ' selected' : ''}>${d}</option>`).join('');
            return `<div class="db-day-picker">
                <span class="db-picker-label">Day of month</span>
                <select class="db-day-select" data-action="set-recur-day" data-guid="${guid}">
                    ${!activeDay ? '<option value="" disabled selected>Pick a day</option>' : ''}
                    ${options}
                </select>
            </div>`;
        }
        if (freq === 'yearly') {
            const [mm, dd] = day ? day.split('-').map(Number) : [0, 0];
            const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const mOpts    = MONTHS.map((m, i) => `<option value="${i+1}"${mm === i+1 ? ' selected' : ''}>${m}</option>`).join('');
            const dOpts    = Array.from({length: 31}, (_, i) => i + 1)
                .map(d => `<option value="${d}"${dd === d ? ' selected' : ''}>${d}</option>`).join('');
            return `<div class="db-day-picker">
                <select class="db-recur-year-select db-recur-year-month db-day-select" data-guid="${guid}">
                    ${!mm ? '<option value="" disabled selected>Month</option>' : ''}${mOpts}
                </select>
                <select class="db-recur-year-select db-recur-year-day db-day-select" data-guid="${guid}">
                    ${!dd ? '<option value="" disabled selected>Day</option>' : ''}${dOpts}
                </select>
            </div>`;
        }
        return '';
    }

    _getTaskDate(task) {
        const seg = (task.segments || []).find(s => s.type === 'datetime');
        return seg?.text || null;
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

    _section(title, tasks, type, headerExtra = '') {
        const empty = {
            overdue: 'No overdue tasks',
            today:   'Nothing pinned — tap a task in the inbox to add it',
            inbox:   'No undated tasks',
        }[type];

        return `<div class="db-section db-section--${type}">
            <div class="db-section-header">
                <span class="db-section-title">${title}</span>
                ${tasks.length ? `<span class="db-count">${tasks.length}</span>` : ''}
                ${headerExtra}
            </div>
            ${tasks.length
                ? tasks.map(t => this._taskRow(t, type)).join('')
                : `<div class="db-empty">${empty}</div>`
            }
        </div>`;
    }

    _sectionMixed(title, primary, primaryType, secondary, secondaryType) {
        const empty = 'Nothing pinned — tap a task in the inbox to add it';
        const totalCount = primary.length + secondary.length;
        return `<div class="db-section db-section--${primaryType}">
            <div class="db-section-header">
                <span class="db-section-title">${title}</span>
                ${totalCount ? `<span class="db-count">${totalCount}</span>` : ''}
            </div>
            ${primary.map(t => this._taskRow(t, primaryType)).join('')}
            ${secondary.map(t => this._taskRow(t, secondaryType)).join('')}
            ${!totalCount ? `<div class="db-empty">${empty}</div>` : ''}
        </div>`;
    }

    _taskRow(task, section) {
        const text       = this._escape(this._getText(task));
        const source     = this._escape(task.record?.getName() || '');
        const sourceHTML = source
            ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>`
              // WIP: open-in-panel button goes here — blocked on Thymer SDK (createPanel + navigateTo doesn't open native record view)
            : '';
        const isPast   = this._viewDateStr() < this._todayD();
        const isFuture = this._viewDateStr() > this._todayD();
        const doneBtn  = isFuture
            ? `<div class="db-done line-check-div" style="opacity:.25;cursor:default" data-guid="${task.guid}"></div>`
            : `<div class="db-done line-check-div clickable" data-action="done" data-guid="${task.guid}"></div>`;
        // [RECURRING-START] freq button — remove when Thymer ships native recurring
        const freq       = task.props?.['db-recurring-freq'];
        const recurToggle = freq
            ? `<button class="db-recurring-btn db-recurring-btn--active" data-action="remove-recurring" data-guid="${task.guid}" title="Remove recurring"><i class="ti ti-repeat"></i></button>`
            : `<button class="db-recurring-btn" data-action="enable-recurring" data-guid="${task.guid}" title="Set as recurring"><i class="ti ti-repeat"></i></button>`;
        // [RECURRING-END]

        if (isPast || section === 'recurring-preview') {
            const isDone = section === 'done';
            return `<div class="db-task listitem-task${isDone ? ' state-done' : ''}${section === 'recurring-preview' ? ' db-task--recurring-preview' : ''}" data-guid="${task.guid}">
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                </div>
                ${sourceHTML}
            </div>`;
        }

        const isFocus = section === 'focus-pinned' || section === 'focus-scheduled' || section === 'block';

        if (section === 'done') {
            return `<div class="db-task listitem-task state-done" data-guid="${task.guid}">
                <div class="db-done line-check-div clickable" data-action="undone" data-guid="${task.guid}"></div>
                <span class="db-task-text--sel">${text}</span>
                ${sourceHTML}
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
                ${sourceHTML}
                ${actionBtn}
            </div>`;
        }

        if (section === 'today') {
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                </div>
                ${sourceHTML}
                ${recurToggle}<!-- [RECURRING] -->
                <button class="db-unpin" data-action="unpin" data-guid="${task.guid}" title="Remove from Today">×</button>
            </div>`;
        }

        if (section === 'inbox' || section === 'overdue') {
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <div class="db-task-body" data-action="pin" data-guid="${task.guid}">
                    <span class="db-task-text">${text}</span>
                </div>
                ${sourceHTML}
                ${recurToggle}<!-- [RECURRING] -->
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

    _attachListeners(el, allTasks, ignoredTasks = [], signal) {
        const byGuid = new Map();
        for (const l of allTasks)     byGuid.set(l.guid, l);
        for (const l of ignoredTasks) byGuid.set(l.guid, l);
        const today  = this._todayStr();

        el.addEventListener('click', async e => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            e.stopPropagation();
            const action = target.dataset.action;
            const guid   = target.dataset.guid;
            const task   = byGuid.get(guid);

            switch (action) {
                case 'done': {
                    if (!task) return;
                    target.style.pointerEvents = 'none';
                    const row = target.closest('.db-task');
                    if (row) row.classList.add('state-done');
                    try {
                        await task.setTaskStatus('done');
                        await task.setMetaProperty('db-done-date', today);
                        this._doneTasksMap.set(task.guid, task);
                    } catch (err) {
                        console.error('[Dashboard] done failed:', err);
                        if (row) row.classList.remove('state-done');
                        target.style.pointerEvents = '';
                    }
                    break;
                }
                case 'undone': {
                    if (!task) return;
                    target.style.pointerEvents = 'none';
                    try {
                        await task.setTaskStatus('none');
                        await task.setMetaProperty('db-done-date', null);
                        this._doneTasksMap.delete(task.guid);
                        const row = target.closest('.db-task');
                        if (row) row.classList.remove('state-done');
                        if (this._panel) this._render(this._panel);
                    } catch (err) {
                        console.error('[Dashboard] undone failed:', err);
                        target.style.pointerEvents = '';
                    }
                    break;
                }
                case 'pin': {
                    if (!task) return;
                    await task.setMetaProperty('db-pinned', this._viewDateHyphen());
                    this._mode = 'plan';
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'unpin': {
                    if (!task) return;
                    await task.setMetaProperty('db-pinned', null);
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'unassign': {
                    if (!task) return;
                    await task.setMetaProperty('db-timeblock', null);
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'select-task': {
                    if (this._selected?.type === 'block') {
                        const time = this._selected.id;
                        this._selected = null;
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
                    break;
                }
                case 'select-block': {
                    const time = target.dataset.time;
                    if (this._selected?.type === 'task') {
                        const blockTask = byGuid.get(this._selected.id);
                        this._selected = null;
                        if (blockTask) {
                            await blockTask.setMetaProperty('db-timeblock', this._viewDateStr() + ':' + time);
                            if (this._panel) this._render(this._panel);
                        }
                    } else if (this._selected?.type === 'block' && this._selected.id === time) {
                        this._selected = null;
                        this._reapplySelection(el);
                    } else {
                        this._selected = { type: 'block', id: time };
                        this._reapplySelection(el);
                    }
                    break;
                }
                case 'open': {
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
                    break;
                }
                case 'toggle-menu': {
                    const menuWrap = target.closest('.db-menu-wrap');
                    const drop = menuWrap?.querySelector('.db-dropdown');
                    if (!drop) return;
                    drop.hidden = !drop.hidden;
                    if (!drop.hidden) document.addEventListener('click', () => { drop.hidden = true; }, { once: true });
                    break;
                }
                case 'ignore': {
                    if (!task) return;
                    await task.setMetaProperty('db-ignored', 'true');
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'unignore': {
                    if (!task) return;
                    await task.setMetaProperty('db-ignored', null);
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'open-freq-menu': {
                    const freqWrap = target.closest('.db-freq-menu-wrap');
                    const drop = freqWrap?.querySelector('.db-freq-dropdown');
                    if (!drop) return;
                    drop.hidden = !drop.hidden;
                    if (!drop.hidden) document.addEventListener('click', () => { drop.hidden = true; }, { once: true });
                    break;
                }
                case 'set-freq': {
                    if (!task) return;
                    await task.setMetaProperty('db-recurring-freq', target.dataset.freq);
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'set-recur-day': {
                    if (!task) return;
                    const val  = target.dataset.day;
                    const freq = task.props?.['db-recurring-freq'];
                    await task.setMetaProperty('db-recurring-day', val);
                    await task.setMetaProperty('db-pinned', this._nextUpcomingDate(freq, val));
                    if (this._panel) this._render(this._panel);
                    break;
                }
                // [RECURRING-START] enable toggle — remove when Thymer ships native recurring
                case 'enable-recurring': {
                    if (!task) return;
                    await task.setMetaProperty('db-recurring-freq', 'daily');
                    await task.setMetaProperty('db-pinned', this._viewDateHyphen());
                    if (this._panel) this._render(this._panel);
                    break;
                }
                // [RECURRING-END]
                case 'remove-recurring': {
                    if (!task) return;
                    await Promise.all([
                        task.setMetaProperty('db-recurring-freq', null),
                        task.setMetaProperty('db-recurring-day',  null),
                        task.setMetaProperty('db-recurring-next', null),
                    ]);
                    if (this._panel) this._render(this._panel);
                    break;
                }
                // [RECURRING] toggle-recurring-filter — remove when Thymer ships native recurring
                case 'toggle-recurring-filter': {
                    this._hideRecurring = !this._hideRecurring;
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'set-mode': {
                    this._mode = target.dataset.mode;
                    if (this._mode === 'plan' && this._viewDate < this._todayD()) this._viewDate = null;
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'go-today': {
                    this._viewDate = null;
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'prev-day': {
                    this._viewDate = this._offsetDate(this._viewDateStr(), -1);
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'next-day': {
                    this._viewDate = this._offsetDate(this._viewDateStr(), 1);
                    if (this._panel) this._render(this._panel);
                    break;
                }
            }
        }, { signal });

        el.addEventListener('change', async e => {
            const target = e.target;
            if (target.matches('select[data-action="set-recur-day"]')) {
                const task = byGuid.get(target.dataset.guid);
                if (!task) return;
                const freq = task.props?.['db-recurring-freq'];
                await task.setMetaProperty('db-recurring-day', target.value);
                await task.setMetaProperty('db-pinned', this._nextUpcomingDate(freq, target.value));
                if (this._panel) this._render(this._panel);
                return;
            }
            // [RECURRING-START] yearly picker — remove when Thymer ships native recurring
            if (target.matches('.db-recur-year-select')) {
                const picker = target.closest('.db-day-picker');
                const mm = picker.querySelector('.db-recur-year-month').value;
                const dd = picker.querySelector('.db-recur-year-day').value;
                if (!mm || !dd) return;
                const task = byGuid.get(target.dataset.guid);
                if (!task) return;
                const dayVal = `${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
                await task.setMetaProperty('db-recurring-day', dayVal);
                await task.setMetaProperty('db-pinned', this._nextUpcomingDate('yearly', dayVal));
            }
            // [RECURRING-END]
        }, { signal });
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
        if (!this._themeCache) {
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
            this._themeCache = { bg, rgb };
        }
        const { bg, rgb } = this._themeCache;
        el.style.setProperty('--db-bg', bg);
        const root = el.querySelector('.db-root');
        if (root) {
            root.style.setProperty('--db-hover',   `rgba(${rgb},.07)`);
            root.style.setProperty('--db-divider', `rgba(${rgb},.12)`);
            root.style.setProperty('--db-sel',     `rgba(${rgb},.1)`);
        }
    }

    // [RECURRING-START] scheduling + occurrence logic — remove when Thymer ships native recurring
    _nextRecurringDate(freq, day) {
        const d = new Date();
        if (freq === 'daily') {
            d.setDate(d.getDate() + 1);
        } else if (freq === 'weekly') {
            if (day) {
                const target  = parseInt(day);
                const current = ((d.getDay() + 6) % 7) + 1; // Mon=1..Sun=7
                let diff = target - current;
                if (diff <= 0) diff += 7;
                d.setDate(d.getDate() + diff);
            } else {
                d.setDate(d.getDate() + 7);
            }
        } else if (freq === 'monthly') {
            const targetDay = day ? parseInt(day) : d.getDate();
            d.setDate(1);
            d.setMonth(d.getMonth() + 1);
            const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            d.setDate(Math.min(targetDay, maxDay));
        } else if (freq === 'yearly') {
            if (day) {
                const [mm, dd] = day.split('-').map(Number);
                d.setFullYear(d.getFullYear() + 1);
                const maxDay = new Date(d.getFullYear(), mm, 0).getDate();
                d.setMonth(mm - 1);
                d.setDate(Math.min(dd, maxDay));
            } else {
                d.setFullYear(d.getFullYear() + 1);
            }
        }
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    _nextUpcomingDate(freq, day) {
        const now   = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const fmt   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (freq === 'daily') return fmt(today);
        if (freq === 'weekly') {
            const target  = day ? parseInt(day) : ((today.getDay() + 6) % 7) + 1;
            const current = ((today.getDay() + 6) % 7) + 1;
            let diff = target - current;
            if (diff < 0) diff += 7;
            const d = new Date(today);
            d.setDate(d.getDate() + diff);
            return fmt(d);
        }
        if (freq === 'monthly') {
            const target = day ? parseInt(day) : today.getDate();
            const maxThis = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
            const dayThis = Math.min(target, maxThis);
            if (dayThis >= today.getDate()) return fmt(new Date(today.getFullYear(), today.getMonth(), dayThis));
            const nextM   = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            const maxNext = new Date(nextM.getFullYear(), nextM.getMonth() + 1, 0).getDate();
            return fmt(new Date(nextM.getFullYear(), nextM.getMonth(), Math.min(target, maxNext)));
        }
        if (freq === 'yearly' && day) {
            const [mm, dd] = day.split('-').map(Number);
            const thisYear = new Date(today.getFullYear(), mm - 1, Math.min(dd, new Date(today.getFullYear(), mm, 0).getDate()));
            if (thisYear >= today) return fmt(thisYear);
            const ny = today.getFullYear() + 1;
            return fmt(new Date(ny, mm - 1, Math.min(dd, new Date(ny, mm, 0).getDate())));
        }
        return fmt(today);
    }

    _wouldRecurOn(task, viewDateStr) {
        const freq = task.props?.['db-recurring-freq'];
        if (!freq) return false;
        const day = task.props?.['db-recurring-day'];
        const d = new Date(+viewDateStr.slice(0,4), +viewDateStr.slice(4,6)-1, +viewDateStr.slice(6,8));
        if (freq === 'daily') return true;
        if (freq === 'weekly') {
            if (!day) return false;
            return ((d.getDay() + 6) % 7) + 1 === parseInt(day);
        }
        if (freq === 'monthly') {
            if (!day) return false;
            return d.getDate() === parseInt(day);
        }
        if (freq === 'yearly') {
            if (!day) return false;
            const [mm, dd] = day.split('-').map(Number);
            return d.getMonth() + 1 === mm && d.getDate() === dd;
        }
        return false;
    }

    async _createNextOccurrence(task) {
        const freq = task.props?.['db-recurring-freq'];
        if (!freq || !task.record) return;
        const day      = task.props?.['db-recurring-day'] || null;
        const nextDate = this._nextRecurringDate(freq, day);
        const text     = this._getText(task);
        const newTask  = await task.record.createLineItem(null, null, 'task', [
            { type: 'text',     text },
            { type: 'datetime', text: nextDate },
        ], null);
        if (newTask) {
            await newTask.setMetaProperty('db-recurring-freq', freq);
            await task.setMetaProperty('db-recurring-next', nextDate);
        }
    }
    // [RECURRING-END]

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
