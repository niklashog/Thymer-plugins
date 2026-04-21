const COLLECTION_CODE = `
class KanbanDependencies {
    constructor(plugin) {
        this.plugin = plugin;
        this._pendingRefreshes = new Map();
    }

    load() {
        this.plugin.ui.injectCSS(
            '.dep-blocked-badge,.dep-blocking-badge{display:flex;align-items:center;gap:5px;' +
            'font-size:11px;font-weight:500;padding:3px 8px;border-radius:4px;margin-top:6px;' +
            'cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;' +
            'white-space:nowrap;user-select:none}' +
            '.dep-blocked-badge{background:#ef4444;color:#fff}' +
            '.dep-blocked-badge.dep-resolved{background:#6b7280;opacity:.55}' +
            '.dep-blocked-badge:hover{opacity:.8}' +
            '.dep-blocking-badge{color:#f59e0b;background:rgba(245,158,11,.12)}' +
            '.dep-blocking-badge:hover{background:rgba(245,158,11,.22)}' +
            '.board-card.dep-is-blocked{border-left:3px solid #ef4444!important}' +
            '.board-card.dep-is-blocking{border-left:3px solid #f59e0b!important}' +
            '.board-card.dep-is-blocked.dep-is-blocking{border-left:3px solid #ef4444!important}'
        );

        this.plugin.views.afterRenderBoardCard(null, ({ viewContext }) => {
            this._scheduleRefresh(viewContext);
        });
    }

    _scheduleRefresh(viewContext) {
        const id = viewContext.instanceId;
        if (this._pendingRefreshes.has(id)) clearTimeout(this._pendingRefreshes.get(id));
        const timer = setTimeout(() => {
            this._pendingRefreshes.delete(id);
            if (viewContext.isDestroyed()) return;
            this._refreshAll(viewContext);
        }, 0);
        this._pendingRefreshes.set(id, timer);
    }

    _refreshAll(viewContext) {
        const records = viewContext.getAllRecords();
        const rootEl  = viewContext.getElement();

        const blockingMap = new Map();
        for (const record of records) {
            const depGuid = record.prop('depends-on') ? record.prop('depends-on').text() : null;
            if (!depGuid || depGuid === record.guid) continue;
            if (!blockingMap.has(depGuid)) blockingMap.set(depGuid, []);
            blockingMap.get(depGuid).push(record);
        }

        for (const record of records) {
            const cardEl = rootEl.querySelector('.board-card[data-guid="' + record.guid + '"]');
            if (!cardEl) continue;

            cardEl.querySelectorAll('.dep-blocked-badge,.dep-blocking-badge').forEach(el => el.remove());
            cardEl.classList.remove('dep-is-blocked', 'dep-is-blocking');

            const depGuid = record.prop('depends-on') ? record.prop('depends-on').text() : null;
            if (depGuid && depGuid !== record.guid) {
                const dep = viewContext.getRecord(depGuid);
                if (dep) {
                    const isDone = dep.prop('status') && dep.prop('status').choice() === 'done';
                    cardEl.classList.add('dep-is-blocked');
                    const badge = document.createElement('div');
                    badge.className = 'dep-blocked-badge' + (isDone ? ' dep-resolved' : '');
                    badge.title = 'Blocked by: ' + dep.getName() + (isDone ? ' (resolved)' : '');
                    badge.innerHTML = '<span>' + (isDone ? '✓' : '⛔') + '</span>' +
                                      '<span>' + this.plugin.ui.htmlEscape(dep.getName()) + '</span>';
                    badge.addEventListener('click', e => {
                        e.stopPropagation();
                        viewContext.openRecordInOtherPanel(depGuid);
                    });
                    cardEl.appendChild(badge);
                }
            }

            const blockedByThis = blockingMap.get(record.guid);
            if (blockedByThis && blockedByThis.length) {
                cardEl.classList.add('dep-is-blocking');
                const label = blockedByThis.length === 1
                    ? ('Blocking: ' + blockedByThis[0].getName())
                    : ('Blocking ' + blockedByThis.length + ' tasks');
                const badge = document.createElement('div');
                badge.className = 'dep-blocking-badge';
                badge.title = blockedByThis.map(r => r.getName()).join(', ');
                badge.innerHTML = '<span>⚡</span>' +
                                  '<span>' + this.plugin.ui.htmlEscape(label) + '</span>';
                badge.addEventListener('click', e => {
                    e.stopPropagation();
                    viewContext.openRecordInOtherPanel(blockedByThis[0].guid);
                });
                cardEl.appendChild(badge);
            }
        }
    }
}

class Plugin extends CollectionPlugin {
    onLoad() {
        new KanbanDependencies(this).load();
    }
}
`;

