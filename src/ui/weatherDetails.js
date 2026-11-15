// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

const FORECAST_ENTRIES = 5;

// Detailed weather card for the World & Weather page. Clicking it opens GNOME
// Weather. It reuses the weather client of the stock date menu (no extra
// location or weather requests).
export class WeatherDetails {
    constructor(client, text, onActivate) {
        this._client = client;
        this._text = text;
        this._onActivate = onActivate;
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        this._content = new St.BoxLayout({
            style_class: 'bct-weather-card',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this.actor = new St.Button({
            style_class: 'bct-weather-button',
            can_focus: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            visible: false,
            accessible_name: text.openWeather,
            child: this._content,
        });
        this.actor.connect('clicked', () => this._activate());

        // Header: icon, temperature, conditions, location
        const header = new St.BoxLayout({style_class: 'bct-weather-header'});
        this._icon = new St.Icon({
            style_class: 'bct-weather-icon-large',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const summary = new St.BoxLayout({
            style_class: 'bct-weather-summary',
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._temperature = new St.Label({style_class: 'bct-weather-temperature'});
        this._conditions = new St.Label({style_class: 'bct-weather-conditions'});
        summary.add_child(this._temperature);
        summary.add_child(this._conditions);
        this._location = new St.Label({
            style_class: 'bct-weather-location',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
        });
        header.add_child(this._icon);
        header.add_child(summary);
        header.add_child(this._location);

        // Extra height (when the card is stretched) is shared above and below
        // the details, so the card stays balanced.
        this._grid = new St.BoxLayout({
            style_class: 'bct-weather-grid',
            vertical: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._forecast = new St.BoxLayout({style_class: 'bct-weather-forecast'});
        this._forecast.layout_manager.homogeneous = true;
        this._updated = new St.Label({style_class: 'bct-weather-updated'});

        this._content.add_child(header);
        this._content.add_child(this._grid);
        this._content.add_child(this._forecast);
        this._content.add_child(this._updated);

        this._clientId = client.connect('changed', () => this._update());
        this._formatId = this._interfaceSettings.connect(
            'changed::clock-format', () => this._update());
        this._update();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        if (this._clientId)
            this._client.disconnect(this._clientId);
        this._clientId = 0;

        if (this._formatId)
            this._interfaceSettings.disconnect(this._formatId);
        this._formatId = 0;
        this._interfaceSettings = null;
    }

    _activate() {
        try {
            if (typeof this._client.activateApp === 'function') {
                this._client.activateApp();
            } else {
                Gio.DesktopAppInfo.new('org.gnome.Weather.desktop')?.launch([], null);
            }
        } catch (e) {
            console.warn(`Better Calendar Toggle: could not open GNOME Weather: ${e.message}`);
        }
        this._onActivate?.();
    }

    // The city that was chosen, not the name of the nearest weather station.
    _locationName(info) {
        const location = info.location ?? null;
        try {
            const city = location?.get_city_name?.();
            if (city)
                return city;
            const name = location?.get_name?.();
            if (name)
                return name;
        } catch (e) {
            // Fall through to the station name.
        }
        return this._read(info, 'get_location_name') ?? '';
    }

    _read(info, method, ...args) {
        try {
            const value = info[method]?.(...args);
            if (typeof value !== 'string')
                return value ?? null;
            const trimmed = value.trim();
            return trimmed === '' || trimmed === '-' ? null : trimmed;
        } catch (e) {
            return null;
        }
    }

    _update() {
        const client = this._client;
        if (!client.available || !client.hasLocation) {
            this.actor.visible = false;
            return;
        }
        // While a refresh is running, keep showing the last known values.
        if (client.loading)
            return;

        const info = client.info;
        if (!info || (typeof info.is_valid === 'function' && !info.is_valid())) {
            this.actor.visible = false;
            return;
        }

        this._icon.icon_name = this._read(info, 'get_symbolic_icon_name') ?? 'weather-clear-symbolic';
        this._temperature.text = this._read(info, 'get_temp_summary') ??
            this._read(info, 'get_temp') ?? '';
        this._conditions.text = this._read(info, 'get_conditions') ??
            this._read(info, 'get_sky') ?? '';
        this._conditions.visible = this._conditions.text !== '';
        this._location.text = this._locationName(info);

        this._fillGrid(info);
        this._fillForecast(info);

        const updated = this._read(info, 'get_update');
        this._updated.text = updated ? `${this._text.updated}: ${updated}` : '';
        this._updated.visible = Boolean(updated);

        this.actor.visible = true;
    }

    _fillGrid(info) {
        const t = this._text;
        const entries = [
            [t.feelsLike, this._read(info, 'get_apparent')],
            [t.humidity, this._read(info, 'get_humidity')],
            [t.wind, this._read(info, 'get_wind')],
            [t.pressure, this._read(info, 'get_pressure')],
            [t.visibility, this._read(info, 'get_visibility')],
            [t.dewPoint, this._read(info, 'get_dew')],
            [t.sunrise, this._read(info, 'get_sunrise')],
            [t.sunset, this._read(info, 'get_sunset')],
        ].filter(([, value]) => value !== null);

        this._grid.destroy_all_children();
        for (let i = 0; i < entries.length; i += 2) {
            const row = new St.BoxLayout({style_class: 'bct-weather-row'});
            row.layout_manager.homogeneous = true;
            for (const [label, value] of entries.slice(i, i + 2))
                row.add_child(this._makeCell(label, value));
            this._grid.add_child(row);
        }
    }

    _makeCell(label, value) {
        const cell = new St.BoxLayout({
            style_class: 'bct-weather-cell',
            vertical: true,
            x_expand: true,
        });
        cell.add_child(new St.Label({text: label, style_class: 'bct-weather-cell-label'}));
        cell.add_child(new St.Label({text: String(value), style_class: 'bct-weather-cell-value'}));
        return cell;
    }

    _fillForecast(info) {
        this._forecast.destroy_all_children();

        let forecasts = [];
        try {
            forecasts = info.get_forecast_list?.() ?? [];
        } catch (e) {
            forecasts = [];
        }

        const nowSeconds = Date.now() / 1000;
        const format = this._interfaceSettings.get_string('clock-format') === '12h'
            ? '%-I %p'
            : '%H:%M';

        let shown = 0;
        for (const forecast of forecasts) {
            if (shown >= FORECAST_ENTRIES)
                break;

            let timestamp = 0;
            try {
                const [ok, value] = forecast.get_value_update();
                timestamp = ok ? value : 0;
            } catch (e) {
                timestamp = 0;
            }
            if (!timestamp || timestamp < nowSeconds - 1800)
                continue;

            const column = new St.BoxLayout({
                style_class: 'bct-weather-forecast-item',
                vertical: true,
                x_expand: true,
            });
            column.add_child(new St.Label({
                text: GLib.DateTime.new_from_unix_local(timestamp).format(format),
                style_class: 'bct-weather-forecast-time',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            column.add_child(new St.Icon({
                icon_name: this._read(forecast, 'get_symbolic_icon_name') ?? 'weather-clear-symbolic',
                style_class: 'popup-menu-icon',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            column.add_child(new St.Label({
                text: this._read(forecast, 'get_temp_summary') ?? '',
                style_class: 'bct-weather-forecast-temp',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            this._forecast.add_child(column);
            shown++;
        }
        this._forecast.visible = shown > 0;
    }
}
