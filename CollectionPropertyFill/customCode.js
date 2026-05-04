class Plugin extends AppPlugin {
    onLoad() {
        this.ui.injectCSS(
            '.cpf-overlay{position:fixed;inset:0;background:color-mix(in srgb,var(--ed-text-color) 45%,transparent);z-index:99999;' +
            'display:flex;align-items:center;justify-content:center}' +
            '.cpf-modal{width:460px;max-width:calc(100vw - 32px);border-radius:12px;padding:22px;' +
            'box-shadow:var(--color-shadow-hover);background:var(--input-bg-color);color:var(--ed-text-color)}' +
            '.cpf-modal h2{margin:0 0 6px;font-size:17px;font-weight:600}' +
            '.cpf-modal p{margin:0 0 18px;font-size:13px;opacity:.68;line-height:1.35}' +
            '.cpf-field{margin-bottom:14px}' +
            '.cpf-field label{display:block;margin-bottom:6px;font-size:12px;font-weight:600;opacity:.72}' +
            '.cpf-field select,.cpf-field input,.cpf-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--input-border-color);' +
            'border-radius:7px;background:var(--input-bg-color);color:var(--ed-text-color);padding:9px 10px;font:inherit;font-size:13px;outline:none}' +
            '.cpf-field select option{background:var(--input-bg-color);color:var(--ed-text-color)}' +
            '.cpf-field textarea{min-height:86px;resize:vertical}' +
            '.cpf-field select:focus,.cpf-field input:focus,.cpf-field textarea:focus{border-color:var(--ed-link-color)}' +
            '.cpf-row{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}' +
            '.cpf-button{border:1px solid var(--input-border-color);border-radius:7px;background:transparent;color:inherit;' +
            'font:inherit;font-size:13px;padding:8px 12px;cursor:pointer}' +
            '.cpf-button:hover,.cpf-button:focus{background:var(--cards-hover-bg);outline:none}' +
            '.cpf-button-primary{background:var(--ed-button-primary-bg);border-color:var(--ed-button-primary-bg);color:var(--ed-button-primary-color)}' +
            '.cpf-button-primary:hover,.cpf-button-primary:focus{filter:brightness(1.05)}' +
            '.cpf-message{font-size:12px;line-height:1.35;margin-top:10px;opacity:.72}' +
            '.cpf-error{color:var(--ed-error-color);opacity:1}'
        );

        this.ui.addCommandPaletteCommand({
            label: 'Fill Collection Property',
            icon: 'ti-adjustments',
            onSelected: () => this._openDialog(),
        });
    }

    async _openDialog() {
        const overlay = this._createOverlay();
        document.body.appendChild(overlay);

        const refs = this._renderDialog(overlay);
        refs.cancel.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.remove();
        });
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') overlay.remove();
        });

        let collections = [];
        try {
            collections = await this.data.getAllCollections();
        } catch (err) {
            refs.message.textContent = 'Could not load collections: ' + String(err);
            refs.message.classList.add('cpf-error');
            return;
        }

        refs.collection.innerHTML = collections.length
            ? collections.map(collection => (
                '<option value="' + this._esc(collection.getGuid()) + '">' +
                this._esc(collection.getName()) +
                '</option>'
            )).join('')
            : '<option value="">No collections found</option>';
        refs.apply.disabled = !collections.length;

        const refreshProperties = () => {
            const collection = collections.find(c => c.getGuid() === refs.collection.value);
            const fields = this._editableTextFields(collection);
            refs.property.innerHTML =
                '<option value="__new__">New text property...</option>' +
                fields.map(field => (
                    '<option value="' + this._esc(field.id) + '">' +
                    this._esc(field.label || field.id) +
                    '</option>'
                )).join('');
            refs.propertyName.value = '';
            refs.propertyName.disabled = refs.property.value !== '__new__';
        };

        refs.collection.addEventListener('change', refreshProperties);
        refs.property.addEventListener('change', () => {
            refs.propertyName.disabled = refs.property.value !== '__new__';
            if (!refs.propertyName.disabled) refs.propertyName.focus();
        });
        refs.apply.addEventListener('click', () => {
            this._applyToCollection(collections, refs, overlay);
        });

        refreshProperties();
        refs.collection.focus();
    }

    _createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'cpf-overlay';
        overlay.tabIndex = -1;
        return overlay;
    }

    _renderDialog(overlay) {
        overlay.innerHTML =
            '<div class="cpf-modal" role="dialog" aria-modal="true">' +
                '<h2>Fill Collection Property</h2>' +
                '<p>Choose a collection and set one text property value on every note in it.</p>' +
                '<div class="cpf-field">' +
                    '<label>Collection</label>' +
                    '<select data-ref="collection"><option>Loading...</option></select>' +
                '</div>' +
                '<div class="cpf-field">' +
                    '<label>Property</label>' +
                    '<select data-ref="property"></select>' +
                '</div>' +
                '<div class="cpf-field">' +
                    '<label>New property name</label>' +
                    '<input data-ref="propertyName" placeholder="Example: Source" />' +
                '</div>' +
                '<div class="cpf-field">' +
                    '<label>Value</label>' +
                    '<textarea data-ref="value" placeholder="Text to write to every note"></textarea>' +
                '</div>' +
                '<div data-ref="message" class="cpf-message"></div>' +
                '<div class="cpf-row">' +
                    '<button class="cpf-button" data-ref="cancel">Cancel</button>' +
                    '<button class="cpf-button cpf-button-primary" data-ref="apply">Apply</button>' +
                '</div>' +
            '</div>';

        return {
            collection: overlay.querySelector('[data-ref="collection"]'),
            property: overlay.querySelector('[data-ref="property"]'),
            propertyName: overlay.querySelector('[data-ref="propertyName"]'),
            value: overlay.querySelector('[data-ref="value"]'),
            message: overlay.querySelector('[data-ref="message"]'),
            cancel: overlay.querySelector('[data-ref="cancel"]'),
            apply: overlay.querySelector('[data-ref="apply"]'),
        };
    }

    _editableTextFields(collection) {
        if (!collection) return [];
        const conf = collection.getConfiguration();
        return (conf.fields || []).filter(field =>
            field &&
            field.active !== false &&
            field.read_only !== true &&
            field.type === 'text'
        );
    }

    async _applyToCollection(collections, refs, overlay) {
        refs.message.textContent = '';
        refs.message.classList.remove('cpf-error');

        const collection = collections.find(c => c.getGuid() === refs.collection.value);
        if (!collection) {
            this._showError(refs, 'Choose a collection first.');
            return;
        }

        const conf = collection.getConfiguration();
        let fieldId = refs.property.value;

        if (fieldId === '__new__') {
            const label = refs.propertyName.value.trim();
            if (!label) {
                this._showError(refs, 'Enter a property name.');
                return;
            }
            const existing = (conf.fields || []).find(field =>
                (field.label || '').toLowerCase() === label.toLowerCase() ||
                (field.id || '').toLowerCase() === label.toLowerCase()
            );
            if (existing) {
                if (existing.type !== 'text' || existing.read_only) {
                    this._showError(refs, 'A non-editable or non-text property with that name already exists.');
                    return;
                }
                fieldId = existing.id;
            } else {
                fieldId = this._addTextField(conf, label);
                const saved = await collection.saveConfiguration(conf);
                if (!saved) {
                    this._showError(refs, 'Could not save the new property on the collection.');
                    return;
                }
            }
        }

        refs.apply.disabled = true;
        refs.cancel.disabled = true;
        refs.message.textContent = 'Updating notes...';

        try {
            const records = await collection.getAllRecords();
            let updated = 0;
            let failed = 0;
            for (const record of records) {
                const prop = record.prop(fieldId);
                if (!prop) {
                    failed++;
                    continue;
                }
                try {
                    prop.set(refs.value.value);
                    updated++;
                } catch (err) {
                    failed++;
                    console.error('[Collection Property Fill] failed to update record', record.guid, err);
                }
            }

            overlay.remove();
            this.ui.addToaster({
                title: 'Collection Property Fill',
                message: 'Updated ' + updated + ' notes' + (failed ? ', failed ' + failed : '') + '.',
                dismissible: true,
                autoDestroyTime: failed ? 6000 : 3500,
            });
        } catch (err) {
            refs.apply.disabled = false;
            refs.cancel.disabled = false;
            this._showError(refs, 'Update failed: ' + String(err));
        }
    }

    _addTextField(conf, label) {
        if (!conf.fields) conf.fields = [];
        if (!conf.page_field_ids) conf.page_field_ids = [];

        const base = label.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'property';
        const used = new Set(conf.fields.map(field => field.id));
        let fieldId = base;
        let suffix = 2;
        while (used.has(fieldId)) {
            fieldId = base + '-' + suffix;
            suffix++;
        }

        conf.fields.push({
            id: fieldId,
            label: label,
            type: 'text',
            icon: 'ti-abc',
            many: false,
            read_only: false,
            active: true,
        });

        if (!conf.page_field_ids.includes(fieldId)) {
            conf.page_field_ids.push(fieldId);
        }

        return fieldId;
    }

    _showError(refs, message) {
        refs.message.textContent = message;
        refs.message.classList.add('cpf-error');
    }

    _esc(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