class Plugin extends AppPlugin {

    onLoad() {
        this.ui.injectCSS(
            '.imagine-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;' +
            'display:flex;align-items:center;justify-content:center}' +
            '.imagine-modal{border-radius:14px;padding:28px 28px 20px;width:420px;' +
            'max-width:calc(100vw - 40px);box-shadow:0 24px 64px rgba(0,0,0,.5)}' +
            '.imagine-modal h2{margin:0 0 6px;font-size:17px;font-weight:600}' +
            '.imagine-modal p{margin:0 0 20px;font-size:13px;opacity:.6}' +
            '.imagine-choices{display:flex;gap:12px;margin-bottom:16px}' +
            '.imagine-choice{flex:1;border:2px solid var(--imagine-border);' +
            'border-radius:10px;padding:14px 12px;cursor:pointer;transition:background .15s,border-color .15s;outline:none}' +
            '.imagine-choice:hover,.imagine-choice:focus{background:var(--imagine-hover)}' +
            '.imagine-choice:focus{border-color:var(--imagine-focus)}' +
            '.imagine-choice-title{font-size:14px;font-weight:600;margin-bottom:8px}' +
            '.imagine-choice-steps{font-size:12px;opacity:.55;line-height:1.7}' +
            '.imagine-cancel{display:block;width:100%;text-align:center;font-size:13px;opacity:.5;' +
            'cursor:pointer;padding:4px;background:none;border:none;color:inherit}' +
            '.imagine-cancel:hover{opacity:.8}'
        );

        this.ui.addCommandPaletteCommand({
            label: 'New Kanban Board',
            icon:  'ti-layout-kanban',
            onSelected: () => this._createBoard(),
        });
    }

