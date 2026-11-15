// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// GNOME Clocks stores only the configured timers (`{duration, name}`) and reads
// them when it starts. It has no running countdown to mirror and no stored
// stopwatch at all. The extension therefore writes its Timer as one stopped
// entry named CLOCKS_TIMER_NAME while it is running or paused, and removes it
// when the timer is reset or finishes.
const CLOCKS_SCHEMA = 'org.gnome.clocks';
const CLOCKS_TIMERS_KEY = 'timers';
const CLOCKS_TIMERS_TYPE = 'aa{sv}';
const CLOCKS_TIMER_NAME = 'Better Calendar Toggle';

let settings = null;

// Connects to Clocks when its schema can store timers. Returns the name used
// for the mirrored entry, so callers can tell it apart from the user's timers.
export function connectClocksTimer() {
    settings = null;
    try {
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(CLOCKS_SCHEMA, true);
        if (!schema || !schema.has_key(CLOCKS_TIMERS_KEY))
            return null;
        if (schema.get_key(CLOCKS_TIMERS_KEY).get_value_type().dup_string() !== CLOCKS_TIMERS_TYPE)
            return null;
        settings = new Gio.Settings({schema_id: CLOCKS_SCHEMA});
        return CLOCKS_TIMER_NAME;
    } catch (e) {
        settings = null;
        return null;
    }
}

export function disconnectClocksTimer() {
    settings = null;
}

// Adds or updates the mirrored timer; 0 removes it. Every other timer in
// GNOME Clocks is preserved.
export function mirrorTimer(seconds) {
    if (!settings)
        return;

    let entries = [];
    try {
        entries = settings.get_value(CLOCKS_TIMERS_KEY).deepUnpack();
    } catch (e) {
        entries = [];
    }
    if (!Array.isArray(entries))
        entries = [];

    const kept = entries.filter(entry =>
        entry?.name?.unpack?.() !== CLOCKS_TIMER_NAME);

    if (seconds > 0) {
        kept.push({
            duration: GLib.Variant.new_int32(seconds),
            name: GLib.Variant.new_string(CLOCKS_TIMER_NAME),
        });
    }

    try {
        settings.set_value(CLOCKS_TIMERS_KEY, new GLib.Variant(CLOCKS_TIMERS_TYPE, kept));
    } catch (e) {
        console.warn(`Better Calendar Toggle: cannot save the GNOME Clocks timer: ${e.message}`);
    }
}