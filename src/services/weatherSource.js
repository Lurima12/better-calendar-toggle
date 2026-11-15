// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {loadGWeather} from './gweather.js';

// Where GNOME keeps the saved cities. GNOME Weather has its own list, and the
// shell keeps one for the date menu; either can hold the city you picked.
const SAVED_CITY_SCHEMAS = ['org.gnome.Weather', 'org.gnome.shell.weather'];
const REFRESH_SECONDS = 600;

// Provides the weather that the card and the panel indicator show.
//
// The date menu's own weather client follows the location setting of GNOME
// Shell, which can differ from the city you saved in GNOME Weather (for
// example when "automatic location" is on, it shows the nearest big city). So,
// by default, weather is fetched here for the first city saved in GNOME
// Weather, ignoring automatic location. Settings can switch to the date
// menu's own location, or to a city typed in the preferences. When no city can
// be found, the date menu's weather client is used unchanged.
//
// It offers the same API as that client: available, hasLocation, loading,
// info, activateApp() and a 'changed' signal.
export class WeatherSource extends Signals.EventEmitter {
    constructor() {
        super();

        this._destroyed = false;
        this._token = 0;
        this._mode = 'shell';
        // True until it is known which location to use, so the location of the
        // stock date menu is never shown for a moment by mistake.
        this._resolving = true;

        this._shellClient = null;
        this._shellClientId = 0;

        this._savedSettings = [];
        this._savedSettingsIds = [];

        this._GWeather = null;
        this._info = null;
        this._infoId = 0;
        this._loading = false;
        this._timerId = 0;
    }

    get available() {
        if (this._resolving)
            return false;
        return this._mode === 'own' ? true : Boolean(this._shellClient?.available);
    }

    get hasLocation() {
        if (this._resolving)
            return false;
        return this._mode === 'own' ? true : Boolean(this._shellClient?.hasLocation);
    }

    get loading() {
        return this._mode === 'own' ? this._loading : Boolean(this._shellClient?.loading);
    }

    get info() {
        return this._mode === 'own' ? this._info : (this._shellClient?.info ?? null);
    }

    start() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        this._shellClient = dateMenu?._weatherItem?._weatherClient ?? null;
        if (this._shellClient && typeof this._shellClient.connect === 'function') {
            this._shellClientId = this._shellClient.connect('changed', () => {
                if (this._mode === 'shell' && !this._resolving)
                    this.emit('changed');
            });
        }

        const schemaSource = Gio.SettingsSchemaSource.get_default();
        for (const schemaId of SAVED_CITY_SCHEMAS) {
            if (!schemaSource?.lookup(schemaId, true))
                continue;
            const settings = new Gio.Settings({schema_id: schemaId});
            this._savedSettings.push(settings);
            this._savedSettingsIds.push(
                settings.connect('changed::locations', () => this._reload()));
        }

        this._reload();
        return true;
    }

    destroy() {
        this._destroyed = true;
        this._token++;

        this._savedSettings.forEach((settings, index) =>
            settings.disconnect(this._savedSettingsIds[index]));
        this._savedSettings = [];
        this._savedSettingsIds = [];

        if (this._shellClient && this._shellClientId)
            this._shellClient.disconnect(this._shellClientId);
        this._shellClientId = 0;
        this._shellClient = null;

        this._disposeOwn();
        this.disconnectAll();
    }

    activateApp() {
        try {
            if (typeof this._shellClient?.activateApp === 'function')
                this._shellClient.activateApp();
            else
                Gio.DesktopAppInfo.new('org.gnome.Weather.desktop')?.launch([], null);
        } catch (e) {
            console.warn(`Better Calendar Toggle: could not open GNOME Weather: ${e.message}`);
        }
    }

    // ------------------------------------------------------------ internals

    async _reload() {
        const token = ++this._token;
        this._resolving = true;
        this._disposeOwn();

        let location = null;
        try {
            location = await this._chosenLocation();
        } catch (e) {
            console.warn(`Better Calendar Toggle: cannot read the weather location: ${e.message}`);
        }
        if (this._destroyed || token !== this._token)
            return;

        if (location)
            this._startOwn(location);
        this._resolving = false;
        this.emit('changed');
    }

    async _chosenLocation() {
        this._GWeather = await loadGWeather();
        if (!this._GWeather)
            return null;

        // The first saved city of GNOME Weather, then of the shell. Automatic
        // location is ignored on purpose: a saved city always wins.
        const world = this._GWeather.Location.get_world();
        for (const settings of this._savedSettings) {
            const locations = settings.get_value('locations').deepUnpack();
            if (locations.length === 0)
                continue;
            try {
                const location = world?.deserialize(locations[0]);
                if (location)
                    return location;
            } catch (e) {
                console.warn(`Better Calendar Toggle: cannot read a saved city: ${e.message}`);
            }
        }
        return null;
    }

    _startOwn(location) {
        const GWeather = this._GWeather;

        this._info = new GWeather.Info({
            application_id: 'org.gnome.Shell',
            contact_info: 'https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/HEAD/data/org.gnome.Shell.desktop.in.in',
            enabled_providers: GWeather.Provider.METAR | GWeather.Provider.MET_NO,
        });
        this._info.set_location(location);
        this._infoId = this._info.connect('updated', () => {
            this._loading = false;
            this.emit('changed');
        });
        this._mode = 'own';

        this._refresh();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _refresh() {
        if (!this._info)
            return;
        this._loading = true;
        this._info.update();
    }

    _disposeOwn() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
        if (this._info && this._infoId)
            this._info.disconnect(this._infoId);
        this._infoId = 0;
        this._info = null;
        this._loading = false;
        this._mode = 'shell';
    }
}