    _pickLayout() {
        return new Promise(resolve => {
            // Walk up from a Thymer panel until we hit a solid background
            const startNode = document.querySelector('.panel') || document.body;
            let node = startNode;
            let bg   = null;
            while (node) {
                const c = getComputedStyle(node).backgroundColor;
                if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
                node = node.parentElement;
            }
            // Fallback: detect dark/light from body text color
            if (!bg) {
                const tc  = getComputedStyle(document.body).color;
                const v   = (tc.match(/\d+/g) || []).map(Number);
                const lum = v.length >= 3 ? (v[0] * 299 + v[1] * 587 + v[2] * 114) / 1000 : 0;
                bg = lum > 128 ? '#1f1f2e' : '#f5f5f5';
            }
            // Read fg from the node where bg was found, or fall back to start node
            const fg  = getComputedStyle(node || startNode).color;
            const rgb = (fg.match(/\d+/g) || ['180', '180', '180']).slice(0, 3).join(',');

            const overlay = document.createElement('div');
            overlay.className = 'imagine-overlay';

            let resolved = false;
            const done = (val) => {
                if (resolved) return;
                resolved = true;
                document.body.removeChild(overlay);
                resolve(val);
            };

            overlay.addEventListener('click', e => { if (e.target === overlay) done(null); });

            overlay.innerHTML =
                '<div class="imagine-modal">' +
                  '<h2>New Board</h2>' +
                  '<p>Choose your workflow layout</p>' +
                  '<div class="imagine-choices">' +
                    '<div class="imagine-choice" tabindex="0" role="button" data-steps="3">' +
                      '<div class="imagine-choice-title">3-step</div>' +
                      '<div class="imagine-choice-steps">To Do<br>Doing<br>Done</div>' +
                    '</div>' +
                    '<div class="imagine-choice" tabindex="0" role="button" data-steps="4">' +
                      '<div class="imagine-choice-title">4-step</div>' +
                      '<div class="imagine-choice-steps">To Do<br>In Progress<br>In Review<br>Done</div>' +
                    '</div>' +
                  '</div>' +
                  '<button class="imagine-cancel" tabindex="0">Cancel</button>' +
                '</div>';

            const modal   = overlay.querySelector('.imagine-modal');
            const choices = [...overlay.querySelectorAll('.imagine-choice')];
            const cancel  = overlay.querySelector('.imagine-cancel');

            modal.style.background = bg;
            modal.style.color      = fg;
            modal.style.setProperty('--imagine-border', `rgba(${rgb},.15)`);
            modal.style.setProperty('--imagine-hover',  `rgba(${rgb},.07)`);
            modal.style.setProperty('--imagine-focus',  `rgba(${rgb},.6)`);

            choices.forEach(el => {
                el.addEventListener('click', () => done(Number(el.dataset.steps)));
                el.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(Number(el.dataset.steps)); }
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); choices[(choices.indexOf(el) + 1) % choices.length].focus(); }
                    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); choices[(choices.indexOf(el) - 1 + choices.length) % choices.length].focus(); }
                    if (e.key === 'Escape') done(null);
                    if (e.key === 'Tab' && !e.shiftKey && el === choices[choices.length - 1]) { e.preventDefault(); cancel.focus(); }
                    if (e.key === 'Tab' &&  e.shiftKey && el === choices[0])                  { e.preventDefault(); cancel.focus(); }
                });
            });

            cancel.addEventListener('click', () => done(null));
            cancel.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(null); }
                if (e.key === 'Escape') done(null);
                if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); choices[0].focus(); }
                if (e.key === 'Tab' &&  e.shiftKey) { e.preventDefault(); choices[choices.length - 1].focus(); }
            });

            document.body.appendChild(overlay);
            choices[0].focus();
        });
    }

    async _createBoard() {
        const steps = await this._pickLayout();

        if (!steps) return;

        const toaster = this.ui.addToaster({
            title: 'Creating board…',
            dismissible: false,
        });

        try {
            const collection = await this.data.createCollection();
            if (!collection) {
                toaster.destroy();
                this.ui.addToaster({ title: 'Could not create collection', dismissible: true, autoDestroyTime: 4000 });
                return;
            }

            const conf = JSON.parse(JSON.stringify(this.getConfiguration().custom.collectionConf));

            if (steps === 3) {
                const statusField = conf.fields.find(f => f.id === 'status');
                if (statusField) {
                    statusField.choices = [
                        { id: 'todo',  label: 'To Do', color: '9', icon: '', active: true },
                        { id: 'doing', label: 'Doing', color: '4', icon: '', active: true },
                        { id: 'done',  label: 'Done',  color: '2', icon: '', active: true },
                    ];
                }
            }

            const dependsOnField = conf.fields.find(f => f.id === 'depends-on');
            if (dependsOnField) {
                dependsOnField.filter_colguid = collection.getGuid();
            }
            await collection.savePlugin(conf, COLLECTION_CODE);

            const panel = this.ui.getActivePanel();
            if (panel) {
                panel.navigateTo({
                    type: 'overview',
                    rootId: collection.getGuid(),
                    subId: null,
                    workspaceGuid: this.getWorkspaceGuid(),
                });
            }

            toaster.destroy();
            this.ui.addToaster({ title: 'Board created!', dismissible: true, autoDestroyTime: 3000 });
        } catch (err) {
            toaster.destroy();
            this.ui.addToaster({ title: 'Something went wrong', message: String(err), dismissible: true, autoDestroyTime: 6000 });
        }
    }
}
