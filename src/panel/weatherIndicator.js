// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Weather icon and temperature inside the panel clock, left or right of the
// time. The weather comes from the shared weather source, so it shows the same
// location as the weather card.
export class WeatherIndicator {
    constructor(settings, source) {
        this._settings = settings;
        this._source = source;
        this._settingsSignals = [];

        this._client = null;
        this._clientSignalId = 0;
        this._box = null;
        this._icon = null;
        this._label = null;
    }

    start() {
        for (const key of ['show-weather-indicator', 'weather-position']) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._recreate()));
        }
        this._settingsSignals.push(
            this._settings.connect('changed::weather-display', () => this._applyDisplay()));

        this._create();
        return true;
    }

    destroy() {
        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        this._remove();
    }

    _create() {
        if (!this._settings.get_boolean('show-weather-indicator'))
            return;

        const dateMenu = Main.panel.statusArea.dateMenu;
        const client = this._source;
        const clockDisplay = dateMenu?._clockDisplay ?? null;
        const clockParent = clockDisplay?.get_parent() ?? null;

        if (!client || typeof client.connect !== 'function' || !clockParent) {
            console.warn('Better Calendar Toggle: weather client or panel clock not found, indicator disabled');
            return;
        }
        this._client = client;

        this._box = new St.BoxLayout({
            style_class: 'bct-weather-box',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._icon = new St.Icon({
            style_class: 'bct-weather-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            style_class: 'bct-weather-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._icon);
        this._box.add_child(this._label);

        const clockIndex = clockParent.get_children().indexOf(clockDisplay);
        const left = this._settings.get_string('weather-position') === 'left';
        clockParent.insert_child_at_index(this._box, left ? clockIndex : clockIndex + 1);

        this._clientSignalId = client.connect('changed', () => this._sync());
        this._sync();
    }

    _remove() {
        if (this._client && this._clientSignalId)
            this._client.disconnect(this._clientSignalId);
        this._clientSignalId = 0;
        this._client = null;

        this._box?.destroy();
        this._box = null;
        this._icon = null;
        this._label = null;
    }

    _recreate() {
        this._remove();
        this._create();
    }

    _sync() {
        if (!this._box)
            return;

        const client = this._client;
        if (!client.available || !client.hasLocation) {
            this._box.visible = false;
            return;
        }

        // While a refresh is running, keep showing the last known values.
        if (client.loading)
            return;

        const info = client.info;
        if (!info || (typeof info.is_valid === 'function' && !info.is_valid())) {
            this._box.visible = false;
            return;
        }

        this._icon.icon_name = info.get_symbolic_icon_name();
        this._label.text = info.get_temp_summary?.() ?? info.get_temp?.() ?? '';

        this._applyDisplay();
        this._box.visible = true;
    }

    _applyDisplay() {
        if (!this._box)
            return;

        const mode = this._settings.get_string('weather-display');
        this._icon.visible = mode !== 'temp';
        this._label.visible = mode !== 'icon';
    }
}
