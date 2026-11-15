// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const TICK_MS = 1000;
// An alarm whose time passed less than this long ago still rings (for example
// right after the extension was enabled again).
const MISSED_WINDOW_MS = 5 * 60 * 1000;
const RING_REPEAT_MS = 5000;
const RING_MAX_REPEATS = 12;

const CLOCKS_SCHEMA = 'org.gnome.clocks';
const CLOCKS_KEY = 'alarms';
const CLOCKS_TYPE = 'aa{sv}';

// GNOME Clocks counts weekdays from Monday (0) to Sunday (6); here weekdays
// follow JavaScript: Sunday (0) to Saturday (6).
const fromClocksDay = day => (day + 1) % 7;
const toClocksDay = day => (day + 6) % 7;

// The alarms. An alarm is {id, name, hour, minute, days, enabled}; days lists
// the weekdays it repeats on (0 = Sunday ... 6 = Saturday), and an empty list
// means it rings once and then turns itself off.
//
// They are stored in one of two places (the 'alarm-storage' setting):
//   extension  a list kept by this extension
//   clocks     the alarm list of GNOME Clocks, so the card and the Clocks app
//              show and edit the very same alarms
// With Clocks storage, GNOME Clocks rings the alarms; the extension rings them
// too only when 'alarm-ring-clocks' is on.
//
// It lives apart from the user interface, so alarms ring whether or not the
// menu is open.
export class AlarmModel extends Signals.EventEmitter {
    // callbacks: {ring(alarm), sound()}
    constructor(settings, callbacks) {
        super();
        this._settings = settings;
        this._callbacks = callbacks;
        this._settingsIds = [];

        this._clocks = false;
        this._clocksSettings = null;
        this._clocksId = 0;

        this._alarms = [];
        this._ringing = null;
        this._snoozed = null;
        this._lastCheck = 0;

        this._tickId = 0;
        this._inTick = false;
        this._soundId = 0;
        this._soundCount = 0;
    }

    start() {
        for (const key of ['alarm-storage', 'alarm-ring-clocks']) {
            this._settingsIds.push(
                this._settings.connect(`changed::${key}`, () => this._reload()));
        }

        this._connectStorage();
        this._load();
        this._lastCheck = Date.now() - 60 * 1000;
        this._syncTick();
    }

    destroy() {
        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = 0;
        }
        this._stopSound();

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._disconnectStorage();

