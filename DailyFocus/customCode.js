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
        this._lastData           = null;
        this._prefetchInFlight   = false;
        // [RECURRING-START] draft state for recurring task UI — remove when Thymer ships native recurring
        this._expandedRecurring       = null;
        this._recurringDraft          = null;
        this._completedRecurringDates = {}; // guid → comma-separated YYYYMMDD, persists across _lastData refreshes
        this._rescheduledRecurring    = {}; // guid → YYYYMMDD start date when rescheduled to future
        // [RECURRING-END]
        this._settings   = { ...(plugin.getConfiguration().settings || {}) };
        this._planSearch = '';
    }

    async _saveSettings() {
        const pluginApi = this.plugin.data.getPluginByGuid(this.plugin.getGuid());
        if (!pluginApi) return;
        const config = pluginApi.getConfiguration();
        config.settings = this._settings;
        await pluginApi.saveConfiguration(config);
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
            '.db-root{width:100%;height:100%;box-sizing:border-box;padding:0 0 32px;}' +
            '.db-section{margin-bottom:32px}' +
            '.db-section-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;' +
            'padding-bottom:8px;border-bottom:1px solid var(--sidebar-border-color)}' +
            '.db-section-title{font-size:13px;font-weight:600;opacity:.55}' +
            '.db-section--overdue .db-section-title{color:var(--ed-error-color);opacity:1}' +
            '.db-section--overdue .db-section-header{border-color:color-mix(in srgb,var(--ed-error-color) 30%,transparent)}' +
            '.db-count{font-size:11px;font-weight:600;opacity:.4}' +
            '.db-task{display:flex;align-items:center;gap:8px;padding:7px 10px;' +
            'border-radius:var(--ed-radius-block);transition:background .1s,box-shadow .1s;' +
            'background:var(--cards-bg);border:1px solid var(--cards-border-color);' +
            'box-shadow:var(--color-shadow-cards);margin-bottom:4px}' +
            '.db-task:hover{background:var(--cards-hover-bg);box-shadow:var(--color-shadow-hover)}' +
            '.db-task--selected{box-shadow:0 0 0 2px var(--ed-link-color),var(--color-shadow-cards)}' +
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
            // [RECURRING-START] recurring UI — remove when Thymer ships native recurring
            '.db-recurring-btn{display:inline-flex;align-items:center;gap:2px}' +
            '.db-recurring-btn--active{opacity:.6;color:var(--ed-link-color)}' +
            '.db-task--recurring-preview{opacity:.55}' +
            '.db-recurring-btn--active:hover{opacity:1}' +
            '.db-recurring-filter{background:none;border:none;cursor:pointer;font-size:12px;color:inherit;' +
            'opacity:.35;padding:2px 4px;border-radius:4px;transition:opacity .15s;white-space:nowrap}' +
            '.db-recurring-filter:hover{opacity:.6}' +
            '.db-recurring-filter--active{opacity:.6;color:var(--ed-link-color)}' +
            '.db-recurring-notice{font-size:12px;opacity:.6;padding:4px 6px 12px;display:flex;align-items:center;gap:5px}' +
            '.db-recurring-notice-btn{background:none;border:none;cursor:pointer;color:var(--ed-link-color);' +
            'font-size:12px;padding:0;text-decoration-line:underline;text-decoration-style:dotted;text-underline-offset:2px}' +
            '.db-recurring-notice-btn:hover{color:var(--ed-link-hover-color)}' +
            '.db-recur-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:199}' +
            '.db-recur-row{display:flex;align-items:center;gap:8px;padding:10px 14px;' +
            'border-radius:var(--ed-radius-block);cursor:pointer;transition:background .1s,box-shadow .1s;' +
            'background:var(--cards-bg);border:1px solid var(--cards-border-color);' +
            'box-shadow:var(--color-shadow-cards);margin-bottom:6px}' +
            '.db-recur-row:hover{background:var(--cards-hover-bg);box-shadow:var(--color-shadow-hover)}' +
            '.db-recur-row--expanded{border-radius:var(--ed-radius-block) var(--ed-radius-block) 0 0;' +
            'margin-bottom:0;border-bottom:1px solid var(--sidebar-border-color);box-shadow:none}' +
            '.db-recur-name{flex:1;min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.db-recur-summary{font-size:12px;opacity:.4;white-space:nowrap;flex-shrink:0}' +
            '.db-recur-summary--unconfigured{color:var(--ed-error-color);opacity:.7}' +
            '.db-recur-row .db-task-source-wrap{min-width:120px;justify-content:flex-end;' +
            'border-left:1px solid var(--sidebar-border-color);padding-left:10px;margin-left:4px}' +
            '.db-recur-edit{background:var(--cards-bg);border:1px solid var(--cards-border-color);' +
            'border-top:none;border-radius:0 0 var(--ed-radius-block) var(--ed-radius-block);' +
            'padding:16px;margin:0 0 6px 0;box-shadow:var(--color-shadow-cards)}' +
            '.db-recur-pills{display:flex;gap:6px;margin-bottom:16px}' +
            '.db-recur-pill{background:none;border:1px solid var(--sidebar-border-color);' +
            'border-radius:var(--ed-radius-pill);cursor:pointer;font-size:12px;font-weight:500;' +
            'padding:4px 12px;color:inherit;opacity:.6;transition:all .1s}' +
            '.db-recur-pill:hover{opacity:1}' +
            '.db-recur-pill--active{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-color);border-color:transparent;opacity:1}' +
            '.db-recur-date-area{margin-bottom:16px}' +
            '.db-recur-days{display:flex;flex-wrap:wrap;gap:6px}' +
            '.db-recur-day-btn{background:none;border:1px solid var(--sidebar-border-color);' +
            'border-radius:var(--ed-radius-normal);cursor:pointer;font-size:12px;font-weight:500;' +
            'padding:5px 10px;color:inherit;opacity:.5;transition:all .1s}' +
            '.db-recur-day-btn:hover{opacity:.9}' +
            '.db-recur-day-btn--active{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-color);border-color:transparent;opacity:1}' +
            '.db-recur-select{background:var(--input-bg-color);border:1px solid var(--input-border-color);' +
            'border-radius:var(--ed-radius-normal);cursor:pointer;font-size:12px;padding:5px 8px;' +
            'color:inherit;outline:none;margin-right:8px}' +
            '.db-recur-actions{display:flex;align-items:center;gap:8px}' +
            '.db-recur-save{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-color);' +
            'border:none;border-radius:var(--ed-radius-normal);cursor:pointer;font-size:12px;font-weight:600;' +
            'padding:6px 16px;transition:background .1s}' +
            '.db-recur-save:hover{background:var(--ed-button-primary-bg-hover)}' +
            '.db-recur-cancel{background:none;border:none;cursor:pointer;font-size:12px;color:inherit;' +
            'opacity:.45;padding:6px 8px;transition:opacity .1s;border-radius:var(--ed-radius-normal)}' +
            '.db-recur-cancel:hover{opacity:.8}' +
            '.db-recur-delete{background:none;border:none;cursor:pointer;font-size:14px;' +
            'color:var(--ed-error-color);opacity:.35;padding:4px 6px;margin-left:auto;' +
            'border-radius:var(--ed-radius-normal);transition:opacity .1s}' +
            '.db-recur-delete:hover{opacity:.8}' +
            '@media(max-width:600px){.db-recur-overlay:not([hidden]){display:block}' +
            '.db-recur-edit{position:fixed;bottom:0;left:0;right:0;border-radius:16px 16px 0 0;border:none;' +
            'border-top:1px solid var(--sidebar-border-color);padding:20px 20px 32px;z-index:200;' +
            'box-shadow:var(--color-shadow-hover);margin:0}}' +
            // [RECURRING-END]
            '.db-task--ignored{opacity:.35}' +
            '.db-icon-hover{display:none}' +
            '.db-ignore:hover .db-icon-default,.db-unignore:hover .db-icon-default{display:none}' +
            '.db-ignore:hover .db-icon-hover,.db-unignore:hover .db-icon-hover{display:inline}' +
            '.db-menu-wrap{position:relative;flex-shrink:0}' +
            '.db-hamburger{background:none;border:none;cursor:pointer;color:inherit;font-size:18px;' +
            'line-height:1;padding:1px 5px;opacity:.3;transition:opacity .15s;border-radius:4px}' +
            '.db-hamburger:hover{opacity:.7}' +
            '.db-dropdown{position:absolute;top:calc(100% + 6px);left:0;background:var(--input-bg-color);' +
            'border:1px solid var(--input-border-color);border-radius:var(--ed-radius-block);padding:4px;' +
            'min-width:180px;z-index:100;box-shadow:0 4px 20px rgba(0,0,0,.35)}' +
            '.db-dropdown-item{display:block;width:100%;text-align:left;background:none;border:none;' +
            'cursor:pointer;color:inherit;font-size:14px;padding:10px 14px;border-radius:var(--ed-radius-normal);transition:background .1s,color .1s}' +
            '.db-dropdown-item:hover{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-text)}' +
            '.db-setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
            'padding:10px 14px;border-radius:var(--ed-radius-block);cursor:pointer;' +
            'background:var(--cards-bg);border:1px solid var(--cards-border-color);' +
            'box-shadow:var(--color-shadow-cards);margin-bottom:4px;transition:background .1s}' +
            '.db-setting-row:hover{background:var(--cards-hover-bg)}' +
            '.db-plan-search{width:100%;box-sizing:border-box;margin-bottom:20px;' +
            'background:var(--input-bg-color);border:1px solid var(--input-border-color);' +
            'border-radius:var(--ed-radius-block);padding:8px 12px;font-size:14px;' +
            'color:inherit;outline:none;transition:border-color .15s}' +
            '.db-plan-search:focus{border-color:var(--ed-link-color)}' +
            '.db-plan-search::placeholder{opacity:.4}' +
            '.db-setting-label{font-size:14px;flex:1}' +
            '.db-setting-toggle{background:none;border:1px solid var(--sidebar-border-color);cursor:pointer;color:inherit;' +
            'font-size:12px;font-weight:500;padding:4px 12px;border-radius:var(--ed-radius-pill);' +
            'opacity:.5;transition:all .1s;white-space:nowrap}' +
            '.db-setting-toggle:hover{opacity:.9}' +
            '.db-setting-toggle--on{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-text);border-color:transparent;opacity:1}' +
            '.db-src-icon{display:inline-flex;align-items:center;justify-content:center}' +
            '.db-empty{font-size:13px;opacity:.3;padding:12px 6px}' +
            '.db-loading{padding:28px;opacity:.35;font-size:14px}' +
            '.db-header{display:flex;align-items:center;padding:24px 0 28px;width:100%;box-sizing:border-box}' +
            '.db-header-left{display:flex;align-items:center;gap:8px;flex:1}' +
            '.db-menu-trigger{display:flex;align-items:center;gap:8px;cursor:pointer}' +
            '.db-header-right{display:flex;align-items:center;justify-content:flex-end;flex:1}' +
            '.db-header-crumb{font-size:16px;opacity:.4;font-weight:500;padding:2px 0}' +
            '.db-header-sep{font-size:16px;opacity:.2;margin:0 4px;padding:2px 0}' +
            '.db-mode-toggle{background:none;border:none;cursor:pointer;color:var(--ed-link-color);' +
            'font-size:14px;padding:2px 0;transition:color .15s}' +
            '.db-mode-toggle:hover{color:var(--ed-link-hover-color)}' +
            '' +
            '.db-block{display:flex;border-radius:var(--ed-radius-block);cursor:pointer;' +
            'transition:background .1s,box-shadow .1s;min-height:52px;margin-bottom:6px;' +
            'background:var(--cards-bg);border:1px solid var(--cards-border-color);box-shadow:var(--color-shadow-cards)}' +
            '.db-block:hover{background:var(--cards-hover-bg);box-shadow:var(--color-shadow-hover)}' +
            '.db-block--selected{background:var(--cards-hover-bg);box-shadow:0 0 0 2px var(--ed-link-color),var(--color-shadow-cards)}' +
            '.db-block-time{flex-shrink:0;align-self:flex-start;min-width:190px;padding:3px 0 4px}' +
            '.db-block-time-inner{display:flex;align-items:center;gap:6px;font-size:13px;opacity:.4;' +
            'padding:5px 6px;min-height:30px}' +
            '.db-block-label{width:120px;flex-shrink:0;white-space:nowrap}' +
            '.db-block-clock{font-variant-numeric:tabular-nums;flex-shrink:0}' +
            '.db-block-body{flex:1;min-width:0;padding:4px 8px 8px 12px}' +
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
            '.db-root{padding:12px 0;max-width:100%}' +
            '.db-header{padding:10px 0 16px}' +
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

        this.plugin.events.on('lineitem.updated', () => this._scheduleRefresh());
        this.plugin.events.on('lineitem.created', () => this._scheduleRefresh());
        this.plugin.events.on('lineitem.deleted', () => this._scheduleRefresh());


        this._prefetch();
    }

    _patchTask(guid, propsUpdate) {
        if (!this._lastData) return;
        for (const key of ['todoResult', 'doneResult']) {
            const line = (this._lastData[key]?.lines || []).find(l => l.guid === guid);
            if (line) { if (!line.props) line.props = {}; Object.assign(line.props, propsUpdate); return; }
        }
    }

    _moveToDone(guid, doneDate) {
        if (!this._lastData) return;
        const lines = this._lastData.todoResult?.lines || [];
        const idx = lines.findIndex(l => l.guid === guid);
        if (idx === -1) return;
        const task = lines.splice(idx, 1)[0];
        if (!task.props) task.props = {};
        task.props['db-done-date'] = doneDate;
        this._lastData.doneResult.lines.unshift(task);
        this._doneTasksMap.set(guid, task);
    }

    _moveToTodo(guid) {
        if (!this._lastData) return;
        const lines = this._lastData.doneResult?.lines || [];
        const idx = lines.findIndex(l => l.guid === guid);
        if (idx === -1) return;
        const task = lines.splice(idx, 1)[0];
        if (task.props) task.props['db-done-date'] = null;
        this._lastData.todoResult.lines.unshift(task);
        this._doneTasksMap.delete(guid);
    }

    async _prefetch() {
        if (this._prefetchInFlight) return;
        this._prefetchInFlight = true;
        try {
            const [todoResult, scheduledResult, overdueResult, dueResult, doneResult] = await Promise.all([
                this.plugin.data.searchByQuery('@task @todo',    150),
                this.plugin.data.searchByQuery('@task @today',  100),
                this.plugin.data.searchByQuery('@task @overdue',  50),
                this.plugin.data.searchByQuery('@task @due',    100),
                this.plugin.data.searchByQuery('@task @done',   100),
            ]);
            this._lastData = { todoResult, scheduledResult, overdueResult, dueResult, doneResult };
        } catch (e) {
            console.warn('[Dashboard] prefetch failed:', e);
        } finally {
            this._prefetchInFlight = false;
        }
    }

    _scheduleRefresh() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        if (this._panel) this._prefetch();
        else this._lastData = null;
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            if (!this._panel) return;
            const el = this._panel.getElement();
            if (el?.isConnected && el.querySelector('.db-root, .db-loading')) {
                this._render(this._panel, false);
            }
        }, 800);
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

        const data = this._lastData;

        if (!el.querySelector('.db-root') && !data) {
            el.innerHTML = '<div class="db-loading">Loading tasks…</div>';
        }

        const today          = this._todayStr();
        const viewDate       = this._viewDateStr();
        const viewDateHyphen = `${viewDate.slice(0,4)}-${viewDate.slice(4,6)}-${viewDate.slice(6,8)}`;
        const isViewingToday = viewDate === this._todayD();

        let todoResult, scheduledResult, overdueResult, dueResult, doneLinesAll = [];

        if (data) {
            todoResult      = data.todoResult;
            scheduledResult = data.scheduledResult;
            overdueResult   = (this._mode === 'focus' || this._mode === 'ignore-list') ? { lines: [] } : data.overdueResult;
            dueResult       = (this._mode === 'focus' || this._mode === 'ignore-list') ? { lines: [] } : data.dueResult;
            if (this._mode !== 'recurring-list' && this._mode !== 'ignore-list') {
                doneLinesAll = (data.doneResult?.lines || []).filter(l => l.type === 'task');
            }
        } else {
            let doneResult = { lines: [] };
            try {
                [todoResult, scheduledResult, overdueResult, dueResult, doneResult] = await Promise.all([
                    this.plugin.data.searchByQuery('@task @todo',     150),
                    this.plugin.data.searchByQuery('@task @today',   100),
                    this.plugin.data.searchByQuery('@task @overdue',  50),
                    this.plugin.data.searchByQuery('@task @due',     100),
                    this.plugin.data.searchByQuery('@task @done',    100),
                ]);
            } catch (e) {
                console.warn('[Dashboard] fetch failed:', e);
                todoResult = scheduledResult = overdueResult = dueResult = { lines: [] };
            }
            doneLinesAll = (doneResult.lines || []).filter(l => l.type === 'task');
            this._lastData = { todoResult, scheduledResult, overdueResult, dueResult, doneResult };
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
        const viewPinned     = allTodos.filter(l => {
            if (l.props?.['db-pinned'] === viewDateHyphen) return true;
            const seg = (l.segments || []).find(s => s.type === 'datetime');
            if (seg?.text?.d !== viewDate) return false;
            // [RECURRING-START] exclude recurring tasks already completed on this date or rescheduled away
            const recurDone = l.props?.['db-recurring-done-dates'];
            if (recurDone?.split(',').includes(viewDate)) return false;
            if (this._completedRecurringDates[l.guid]?.split(',').includes(viewDate)) return false;
            const rescheduled = this._rescheduledRecurring[l.guid];
            if (rescheduled && rescheduled > viewDate) return false;
            // [RECURRING-END]
            return true;
        });
        const viewPinnedSet  = new Set(viewPinned.map(l => l.guid));

        // Time blocks — date-stamped format "YYYYMMDD:HH:MM", only show for the viewed date
        const timeBlocks = {};
        for (const t of [...allTodos, ...doneTasks]) {
            const parsed = this._parseTimeblock(t.props?.['db-timeblock']);
            if (parsed && parsed.date === viewDate) timeBlocks[t.guid] = parsed.time;
        }

        const planOverdue = [], todayPinned = [], scheduled = [], inbox = [], planInbox = [];
        for (const l of allTodos) {
            const isOverdue   = overdueGuids.has(l.guid);
            const isPinned    = todaySet.has(l.guid);
            const isScheduled = scheduledGuids.has(l.guid);
            const isDated     = datedGuids.has(l.guid);
            const hasPinProp  = !!l.props?.['db-pinned'];
            // [RECURRING-START] don't show recurring tasks already completed or rescheduled away from today
            const recurDone   = l.props?.['db-recurring-done-dates'];
            const isRecurringCompleted = !!(
                recurDone?.split(',').includes(viewDate) ||
                this._completedRecurringDates[l.guid]?.split(',').includes(viewDate)
            );
            const rescheduledStart = this._rescheduledRecurring[l.guid];
            const isRescheduledAway = !!(rescheduledStart && rescheduledStart > viewDate);
            // [RECURRING-END]
            if (isOverdue && !isPinned)                                                              planOverdue.push(l);
            if (isPinned    && !isRecurringCompleted && !isRescheduledAway)                          todayPinned.push(l);
            if (isScheduled && !isPinned && !isOverdue && !isRecurringCompleted && !isRescheduledAway) scheduled.push(l);
            if (!isDated && !isPinned && !isScheduled && !isOverdue)                inbox.push(l);
            if (!isDated && !hasPinProp && !isScheduled && !isOverdue)              planInbox.push(l);
        }

        const hasAnyTasks = todayPinned.length > 0 || scheduled.length > 0 || doneTasks.length > 0;
        const effectiveMode = this._mode === 'ignore-list' ? 'ignore-list'
            : this._mode === 'recurring-list' ? 'recurring-list'
            : this._mode === 'settings' ? 'settings'
            : (this._mode === 'plan' || (!hasAnyTasks && this._mode !== 'focus')) ? 'plan'
            : 'focus';

        // [RECURRING-START] unconfigured count, future preview, past ghost traces
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
        const recurringDoneGhosts = viewDate <= this._todayD()
            ? allTodos.filter(t => {
                if (!t.props?.['db-recurring-freq']) return false;
                if (viewPinnedSet.has(t.guid)) return false;
                const dates = t.props?.['db-recurring-done-dates'];
                if (dates?.split(',').includes(viewDate)) return true;
                // Fallback: in-memory record bridges the gap before _lastData refreshes
                return this._completedRecurringDates[t.guid]?.split(',').includes(viewDate) ?? false;
              })
            : [];
        const recurringMissedGhosts = viewDate < this._todayD()
            ? allTodos.filter(t => {
                if (!t.props?.['db-recurring-freq']) return false;
                const start = t.props?.['db-recurring-start'];
                if (!start || viewDate < start) return false; // no history before schedule was set
                if (viewPinnedSet.has(t.guid)) return false;
                if (!this._wouldRecurOn(t, viewDate)) return false;
                const dates = t.props?.['db-recurring-done-dates'];
                return !dates?.split(',').includes(viewDate);
              })
            : [];
        // [RECURRING-END]

        const allTasks = [...allTodos, ...doneTasks];

        el.innerHTML = effectiveMode === 'ignore-list'
            ? this._buildIgnoreListHTML(allTodos, ignoredTasks)
            : effectiveMode === 'recurring-list'
                ? this._buildRecurringHTML(allTodosRaw.filter(l => l.props?.['db-recurring-freq']))
                : effectiveMode === 'settings'
                    ? this._buildSettingsHTML()
                    : effectiveMode === 'focus'
                        ? this._buildFocusHTML(todayPinned, scheduled, this._settings.hideDoneInFocus ? [] : doneTasks, timeBlocks, allTasks, viewPinned, recurringPreview, recurringDoneGhosts, recurringMissedGhosts)
                        : this._buildPlanHTML(planOverdue, viewPinned, planInbox, ignoredTasks.length, unconfiguredRecurring, this._hideRecurring, recurringPreview);

        this._applyTheme(el);
        if (this._listenerAbort) this._listenerAbort.abort();
        this._listenerAbort = new AbortController();
        this._attachListeners(el, allTasks, ignoredTasks, this._listenerAbort.signal);
        this._reapplySelection(el);
    }

    _menuHTML(crumb) {
        return `<div class="db-menu-wrap">
            <div class="db-menu-trigger">
                <button class="db-hamburger"><i class="ti ti-menu-2"></i></button>
                <span class="db-header-crumb">${crumb}</span>
                <span class="db-header-sep">/</span>
            </div>
            <div class="db-dropdown" hidden>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="focus">Focus</button>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="plan">Plan</button>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="recurring-list">Recurring tasks</button>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="ignore-list">Ignore list</button>
                <button class="db-dropdown-item" data-action="set-mode" data-mode="settings">Settings</button>
            </div>
        </div>`;
    }

    _buildFocusHTML(today, scheduled, doneTasks, timeBlocks, allTasks, viewPinned, recurringPreview = [], recurringDoneGhosts = [], recurringMissedGhosts = []) {
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
                    ${this._menuHTML('Focus')}
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
            ${(unassigned.length || unassignedDone.length || recurringDoneGhosts.length || recurringMissedGhosts.length) ? `
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
                        ${recurringDoneGhosts.map(t => this._taskRow(t, 'recurring-done')).join('')}
                        ${recurringMissedGhosts.map(t => this._taskRow(t, 'recurring-missed')).join('')}
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
                    ${this._menuHTML('Plan')}
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
            <input class="db-plan-search" type="text" placeholder="Search tasks…" value="${this._escape(this._planSearch)}">
            ${this._section('Overdue',  overdue,  'overdue')}
            ${this._sectionMixed(focusTitle, today, 'today', recurringPreview, 'recurring-preview')}
            ${recurringNotice}
            ${this._section('Inbox',    visInbox, 'inbox', toggleBtn)}
        </div>`;
    }

    _buildIgnoreListHTML(activeTasks, ignoredTasks) {
        return `<div class="db-header">
                <div class="db-header-left">
                    ${this._menuHTML('Ignore list')}
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

    _buildSettingsHTML() {
        const row = (label, key) => {
            const on = !!this._settings[key];
            return `<div class="db-setting-row" data-action="toggle-setting" data-setting="${key}">
                <span class="db-setting-label">${label}</span>
                <button class="db-setting-toggle${on ? ' db-setting-toggle--on' : ''}" tabindex="-1">${on ? 'On' : 'Off'}</button>
            </div>`;
        };
        return `<div class="db-header">
                <div class="db-header-left">
                    ${this._menuHTML('Settings')}
                </div>
                <div class="db-header-right">
                    <button class="db-mode-toggle" data-action="set-mode" data-mode="focus">← Focus</button>
                </div>
            </div>
            <div class="db-root">
                <div class="db-section">
                    <div class="db-section-header">
                        <span class="db-section-title">Focus</span>
                    </div>
                    ${row('Hide completed tasks', 'hideDoneInFocus')}
                </div>
                <div class="db-section">
                    <div class="db-section-header">
                        <span class="db-section-title">Journal</span>
                    </div>
                    ${row('Add transclusion to journal when completing a task', 'journalTransclusions')}
                </div>
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

        return `<div class="db-recur-overlay"${this._expandedRecurring ? '' : ' hidden'} data-action="cancel-recurring"></div>
            <div class="db-header">
                <div class="db-header-left">
                    ${this._menuHTML('Recurring tasks')}
                </div>
                <div class="db-header-right">
                    <button class="db-mode-toggle" data-action="set-mode" data-mode="focus">← Focus</button>
                </div>
            </div>
            <div class="db-root">
                ${sections}
            </div>`;
    }

    _recurringTaskRow(task) {
        const text = this._escape(this._getText(task));
        const source = this._escape(task.record?.getName() || '');
        const sourceHTML = source
            ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-src-icon db-nav" title="Open source"><i class="ti ti-arrow-up-right"></i></button></span>`
            : '';
        const freq = task.props?.['db-recurring-freq'];
        const day  = task.props?.['db-recurring-day'] || null;
        const summary = this._recurSummary(freq, day);
        const summaryHTML = summary
            ? `<span class="db-recur-summary">${this._escape(summary)}</span>`
            : `<span class="db-recur-summary db-recur-summary--unconfigured">Configure</span>`;
        const isExpanded = this._expandedRecurring === task.guid;
        const row = `<div class="db-recur-row${isExpanded ? ' db-recur-row--expanded' : ''}" data-action="${isExpanded ? 'cancel-recurring' : 'expand-recurring'}" data-guid="${task.guid}">
            <span class="db-recur-name">${text}</span>
            ${summaryHTML}
            ${sourceHTML}
        </div>`;
        if (isExpanded) {
            const draft = this._recurringDraft || { freq, day };
            return row + this._recurringEditPanel(task.guid, draft.freq, draft.day);
        }
        return row;
    }

    // [RECURRING-START] recurring UI helpers — remove when Thymer ships native recurring
    _recurSummary(freq, day) {
        if (freq === 'daily') return 'Every day';
        if (freq === 'weekly') {
            if (!day) return null;
            return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][parseInt(day) - 1] || null;
        }
        if (freq === 'monthly') {
            return day ? `Day ${parseInt(day)}` : null;
        }
        if (freq === 'yearly') {
            if (!day) return null;
            const [mm, dd] = day.split('-').map(Number);
            return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mm - 1]}`;
        }
        return null;
    }

    _recurringEditPanel(guid, draftFreq, draftDay) {
        const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
        const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
        const pills = FREQS.map(f =>
            `<button class="db-recur-pill${draftFreq === f ? ' db-recur-pill--active' : ''}" data-action="draft-freq" data-guid="${guid}" data-freq="${f}">${FREQ_LABEL[f]}</button>`
        ).join('');
        let dateArea = '';
        if (draftFreq === 'weekly') {
            const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
            const active = draftDay ? parseInt(draftDay) : null;
            dateArea = `<div class="db-recur-days">${DAYS.map((label, i) => {
                const iso = i + 1;
                return `<button class="db-recur-day-btn${active === iso ? ' db-recur-day-btn--active' : ''}" data-action="draft-day" data-guid="${guid}" data-day="${iso}">${label}</button>`;
            }).join('')}</div>`;
        } else if (draftFreq === 'monthly') {
            const activeDay = draftDay ? parseInt(draftDay) : 0;
            const options = Array.from({length: 31}, (_, i) => i + 1)
                .map(d => `<option value="${d}"${activeDay === d ? ' selected' : ''}>${d}</option>`).join('');
            dateArea = `<select class="db-recur-select db-recur-month-day" data-guid="${guid}">${!activeDay ? '<option value="" disabled selected>Day of month</option>' : ''}${options}</select>`;
        } else if (draftFreq === 'yearly') {
            const [mm, dd] = draftDay ? draftDay.split('-').map(Number) : [0, 0];
            const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const mOpts = MONTHS.map((m, i) => `<option value="${i+1}"${mm === i+1 ? ' selected' : ''}>${m}</option>`).join('');
            const dOpts = Array.from({length: 31}, (_, i) => i + 1)
                .map(d => `<option value="${d}"${dd === d ? ' selected' : ''}>${d}</option>`).join('');
            dateArea = `<select class="db-recur-select db-recur-year-month" data-guid="${guid}">${!mm ? '<option value="" disabled selected>Month</option>' : ''}${mOpts}</select><select class="db-recur-select db-recur-year-day" data-guid="${guid}">${!dd ? '<option value="" disabled selected>Day</option>' : ''}${dOpts}</select>`;
        }
        return `<div class="db-recur-edit">
            <div class="db-recur-pills">${pills}</div>
            ${dateArea ? `<div class="db-recur-date-area">${dateArea}</div>` : ''}
            <div class="db-recur-actions">
                <button class="db-recur-save" data-action="save-recurring" data-guid="${guid}">Save</button>
                <button class="db-recur-cancel" data-action="cancel-recurring">Cancel</button>
                <button class="db-recur-delete" data-action="remove-recurring" data-guid="${guid}" title="Remove recurring"><i class="ti ti-trash"></i></button>
            </div>
        </div>`;
    }
    // [RECURRING-END]

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
        const disabledDoneBtn = `<div class="db-done line-check-div" style="cursor:default" data-guid="${task.guid}"></div>`;
        // [RECURRING-START] freq button — remove when Thymer ships native recurring
        const freq       = task.props?.['db-recurring-freq'];
        const recurToggle = freq
            ? `<button class="db-recurring-btn db-recurring-btn--active" data-action="remove-recurring" data-guid="${task.guid}" title="Remove recurring"><i class="ti ti-repeat"></i></button>`
            : `<button class="db-recurring-btn" data-action="enable-recurring" data-guid="${task.guid}" title="Set as recurring"><i class="ti ti-repeat"></i></button>`;
        // [RECURRING-END]

        if (section === 'recurring-preview') {
            return `<div class="db-task listitem-task db-task--recurring-preview" data-guid="${task.guid}">
                <div class="db-done line-check-div" style="opacity:.25;cursor:default" data-guid="${task.guid}"></div>
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                </div>
                ${sourceHTML}
            </div>`;
        }

        // [RECURRING-START] ghost traces for past/today views
        if (section === 'recurring-done') {
            return `<div class="db-task listitem-task state-done db-task--recurring-done" data-guid="${task.guid}">
                <div class="db-done line-check-div" style="opacity:.5;cursor:default" data-guid="${task.guid}"></div>
                <span class="db-task-text--sel">${text}</span>
                ${sourceHTML}
            </div>`;
        }

        if (section === 'recurring-missed') {
            return `<div class="db-task listitem-task db-task--recurring-missed" data-guid="${task.guid}">
                <div class="db-done line-check-div" style="opacity:.15;cursor:default" data-guid="${task.guid}"></div>
                <div class="db-task-body">
                    <span class="db-task-text" style="opacity:.4">${text}</span>
                </div>
                ${sourceHTML}
            </div>`;
        }
        // [RECURRING-END]

        if (isPast) {
            const isDone = section === 'done';
            return `<div class="db-task listitem-task${isDone ? ' state-done' : ''}" data-guid="${task.guid}">
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
            const unpinBtn = task.props?.['db-pinned']
                ? `<button class="db-unpin" data-action="unpin" data-guid="${task.guid}" title="Remove from Today">×</button>`
                : '';
            return `<div class="db-task listitem-task" data-guid="${task.guid}">
                ${doneBtn}
                <div class="db-task-body">
                    <span class="db-task-text">${text}</span>
                </div>
                ${sourceHTML}
                ${recurToggle}<!-- [RECURRING] -->
                ${unpinBtn}
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

        const searchInput = el.querySelector('.db-plan-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this._planSearch = searchInput.value;
                const term = this._planSearch.toLowerCase().trim();
                const searchableSections = el.querySelectorAll('.db-section--overdue, .db-section--inbox');
                for (const section of searchableSections) {
                    let visibleCount = 0;
                    for (const row of section.querySelectorAll('.db-task')) {
                        const text = row.textContent.toLowerCase();
                        const match = !term || text.includes(term);
                        row.style.display = match ? '' : 'none';
                        if (match) visibleCount++;
                    }
                    section.style.display = term.length > 0 && visibleCount === 0 ? 'none' : '';
                }
            }, { signal });
        }

        const trigger = el.querySelector('.db-menu-trigger');
        const drop    = el.querySelector('.db-dropdown');
        if (trigger && drop) {
            trigger.addEventListener('click', e => {
                e.stopPropagation();
                drop.hidden = !drop.hidden;
                if (!drop.hidden) document.addEventListener('click', () => { drop.hidden = true; }, { once: true });
            }, { signal });
        }

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
                    const isRecurring = !!task.props?.['db-recurring-freq'];
                    if (isRecurring) {
                        // [RECURRING-START] recurring done — ghost trace, advance date, stay as todo
                        const freq     = task.props['db-recurring-freq'];
                        const day      = task.props?.['db-recurring-day'] || null;
                        const nextDate = this._nextRecurringDate(freq, day);
                        const doneDate = this._todayD();
                        const existing = task.props?.['db-recurring-done-dates'] || '';
                        const newDoneDates = existing ? existing + ',' + doneDate : doneDate;
                        this._completedRecurringDates[task.guid] = newDoneDates; // persist across _lastData refreshes
                        const newSegments  = [
                            ...(task.segments || []).filter(s => s.type !== 'datetime'),
                            { type: 'datetime', text: { d: nextDate.replace(/-/g, '') } },
                        ];
                        // Optimistic patch — reflect final state immediately so any intermediate
                        // event-triggered refresh doesn't bring the task back into today's view
                        const lines = this._lastData?.todoResult?.lines;
                        const cachedTask = lines?.find(l => l.guid === task.guid);
                        if (cachedTask) {
                            if (!cachedTask.props) cachedTask.props = {};
                            cachedTask.props['db-pinned']                = null;
                            cachedTask.props['db-recurring-done-dates']  = newDoneDates;
                            cachedTask.segments                          = newSegments;
                        }
                        if (this._panel) this._render(this._panel);
                        try {
                            await task.setMetaProperty('db-pinned', null);
                            await task.setMetaProperty('db-recurring-done-dates', newDoneDates);
                            await task.setSegments(newSegments);
                        } catch (err) {
                            console.error('[Dashboard] recurring done failed:', err);
                            this._scheduleRefresh();
                        }
                        // [RECURRING-END]
                    } else {
                        this._moveToDone(task.guid, today);
                        if (this._panel) this._render(this._panel);
                        try {
                            await task.setTaskStatus('done');
                            await task.setMetaProperty('db-done-date', today);
                            if (this._settings.journalTransclusions !== false) {
                                const journal = await this._journalRecord();
                                if (journal) await journal.createLineItem(null, null, 'ref', null, { itemref: task.guid });
                            }
                        } catch (err) {
                            console.error('[Dashboard] done failed:', err);
                            this._moveToTodo(task.guid);
                            if (this._panel) this._render(this._panel);
                        }
                    }
                    break;
                }
                case 'undone': {
                    if (!task) return;
                    this._moveToTodo(task.guid);
                    if (this._panel) this._render(this._panel);
                    try {
                        await task.setTaskStatus('none');
                        await task.setMetaProperty('db-done-date', null);
                    } catch (err) {
                        console.error('[Dashboard] undone failed:', err);
                        this._moveToDone(task.guid, today);
                        if (this._panel) this._render(this._panel);
                    }
                    break;
                }
                case 'pin': {
                    if (!task) return;
                    const pinDate = this._viewDateHyphen();
                    this._patchTask(task.guid, { 'db-pinned': pinDate });
                    this._mode = 'plan';
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-pinned', pinDate);
                    break;
                }
                case 'unpin': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-pinned': null });
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-pinned', null);
                    break;
                }
                case 'unassign': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-timeblock': null });
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-timeblock', null);
                    break;
                }
                case 'select-task': {
                    if (this._selected?.type === 'block') {
                        const time = this._selected.id;
                        this._selected = null;
                        if (task) {
                            const tb = this._viewDateStr() + ':' + time;
                            this._patchTask(task.guid, { 'db-timeblock': tb });
                            if (this._panel) this._render(this._panel);
                            task.setMetaProperty('db-timeblock', tb);
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
                            const tb = this._viewDateStr() + ':' + time;
                            this._patchTask(blockTask.guid, { 'db-timeblock': tb });
                            if (this._panel) this._render(this._panel);
                            blockTask.setMetaProperty('db-timeblock', tb);
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
                case 'ignore': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-ignored': 'true' });
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-ignored', 'true');
                    break;
                }
                case 'unignore': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-ignored': null });
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-ignored', null);
                    break;
                }
                // [RECURRING-START] recurring view interactions — remove when Thymer ships native recurring
                case 'expand-recurring': {
                    if (!task) return;
                    this._expandedRecurring = guid;
                    this._recurringDraft = {
                        freq: task.props?.['db-recurring-freq'] || 'daily',
                        day:  task.props?.['db-recurring-day']  || null,
                    };
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'draft-freq': {
                    if (!this._recurringDraft) return;
                    this._recurringDraft.freq = target.dataset.freq;
                    this._recurringDraft.day  = null;
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'draft-day': {
                    if (!this._recurringDraft) return;
                    this._recurringDraft.day = target.dataset.day;
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'save-recurring': {
                    if (!task || !this._recurringDraft) return;
                    const { freq, day } = this._recurringDraft;
                    const nextDate  = this._nextUpcomingDate(freq, day || null);
                    const startDate = nextDate.replace(/-/g, '');
                    const newSegs   = [
                        ...(task.segments || []).filter(s => s.type !== 'datetime'),
                        { type: 'datetime', text: { d: startDate } },
                    ];
                    this._patchTask(task.guid, { 'db-recurring-freq': freq, 'db-recurring-day': day || null, 'db-recurring-start': startDate });
                    if (startDate > this._todayD()) this._rescheduledRecurring[task.guid] = startDate;
                    // Patch segments and remove from scheduledResult if new date is not today
                    const cachedLine = (this._lastData?.todoResult?.lines || []).find(l => l.guid === task.guid);
                    if (cachedLine) cachedLine.segments = newSegs;
                    if (startDate !== this._todayD() && this._lastData?.scheduledResult?.lines) {
                        const idx = this._lastData.scheduledResult.lines.findIndex(l => l.guid === task.guid);
                        if (idx !== -1) this._lastData.scheduledResult.lines.splice(idx, 1);
                    }
                    this._expandedRecurring = null;
                    this._recurringDraft = null;
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-recurring-freq', freq);
                    task.setMetaProperty('db-recurring-day', day || null);
                    task.setMetaProperty('db-recurring-start', startDate);
                    task.setSegments(newSegs);
                    break;
                }
                case 'cancel-recurring': {
                    this._expandedRecurring = null;
                    this._recurringDraft = null;
                    if (this._panel) this._render(this._panel);
                    break;
                }
                // [RECURRING-END]
                // [RECURRING-START] enable toggle — remove when Thymer ships native recurring
                case 'enable-recurring': {
                    if (!task) return;
                    const recPinDate  = this._viewDateHyphen();
                    const recStartDate = recPinDate.replace(/-/g, '');
                    this._patchTask(task.guid, { 'db-recurring-freq': 'daily', 'db-recurring-start': recStartDate });
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-recurring-freq', 'daily');
                    task.setMetaProperty('db-recurring-start', recStartDate);
                    task.setSegments([
                        ...(task.segments || []).filter(s => s.type !== 'datetime'),
                        { type: 'datetime', text: { d: recStartDate } },
                    ]);
                    break;
                }
                // [RECURRING-END]
                case 'remove-recurring': {
                    if (!task) return;
                    this._expandedRecurring = null; // [RECURRING]
                    this._recurringDraft    = null; // [RECURRING]
                    this._patchTask(task.guid, { 'db-recurring-freq': null, 'db-recurring-day': null });
                    if (this._panel) this._render(this._panel);
                    task.setMetaProperty('db-recurring-freq', null);
                    task.setMetaProperty('db-recurring-day',  null);
                    break;
                }
                // [RECURRING] toggle-recurring-filter — remove when Thymer ships native recurring
                case 'toggle-setting': {
                    const key = target.dataset.setting;
                    if (key) {
                        this._settings[key] = !this._settings[key];
                        const on = !!this._settings[key];
                        const btn = target.querySelector('.db-setting-toggle');
                        if (btn) {
                            btn.textContent = on ? 'On' : 'Off';
                            btn.classList.toggle('db-setting-toggle--on', on);
                        }
                        this._saveSettings();
                    }
                    break;
                }
                case 'toggle-recurring-filter': {
                    this._hideRecurring = !this._hideRecurring;
                    if (this._panel) this._render(this._panel);
                    break;
                }
                case 'set-mode': {
                    this._mode = target.dataset.mode;
                    this._expandedRecurring = null; // [RECURRING]
                    this._recurringDraft    = null; // [RECURRING]
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

        el.addEventListener('change', e => {
            const t = e.target;
            // [RECURRING-START] draft day selects — remove when Thymer ships native recurring
            if (t.matches('.db-recur-month-day')) {
                if (this._recurringDraft) this._recurringDraft.day = t.value;
                return;
            }
            if (t.matches('.db-recur-year-month, .db-recur-year-day')) {
                if (!this._recurringDraft) return;
                const edit = t.closest('.db-recur-edit');
                const mm = edit?.querySelector('.db-recur-year-month')?.value;
                const dd = edit?.querySelector('.db-recur-year-day')?.value;
                if (mm && dd) this._recurringDraft.day = `${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
                return;
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
                d.setDate(1);
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

    // [RECURRING-END]

    async _journalRecord() {
        if (!this._journalCollection) {
            const collections = await this.plugin.data.getAllCollections();
            this._journalCollection = collections.find(c => c.isJournalPlugin()) || null;
        }
        if (!this._journalCollection) return null;
        const user = this.plugin.data.getActiveUsers()[0];
        if (!user) return null;
        try {
            return await this._journalCollection.getJournalRecord(user);
        } catch (e) {
            return null;
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
