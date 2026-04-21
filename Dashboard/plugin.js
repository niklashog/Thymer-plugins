export class Plugin extends CollectionPlugin {

    onLoad() {
        this.ui.injectCSS(`
            .td-root {
                display: flex;
                height: 100%;
                overflow: hidden;
                font-family: var(--font-family);
                background: var(--bg-default);
            }

            /* ── Sidebar ─────────────────────────────────────── */

            .td-sidebar {
                width: 220px;
                flex-shrink: 0;
                display: flex;
                flex-direction: column;
                background: var(--bg-sidebar, var(--bg-hover));
                border-right: 1px solid var(--border-default);
                overflow-y: auto;
                padding: 12px 8px;
                gap: 2px;
            }

            .td-sidebar-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 4px 8px 10px;
                color: var(--text-default);
                font-size: 14px;
                font-weight: 600;
            }

            .td-sidebar-refresh {
                background: none;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                transition: color 0.15s;
            }

            .td-sidebar-refresh:hover { color: var(--text-default); }

            .td-sidebar-refresh.spinning svg {
                animation: td-spin 0.7s linear infinite;
            }

            @keyframes td-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            .td-section-btn {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 10px;
                border-radius: 7px;
                cursor: pointer;
                border: none;
                background: none;
                width: 100%;
                text-align: left;
                transition: background 0.12s;
                gap: 8px;
            }

            .td-section-btn:hover  { background: var(--bg-active); }
            .td-section-btn.active { background: var(--bg-active); }

            .td-section-btn-left {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
            }

            .td-section-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                flex-shrink: 0;
            }

            .td-section-btn-text {
                display: flex;
                flex-direction: column;
                min-width: 0;
            }

            .td-section-btn-label {
                font-size: 13px;
                font-weight: 500;
                color: var(--text-default);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .td-section-btn-sub {
                font-size: 11px;
                color: var(--text-muted);
                white-space: nowrap;
            }

            .td-section-count {
                font-size: 11px;
                color: var(--text-muted);
                background: var(--bg-default);
                border-radius: 10px;
                padding: 1px 7px;
                flex-shrink: 0;
                min-width: 20px;
                text-align: center;
            }

            .td-section-btn.active .td-section-count { background: var(--bg-hover); }

            /* ── Main area ───────────────────────────────────── */

            .td-main {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .td-main-header {
                padding: 20px 24px 12px;
                flex-shrink: 0;
            }

            .td-main-title {
                font-size: 22px;
                font-weight: 700;
                color: var(--text-default);
                margin-bottom: 4px;
            }

            .td-main-sub {
                font-size: 13px;
                color: var(--text-muted);
            }

            .td-task-list {
                flex: 1;
                overflow-y: auto;
                padding: 0 16px 16px;
            }

            /* ── Task rows ───────────────────────────────────── */

            .td-task-row {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 10px;
                border-radius: 7px;
                transition: background 0.12s;
                border-bottom: 1px solid var(--border-default);
            }

            .td-task-row:last-child  { border-bottom: none; }
            .td-task-row:hover       { background: var(--bg-hover); }

            /* Completed task: faded + strikethrough */
            .td-task-row.td-done {
                opacity: 0.4;
            }
            .td-task-row.td-done .td-task-name {
                text-decoration: line-through;
                color: var(--text-muted);
            }

            /* ── Checkbox ───────────────────────────────────── */

            .td-root .line-check-div {
                margin-left: 0 !important;
                flex-shrink: 0;
                position: relative;
            }

            .td-root .line-check-div.td-check--started::after,
            .td-root .line-check-div.td-check--waiting::after,
            .td-root .line-check-div.td-check--important::after,
            .td-root .line-check-div.td-check--billable::after,
            .td-root .line-check-div.td-check--discuss::after,
            .td-root .line-check-div.td-check--alert::after,
            .td-root .line-check-div.td-check--starred::after {
                content: '';
                position: absolute;
                inset: 0;
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
            }

            .td-root .line-check-div.td-check--started::after   { background-image: var(--ed-check-started-icon); }
            .td-root .line-check-div.td-check--waiting::after   { background-image: var(--ed-check-blocked-icon); }
            .td-root .line-check-div.td-check--important::after { background-image: var(--ed-check-exclaim-icon); }
            .td-root .line-check-div.td-check--billable::after  { background-image: var(--ed-check-dollar-icon);  }
            .td-root .line-check-div.td-check--discuss::after   { background-image: var(--ed-check-question-icon);}
            .td-root .line-check-div.td-check--alert::after     { background-image: var(--ed-check-alert-icon);   }
            .td-root .line-check-div.td-check--starred::after   { background-image: var(--ed-check-starred-icon); }

            /* ── Task name & meta ────────────────────────────── */

            .td-task-name {
                flex: 1;
                font-size: 13px;
                color: var(--text-default);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .td-task-record {
                font-size: 11px;
                color: var(--text-muted);
                white-space: nowrap;
                flex-shrink: 0;
                max-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            /* ── Date chip ───────────────────────────────────── */

            .td-task-chip {
                font-size: 11px;
                padding: 2px 8px;
                border-radius: 4px;
                white-space: nowrap;
                flex-shrink: 0;
            }

            .td-chip--overdue  { background: rgba(239,68,68,0.15);  color: #f87171; }
            .td-chip--today    { background: rgba(245,158,11,0.15);  color: #fbbf24; }
            .td-chip--tomorrow { background: rgba(59,130,246,0.15);  color: #60a5fa; }
            .td-chip--week     { background: rgba(139,92,246,0.15);  color: #a78bfa; }
            .td-chip--later    { background: var(--bg-hover);        color: var(--text-muted); }

            .td-dot--overdue  { background: #ef4444; }
            .td-dot--today    { background: #f59e0b; }
            .td-dot--tomorrow { background: #3b82f6; }
            .td-dot--week     { background: #8b5cf6; }
            .td-dot--later    { background: var(--text-muted); }

            .td-empty   { text-align: center; color: var(--text-muted); padding: 48px 20px; font-size: 13px; }
            .td-loading { text-align: center; color: var(--text-muted); padding: 48px 20px; font-size: 13px; }
        `);

        this.views.register("Dashboard", (viewContext) => {

            const SECTIONS = [
                { key: "overdue",  label: "Försenade",    sub: "Passerat förfallodatum", chipCls: "td-chip--overdue",  dotCls: "td-dot--overdue" },
                { key: "today",    label: "Idag",         sub: "Förfaller idag",         chipCls: "td-chip--today",    dotCls: "td-dot--today" },
                { key: "tomorrow", label: "Imorgon",      sub: "Förfaller imorgon",      chipCls: "td-chip--tomorrow", dotCls: "td-dot--tomorrow" },
                { key: "week",     label: "Denna veckan", sub: "Inom 7 dagar",           chipCls: "td-chip--week",     dotCls: "td-dot--week" },
                { key: "later",    label: "Senare",       sub: "Längre fram",            chipCls: "td-chip--later",    dotCls: "td-dot--later" },
            ];

            const STATUSES = [
                { key: "none",      label: "No status",         icon: "ti-circle-x" },
                { key: "started",   label: "In Progress",       icon: "ti-player-play" },
                { key: "waiting",   label: "Blocked (Waiting)", icon: "ti-player-pause" },
                { key: "billable",  label: "Cost-related",      icon: "ti-currency-dollar" },
                { key: "important", label: "Important",         icon: "ti-alert-square" },
                { key: "discuss",   label: "Discuss/Question",  icon: "ti-help" },
                { key: "alert",     label: "Alert",             icon: "ti-alert-triangle" },
                { key: "starred",   label: "Starred",           icon: "ti-star" },
            ];

            let groups = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
            let activeSection = "today";
            /** @type {HTMLElement|null} */
            let rootEl = null;
            /** @type {HTMLElement|null} */
            let activePopup = null;
            /** guid → checkbox element, for reactive status icon updates */
            const checkboxMap = new Map();
            let statusEventHandlerId = null;

            const closePopup = () => {
                if (activePopup) { activePopup.remove(); activePopup = null; }
            };

            const applyStatusToCheckbox = (checkbox, status) => {
                checkbox.className = "line-check-div clickable tooltip";
                if (status && status !== "none") checkbox.classList.add(`td-check--${status}`);
            };

            const showStatusPopup = (task, anchor, checkbox) => {
                closePopup();

                const rect = anchor.getBoundingClientRect();
                const popup = document.createElement("div");
                popup.className = "cmdpal--inline animate-open active";
                popup.style.cssText = `position:fixed; width:220px; max-width:calc(100vw - 20px); z-index:9999; top:${rect.bottom + 4}px; left:${rect.left}px;`;

                const inner = document.createElement("div");
                inner.className = "autocomplete clickable";
                inner.style.cssText = "position:relative; overflow:hidden;";

                const scroll = document.createElement("div");
                scroll.className = "vscroll-node";
                scroll.style.cssText = "overflow-y:auto; scrollbar-width:none;";

                for (const s of STATUSES) {
                    const opt = document.createElement("div");
                    opt.className = "autocomplete--option clickable";

                    const iconSpan = document.createElement("span");
                    iconSpan.className = "autocomplete--option-icon";
                    const icon = document.createElement("span");
                    icon.className = `ti ${s.icon}`;
                    iconSpan.appendChild(icon);

                    const labelSpan = document.createElement("span");
                    labelSpan.className = "autocomplete--option-label";
                    labelSpan.textContent = s.label;

                    opt.appendChild(iconSpan);
                    opt.appendChild(labelSpan);

                    opt.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        closePopup();
                        await task.setTaskStatus(s.key);
                        applyStatusToCheckbox(checkbox, s.key);
                    });

                    scroll.appendChild(opt);
                }

                inner.appendChild(scroll);
                popup.appendChild(inner);
                document.body.appendChild(popup);
                activePopup = popup;
            };

            const getTaskText = (li) =>
                li.segments.filter(s => s.type !== "datetime" && typeof s.text === "string")
                    .map(s => s.text).join("").trim() || "(namnlös uppgift)";

            const getDueDate = (li) => {
                const seg = li.segments.find(s => s.type === "datetime");
                if (!seg?.text) return null;
                try { return new DateTime(seg.text).toDate(); } catch { return null; }
            };

            const formatDate = (date) => {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const diff = Math.floor((date - today) / 86400000);
                if (diff < 0) return Math.abs(diff) === 1 ? "igår" : `${Math.abs(diff)}d sedan`;
                if (diff === 0) return "idag";
                if (diff === 1) return "imorgon";
                const mo = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
                return `${date.getDate()} ${mo[date.getMonth()]}`;
            };

            const groupTasks = (tasks) => {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today.getTime() + 86400000);
                const weekEnd  = new Date(today.getTime() + 7 * 86400000);
                const g = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
                for (const task of tasks) {
                    const due = getDueDate(task);
                    if (!due) continue;
                    const d = new Date(due); d.setHours(0, 0, 0, 0);
                    if (d < today)                               g.overdue.push(task);
                    else if (d.getTime() === today.getTime())    g.today.push(task);
                    else if (d.getTime() === tomorrow.getTime()) g.tomorrow.push(task);
                    else if (d < weekEnd)                        g.week.push(task);
                    else                                         g.later.push(task);
                }
                return g;
            };

            const renderTaskRow = (task, section) => {
                const row = document.createElement("div");
                row.className = "td-task-row";

                // ── Checkbox — vänsterklick = klar, högerklick = statusväljare ──
                const checkbox = document.createElement("div");
                checkbox.className = "line-check-div clickable tooltip";
                checkbox.setAttribute("data-tooltip", "Klick: klar  |  Högerklick: status");
                checkbox.setAttribute("data-tooltip-dir", "top");

                checkbox.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await task.setTaskStatus("done");
                    row.classList.add("td-done");
                    row.parentElement?.appendChild(row);
                });

                checkbox.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showStatusPopup(task, checkbox, checkbox);
                });

                applyStatusToCheckbox(checkbox, task.getTaskStatus() || "none");
                checkboxMap.set(task.guid, checkbox);

                // ── Name ──
                const name = document.createElement("span");
                name.className = "td-task-name";
                name.textContent = getTaskText(task);
                name.title = name.textContent;

                // ── Record ──
                const record = task.getRecord();
                const recSpan = document.createElement("span");
                recSpan.className = "td-task-record";
                recSpan.textContent = record?.getName() || "";
                recSpan.title = recSpan.textContent;

                // ── Date chip ──
                const due = getDueDate(task);
                const chip = document.createElement("span");
                chip.className = `td-task-chip ${section.chipCls}`;
                chip.textContent = due ? formatDate(due) : "";

                row.appendChild(checkbox);
                row.appendChild(name);
                row.appendChild(recSpan);
                row.appendChild(chip);

                return row;
            };

            const renderTaskList = () => {
                if (!rootEl) return;
                const list  = rootEl.querySelector(".td-task-list");
                const title = rootEl.querySelector(".td-main-title");
                const sub   = rootEl.querySelector(".td-main-sub");
                if (!list || !title || !sub) return;

                const section = SECTIONS.find(s => s.key === activeSection);
                title.textContent = section.label;
                sub.textContent   = section.sub;

                const tasks = groups[activeSection] || [];
                list.innerHTML = "";

                if (tasks.length === 0) {
                    list.innerHTML = `<div class="td-empty">Inga uppgifter här.</div>`;
                    return;
                }

                checkboxMap.clear();
                for (const task of tasks) {
                    list.appendChild(renderTaskRow(task, section));
                }
            };

            const renderSidebar = () => {
                if (!rootEl) return;
                const sidebar = rootEl.querySelector(".td-sidebar-sections");
                if (!sidebar) return;
                sidebar.innerHTML = "";

                for (const section of SECTIONS) {
                    const btn = document.createElement("button");
                    btn.className = `td-section-btn${activeSection === section.key ? " active" : ""}`;

                    const left = document.createElement("div");
                    left.className = "td-section-btn-left";

                    const dot = document.createElement("div");
                    dot.className = `td-section-dot ${section.dotCls}`;

                    const text = document.createElement("div");
                    text.className = "td-section-btn-text";

                    const label = document.createElement("span");
                    label.className = "td-section-btn-label";
                    label.textContent = section.label;

                    const s = document.createElement("span");
                    s.className = "td-section-btn-sub";
                    s.textContent = `${(groups[section.key] || []).length} uppgifter`;

                    text.appendChild(label);
                    text.appendChild(s);
                    left.appendChild(dot);
                    left.appendChild(text);

                    const count = document.createElement("span");
                    count.className = "td-section-count";
                    count.textContent = (groups[section.key] || []).length;

                    btn.appendChild(left);
                    btn.appendChild(count);

                    btn.addEventListener("click", () => {
                        activeSection = section.key;
                        renderSidebar();
                        renderTaskList();
                    });

                    sidebar.appendChild(btn);
                }
            };

            const loadAndRender = async () => {
                if (!rootEl) return;
                const list = rootEl.querySelector(".td-task-list");
                if (list) list.innerHTML = `<div class="td-loading">Laddar…</div>`;

                let result;
                try {
                    result = await this.data.searchByQuery("@due", 1000);
                } catch {
                    if (list) list.innerHTML = `<div class="td-empty">Kunde inte hämta uppgifter.</div>`;
                    return;
                }

                const tasks = (result.lines || []).filter(
                    li => li.type === "task" && !li.isTaskCompleted()
                );

                groups = groupTasks(tasks);

                const first = SECTIONS.find(s => (groups[s.key] || []).length > 0);
                if (first && (groups[activeSection] || []).length === 0) {
                    activeSection = first.key;
                }

                renderSidebar();
                renderTaskList();
            };

            const buildLayout = () => {
                const el = viewContext.getElement();
                el.innerHTML = "";

                rootEl = document.createElement("div");
                rootEl.className = "td-root";

                const sidebar = document.createElement("div");
                sidebar.className = "td-sidebar";

                const sidebarHeader = document.createElement("div");
                sidebarHeader.className = "td-sidebar-header";

                const sidebarTitle = document.createElement("span");
                sidebarTitle.textContent = "Uppgifter";

                const refreshBtn = document.createElement("button");
                refreshBtn.className = "td-sidebar-refresh";
                refreshBtn.title = "Uppdatera";
                refreshBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
                refreshBtn.addEventListener("click", async () => {
                    refreshBtn.classList.add("spinning");
                    await loadAndRender();
                    refreshBtn.classList.remove("spinning");
                });

                sidebarHeader.appendChild(sidebarTitle);
                sidebarHeader.appendChild(refreshBtn);
                sidebar.appendChild(sidebarHeader);

                const sections = document.createElement("div");
                sections.className = "td-sidebar-sections";
                sidebar.appendChild(sections);

                const main = document.createElement("div");
                main.className = "td-main";

                const mainHeader = document.createElement("div");
                mainHeader.className = "td-main-header";

                const mainTitle = document.createElement("div");
                mainTitle.className = "td-main-title";

                const mainSub = document.createElement("div");
                mainSub.className = "td-main-sub";

                mainHeader.appendChild(mainTitle);
                mainHeader.appendChild(mainSub);

                const taskList = document.createElement("div");
                taskList.className = "td-task-list";

                main.appendChild(mainHeader);
                main.appendChild(taskList);

                rootEl.appendChild(sidebar);
                rootEl.appendChild(main);
                el.appendChild(rootEl);

                document.addEventListener("click", () => closePopup());

            };

            return {
                onLoad: () => {
                    buildLayout();
                    loadAndRender();
                    statusEventHandlerId = this.events.on("lineitem.updated", (ev) => {
                        if (ev.status === null) return;
                        const cb = checkboxMap.get(ev.lineItemGuid);
                        if (cb) applyStatusToCheckbox(cb, ev.status);
                    });
                },
                onRefresh:            () => { loadAndRender(); },
                onPanelResize:        () => {},
                onDestroy:            () => {
                    closePopup();
                    if (statusEventHandlerId) {
                        this.events.off(statusEventHandlerId);
                        statusEventHandlerId = null;
                    }
                    checkboxMap.clear();
                    rootEl = null;
                },
                onFocus:              () => {},
                onBlur:               () => { closePopup(); },
                onKeyboardNavigation: () => {},
            };
        });
    }
}
