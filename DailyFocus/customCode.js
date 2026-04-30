const SLOTS = [
    { time: '08:00', label: 'Early morning' },
{ time: '10:00', label: 'Morning' },
{ time: '12:00', label: 'Midday' },
{ time: '14:00', label: 'Early afternoon' },
{ time: '16:00', label: 'Afternoon' },
{ time: '18:00', label: 'The close' },
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
        this._taskSheet      = null;
        this._taskSheetSlot  = null;
        this._doneTasksMap   = new Map();
        this._viewDate       = null;
        this._hideUndated    = false;
        this._hideUpcoming   = true;
        this._overdueCollapsed = false;
        this._listenerAbort  = null;
        this._todayCache     = null;
        this._lastData           = null;
        this._prefetchInFlight   = false;
        this._peekOverlay        = null;
        this._peekPanel          = null;
        this._peekMode           = 'focus';
        // [RECURRING-START] draft state for recurring task UI — remove when Thymer ships native recurring
        this._expandedRecurring       = null;
        this._recurringDraft          = null;
        this._recurringSheetAnimate   = false;
        this._completedRecurringDates = {}; // guid → comma-separated YYYYMMDD, persists across _lastData refreshes
        this._rescheduledRecurring    = {}; // guid → YYYYMMDD start date when rescheduled to future
        // [RECURRING-END]
        try { this._settings = { ...((plugin.getConfiguration()?.settings) || {}) }; }
        catch (e) { this._settings = {}; }
        this._planSearch = '';
        this._wipeState  = null;
    }

    async _fetchTaskData() {
        const [todoResult, scheduledResult, overdueResult, dueResult, doneResult] = await Promise.all([
            this.plugin.data.searchByQuery('@task @todo',    150),
            this.plugin.data.searchByQuery('@task @today',   100),
            this.plugin.data.searchByQuery('@task @overdue',  50),
            this.plugin.data.searchByQuery('@task @due',     100),
            this.plugin.data.searchByQuery('@task @done',    100),
        ]);
        return { todoResult, scheduledResult, overdueResult, dueResult, doneResult };
    }

    _scheduleTrashRefresh(ev) {
        if (ev?.trashed === null || ev?.trashed === undefined) return;
        this._lastData = null;
        this._scheduleRefresh();
    }

    async _wipePluginMetadata() {
        const DB_KEYS = [
            'db-pinned', 'db-timeblock', 'db-recurring-freq', 'db-recurring-day',
            'db-recurring-done-dates', 'db-recurring-start', 'db-recurring-next',
            'db-ignored', 'db-done-date',
        ];
        try {
            const [todos, done] = await Promise.all([
                this.plugin.data.searchByQuery('@task @todo', 1000),
                                                    this.plugin.data.searchByQuery('@task @done', 1000),
            ]);
            const allTasks = [...(todos?.lines || []), ...(done?.lines || [])];
            for (const task of allTasks) {
                if (!DB_KEYS.some(k => task.props?.[k] != null)) continue;
                if (task.props?.['db-recurring-freq'] != null) {
                    const cleanSegs = this._stripDateSegments(task.segments);
                    if (cleanSegs.length !== (task.segments || []).length) {
                        await task.setSegments(cleanSegs);
                    }
                }
                for (const key of DB_KEYS) {
                    if (task.props?.[key] != null) await task.setMetaProperty(key, null);
                }
            }
            const pluginApi = this.plugin.data.getPluginByGuid(this.plugin.getGuid());
            if (pluginApi) {
                const config = pluginApi.getConfiguration() ?? {};
                delete config.settings;
                await pluginApi.saveConfiguration(config);
            }
            this._settings  = {};
            this._lastData  = null;
            this._wipeState = 'done';
        } catch (e) {
            console.error('[DailyFocus] wipe failed:', e);
            this._wipeState = 'done';
        }
        if (this._panel) this._render(this._panel);
    }

    async _saveSettings() {
        const pluginApi = this.plugin.data.getPluginByGuid(this.plugin.getGuid());
        if (!pluginApi) return;
        const config = pluginApi.getConfiguration() ?? {};
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

    _makeDateSegment(yyyymmdd) {
        const dt = DateTime.dateOnly(+yyyymmdd.slice(0,4), +yyyymmdd.slice(4,6) - 1, +yyyymmdd.slice(6,8));
        return { type: 'datetime', text: dt.value() };
    }

    _stripDateSegments(segments) {
        return (segments || []).filter(s => s.type !== 'datetime' && !(s.type === 'text' && !s.text?.trim()));
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
            '.db-section{margin-bottom:28px}' +
            '.db-section-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;' +
            'padding-bottom:6px;border-bottom:1px solid var(--sidebar-border-color)}' +
            '.db-section-title{font-size:13px;font-weight:600;opacity:.55}' +
            '.db-count{font-size:11px;font-weight:600;opacity:.4}' +
            '.db-section-toggle{margin-left:auto;background:none;border:none;cursor:pointer;color:inherit;' +
            'font-size:15px;line-height:1;padding:1px 4px;border-radius:4px;opacity:.35;transition:opacity .15s}' +
            '.db-section-toggle:hover{opacity:.65}' +
            '.db-task,.db-recur-edit,.db-setting-row,.db-settings-note,.db-block,.db-sheet-slot,.db-wipe-confirm{' +
            'background:var(--cards-bg);border:1px solid var(--ed-container-border-color);box-shadow:none}' +
            '.db-task{display:flex;align-items:center;gap:8px;padding:6px 8px;min-height:36px;' +
            'box-sizing:border-box;border-radius:var(--ed-radius-normal);transition:background .1s,border-color .1s;' +
            'margin-bottom:3px}' +
            '.db-task:hover{background:var(--cards-hover-bg);box-shadow:none}' +
            '.db-task:focus-visible,.db-btn:focus-visible,.db-icon-btn:focus-visible,.db-hamburger:focus-visible,.db-recur-remove:focus-visible,' +
            '.db-inline-slot:focus-visible,.db-sheet-slot:focus-visible,.db-day-nav-btn:focus-visible,.db-day-nav-label:focus-visible,.db-mode-toggle:focus-visible{' +
            'outline:1px solid var(--ed-link-color);outline-offset:2px}' +
            '.db-done{flex-shrink:0;cursor:pointer;align-self:center;margin-top:0!important;margin-right:0!important}' +
            '.db-task.state-done .db-task-text,.db-task.state-done .db-task-text--sel{text-decoration:line-through;opacity:.4}' +
            '.db-task.state-done .db-task-source--link{opacity:.2}' +
            '.db-task.state-done .db-date-chip{opacity:.35}' +
            '.db-task-body{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;cursor:pointer;line-height:1.35}' +
            '.db-task-text{min-width:0;font-size:14px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.db-task-text--sel{min-width:0;font-size:14px;line-height:1.35;white-space:nowrap;overflow:hidden;' +
            'text-overflow:ellipsis;cursor:pointer}' +
            '.db-ref-chip{display:inline-flex;align-items:center;gap:2px;color:var(--ed-link-color);cursor:pointer;' +
            'border-radius:3px;padding:0 2px;transition:opacity .15s;white-space:nowrap}' +
            '.db-ref-chip:hover{opacity:.7}' +
            '.db-ref-chip .ti{font-size:11px;opacity:.6}' +
            '.db-date-chip{flex-shrink:0;color:var(--ed-datetime-color);background:var(--ed-datetime-bg);' +
            'border-radius:3px;padding:1px 4px;font-size:12px;line-height:1.35;white-space:nowrap}' +
            '.db-task-source-wrap{display:inline-flex;align-items:center;flex-shrink:0;gap:2px;padding-right:0px;max-width:180px}' +
            '.db-task-source--link{font-size:12px;color:var(--ed-link-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
            'text-decoration-line:underline;text-decoration-style:dotted;text-underline-offset:2px}' +
            '.db-task-source-wrap:hover .db-task-source--link{color:var(--ed-link-hover-color)}' +
            '.db-btn{background:none;border:none;cursor:pointer;color:inherit;border-radius:var(--ed-radius-normal);' +
            'transition:opacity .1s,background .1s,color .1s}' +
            '.db-btn--primary{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-color);' +
            'font-size:12px;font-weight:600;padding:6px 16px}' +
            '.db-btn--primary:hover{background:var(--ed-button-primary-bg-hover)}' +
            '.db-btn--danger{background:var(--ed-error-color);color:var(--ed-button-primary-text);' +
            'font-size:13px;font-weight:600;padding:6px 14px}' +
            '.db-btn--danger:hover{opacity:.85}' +
            '.db-btn--quiet{font-size:12px;opacity:.45;padding:6px 8px}' +
            '.db-btn--quiet:hover{opacity:.8}' +
            '.db-icon-btn{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
            'font-size:15px;line-height:1;padding:1px 5px;opacity:.2;transition:opacity .15s;border-radius:4px}' +
            '.db-icon-btn:hover{opacity:.7}' +
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
            '.db-bottom-sheet{display:none;position:fixed;bottom:0;left:0;right:0;' +
            'border:none;border-top:1px solid var(--sidebar-border-color);border-radius:16px 16px 0 0;' +
            'background:var(--cards-bg);z-index:200;box-shadow:none;max-height:calc(100vh - 24px);' +
            'overflow:auto;animation:db-sheet-rise .16s ease-out}' +
            '.db-recur-overlay{display:none;position:fixed;inset:0;background:transparent;z-index:199}' +
            '.db-recur-row{cursor:pointer}' +
            '.db-recur-summary{font-size:12px;opacity:.4;white-space:nowrap;flex-shrink:0}' +
            '.db-recur-summary--unconfigured{color:var(--ed-error-color);opacity:.7}' +
            '.db-recur-row .db-task-source-wrap{min-width:0}' +
            '.db-recur-edit{border-top:none;border-radius:0 0 var(--ed-radius-block) var(--ed-radius-block);' +
            'padding:16px;margin:-1px 0 8px;box-shadow:none;box-sizing:border-box}' +
            '.db-recur-edit--sheet{display:none}' +
            '.db-recur-pills{display:flex;gap:6px;margin-bottom:16px}' +
            '.db-recur-pill,.db-recur-day-btn,.db-setting-toggle{background:none;border:1px solid var(--sidebar-border-color);' +
            'cursor:pointer;color:inherit;font-size:12px;font-weight:500;transition:all .1s}' +
            '.db-recur-pill,.db-setting-toggle{border-radius:var(--ed-radius-pill);padding:4px 12px}' +
            '.db-recur-pill{opacity:.6}' +
            '.db-recur-pill:hover{opacity:1}' +
            '.db-recur-pill--active,.db-recur-day-btn--active,.db-setting-toggle--on{' +
            'background:var(--ed-button-primary-bg);color:var(--ed-button-primary-color);border-color:transparent;opacity:1}' +
            '.db-recur-date-area{margin-bottom:16px}' +
            '.db-recur-start{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px}' +
            '.db-recur-start-label{flex:0 0 100%;font-size:12px;font-weight:600;opacity:.45;line-height:1.2}' +
            '.db-recur-days{display:flex;flex-wrap:wrap;gap:6px}' +
            '.db-recur-day-btn{border-radius:var(--ed-radius-normal);padding:5px 10px;opacity:.5}' +
            '.db-recur-day-btn:hover{opacity:.9}' +
            '.db-recur-select{background:var(--input-bg-color);border:1px solid var(--input-border-color);' +
            'border-radius:var(--ed-radius-normal);cursor:pointer;font-size:12px;padding:5px 8px;' +
            'color:inherit;outline:none;margin-right:8px}' +
            '.db-recur-actions{display:flex;align-items:center;gap:8px}' +
            '.db-recur-remove{display:inline-flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;' +
            'font-size:12px;color:var(--ed-link-color);opacity:1;padding:6px 8px;margin-left:auto;' +
            'border-radius:var(--ed-radius-normal);transition:opacity .1s,color .1s}' +
            '.db-recur-remove:hover{opacity:.45;color:inherit}' +
            '@media(max-width:700px),(pointer:coarse){.db-recur-overlay:not([hidden]){display:block}' +
            '.db-recur-edit--sheet.db-bottom-sheet{display:block;border-top:1px solid var(--sidebar-border-color);' +
            'border-radius:16px 16px 0 0}' +
            '.db-recur-summary{margin-left:auto;line-height:1.35;padding-top:1px}' +
            '.db-recur-row .db-task-source-wrap{min-width:0;max-width:none}' +
            '.db-recur-edit--inline{display:none}' +
            '.db-recur-edit--sheet{padding:20px;margin:0}' +
            '.db-recur-edit--no-anim{animation:none}' +
            '.db-recur-edit--sheet .db-recur-fields{min-height:66px}' +
            '.db-recur-pills,.db-recur-actions{flex-wrap:wrap}' +
            '.db-recur-select{max-width:100%;margin-bottom:8px}' +
            '.db-recur-remove{margin-left:0}}' +
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
            'min-width:180px;z-index:100;box-shadow:var(--color-shadow-hover)}' +
            '.db-dropdown-item{display:block;width:100%;text-align:left;background:none;border:none;' +
            'cursor:pointer;color:inherit;font-size:14px;padding:10px 14px;border-radius:var(--ed-radius-normal);transition:background .1s,color .1s}' +
            '.db-dropdown-item:hover{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-text)}' +
            '.db-setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
            'padding:10px 14px;border-radius:var(--ed-radius-block);cursor:pointer;' +
            'margin-bottom:4px;transition:background .1s}' +
            '.db-setting-row:hover{background:var(--cards-hover-bg)}' +
            '.db-search-wrap{position:relative;margin-bottom:20px}' +
            '.db-plan-search{width:100%;box-sizing:border-box;' +
            'background:var(--input-bg-color);border:1px solid var(--input-border-color);' +
            'border-radius:var(--ed-radius-block);padding:8px 34px 8px 12px;font-size:14px;' +
            'color:inherit;outline:none;transition:border-color .15s}' +
            '.db-plan-search:focus{border-color:var(--ed-link-color)}' +
            '.db-plan-search::placeholder{opacity:.4}' +
            '.db-search-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);' +
            'background:none;border:none;cursor:pointer;color:var(--ed-gray-text);' +
            'font-size:16px;line-height:1;padding:2px 4px;border-radius:var(--ed-radius-normal);' +
            'transition:color .1s,background .1s}' +
            '.db-search-clear:hover,.db-search-clear:focus{color:var(--ed-text-color);' +
            'background:var(--cards-hover-bg);outline:none}' +
            '.db-setting-label{font-size:14px;flex:1}' +
            '.db-setting-toggle{opacity:.5;white-space:nowrap}' +
            '.db-setting-toggle:hover{opacity:.9}' +
            '.db-setting-toggle--on{color:var(--ed-button-primary-text)}' +
            '.db-settings-note{border-radius:var(--ed-radius-block);padding:12px 14px;margin-bottom:4px}' +
            '.db-settings-note-title{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;margin-bottom:4px}' +
            '.db-settings-badge{font-size:11px;font-weight:600;color:var(--ed-link-color);opacity:.75}' +
            '.db-settings-note-copy{font-size:12px;line-height:1.45;opacity:.55;margin:0 0 12px}' +
            '.db-keybind-list{display:grid;grid-template-columns:minmax(150px,1fr) 2fr;gap:6px 12px;font-size:12px}' +
            '.db-keybind-list dt{opacity:.9}' +
            '.db-keybind-list dd{margin:0;opacity:.55}' +
            '.db-keybind-break{padding-top:10px;margin-top:4px;border-top:1px solid var(--ed-container-border-color)}' +
            '.db-keybind-break + dd{padding-top:10px;margin-top:4px;border-top:1px solid var(--ed-container-border-color)}' +
            '.db-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:1px 5px;' +
            'border:1px solid var(--ed-container-border-color);border-radius:4px;background:var(--input-bg-color);' +
            'font-size:11px;font-weight:600;color:var(--ed-text-color);opacity:.8}' +
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
            '.db-block{border-radius:var(--ed-radius-block);margin-bottom:12px}' +
            '.db-block-time{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px}' +
            '.db-block-label{font-size:13px;font-weight:500;opacity:.48}' +
            '.db-block-clock{font-size:12px;opacity:.32;font-variant-numeric:tabular-nums}' +
            '.db-block-body{padding:2px 8px 8px}' +
            '.db-block-body .db-task{background:none;border:none;box-shadow:none;border-radius:0;margin-bottom:0;' +
            'border-top:1px solid var(--ed-container-border-color);padding:7px 8px}' +
            '.db-block-body .db-task:hover{background:var(--ed-button-bg-hover);box-shadow:none}' +
            '.db-block-body .db-task--open{border-left:1px solid var(--ed-container-border-color);' +
            'border-right:1px solid var(--ed-container-border-color);border-bottom:none;' +
            'border-radius:var(--ed-radius-block) var(--ed-radius-block) 0 0}' +
            '.db-block-body .db-task-inline{background:var(--input-bg-color);border:1px solid var(--ed-container-border-color);' +
            'border-top:none;border-radius:0 0 var(--ed-radius-block) var(--ed-radius-block);' +
            'box-shadow:none;margin:-1px 0 8px;box-sizing:border-box}' +
            '.db-day-nav{display:flex;align-items:center;gap:8px}' +
            '.db-day-nav-btn{background:none;border:none;cursor:pointer;color:var(--ed-link-color);font-size:16px;' +
            'padding:2px 6px;transition:color .15s;border-radius:4px}' +
            '.db-day-nav-btn:hover:not(:disabled){color:var(--ed-link-hover-color)}' +
            '.db-day-nav-btn:disabled{opacity:.2;cursor:default}' +
            '.db-day-nav-label{background:none;border:none;color:inherit;cursor:pointer;font-size:15px;font-weight:500;' +
            'opacity:.6;min-width:88px;text-align:center;padding:2px 0;border-radius:4px}' +
            '.db-day-nav-label:not([data-action]){cursor:default}' +
            '.db-day-nav-label[data-action="go-today"]{cursor:pointer;opacity:1;color:var(--ed-link-color);transition:color .15s}' +
            '.db-day-nav-label[data-action="go-today"]:hover{color:var(--ed-link-hover-color)}' +
            '.db-task[data-action="select-task"],.db-task[data-action="pin"]{cursor:pointer}' +
            '.db-task-r1{display:flex;align-items:center;gap:8px;flex:1;min-width:0;padding-left:2px}' +
            '.db-task-r2{display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:auto;min-width:0}' +
            '.db-task-meta{display:flex;align-items:center;gap:4px;min-width:0}' +
            '.db-task-r2-actions{display:flex;align-items:center;gap:2px;flex-shrink:0}' +
            '.db-section--overdue>.db-task,.db-section--today>.db-task,.db-section--inbox>.db-task,.db-section--ignore>.db-task,.db-section--recurring>.db-task{margin-bottom:0}' +
            '@media(min-width:601px){' +
            '.db-section--overdue,.db-section--today,.db-section--inbox,.db-section--ignore,.db-section--recurring{padding-top:2px}' +
            '.db-section--overdue>.db-task,.db-section--today>.db-task,.db-section--inbox>.db-task,.db-section--ignore>.db-task,.db-section--recurring>.db-task{' +
            'background:transparent;border-color:transparent;border-bottom-color:var(--ed-container-border-color);' +
            'border-radius:0;box-shadow:none;padding:7px 10px;min-height:38px}' +
            '.db-section--overdue>.db-section-header+.db-task,.db-section--today>.db-section-header+.db-task,.db-section--inbox>.db-section-header+.db-task,.db-section--ignore>.db-section-header+.db-task,.db-section--recurring>.db-section-header+.db-task{' +
            'border-top-color:var(--ed-container-border-color)}' +
            '.db-section--overdue>.db-task:hover,.db-section--today>.db-task:hover,.db-section--inbox>.db-task:hover,.db-section--ignore>.db-task:hover,.db-section--recurring>.db-task:hover{' +
            'background:var(--ed-button-bg-hover);border-left-color:transparent;border-right-color:transparent;box-shadow:none}' +
            '.db-section--overdue>.db-task--open,.db-section--today>.db-task--open,.db-section--inbox>.db-task--open,.db-section--recurring>.db-task--open{' +
            'background:var(--cards-hover-bg);border-color:var(--ed-container-border-color);border-radius:var(--ed-radius-normal) var(--ed-radius-normal) 0 0}' +
            '.db-section--overdue>.db-task-inline,.db-section--today>.db-task-inline,.db-section--inbox>.db-task-inline,.db-section--recurring>.db-recur-edit--inline{' +
            'margin:0 0 8px;border-color:var(--ed-container-border-color);box-shadow:none}' +
            '}' +
            '@media(max-width:600px){' +
            '.db-root{padding:12px 0;max-width:100%}' +
            '.db-header{padding:10px 0 16px}' +
            '.db-block{margin-bottom:8px}' +
            '.db-block-body{padding:0 0 8px}' +
            '.db-task{flex-wrap:wrap;align-items:flex-start;row-gap:2px;padding:8px 10px}' +
            '.db-block-body .db-task{padding:12px 10px;min-height:58px}' +
            '.db-block-body .db-done{align-self:flex-start;margin-top:2px!important}' +
            '.db-block-body .db-task.state-done>.db-task-r1{flex:1 1 0;min-width:0}' +
            '.db-task-r1{flex:1 1 0;align-items:flex-start;padding-left:0}' +
            '.db-task>.db-done{align-self:flex-start;margin-top:2px!important}' +
            '.db-task-r2{flex:0 0 100%;margin-left:0;padding-left:32px;justify-content:space-between;min-height:18px}' +
            '.db-task-body{align-items:baseline;flex-wrap:wrap;row-gap:1px;column-gap:6px}' +
            '.db-task-text,.db-task-text--sel{flex:1;min-width:0;white-space:normal;display:-webkit-box;' +
            '-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
            '.db-date-chip{margin-left:auto}' +
            '.db-task-r2-actions{margin-left:auto;flex-shrink:0;min-width:0}' +
            '.db-task-meta{flex:1;min-width:0}' +
            '.db-task-source-wrap{flex:0 0 100%;min-width:0;max-width:none;margin-top:4px}' +
            '.db-task-source--link{overflow:hidden;text-overflow:ellipsis;max-width:24ch;font-size:12px;opacity:.75}' +
            '.db-src-icon{padding:1px 2px}' +
            '}' +
            '.db-task--open{background:var(--cards-hover-bg);border-color:var(--ed-container-border-color);' +
            'border-radius:var(--ed-radius-block) var(--ed-radius-block) 0 0;margin-bottom:0!important}' +
            '.db-task-inline{background:var(--input-bg-color);border:1px solid var(--ed-container-border-color);' +
            'border-top:none;border-radius:0 0 var(--ed-radius-block) var(--ed-radius-block);' +
            'padding:6px;margin:-1px 0 8px;box-shadow:none;box-sizing:border-box}' +
            '.db-inline-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}' +
            '.db-inline-slot{display:flex;align-items:center;justify-content:space-between;gap:6px;' +
            'padding:7px 9px;background:transparent;border:1px solid transparent;' +
            'border-radius:var(--ed-radius-normal);cursor:pointer;color:inherit;min-height:34px;' +
            'transition:background .1s,border-color .1s;box-sizing:border-box}' +
            '.db-inline-slot:hover{background:var(--ed-button-bg-hover);border-color:var(--ed-button-border)}' +
            '.db-inline-slot--active{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-color);border-color:transparent}' +
            '.db-inline-slot-label{font-size:13px;font-weight:500;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.db-inline-slot-time{font-size:11px;opacity:.5;white-space:nowrap;font-variant-numeric:tabular-nums}' +
            '.db-pin-icon{display:inline-flex;align-items:center;justify-content:center;' +
            'color:var(--ed-gray-text);opacity:.7;font-size:14px;padding:0 4px}' +
            '.db-pin-icon:hover{opacity:1;color:var(--ed-link-color)}' +
            '.db-sheet-overlay{display:none}' +
            '.db-task-sheet{display:none}' +
            '@media(max-width:600px){' +
            '.db-task-inline{display:none}' +
            '.db-sheet-overlay{display:block;position:fixed;inset:0;background:transparent;z-index:199}' +
            '.db-task-sheet.db-bottom-sheet{display:block}' +
            '.db-sheet-handle{width:36px;height:4px;background:var(--sidebar-border-color);' +
            'border-radius:2px;margin:10px auto 12px}' +
            '.db-sheet-header{padding:0 20px 14px;border-bottom:1px solid var(--sidebar-border-color)}' +
            '.db-sheet-kicker{font-size:11px;font-weight:600;letter-spacing:0;text-transform:uppercase;opacity:.35;margin-bottom:4px}' +
            '.db-sheet-name{font-size:15px;font-weight:600;line-height:1.35;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ed-text-color)}' +
            '.db-sheet-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:16px 20px}' +
            '.db-sheet-slot{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            'padding:10px 6px;border-radius:var(--ed-radius-block);' +
            'cursor:pointer;color:inherit;min-height:52px;transition:background .1s,border-color .1s;box-sizing:border-box}' +
            '.db-sheet-slot:active{background:var(--cards-hover-bg);border-color:var(--input-border-color)}' +
            '.db-sheet-slot--active{background:var(--ed-button-primary-bg);color:var(--ed-button-primary-color);border-color:transparent}' +
            '.db-sheet-slot-label{font-size:12px;font-weight:500;text-align:center;line-height:1.3}' +
            '.db-sheet-slot-time{font-size:11px;opacity:.5;margin-top:3px}' +
            '.db-sheet-footer{display:flex;align-items:center;justify-content:center;gap:8px;padding:4px 12px 24px;' +
            'border-top:1px solid var(--sidebar-border-color)}' +
            '.db-sheet-remove{display:inline-flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;font-size:13px;' +
            'color:var(--ed-gray-text);padding:10px 8px;border-radius:var(--ed-radius-normal);transition:opacity .1s,color .1s}' +
            '.db-sheet-remove:hover{color:var(--ed-link-color)}' +
            '.db-sheet-remove:active{opacity:.6}' +
            '.db-pin-icon{display:none}' +
            '}' +
            '.db-wipe-btn{width:100%;text-align:left;padding:10px 14px;background:none;border:none;cursor:pointer;' +
            'font-size:14px;color:var(--ed-error-color);opacity:.7;border-radius:var(--ed-radius-block);transition:opacity .1s,background .1s}' +
            '.db-wipe-btn:hover{opacity:1;background:var(--cards-hover-bg)}' +
            '.db-wipe-confirm{padding:10px 14px;border-radius:var(--ed-radius-block)}' +
            '.db-wipe-confirm-msg{font-size:13px;opacity:.7;margin:0 0 14px;line-height:1.5}' +
            '.db-wipe-actions{display:flex;gap:8px;align-items:center}' +
            '.db-wipe-status{font-size:13px;padding:10px 14px;opacity:.5}'
            + '.db-peek-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);' +
            'display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}' +
            '.db-peek-modal{width:min(760px,100%);height:min(760px,calc(100vh - 48px));' +
            'display:flex;flex-direction:column;background:var(--input-bg-color,var(--cards-bg,#1f1f2a));color:var(--ed-text-color);' +
            'border:1px solid var(--ed-container-border-color);border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden}' +
            '.db-peek-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--ed-container-border-color);background:var(--input-bg-color,var(--cards-bg,#1f1f2a));flex-shrink:0}' +
            '.db-peek-title{font-size:13px;font-weight:600;opacity:.65;margin-right:auto}' +
            '.db-peek-switch{display:flex;align-items:center;gap:2px;padding:2px;background:var(--input-bg-color);border:1px solid var(--input-border-color);border-radius:var(--ed-radius-block)}' +
            '.db-peek-switch-btn{background:none;border:none;color:inherit;cursor:pointer;border-radius:var(--ed-radius-normal);font-size:12px;padding:5px 10px;opacity:.55}' +
            '.db-peek-switch-btn:hover{opacity:.85;background:var(--cards-hover-bg)}' +
            '.db-peek-switch-btn--active{opacity:1;background:var(--cards-bg)}' +
            '.db-peek-close{background:none;border:none;color:inherit;cursor:pointer;border-radius:var(--ed-radius-normal);font-size:18px;line-height:1;padding:4px 8px;opacity:.45}' +
            '.db-peek-close:hover{opacity:.8;background:var(--cards-hover-bg)}' +
            '.db-peek-content{flex:1;min-height:0;overflow:auto;padding:16px 18px 20px;box-sizing:border-box;background:var(--input-bg-color,var(--cards-bg,#1f1f2a))}' +
            '.db-peek-content>.db-header{display:none}' +
            '.db-peek-content .db-root{height:auto;padding-bottom:0}' +
            '@media(max-width:700px){.db-peek-overlay{padding:0;align-items:stretch}.db-peek-modal{height:100vh;width:100%;border-radius:0;border-left:none;border-right:none}}'
            + '@keyframes db-sheet-rise{from{transform:translateY(14px);opacity:.92}to{transform:translateY(0);opacity:1}}'
            + '@media(prefers-reduced-motion:reduce){.db-task-sheet,.db-recur-edit--sheet{animation:none}}'
        );

        this.plugin.ui.addCommandPaletteCommand({
            label: "Open Daily Focus",
            icon:  'gauge',
            onSelected: () => this._openPanel(),
        });

        this.plugin.ui.addCommandPaletteCommand({
            label: "Daily Focus: Open Focus",
            icon:  'gauge',
            onSelected: () => this._openMode('focus'),
        });

        this.plugin.ui.addCommandPaletteCommand({
            label: "Daily Focus: Open Plan",
            icon:  'calendar',
            onSelected: () => this._openMode('plan'),
        });

        this.plugin.ui.addCommandPaletteCommand({
            label: "Daily Focus: Open Recurring Tasks",
            icon:  'repeat',
            onSelected: () => this._openMode('recurring-list'),
        });

        this.plugin.ui.addCommandPaletteCommand({
            label: "Daily Focus: Open Ignore List",
            icon:  'eye-off',
            onSelected: () => this._openMode('ignore-list'),
        });

        this.plugin.ui.addCommandPaletteCommand({
            label: "Daily Focus: Open Settings",
            icon:  'settings',
            onSelected: () => this._openMode('settings'),
        });

        this.plugin.ui.addCommandPaletteCommand({
            label: "Daily Focus: Peek",
            icon:  'eye',
            onSelected: () => this._openPeek(),
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
        this.plugin.events.on('lineitem.undeleted', () => this._scheduleRefresh());
        this.plugin.events.on('record.updated', ev => this._scheduleTrashRefresh(ev));
        this.plugin.events.on('collection.updated', ev => this._scheduleTrashRefresh(ev));
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
        if (!this._panel && !this._peekPanel) return;
        if (this._prefetchInFlight) return;
        this._prefetchInFlight = true;
        try {
            this._lastData = await this._fetchTaskData();
        } catch (e) {
            console.warn('[Dashboard] prefetch failed:', e);
        } finally {
            this._prefetchInFlight = false;
        }
    }

    _scheduleRefresh() {
        if (!this._panel && !this._peekPanel) return;
        if (this._panel && !this._panel.getElement()?.isConnected) this._panel = null;
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._prefetch();
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            if (this._panel) {
                const el = this._panel.getElement();
                if (el?.isConnected && el.querySelector('.db-root, .db-loading')) {
                    this._render(this._panel, false);
                }
            }
            if (this._peekPanel) this._renderPeek();
        }, 800);
    }

    async _openPanel() {
        let panel = this.plugin.ui.getActivePanel();
        if (!panel) panel = await this.plugin.ui.createPanel();
        if (panel) panel.navigateToCustomType('today-dashboard');
    }

    async _openMode(mode) {
        this._mode = mode;
        this._expandedRecurring = null; // [RECURRING]
        this._recurringDraft    = null; // [RECURRING]
        if (this._mode === 'plan' && this._viewDate < this._todayD()) this._viewDate = null;
        await this._openPanel();
        if (this._panel) this._render(this._panel);
    }

    async _openPeek() {
        if (this._peekOverlay) {
            this._peekOverlay.querySelector('.db-peek-modal')?.focus();
            return;
        }

        this._peekMode = 'focus';
        const overlay = document.createElement('div');
        overlay.className = 'db-peek-overlay';
        overlay.innerHTML = `<div class="db-peek-modal" role="dialog" aria-modal="true" aria-label="Daily Focus peek" tabindex="-1">
        <div class="db-peek-bar">
        <div class="db-peek-title">Daily Focus</div>
        <div class="db-peek-switch" role="group" aria-label="Peek view">
        <button class="db-peek-switch-btn db-peek-switch-btn--active" data-peek-mode="focus">Focus</button>
        <button class="db-peek-switch-btn" data-peek-mode="plan">Plan</button>
        </div>
        <button class="db-peek-close" aria-label="Close Daily Focus peek">×</button>
        </div>
        <div class="db-peek-content"></div>
        </div>`;

        const modal = overlay.querySelector('.db-peek-modal');
        const content = overlay.querySelector('.db-peek-content');
        this._peekOverlay = overlay;
        this._peekPanel = { getElement: () => content };

        const close = () => this._closePeek();
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        overlay.querySelector('.db-peek-close')?.addEventListener('click', close);
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        });
        for (const btn of overlay.querySelectorAll('[data-peek-mode]')) {
            btn.addEventListener('click', () => {
                this._peekMode = btn.dataset.peekMode;
                this._renderPeek();
            });
        }

        document.body.appendChild(overlay);
        await this._renderPeek();
        modal?.focus();
    }

    _closePeek() {
        if (!this._peekOverlay) return;
        this._peekOverlay.remove();
        this._peekOverlay = null;
        this._peekPanel = null;
        if (this._panel) this._render(this._panel);
    }

    async _renderPeek() {
        if (!this._peekPanel || !this._peekOverlay) return;
        const previousMode = this._mode;
        this._mode = this._peekMode;
        try {
            if (this._mode === 'plan' && this._viewDate < this._todayD()) this._viewDate = null;
            for (const btn of this._peekOverlay.querySelectorAll('[data-peek-mode]')) {
                btn.classList.toggle('db-peek-switch-btn--active', btn.dataset.peekMode === this._peekMode);
            }
            await this._render(this._peekPanel, true);
        } finally {
            this._mode = previousMode;
        }
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
                ({ todoResult, scheduledResult, overdueResult, dueResult, doneResult } = await this._fetchTaskData());
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
            const pinDate     = l.props?.['db-pinned'] || '';
            const hasActivePin = pinDate >= today;
            // [RECURRING-START] don't show recurring tasks already completed or rescheduled away from today
            const recurDone   = l.props?.['db-recurring-done-dates'];
            const isRecurringCompleted = !!(
                recurDone?.split(',').includes(viewDate) ||
                this._completedRecurringDates[l.guid]?.split(',').includes(viewDate)
            );
            const rescheduledStart = this._rescheduledRecurring[l.guid];
            const isRescheduledAway = !!(rescheduledStart && rescheduledStart > viewDate);
            const isRecurringToday = !!(l.props?.['db-recurring-freq'] && (l.segments || []).some(s => s.type === 'datetime' && s.text?.d === viewDate));
            // [RECURRING-END]
            if (isOverdue && !isPinned)                                                                                             planOverdue.push(l);
            if (isPinned    && !isRecurringCompleted && !isRescheduledAway)                                                         todayPinned.push(l);
            if ((isScheduled || isRecurringToday) && !isPinned && !isOverdue && !isRecurringCompleted && !isRescheduledAway)        scheduled.push(l);
            if (!isDated && !isPinned && !isScheduled && !isOverdue)    inbox.push(l);
            if (!isDated && !hasActivePin && !isScheduled && !isOverdue)  planInbox.push(l);
        }
        planOverdue.sort((a, b) => {
            const da = this._taskDueDateKey(a);
            const db = this._taskDueDateKey(b);
            if (da && db && da !== db) return da.localeCompare(db);
            if (da && !db) return -1;
            if (!da && db) return 1;
            return 0;
        });

        const todayD = this._todayD().replace(/-/g, '');
        const upcomingCutoff = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0,10).replace(/-/g,''); })();
        const upcomingTasks = allTodos.filter(l => {
            const pinDate = l.props?.['db-pinned'] || '';
            if (overdueGuids.has(l.guid) || todaySet.has(l.guid) || pinDate >= today) return false;
            const seg = (l.segments || []).find(s => s.type === 'datetime');
            const d = seg?.text?.d;
            return d && d > todayD && d <= upcomingCutoff;
        });

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
        : this._buildPlanHTML(planOverdue, viewPinned, planInbox, ignoredTasks.length, unconfiguredRecurring, false, recurringPreview, timeBlocks, upcomingTasks);

        if (this._listenerAbort) this._listenerAbort.abort();
        this._listenerAbort = new AbortController();
        this._attachListeners(el, allTasks, ignoredTasks, this._listenerAbort.signal);
        this._reapplyPlanSearch(el);
    }

    _menuHTML(crumb) {
        return `<div class="db-menu-wrap">
        <div class="db-menu-trigger">
        <button class="db-hamburger" data-nav-item="menu" aria-label="Open menu"><i class="ti ti-menu-2"></i></button>
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

        let sheetHTML = '';
        if (this._taskSheet) {
            const sheetTask    = taskByGuid.get(this._taskSheet);
            const currentSlot  = timeBlocks[this._taskSheet] || null;
            const isPinned     = pinnedGuids.has(this._taskSheet);
            sheetHTML = this._buildTaskSheetHTML(this._taskSheet, sheetTask, currentSlot, isPinned);
        }

        return sheetHTML + `<div class="db-header" data-nav-region="navbar" role="navigation" aria-label="Daily Focus navigation">
        <div class="db-header-left">
        ${this._menuHTML('Focus')}
        </div>
        <div class="db-day-nav">
        <button class="db-day-nav-btn" data-nav-item="prev-day" data-action="prev-day" aria-label="Previous day">←</button>
        <button class="db-day-nav-label" data-nav-item="today"${this._viewDateStr() !== this._todayD() ? ' data-action="go-today" title="Go to today"' : ''}>${this._viewDateLabel()}</button>
        <button class="db-day-nav-btn" data-nav-item="next-day" data-action="next-day" aria-label="Next day">→</button>
        </div>
        <div class="db-header-right">
        <button class="db-mode-toggle" data-nav-item="mode" data-action="set-mode" data-mode="plan">Plan →</button>
        </div>
        </div>
        <div class="db-root" data-nav-region="tasks">
        ${(unassigned.length || unassignedDone.length || recurringDoneGhosts.length || recurringMissedGhosts.length) ? `
            <div class="db-section db-section--today">
            <div class="db-section-header">
            <span class="db-section-title">Anytime Today</span>
            ${unassigned.length ? `<span class="db-count">${unassigned.length}</span>` : ''}
            </div>
            <div class="db-block">
            <div class="db-block-time"><span class="db-block-label">Open</span></div>
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
            <span class="db-section-title">Daily Rhythm</span>
            </div>
            ${SLOTS.filter(s => !this._settings.hideEmptyBlocks || (assignedByTime[s.time] || []).length > 0).map(s => this._blockHTML(s.time, s.label, assignedByTime[s.time] || [], doneGuids)).join('')}
            </div>
            </div>`; // closes db-root — db-topbar is a sibling, no wrapper needed
    }

    _buildTaskInlinePanel(guid, currentSlot) {
        const slotsHTML = SLOTS.map(s => {
            const active = currentSlot === s.time;
            return `<button class="db-inline-slot${active ? ' db-inline-slot--active' : ''}" data-nav-timeblock="true" data-action="sheet-assign-slot" data-guid="${guid}" data-time="${s.time}">
            <span class="db-inline-slot-label">${s.label}</span>
            <span class="db-inline-slot-time">→ ${s.time}</span>
            </button>`;
        }).join('');
        return `<div class="db-task-inline">
        <div class="db-inline-slots">${slotsHTML}</div>
        </div>`;
    }

    _buildTaskSheetHTML(guid, task, currentSlot, isPinned) {
        const text = task ? this._escape(this._getText(task)) : '';
        const slotsHTML = SLOTS.map(s => {
            const active = currentSlot === s.time;
            return `<button class="db-sheet-slot${active ? ' db-sheet-slot--active' : ''}" data-nav-timeblock="true" data-action="sheet-assign-slot" data-guid="${guid}" data-time="${s.time}">
            <span class="db-sheet-slot-label">${s.label}</span>
            <span class="db-sheet-slot-time">→ ${s.time}</span>
            </button>`;
        }).join('');
        const removeBtn = isPinned
        ? `<button class="db-sheet-remove" data-action="sheet-unpin" data-guid="${guid}"><i class="ti ti-pin"></i><span>Unpin</span></button>`
        : '';
        return `<div class="db-sheet-overlay" data-action="close-task-sheet"></div>
        <div class="db-bottom-sheet db-task-sheet">
        <div class="db-sheet-handle"></div>
        <div class="db-sheet-header">
        <div class="db-sheet-kicker">Schedule</div>
        <div class="db-sheet-name">${text}</div>
        </div>
        <div class="db-sheet-slots">${slotsHTML}</div>
        ${removeBtn ? `<div class="db-sheet-footer">${removeBtn}</div>` : ''}
        </div>`;
    }

    _blockHTML(time, label, tasks, doneGuids = new Set()) {
        return `<div class="db-block" data-time="${time}">
        <div class="db-block-time"><span class="db-block-label">${label}</span><span class="db-block-clock">→ ${time}</span></div>
        ${tasks.length ? `<div class="db-block-body">${tasks.map(t => this._taskRow(t, doneGuids.has(t.guid) ? 'done' : 'block')).join('')}</div>` : ''}
        </div>`;
    }

    _buildPlanHTML(overdue, today, inbox, ignoredCount = 0, unconfiguredRecurring = 0, hideRecurring = false, recurringPreview = [], timeBlocks = {}, upcomingTasks = []) {
        const undatedBtn    = `<button class="db-recurring-filter${!this._hideUndated ? ' db-recurring-filter--active' : ''}" data-action="toggle-undated-filter">Unscheduled</button>`;
        const upcomingBtn   = `<button class="db-recurring-filter${!this._hideUpcoming ? ' db-recurring-filter--active' : ''}" data-action="toggle-upcoming-filter" style="margin-left:auto">Upcoming</button>`;
        let visInbox = inbox;
        if (!this._hideUpcoming) visInbox = [...upcomingTasks, ...visInbox];
        if (this._hideUndated)   visInbox = visInbox.filter(t => (t.segments || []).some(s => s.type === 'datetime'));
        const filtersHidingAll = visInbox.length === 0 && (inbox.length > 0 || upcomingTasks.length > 0);
        const inboxEmptyMsg = filtersHidingAll ? "There's stuff here — you're just not looking at it." : null;
        // [RECURRING-START]
        const recurringNotice = unconfiguredRecurring > 0
        ? `<div class="db-recurring-notice"><i class="ti ti-info-circle"></i>${unconfiguredRecurring} recurring task${unconfiguredRecurring > 1 ? 's' : ''} need${unconfiguredRecurring === 1 ? 's' : ''} a schedule — <button class="db-recurring-notice-btn" data-action="set-mode" data-mode="recurring-list">configure →</button></div>`
        : '';
        // [RECURRING-END]
        const dateLabel  = this._viewDateLabel();
        const focusTitle = dateLabel === 'Today' ? "Today's Focus" : `${dateLabel}'s Focus`;
        let sheetHTML = '';
        if (this._taskSheet) {
            const sheetTask   = today.find(t => t.guid === this._taskSheet);
            const currentSlot = timeBlocks[this._taskSheet] || null;
            sheetHTML = this._buildTaskSheetHTML(this._taskSheet, sheetTask, currentSlot, true);
        }
        return sheetHTML + `<div class="db-header" data-nav-region="navbar" role="navigation" aria-label="Daily Focus navigation">
        <div class="db-header-left">
        ${this._menuHTML('Plan')}
        </div>
        <div class="db-day-nav">
        <button class="db-day-nav-btn" data-nav-item="prev-day" data-action="prev-day" aria-label="Previous day" ${this._viewDateStr() <= this._todayD() ? 'disabled' : ''}>←</button>
        <button class="db-day-nav-label" data-nav-item="today"${this._viewDateStr() !== this._todayD() ? ' data-action="go-today" title="Go to today"' : ''}>${dateLabel}</button>
        <button class="db-day-nav-btn" data-nav-item="next-day" data-action="next-day" aria-label="Next day">→</button>
        </div>
        <div class="db-header-right">
        <button class="db-mode-toggle" data-nav-item="mode" data-action="set-mode" data-mode="focus">← Focus</button>
        </div>
        </div>
        <div class="db-root" data-nav-region="tasks">
        <div class="db-search-wrap">
        <input class="db-plan-search" type="text" placeholder="Filter tasks…" value="${this._escape(this._planSearch)}">
        <button class="db-search-clear" data-action="clear-search" aria-label="Clear search"${this._planSearch ? '' : ' hidden'}>×</button>
        </div>
        ${this._section('Overdue',  overdue,  'overdue', '', null, {
            collapsed: this._overdueCollapsed,
            toggleAction: 'toggle-overdue',
        })}
        ${this._sectionMixed(focusTitle, today, 'today', recurringPreview, 'recurring-preview')}
        ${recurringNotice}
        ${this._section('Inbox',    visInbox, 'inbox', upcomingBtn + undatedBtn, inboxEmptyMsg)}
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
        <div class="db-section db-section--ignore">
        <div class="db-section-header">
        <span class="db-section-title">Visible in planner</span>
        ${activeTasks.length ? `<span class="db-count">${activeTasks.length}</span>` : ''}
        </div>
        ${activeTasks.length
            ? activeTasks.map(t => this._ignoreListTaskRow(t, false)).join('')
            : `<div class="db-empty">No active tasks</div>`
        }
        </div>
        ${ignoredTasks.length ? `
        <div class="db-section db-section--ignore">
        <div class="db-section-header">
        <span class="db-section-title">Hidden from planner</span>
        <span class="db-count">${ignoredTasks.length}</span>
        </div>
            ${ignoredTasks.map(t => this._ignoreListTaskRow(t, true)).join('')}
            </div>` : ''}
            </div>`;
    }

    _buildSettingsHTML() {
        const row = (label, key, defaultOn = false) => {
            const on = this._settings[key] === undefined ? defaultOn : !!this._settings[key];
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
        ${row('Hide empty time blocks', 'hideEmptyBlocks')}
        </div>
        <div class="db-section">
        <div class="db-section-header">
        <span class="db-section-title">Journal</span>
        </div>
        ${row('Add transclusion to journal when completing a task', 'journalTransclusions')}
        </div>
        <div class="db-section">
        <div class="db-section-header">
        <span class="db-section-title">Keyboard navigation</span>
        </div>
        <div class="db-settings-note">
        <div class="db-settings-note-title">
        <span>Planned</span>
        <span class="db-settings-badge">Not available yet</span>
        </div>
        <p class="db-settings-note-copy">Daily Focus is being structured for keyboard-first navigation. These bindings describe the planned interaction model.</p>
        <dl class="db-keybind-list">
        <dt><span class="db-kbd">Up</span> / <span class="db-kbd">Down</span></dt><dd>Move between tasks</dd>
        <dt><span class="db-kbd">Enter</span></dt><dd>Complete or reopen the focused task</dd>
        <dt><span class="db-kbd">Space</span></dt><dd>Open or close time block choices</dd>
        <dt><span class="db-kbd">Arrows</span></dt><dd>Move through time block choices</dd>
        <dt><span class="db-kbd">1</span>-<span class="db-kbd">9</span></dt><dd>Choose a time block directly</dd>
        <dt><span class="db-kbd">Tab</span> / <span class="db-kbd">Shift</span>+<span class="db-kbd">Tab</span></dt><dd>Move through task actions</dd>
        <dt><span class="db-kbd">Esc</span></dt><dd>Close choices or return to the task</dd>
        <dt class="db-keybind-break"><span class="db-kbd">Ctrl</span>+<span class="db-kbd">Up</span> / <span class="db-kbd">Alt</span>+<span class="db-kbd">Up</span></dt><dd>Jump from tasks to the navbar, if available</dd>
        <dt><span class="db-kbd">Ctrl</span>+<span class="db-kbd">Down</span> / <span class="db-kbd">Alt</span>+<span class="db-kbd">Down</span></dt><dd>Return to the active task or section, if available</dd>
        <dt>Navbar</dt><dd>Menu/view, previous day, current day/today, next day, Plan or Focus</dd>
        <dt><span class="db-kbd">Left</span> / <span class="db-kbd">Right</span></dt><dd>Move between navbar items</dd>
        <dt><span class="db-kbd">Enter</span></dt><dd>Activate the focused navbar item</dd>
        <dt><span class="db-kbd">Esc</span></dt><dd>Leave navbar focus and return to the task</dd>
        <dt><span class="db-kbd">[</span></dt><dd>Previous day</dd>
        <dt><span class="db-kbd">]</span></dt><dd>Next day</dd>
        <dt><span class="db-kbd">Alt</span>+<span class="db-kbd">Left</span> / <span class="db-kbd">Alt</span>+<span class="db-kbd">Right</span></dt><dd>Previous or next day, if available</dd>
        <dt><span class="db-kbd">F</span> / <span class="db-kbd">P</span> / <span class="db-kbd">T</span></dt><dd>Focus, Plan, Today</dd>
        </dl>
        </div>
        </div>
        <div class="db-section">
        <div class="db-section-header">
        <span class="db-section-title">Data</span>
        </div>
        ${this._wipeState === 'confirm' ? `
            <div class="db-wipe-confirm">
            <p class="db-wipe-confirm-msg">Removes all plugin data from tasks — pins, time blocks, recurring settings, ignored status — and clears plugin configuration. Cannot be undone.</p>
            <div class="db-wipe-actions">
            <button class="db-btn db-btn--danger db-wipe-confirm-btn" data-action="wipe-metadata-confirm">Confirm wipe</button>
            <button class="db-btn db-btn--quiet db-wipe-cancel-btn" data-action="wipe-metadata-cancel">Cancel</button>
            </div>
            </div>` : this._wipeState === 'wiping' ? `
            <div class="db-wipe-status">Wiping…</div>` : this._wipeState === 'done' ? `
            <div class="db-wipe-status">Done. Reload the page to complete the reset.</div>` : `
            <button class="db-wipe-btn" data-action="wipe-metadata">Wipe Plugin Metadata</button>`}
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
        const expandedTask = this._expandedRecurring
        ? recurringTasks.find(t => t.guid === this._expandedRecurring)
        : null;
        const expandedDraft = expandedTask
        ? (this._recurringDraft || {
            freq: expandedTask.props?.['db-recurring-freq'] || 'daily',
            day:  expandedTask.props?.['db-recurring-day'] || null,
            start: expandedTask.props?.['db-recurring-start'] || this._todayD(),
        })
        : null;

        const sections = grouped.length
        ? grouped.map(g => `
        <div class="db-section db-section--recurring">
        <div class="db-section-header">
        <span class="db-section-title">${LABELS[g.freq]}</span>
        <span class="db-count">${g.tasks.length}</span>
        </div>
        ${g.tasks.map(t => this._recurringTaskRow(t)).join('')}
        </div>`).join('')
        : `<div class="db-empty">No recurring tasks — use the repeat button on any task to set a frequency</div>`;

        return `<div class="db-recur-overlay"${this._expandedRecurring ? '' : ' hidden'} data-action="cancel-recurring"></div>
        ${expandedTask ? this._recurringEditPanel(expandedTask.guid, expandedDraft.freq, expandedDraft.day, expandedDraft.start, 'sheet') : ''}
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
        const text       = this._getTaskTextHTML(task);
        const dateChip   = this._getDateChipHTML(task);
        const STATUS_CLASS = { important:'state-exclaim', started:'state-started', waiting:'state-blocked', billable:'state-dollar', discuss:'state-question', alert:'state-alert', starred:'state-starred' };
        const sc = STATUS_CLASS[task.getTaskStatus?.()] ? ' ' + STATUS_CLASS[task.getTaskStatus?.()] : '';
        const source = this._escape(task.record?.getName() || '');
        const sourceHTML = source
        ? `<span class="db-task-source-wrap"><span class="db-task-source--link" data-action="open" data-guid="${task.guid}">${source}</span><button class="db-icon-btn db-src-icon db-nav" data-action="open" data-guid="${task.guid}" data-task-action="source" title="Open source" aria-label="Open source"><i class="ti ti-arrow-up-right"></i></button></span>`
        : '';
        const bodyMeta = dateChip + sourceHTML;
        const freq = task.props?.['db-recurring-freq'];
        const day  = task.props?.['db-recurring-day'] || null;
        const summary = this._recurSummary(freq, day);
        const summaryHTML = summary
        ? `<span class="db-recur-summary">${this._escape(summary)}</span>`
        : `<span class="db-recur-summary db-recur-summary--unconfigured">Configure</span>`;
        const isExpanded = this._expandedRecurring === task.guid;
        const doneBtn  = `<div class="db-done line-check-div clickable" role="button" aria-label="Complete task" data-task-action="done" data-action="done" data-guid="${task.guid}"></div>`;
        const row = `<div class="db-task db-recur-row${isExpanded ? ' db-task--open' : ''}${sc}" data-nav-task="true" tabindex="-1" data-action="${isExpanded ? 'cancel-recurring' : 'expand-recurring'}" data-guid="${task.guid}">
        ${doneBtn}
        <div class="db-task-r1">
        <div class="db-task-body">
        <span class="db-task-text">${text}</span>${bodyMeta}
        </div>
        </div>
        ${this._r2HTML('', summaryHTML)}
        </div>`;
        if (isExpanded) {
            const draft = this._recurringDraft || { freq, day, start: task.props?.['db-recurring-start'] || this._todayD() };
            return row + this._recurringEditPanel(task.guid, draft.freq, draft.day, draft.start, 'inline');
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

    _recurringEditPanel(guid, draftFreq, draftDay, draftStart = null, variant = 'inline') {
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
        const start = draftStart || this._todayD();
        const sm = parseInt(start.slice(4, 6)) || (new Date().getMonth() + 1);
        const sd = parseInt(start.slice(6, 8)) || new Date().getDate();
        const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const startMonthOptions = MONTHS.map((m, i) => `<option value="${i + 1}"${sm === i + 1 ? ' selected' : ''}>${m}</option>`).join('');
        const startDayOptions = Array.from({length: 31}, (_, i) => i + 1)
        .map(d => `<option value="${d}"${sd === d ? ' selected' : ''}>${d}</option>`).join('');
        const startArea = draftFreq === 'daily' ? `<div class="db-recur-start">
        <span class="db-recur-start-label">Starts on</span>
        <select class="db-recur-select db-recur-start-month" data-guid="${guid}">${startMonthOptions}</select>
        <select class="db-recur-select db-recur-start-day" data-guid="${guid}">${startDayOptions}</select>
        </div>` : '';
        const sheetAnimClass = variant === 'sheet' && !this._recurringSheetAnimate ? ' db-recur-edit--no-anim' : '';
        if (variant === 'sheet') this._recurringSheetAnimate = false;
        return `<div class="db-recur-edit db-recur-edit--${variant}${variant === 'sheet' ? ' db-bottom-sheet' : ''}${sheetAnimClass}">
        <div class="db-recur-pills">${pills}</div>
        <div class="db-recur-fields">
        ${dateArea ? `<div class="db-recur-date-area">${dateArea}</div>` : ''}
        ${startArea}
        </div>
        <div class="db-recur-actions">
        <button class="db-btn db-btn--primary db-recur-save" data-action="save-recurring" data-guid="${guid}">Save</button>
        <button class="db-btn db-btn--quiet db-recur-cancel" data-action="cancel-recurring">Cancel</button>
        <button class="db-recur-remove" data-action="remove-recurring" data-guid="${guid}" title="Remove recurring"><i class="ti ti-repeat"></i><span>Remove recurring</span></button>
        </div>
        </div>`;
    }
    // [RECURRING-END]

    _getTaskDate(task) {
        const seg = (task.segments || []).find(s => s.type === 'datetime');
        return seg?.text || null;
    }

    _taskDueDateKey(task) {
        const d = this._getTaskDate(task)?.d;
        return typeof d === 'string' ? d : '';
    }

    _ignoreListTaskRow(task, isIgnored) {
        const text   = this._getTaskTextHTML(task);
        const dateChip = this._getDateChipHTML(task);
        const source = this._escape(task.record?.getName() || '');
        const sourceHTML = source
        ? `<span class="db-task-source-wrap" data-action="open" data-guid="${task.guid}"><span class="db-task-source--link">${source}</span><button class="db-icon-btn db-src-icon db-nav" data-task-action="source" title="Open source" aria-label="Open source"><i class="ti ti-arrow-up-right"></i></button></span>`
        : '';
        const actionHTML = `<button class="db-icon-btn ${isIgnored ? 'db-unignore' : 'db-ignore'}" data-task-action="ignore" data-action="${isIgnored ? 'unignore' : 'ignore'}" data-guid="${task.guid}" title="${isIgnored ? 'Restore task' : 'Ignore task'}" aria-label="${isIgnored ? 'Restore task' : 'Ignore task'}"><i class="ti ${isIgnored ? 'ti-eye-off' : 'ti-eye'} db-icon-default"></i><i class="ti ${isIgnored ? 'ti-eye' : 'ti-eye-off'} db-icon-hover"></i></button>`;
        return `<div class="db-task listitem-task${isIgnored ? ' db-task--ignored' : ''}" data-nav-task="true" tabindex="-1" data-guid="${task.guid}">
        <div class="db-done line-check-div" aria-disabled="true" style="opacity:.25;cursor:default" data-guid="${task.guid}"></div>
        <div class="db-task-r1">
        <div class="db-task-body">
        <span class="db-task-text">${text}</span>${dateChip}${sourceHTML}
        </div>
        </div>
        ${this._r2HTML('', actionHTML)}
        </div>`;
    }

    _section(title, tasks, type, headerExtra = '', emptyMsg = null, opts = {}) {
        const empty = emptyMsg ?? {
            overdue: 'No overdue tasks',
            today:   'Nothing pinned — tap a task in the inbox to add it',
            inbox:   'Nothing here!',
        }[type];
        const collapsed = !!opts.collapsed;
        const toggleHTML = opts.toggleAction
        ? `<button class="db-section-toggle" data-action="${opts.toggleAction}" aria-label="${collapsed ? `Expand ${title}` : `Collapse ${title}`}" title="${collapsed ? 'Expand' : 'Collapse'}"><i class="ti ti-chevron-${collapsed ? 'left' : 'down'}"></i></button>`
        : '';

        return `<div class="db-section db-section--${type}">
        <div class="db-section-header">
        <span class="db-section-title">${title}</span>
        ${tasks.length ? `<span class="db-count">${tasks.length}</span>` : ''}
        ${headerExtra}
        ${toggleHTML}
        </div>
        ${collapsed ? '' : tasks.length
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
        const text       = this._getTaskTextHTML(task);
        const dateChip   = this._getDateChipHTML(task);
        const STATUS_CLASS = { important:'state-exclaim', started:'state-started', waiting:'state-blocked', billable:'state-dollar', discuss:'state-question', alert:'state-alert', starred:'state-starred' };
        const sc = STATUS_CLASS[task.getTaskStatus?.()] ? ' ' + STATUS_CLASS[task.getTaskStatus?.()] : '';
        const source     = this._escape(task.record?.getName() || '');
        // WIP: open-in-panel button goes here — blocked on Thymer SDK (createPanel + navigateTo doesn't open native record view)
        const sourceBody = source
        ? `<span class="db-task-source-wrap"><span class="db-task-source--link" data-action="open" data-guid="${task.guid}">${source}</span><button class="db-icon-btn db-src-icon db-nav" data-action="open" data-guid="${task.guid}" data-task-action="source" title="Open source" aria-label="Open source"><i class="ti ti-arrow-up-right"></i></button></span>`
        : '';
        const bodyMeta = dateChip + sourceBody;
        const isPast   = this._viewDateStr() < this._todayD();
        const isFuture = this._viewDateStr() > this._todayD();
        const doneBtn  = isFuture
        ? `<div class="db-done line-check-div" aria-disabled="true" style="opacity:.25;cursor:default" data-guid="${task.guid}"></div>`
        : `<div class="db-done line-check-div clickable" role="button" aria-label="Complete task" data-task-action="done" data-action="done" data-guid="${task.guid}"></div>`;
        // [RECURRING-START] freq button — remove when Thymer ships native recurring
        const freq       = task.props?.['db-recurring-freq'];
        const recurToggle = freq
        ? `<button class="db-icon-btn db-recurring-btn db-recurring-btn--active" data-task-action="recurring" data-action="remove-recurring" data-guid="${task.guid}" title="Remove recurring"><i class="ti ti-repeat"></i></button>`
        : `<button class="db-icon-btn db-recurring-btn" data-task-action="recurring" data-action="enable-recurring" data-guid="${task.guid}" title="Set as recurring"><i class="ti ti-repeat"></i></button>`;
        // [RECURRING-END]

        if (section === 'recurring-preview') {
            return `<div class="db-task listitem-task db-task--recurring-preview" data-nav-task="true" tabindex="-1" data-guid="${task.guid}">
            <div class="db-done line-check-div" style="opacity:.25;cursor:default" data-guid="${task.guid}"></div>
            <div class="db-task-r1">
            <div class="db-task-body"><span class="db-task-text">${text}</span>${bodyMeta}</div>
            </div>
            ${this._r2HTML('', '')}
            </div>`;
        }

        // [RECURRING-START] ghost traces for past/today views
        if (section === 'recurring-done') {
            return `<div class="db-task listitem listitem-task state-done" data-nav-task="true" tabindex="-1" data-guid="${task.guid}">
            <div class="db-done line-check-div" style="opacity:.5;cursor:default" data-guid="${task.guid}"></div>
            <div class="db-task-r1">
            <div class="db-task-body"><span class="db-task-text--sel">${text}</span>${bodyMeta}</div>
            </div>
            ${this._r2HTML('', '')}
            </div>`;
        }

        if (section === 'recurring-missed') {
            return `<div class="db-task listitem-task" data-nav-task="true" tabindex="-1" data-guid="${task.guid}">
            <div class="db-done line-check-div" style="opacity:.15;cursor:default" data-guid="${task.guid}"></div>
            <div class="db-task-r1">
            <div class="db-task-body"><span class="db-task-text" style="opacity:.4">${text}</span>${bodyMeta}</div>
            </div>
            ${this._r2HTML('', '')}
            </div>`;
        }
        // [RECURRING-END]

        if (isPast) {
            const isDone = section === 'done';
            return `<div class="db-task listitem-task${isDone ? ' state-done' : ''}${sc}" data-nav-task="true" tabindex="-1" data-guid="${task.guid}">
            <div class="db-task-r1">
            <div class="db-task-body"><span class="db-task-text">${text}</span>${bodyMeta}</div>
            </div>
            ${this._r2HTML('', '')}
            </div>`;
        }

        const isFocus = section === 'focus-pinned' || section === 'focus-scheduled' || section === 'block';

        if (section === 'done') {
            return `<div class="db-task listitem listitem-task state-done" data-nav-task="true" tabindex="-1" data-guid="${task.guid}">
            <div class="db-done line-check-div clickable" role="button" aria-label="Reopen task" data-task-action="done" data-action="undone" data-guid="${task.guid}"></div>
            <div class="db-task-r1">
            <div class="db-task-body"><span class="db-task-text--sel">${text}</span>${bodyMeta}</div>
            </div>
            ${this._r2HTML('', '')}
            </div>`;
        }

        if (isFocus) {
            const pinBtn = task.props?.['db-pinned']
            ? `<button class="db-icon-btn db-pin-icon" data-task-action="pin" data-action="sheet-unpin" data-guid="${task.guid}" title="Remove from today"><i class="ti ti-pin"></i></button>`
            : '';
            const isOpen = this._taskSheet === task.guid;
            const inlinePanel = isOpen ? this._buildTaskInlinePanel(task.guid, this._taskSheetSlot) : '';
            return `<div class="db-task listitem-task${isOpen ? ' db-task--open' : ''}${sc}" data-nav-task="true" tabindex="-1" data-action="select-task" data-guid="${task.guid}">
            ${doneBtn}
            <div class="db-task-r1">
            <div class="db-task-body">
            <span class="db-task-text--sel">${text}</span>${bodyMeta}
            </div>
            </div>
            ${this._r2HTML('', pinBtn)}
            </div>${inlinePanel}`;
        }

        if (section === 'today') {
            const pinBtn = task.props?.['db-pinned']
            ? `<button class="db-icon-btn db-pin-icon" data-task-action="pin" data-action="sheet-unpin" data-guid="${task.guid}" title="Remove from today"><i class="ti ti-pin"></i></button>`
            : '';
            const isOpen = this._taskSheet === task.guid;
            const inlinePanel = isOpen ? this._buildTaskInlinePanel(task.guid, this._taskSheetSlot) : '';
            return `<div class="db-task listitem-task${isOpen ? ' db-task--open' : ''}${sc}" data-nav-task="true" tabindex="-1" data-action="select-task" data-guid="${task.guid}">
            ${doneBtn}
            <div class="db-task-r1">
            <div class="db-task-body">
            <span class="db-task-text">${text}</span>${bodyMeta}
            </div>
            </div>
            ${this._r2HTML('', recurToggle + '<!-- [RECURRING] -->' + pinBtn)}
            </div>${inlinePanel}`;
        }

        if (section === 'inbox' || section === 'overdue') {
            return `<div class="db-task listitem-task${sc}" data-nav-task="true" tabindex="-1" data-action="pin" data-guid="${task.guid}">
            ${doneBtn}
            <div class="db-task-r1">
            <div class="db-task-body">
            <span class="db-task-text">${text}</span>${bodyMeta}
            </div>
            </div>
            ${this._r2HTML('', recurToggle + '<!-- [RECURRING] -->')}
            </div>`;
        }

        return `<div class="db-task listitem-task${sc}" data-nav-task="true" tabindex="-1" data-guid="${task.guid}">
        ${doneBtn}
        <div class="db-task-r1">
        <div class="db-task-body" data-action="open" data-guid="${task.guid}">
        <span class="db-task-text">${text}</span>${bodyMeta}
        </div>
        </div>
        ${this._r2HTML('', '')}
        </div>`;
    }

    _r2HTML(dateChip, actionsHTML) {
        const content = (dateChip || '') + (actionsHTML || '');
        if (!content) return '';
        return `<div class="db-task-r2">
        ${dateChip ? `<div class="db-task-meta">${dateChip}</div>` : ''}
        ${actionsHTML ? `<div class="db-task-r2-actions">${actionsHTML}</div>` : ''}
        </div>`;
    }

    _attachListeners(el, allTasks, ignoredTasks = [], signal) {
        const byGuid = new Map();
        for (const l of allTasks)     byGuid.set(l.guid, l);
        for (const l of ignoredTasks) byGuid.set(l.guid, l);
        const today  = this._todayStr();
        const isPeekSurface = () => this._peekPanel?.getElement() === el;
        const rerenderCurrentSurface = () => {
            if (isPeekSurface()) {
                this._renderPeek();
            } else if (this._panel) {
                this._render(this._panel);
            }
        };

        const searchInput = el.querySelector('.db-plan-search');
        const searchClear = el.querySelector('.db-search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this._planSearch = searchInput.value;
                if (searchClear) searchClear.hidden = !this._planSearch;
                this._reapplyPlanSearch(el);
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
                        // Optimistic patch — reflect final state immediately so any intermediate
                        // event-triggered refresh doesn't bring the task back into today's view
                        const lines = this._lastData?.todoResult?.lines;
                        const cachedTask = lines?.find(l => l.guid === task.guid);
                        if (cachedTask) {
                            if (!cachedTask.props) cachedTask.props = {};
                            cachedTask.props['db-pinned']               = null;
                            cachedTask.props['db-recurring-done-dates'] = newDoneDates;
                        }
                        rerenderCurrentSurface();
                        try {
                            const nextYMD = nextDate.replace(/-/g, '');
                            const newSegs = [
                                ...this._stripDateSegments(task.segments),
                            { type: 'text', text: ' ' }, this._makeDateSegment(nextYMD),
                            ];
                            await task.setMetaProperty('db-pinned', null);
                            await task.setMetaProperty('db-recurring-done-dates', newDoneDates);
                            await task.setSegments(newSegs);
                        } catch (err) {
                            console.error('[Dashboard] recurring done failed:', err);
                            this._scheduleRefresh();
                        }
                        // [RECURRING-END]
                    } else {
                        this._moveToDone(task.guid, today);
                        rerenderCurrentSurface();
                        try {
                            await task.setTaskStatus('done');
                            await task.setMetaProperty('db-done-date', today);
                            if (this._settings.journalTransclusions === true) {
                                const journal = await this._journalRecord();
                                if (journal) await journal.createLineItem(null, null, 'ref', null, { itemref: task.guid });
                            }
                        } catch (err) {
                            console.error('[Dashboard] done failed:', err);
                            this._moveToTodo(task.guid);
                            rerenderCurrentSurface();
                        }
                    }
                    break;
                }
                case 'undone': {
                    if (!task) return;
                    this._moveToTodo(task.guid);
                    rerenderCurrentSurface();
                    try {
                        await task.setTaskStatus('none');
                        await task.setMetaProperty('db-done-date', null);
                    } catch (err) {
                        console.error('[Dashboard] undone failed:', err);
                        this._moveToDone(task.guid, today);
                        rerenderCurrentSurface();
                    }
                    break;
                }
                case 'pin': {
                    if (!task) return;
                    const pinDate = this._viewDateHyphen();
                    this._patchTask(task.guid, { 'db-pinned': pinDate });
                    if (isPeekSurface()) this._peekMode = 'plan';
                    else this._mode = 'plan';
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-pinned', pinDate);
                    break;
                }
                case 'unpin': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-pinned': null });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-pinned', null);
                    break;
                }
                case 'unassign': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-timeblock': null });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-timeblock', null);
                    break;
                }
                case 'close-task-sheet': {
                    this._taskSheet = null;
                    this._taskSheetSlot = null;
                    rerenderCurrentSurface();
                    break;
                }
                case 'sheet-assign-slot': {
                    if (!task) { this._taskSheet = null; this._taskSheetSlot = null; break; }
                    const slotTime = target.dataset.time;
                    const prevSlot = this._taskSheetSlot;
                    this._taskSheet = null;
                    this._taskSheetSlot = null;
                    if (slotTime === prevSlot) {
                        this._patchTask(task.guid, { 'db-timeblock': null });
                        rerenderCurrentSurface();
                        task.setMetaProperty('db-timeblock', null);
                    } else {
                        const tb = this._viewDateStr() + ':' + slotTime;
                        this._patchTask(task.guid, { 'db-timeblock': tb });
                        rerenderCurrentSurface();
                        task.setMetaProperty('db-timeblock', tb);
                    }
                    break;
                }
                case 'sheet-clear-slot': {
                    if (!task) { this._taskSheet = null; this._taskSheetSlot = null; break; }
                    this._taskSheet = null;
                    this._taskSheetSlot = null;
                    this._patchTask(task.guid, { 'db-timeblock': null });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-timeblock', null);
                    break;
                }
                case 'sheet-unpin': {
                    if (!task) { this._taskSheet = null; this._taskSheetSlot = null; break; }
                    this._taskSheet = null;
                    this._taskSheetSlot = null;
                    this._patchTask(task.guid, { 'db-pinned': null, 'db-timeblock': null });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-pinned', null);
                    task.setMetaProperty('db-timeblock', null);
                    break;
                }
                case 'select-task': {
                    if (this._taskSheet === guid) {
                        this._taskSheet = null;
                        this._taskSheetSlot = null;
                        rerenderCurrentSurface();
                        break;
                    }
                    this._taskSheet = guid;
                    const parsed = this._parseTimeblock(task?.props?.['db-timeblock']);
                    this._taskSheetSlot = (parsed && parsed.date === this._viewDateStr()) ? parsed.time : null;
                    rerenderCurrentSurface();
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
                case 'open-ref': {
                    const refGuid = target.dataset.guid;
                    if (!refGuid) return;
                    const panel = this.plugin.ui.getActivePanel();
                    if (panel) panel.navigateTo({
                        type: 'edit_panel',
                        rootId: refGuid,
                        subId: null,
                        workspaceGuid: this.plugin.getWorkspaceGuid(),
                    });
                    break;
                }
                case 'ignore': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-ignored': 'true' });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-ignored', 'true');
                    break;
                }
                case 'unignore': {
                    if (!task) return;
                    this._patchTask(task.guid, { 'db-ignored': null });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-ignored', null);
                    break;
                }
                // [RECURRING-START] recurring view interactions — remove when Thymer ships native recurring
                case 'expand-recurring': {
                    if (!task) return;
                    this._expandedRecurring = guid;
                    this._recurringSheetAnimate = true;
                    this._recurringDraft = {
                        freq: task.props?.['db-recurring-freq'] || 'daily',
                        day:  task.props?.['db-recurring-day']  || null,
                        start: task.props?.['db-recurring-start'] || this._todayD(),
                    };
                    rerenderCurrentSurface();
                    break;
                }
                case 'draft-freq': {
                    if (!this._recurringDraft) return;
                    this._recurringDraft.freq = target.dataset.freq;
                    this._recurringDraft.day  = null;
                    rerenderCurrentSurface();
                    break;
                }
                case 'draft-day': {
                    if (!this._recurringDraft) return;
                    this._recurringDraft.day = target.dataset.day;
                    rerenderCurrentSurface();
                    break;
                }
                case 'save-recurring': {
                    if (!task || !this._recurringDraft) return;
                    const { freq, day, start } = this._recurringDraft;
                    const startDate = freq === 'daily'
                    ? (start || this._todayD())
                    : this._nextUpcomingDate(freq, day || null).replace(/-/g, '');
                    this._patchTask(task.guid, { 'db-recurring-freq': freq, 'db-recurring-day': day || null, 'db-recurring-start': startDate });
                    if (startDate > this._todayD()) this._rescheduledRecurring[task.guid] = startDate;
                    else delete this._rescheduledRecurring[task.guid];
                    // Remove from scheduledResult if new date is not today
                    if (startDate !== this._todayD() && this._lastData?.scheduledResult?.lines) {
                        const idx = this._lastData.scheduledResult.lines.findIndex(l => l.guid === task.guid);
                        if (idx !== -1) this._lastData.scheduledResult.lines.splice(idx, 1);
                    }
                    task.segments = [
                        ...this._stripDateSegments(task.segments),
                                     { type: 'text', text: ' ' }, this._makeDateSegment(startDate),
                    ];
                    this._expandedRecurring = null;
                    this._recurringDraft = null;
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-recurring-freq', freq);
                    task.setMetaProperty('db-recurring-day', day || null);
                    task.setMetaProperty('db-recurring-start', startDate);
                    task.setSegments(task.segments);
                    break;
                }
                case 'cancel-recurring': {
                    this._expandedRecurring = null;
                    this._recurringDraft = null;
                    rerenderCurrentSurface();
                    break;
                }
                // [RECURRING-END]
                // [RECURRING-START] enable toggle — remove when Thymer ships native recurring
                case 'enable-recurring': {
                    if (!task) return;
                    const recStartDate = this._viewDateHyphen().replace(/-/g, '');
                    this._patchTask(task.guid, { 'db-recurring-freq': 'daily', 'db-recurring-start': recStartDate, 'db-pinned': null });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-recurring-freq', 'daily');
                    task.setMetaProperty('db-recurring-start', recStartDate);
                    task.setMetaProperty('db-pinned', null);
                    task.setSegments([
                        ...this._stripDateSegments(task.segments),
                                     { type: 'text', text: ' ' }, this._makeDateSegment(recStartDate),
                    ]);
                    break;
                }
                // [RECURRING-END]
                case 'remove-recurring': {
                    if (!task) return;
                    this._expandedRecurring = null; // [RECURRING]
                    this._recurringDraft    = null; // [RECURRING]
                    delete this._rescheduledRecurring[task.guid]; // [RECURRING]
                    const pinDate = this._viewDateHyphen();
                    this._patchTask(task.guid, { 'db-recurring-freq': null, 'db-recurring-day': null, 'db-recurring-start': null, 'db-pinned': pinDate });
                    rerenderCurrentSurface();
                    task.setMetaProperty('db-recurring-freq',  null);
                    task.setMetaProperty('db-recurring-day',   null);
                    task.setMetaProperty('db-recurring-start', null);
                    task.setMetaProperty('db-pinned', pinDate);
                    task.setSegments(this._stripDateSegments(task.segments));
                    break;
                }
                // [RECURRING] toggle-recurring-filter — remove when Thymer ships native recurring
                case 'wipe-metadata': {
                    this._wipeState = 'confirm';
                    rerenderCurrentSurface();
                    break;
                }
                case 'wipe-metadata-cancel': {
                    this._wipeState = null;
                    rerenderCurrentSurface();
                    break;
                }
                case 'wipe-metadata-confirm': {
                    this._wipeState = 'wiping';
                    rerenderCurrentSurface();
                    await this._wipePluginMetadata();
                    break;
                }
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
                case 'clear-search': {
                    this._planSearch = '';
                    const si = el.querySelector('.db-plan-search');
                    const sc = el.querySelector('.db-search-clear');
                    if (si) { si.value = ''; si.focus(); }
                    if (sc) sc.hidden = true;
                    this._reapplyPlanSearch(el);
                    break;
                }
                case 'toggle-undated-filter': {
                    this._hideUndated = !this._hideUndated;
                    rerenderCurrentSurface();
                    break;
                }
                case 'toggle-upcoming-filter': {
                    this._hideUpcoming = !this._hideUpcoming;
                    rerenderCurrentSurface();
                    break;
                }
                case 'toggle-overdue': {
                    this._overdueCollapsed = !this._overdueCollapsed;
                    rerenderCurrentSurface();
                    break;
                }
                case 'set-mode': {
                    if (isPeekSurface()) this._peekMode = target.dataset.mode;
                    else this._mode = target.dataset.mode;
                    this._expandedRecurring = null; // [RECURRING]
                    this._recurringDraft    = null; // [RECURRING]
                    if ((isPeekSurface() ? this._peekMode : this._mode) === 'plan' && this._viewDate < this._todayD()) this._viewDate = null;
                    rerenderCurrentSurface();
                    break;
                }
                case 'go-today': {
                    this._viewDate = null;
                    rerenderCurrentSurface();
                    break;
                }
                case 'prev-day': {
                    this._viewDate = this._offsetDate(this._viewDateStr(), -1);
                    rerenderCurrentSurface();
                    break;
                }
                case 'next-day': {
                    this._viewDate = this._offsetDate(this._viewDateStr(), 1);
                    rerenderCurrentSurface();
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
            if (t.matches('.db-recur-start-month, .db-recur-start-day')) {
                if (!this._recurringDraft) return;
                const edit = t.closest('.db-recur-edit');
                const mm = edit?.querySelector('.db-recur-start-month')?.value;
                const dd = edit?.querySelector('.db-recur-start-day')?.value;
                if (mm && dd) {
                    this._recurringDraft.start = this._startDateFromMonthDay(mm, dd);
                    rerenderCurrentSurface();
                }
                return;
            }
            // [RECURRING-END]
        }, { signal });
    }

    _reapplyPlanSearch(el) {
        const terms = (this._planSearch || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
        const includeTerm = terms.filter(t => !t.startsWith('!') && !t.startsWith('@')).join(' ');
        const excludeTerms = terms.map(t => t.startsWith('!') && !t.startsWith('!@') ? t.slice(1) : '').filter(Boolean);
        const sourceIncludeTerms = terms.map(t => t.startsWith('@') ? t.slice(1) : '').filter(Boolean);
        const sourceExcludeTerms = terms.map(t => t.startsWith('!@') ? t.slice(2) : '').filter(Boolean);
        for (const section of el.querySelectorAll('.db-section--overdue, .db-section--inbox')) {
            let visibleCount = 0;
            for (const row of section.querySelectorAll('.db-task')) {
                const rowText = row.textContent.toLowerCase();
                const sourceText = row.querySelector('.db-task-source--link')?.textContent.toLowerCase() || '';
                const match = (!includeTerm || rowText.includes(includeTerm))
                    && excludeTerms.every(t => !rowText.includes(t))
                    && sourceIncludeTerms.every(t => sourceText.includes(t))
                    && sourceExcludeTerms.every(t => !sourceText.includes(t));
                row.style.display = match ? '' : 'none';
                if (match) visibleCount++;
            }
            section.style.display = (terms.length && visibleCount === 0) ? 'none' : '';
        }
    }

    // [RECURRING-START] scheduling + occurrence logic — remove when Thymer ships native recurring
    _startDateFromMonthDay(month, day) {
        const today = this._todayD();
        let year = +today.slice(0, 4);
        const mm = +month;
        const maxDay = new Date(year, mm, 0).getDate();
        const dd = Math.min(+day, maxDay);
        let date = `${year}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`;
        if (date < today) {
            year += 1;
            const nextMaxDay = new Date(year, mm, 0).getDate();
            date = `${year}${String(mm).padStart(2, '0')}${String(Math.min(+day, nextMaxDay)).padStart(2, '0')}`;
        }
        return date;
    }

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
        const start = task.props?.['db-recurring-start'];
        if (start && viewDateStr < start) return false;
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
            if (s.type === 'ref') return s.text?.title || this.plugin.data.getRecord(s.text?.guid)?.getName() || '';
            if (typeof s.text === 'string') return s.text;
            if (s.text && typeof s.text === 'object') return s.text.title || s.text.link || '';
            return '';
        })
        .join('') || '(untitled)';
    }

    _formatDate(d) {
        if (!d || d.length < 8) return '';
        const year = +d.slice(0, 4), month = +d.slice(4, 6) - 1, day = +d.slice(6, 8);
        const date = new Date(year, month, day);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const diff = Math.round((date - today) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        if (diff === -1) return 'Yesterday';
        const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const label = `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`;
        return date.getFullYear() !== today.getFullYear() ? `${label} ${date.getFullYear()}` : label;
    }

    _getTaskTextHTML(task) {
        const parts = (task.segments || []).map(s => {
            if (s.type === 'ref') {
                const guid = s.text?.guid;
                if (!guid) return '';
                const title = s.text?.title || this.plugin.data.getRecord(guid)?.getName() || '?';
                return `<span class="db-ref-chip" data-action="open-ref" data-guid="${this._escape(guid)}">${this._escape(title)}<i class="ti ti-arrow-up-right"></i></span>`;
            }
            if (s.type === 'datetime') return '';
            if (typeof s.text === 'string') return this._escape(s.text);
            if (s.text && typeof s.text === 'object') return this._escape(s.text.title || s.text.link || '');
            return '';
        }).join('');
        return parts || '(untitled)';
    }

    _getDateChipHTML(task) {
        const seg = (task.segments || []).find(s => s.type === 'datetime');
        const d = seg?.text?.d;
        if (!d) return '';
        const label = this._formatDate(d);
        return `<span class="db-date-chip">${this._escape(label)}</span>`;
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
        try {
            new TodayDashboard(this).load();
        } catch (e) {
            console.error('[DailyFocus] load failed:', e);
        }
    }
}
