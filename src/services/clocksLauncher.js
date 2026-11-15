// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// GNOME Clocks restores its visible panel from this key and updates it whenever
// the user changes tab, which is why launching it used to reopen the last tab.
// Writing it first makes the next launch open the requested panel.
const CLOCKS_APP = 'org.gnome.clocks';
const CLOCKS_PATH = '/org/gnome/clocks';
const CLOCKS_WINDOW_SCHEMA = 'org.gnome.clocks.state.window';
const CLOCKS_PANEL_KEY = 'panel-id';

let windowSettings = null;

function rememberPanel(panel) {
    try {
        if (!windowSettings) {
            const schema = Gio.SettingsSchemaSource.get_default()?.lookup(CLOCKS_WINDOW_SCHEMA, true);
            if (!schema || !schema.has_key(CLOCKS_PANEL_KEY))
                return;
            windowSettings = new Gio.Settings({schema_id: CLOCKS_WINDOW_SCHEMA});
        }
        windowSettings.set_string(CLOCKS_PANEL_KEY, panel);
    } catch (e) {
        // Clocks is not installed, or its schema is unavailable.
    }
}

// Asks an already running Clocks window to switch panel. With NO_AUTO_START it
// fails immediately when Clocks is not running; the launch below then opens the
// panel remembered above. Errors are ignored: the remembered panel is enough.
function switchRunningWindow(panel) {
    try {
        Gio.DBus.session.call(
            CLOCKS_APP, CLOCKS_PATH, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', ['win.set-page', [new GLib.Variant('s', panel)], {}]),
            null, Gio.DBusCallFlags.NO_AUTO_START, -1, null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (e) {
                    // Not running, or this Clocks version has no such action.
                }
            });
    } catch (e) {
        // No session bus.
    }
}

// panel: 'world' | 'alarm' | 'stopwatch' | 'timer'
export function openClocks(panel) {
    rememberPanel(panel);
    switchRunningWindow(panel);

    try {
        Gio.DesktopAppInfo.new('org.gnome.clocks.desktop')?.launch([], null);
    } catch (e) {
        console.warn(`Better Calendar Toggle: could not open GNOME Clocks: ${e.message}`);
    }
}