        this.disconnectAll();
    }

    // 'clocks' when the alarms are the ones of GNOME Clocks, else 'extension'.
    get storage() {
        return this._clocks ? 'clocks' : 'extension';
    }

    get alarms() {
        return this._alarms.map(({raw, ...alarm}) => ({...alarm, days: [...alarm.days]}));
    }

    // The alarm that is ringing now, or null.
    get ringing() {
        return this._ringing ? {...this._ringing} : null;
    }

    // Adds an alarm, or changes the one with the same id. Returns its id.
    save({id, hour, minute, days}) {
        const index = this._alarms.findIndex(existing => existing.id === id);
        const previous = index >= 0 ? this._alarms[index] : null;

        const alarm = {
            id: previous ? previous.id : (this._clocks ? this._alarms.length : Date.now()),
            name: previous?.name ?? '',
            hour,
            minute,
            days: [...days].sort(),
            // Saving an edit must not change the state of the alarm; new
            // alarms start enabled. (The switch in the card toggles it.)
            enabled: previous ? previous.enabled : true,
            raw: previous?.raw ?? null,
        };

        if (previous)
            this._alarms[index] = alarm;
        else
            this._alarms.push(alarm);
        this._changed();
        return alarm.id;
    }

    toggle(id) {
        const alarm = this._alarms.find(existing => existing.id === id);
        if (!alarm)
            return;
        alarm.enabled = !alarm.enabled;
        this._changed();
    }

    remove(id) {
        this._alarms = this._alarms.filter(alarm => alarm.id !== id);
        if (this._clocks)
            this._alarms.forEach((alarm, index) => (alarm.id = index));
        this._changed();
    }

    stopRinging() {
        this._ringing = null;
        this._snoozed = null;
        this._stopSound();
        this._changed();
    }

    snooze() {
        if (!this._ringing)
            return;

        const minutes = this._settings.get_int('alarm-snooze');
        this._snoozed = {alarm: this._ringing, at: Date.now() + minutes * 60 * 1000};
        this._ringing = null;
        this._stopSound();
        this._changed();
    }

    // -------------------------------------------------------------- storage

    // GNOME Clocks is usable when its schema is installed and its alarm list
    // has the layout this code knows.
    _clocksUsable() {
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(CLOCKS_SCHEMA, true);
        if (!schema || !schema.has_key(CLOCKS_KEY))
            return false;
        return schema.get_key(CLOCKS_KEY).get_value_type().dup_string() === CLOCKS_TYPE;
    }

    _wantsClocks() {
        return this._settings.get_string('alarm-storage') !== 'extension' && this._clocksUsable();
    }

    _connectStorage() {
        this._clocks = this._wantsClocks();
        if (!this._clocks)
            return;

        this._clocksSettings = new Gio.Settings({schema_id: CLOCKS_SCHEMA});
        // Changes made in the Clocks app show up here at once.
        this._clocksId = this._clocksSettings.connect(`changed::${CLOCKS_KEY}`, () => {
            this._load();
            this._syncTick();
            this.emit('changed');
        });
    }

    _disconnectStorage() {
        if (this._clocksSettings && this._clocksId)
            this._clocksSettings.disconnect(this._clocksId);
        this._clocksId = 0;
        this._clocksSettings = null;
    }

    _reload() {
        this._disconnectStorage();
        this._connectStorage();
        this._ringing = null;
        this._snoozed = null;
        this._stopSound();
        this._load();
        this._syncTick();
        this.emit('changed');
    }

    _load() {
        this._alarms = this._clocks ? this._loadFromClocks() : this._loadFromExtension();
    }

    _loadFromExtension() {
        let saved = [];
        try {
            saved = JSON.parse(this._settings.get_string('alarms'));
        } catch (e) {
            saved = [];
        }

        return (Array.isArray(saved) ? saved : [])
            .filter(alarm => alarm && Number.isInteger(alarm.hour) && Number.isInteger(alarm.minute) &&
                alarm.hour >= 0 && alarm.hour < 24 && alarm.minute >= 0 && alarm.minute < 60)
            .map(alarm => ({
                id: alarm.id ?? Date.now(),
                name: typeof alarm.name === 'string' ? alarm.name : '',
                hour: alarm.hour,
                minute: alarm.minute,
                days: Array.isArray(alarm.days)
                    ? alarm.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
                    : [],
                enabled: alarm.enabled !== false,
                raw: null,
            }));
    }

    _loadFromClocks() {
        let entries = [];
        try {
            entries = this._clocksSettings.get_value(CLOCKS_KEY).deepUnpack();
        } catch (e) {
            console.warn(`Better Calendar Toggle: cannot read the GNOME Clocks alarms: ${e.message}`);
            return [];
        }

        const alarms = [];
        entries.forEach((entry, index) => {
            try {
                const hour = entry.hour?.unpack();
                const minute = entry.minute?.unpack();
                if (!Number.isInteger(hour) || !Number.isInteger(minute))
                    return;

                const days = entry.days ? entry.days.deepUnpack() : [];
                alarms.push({
                    id: index,
                    name: entry.name?.unpack() ?? '',
                    hour,
                    minute,
                    days: (Array.isArray(days) ? days : [])
                        .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
                        .map(fromClocksDay),
                    enabled: entry.active ? Boolean(entry.active.unpack()) : true,
                    // Everything else the Clocks app stores is kept as it is.
                    raw: entry,
                });
            } catch (e) {
                console.warn(`Better Calendar Toggle: skipped an unreadable alarm: ${e.message}`);
            }
        });
        return alarms;
    }

    _save() {
        if (this._clocks)
            this._saveToClocks();
        else
            this._saveToExtension();
    }

    _saveToExtension() {
        const plain = this._alarms.map(({raw, ...alarm}) => alarm);
        this._settings.set_string('alarms', JSON.stringify(plain));
    }

    _saveToClocks() {
        const entries = this._alarms.map(alarm => ({
            ...(alarm.raw ?? {}),
            name: GLib.Variant.new_string(alarm.name),
            active: GLib.Variant.new_boolean(alarm.enabled),
            days: new GLib.Variant('ai', alarm.days.map(toClocksDay).sort()),
            hour: GLib.Variant.new_int32(alarm.hour),
            minute: GLib.Variant.new_int32(alarm.minute),
        }));

        try {
            this._clocksSettings.set_value(CLOCKS_KEY, new GLib.Variant(CLOCKS_TYPE, entries));
        } catch (e) {
            console.warn(`Better Calendar Toggle: cannot save the GNOME Clocks alarms: ${e.message}`);
        }
    }

    _changed() {
        // The write triggers a reload for Clocks storage; the state is already
        // up to date, so only the extension's own list needs the extra signal.
        this._save();
        this._syncTick();
        this.emit('changed');
    }

    // ------------------------------------------------------------- ringing

    // With Clocks storage, GNOME Clocks rings its own alarms.
    _ringsHere() {
        return !this._clocks || this._settings.get_boolean('alarm-ring-clocks');
    }

    _tick() {
        if (!this._ringsHere()) {
            this._lastCheck = Date.now();
            return;
        }

        const now = Date.now();
        const today = new Date(now);
        let changed = false;

        for (const alarm of this._alarms) {
            if (!alarm.enabled)
                continue;

            const occurrence = new Date(today.getFullYear(), today.getMonth(), today.getDate(),
                alarm.hour, alarm.minute, 0, 0).getTime();
            const dayMatches = alarm.days.length === 0 ||
                alarm.days.includes(new Date(occurrence).getDay());

            if (dayMatches && occurrence > this._lastCheck && occurrence <= now &&
                now - occurrence < MISSED_WINDOW_MS) {
                this._ring(alarm);
                if (alarm.days.length === 0) {
                    alarm.enabled = false;
                    changed = true;
                }
            }
        }

        if (this._snoozed && now >= this._snoozed.at) {
            const {alarm} = this._snoozed;
            this._snoozed = null;
            this._ring(alarm);
            changed = true;
        }

        this._lastCheck = now;
        if (changed)
            this._changed();
    }

    _ring(alarm) {
        const {raw, ...plain} = alarm;
        this._ringing = plain;
        this._callbacks.ring?.(plain);
        this._startSound();
        this.emit('changed');
    }

    _startSound() {
        this._stopSound();
        this._soundCount = 0;
        this._callbacks.sound?.();

        this._soundId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RING_REPEAT_MS, () => {
            if (++this._soundCount >= RING_MAX_REPEATS) {
                // Nobody stopped it: give up after about a minute.
                this._soundId = 0;
                this._ringing = null;
                this.emit('changed');
                return GLib.SOURCE_REMOVE;
            }
            this._callbacks.sound?.();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopSound() {
        if (this._soundId) {
            GLib.Source.remove(this._soundId);
            this._soundId = 0;
        }
    }

    _needsTick() {
        return this._ringsHere() &&
            (this._snoozed !== null || this._alarms.some(alarm => alarm.enabled));
    }

    // The clock is only checked while something can still ring here.
    _syncTick() {
        const needed = this._needsTick();

        if (needed && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                this._inTick = true;
                this._tick();
                this._inTick = false;

                if (this._needsTick())
                    return GLib.SOURCE_CONTINUE;
                this._tickId = 0;
                return GLib.SOURCE_REMOVE;
            });
        } else if (!needed && this._tickId && !this._inTick) {
            GLib.Source.remove(this._tickId);
            this._tickId = 0;
        }
    }
}
