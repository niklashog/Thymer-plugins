class TodayDashboard {
    constructor(plugin) {
        this.plugin      = plugin;
        this._panel      = null;
        this._refreshTimer = null;
        this._renderVer  = 0;
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
            '.db-task{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;' +
            'transition:background .1s}' +
            '.db-task:hover{background:var(--db-hover,rgba(128,128,128,.07))}' +
            '.db-done{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
            'padding:2px;display:flex;opacity:.35;transition:opacity .15s;border-radius:50%}' +
            '.db-done:hover{opacity:1}' +
            '.db-done:disabled{opacity:.15;cursor:default}' +
            '.db-task-body{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;cursor:pointer}' +
            '.db-task-text{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.db-task-source{font-size:11px;opacity:.35;white-space:nowrap;flex-shrink:0}' +
            '.db-pin,.db-unpin{flex-shrink:0;background:none;border:none;cursor:pointer;color:inherit;' +
            'font-size:15px;line-height:1;padding:1px 5px;opacity:.2;transition:opacity .15s;border-radius:4px}' +
            '.db-pin:hover,.db-unpin:hover{opacity:.7}' +
            '.db-empty{font-size:13px;opacity:.3;padding:4px 6px}' +
            '.db-loading{padding:28px;opacity:.35;font-size:14px}'
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
                if (this._panel) this._render(this._panel);
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

        const [todoResult, overdueResult, dueResult] = await Promise.all([
            this.plugin.data.searchByQuery('@task @todo',    500),
            this.plugin.data.searchByQuery('@task @overdue', 200),
            this.plugin.data.searchByQuery('@task @due',     300),
        ]);

        if (ver !== this._renderVer) return; // stale — a newer render is in flight

        const todayGuids   = new Set(this._loadTodayGuids());
        const overdueGuids = new Set((overdueResult.lines || []).filter(l => l.type === 'task').map(l => l.guid));
        const datedGuids   = new Set((dueResult.lines   || []).filter(l => l.type === 'task').map(l => l.guid));
        const allTodos     =         (todoResult.lines  || []).filter(l => l.type === 'task');

        // Remove stale today-guids (tasks that are done or deleted)
        const allTodoSet     = new Set(allTodos.map(l => l.guid));
        const cleanTodayGuids = [...todayGuids].filter(g => allTodoSet.has(g));
        if (cleanTodayGuids.length !== todayGuids.size) this._saveTodayGuids(cleanTodayGuids);
        const todaySet = new Set(cleanTodayGuids);

        const overdue = allTodos.filter(l => overdueGuids.has(l.guid));
        const today   = allTodos.filter(l => todaySet.has(l.guid) && !overdueGuids.has(l.guid));
        const inbox   = allTodos.filter(l => !datedGuids.has(l.guid) && !todaySet.has(l.guid));

        el.innerHTML = this._buildHTML(overdue, today, inbox);
        this._applyTheme(el);
        this._attachListeners(el, allTodos);
    }

    _buildHTML(overdue, today, inbox) {
        return `<div class="db-root">
            ${this._section('Overdue',        overdue, 'overdue')}
            ${this._section("Today's Focus",  today,   'today')}
            ${this._section('Inbox',          inbox,   'inbox')}
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
        const pinned = section === 'today';

        return `<div class="db-task" data-guid="${task.guid}">
            <button class="db-done" data-action="done" data-guid="${task.guid}" title="Mark done">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <circle cx="7.5" cy="7.5" r="6.25" stroke="currentColor" stroke-width="1.25"/>
                </svg>
            </button>
            <div class="db-task-body" data-action="open" data-guid="${task.guid}">
                <span class="db-task-text">${text}</span>
                ${source ? `<span class="db-task-source">${source}</span>` : ''}
            </div>
            <button class="db-${pinned ? 'unpin' : 'pin'}"
                data-action="${pinned ? 'unpin' : 'pin'}"
                data-guid="${task.guid}"
                title="${pinned ? 'Remove from Today' : 'Add to Today'}">
                ${pinned ? '×' : '+'}
            </button>
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
                await task.setTaskStatus(PLUGIN_TASK_STATUS_DONE);
                this._removeFromToday(btn.dataset.guid);
            });
        });

        el.querySelectorAll('[data-action="pin"]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); this._addToToday(btn.dataset.guid); });
        });

        el.querySelectorAll('[data-action="unpin"]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); this._removeFromToday(btn.dataset.guid); });
        });

        el.querySelectorAll('[data-action="open"]').forEach(body => {
            body.addEventListener('click', () => {
                const task = byGuid.get(body.dataset.guid);
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
    }

    _applyTheme(el) {
        let node = document.querySelector('.panel') || document.body;
        while (node) {
            const c = getComputedStyle(node).backgroundColor;
            if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') break;
            node = node.parentElement;
        }
        const fg  = getComputedStyle(node || document.body).color;
        const rgb = (fg.match(/\d+/g) || ['150', '150', '150']).slice(0, 3).join(',');
        const root = el.querySelector('.db-root');
        if (root) {
            root.style.setProperty('--db-hover',   `rgba(${rgb},.07)`);
            root.style.setProperty('--db-divider', `rgba(${rgb},.12)`);
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
}

class Plugin extends AppPlugin {
    onLoad() {
        new TodayDashboard(this).load();
    }
}
