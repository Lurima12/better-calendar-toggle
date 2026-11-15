// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Format codes that change every second and therefore need a 1 s refresh.
const SECONDS_CODE = /%[-_0^#]*[SsTXrc+]/;

// Replaces the date and time text on the top bar using a GLib format string.
export class ClockFormatter {
    constructor(settings) {
        this._settings = settings;
        this._settingsSignals = [];

        this._label = null;
        this._clock = null;
        this._clockSignalId = 0;
        this._timerId = 0;
    }

    start() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        this._label = dateMenu?._clockDisplay ?? null;
        this._clock = dateMenu?._clock ?? null;

        if (!this._label || !this._clock) {
            console.warn('Better Calendar Toggle: panel clock not found, formatter disabled');
            return false;
        }

        // Runs after the stock handler, so our text wins on every clock tick.
        this._clockSignalId = this._clock.connect_after('notify::clock', () => this._update());

        for (const key of ['use-custom-clock-format', 'clock-format']) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._apply()));
        }

        this._apply();
        return true;
    }

    destroy() {
        this._stopTimer();

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        if (this._clock && this._clockSignalId)
            this._clock.disconnect(this._clockSignalId);
        this._clockSignalId = 0;

        this._restoreStockText();

        this._label = null;
        this._clock = null;
    }

    _apply() {
        this._stopTimer();

        if (!this._enabled()) {
            this._restoreStockText();
            return;
        }

        this._update();

        if (SECONDS_CODE.test(this._settings.get_string('clock-format'))) {
            this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _update() {
        if (!this._enabled() || !this._label)
            return;

        const text = this._format();
        this._label.text = text ?? this._clock.clock;
    }

    _format() {
        const format = this._settings.get_string('clock-format');
        if (format === '')
            return null;

        try {
            const text = GLib.DateTime.new_now_local().format(format);
            return text && text.length > 0 ? text : null;
        } catch (e) {
            return null;
        }
    }

    _enabled() {
        return this._settings.get_boolean('use-custom-clock-format');
    }

    _restoreStockText() {
        if (this._label && this._clock)
            this._label.text = this._clock.clock;
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
    }
}
