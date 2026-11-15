// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const TICK_MS = 250;
const MIN_TIMER_MS = 60 * 1000;
const MAX_TIMER_MS = 99 * 3600 * 1000;
const MAX_LAPS = 20;
const MAX_POMODORO_MS = 4 * 3600 * 1000;

const PHASES = ['focus', 'short', 'long'];
const PHASE_KEYS = {
    focus: 'pomodoro-focus',
    short: 'pomodoro-short',
    long: 'pomodoro-long',
};

// State of the Pomodoro, stopwatch and timer. It lives apart from the user
// interface so everything keeps running while the menu is closed. State is
// stored with wall-clock timestamps and saved to settings, so it also survives
// the extension being disabled (for example while the screen is locked).
export class MiscModel extends Signals.EventEmitter {
    // alert({kind: 'pomodoro', finished, next, away}) or alert({kind: 'timer', away})
    constructor(settings, alert) {
        super();
        this._settings = settings;
        this._alert = alert;
        this._settingsSignals = [];
        this._tickId = 0;
        this._inTick = false;
        this._state = this._defaultState();
    }

    start() {
        this._load();

        for (const key of [...Object.values(PHASE_KEYS), 'pomodoro-sessions']) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this.emit('changed')));
        }

        this._checkFinished(true);
        this._syncTick();
    }

    destroy() {
        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = 0;
        }

        this.disconnectAll();
    }

    // ------------------------------------------------------------ pomodoro

    get pomodoro() {
        const p = this._state.pomodoro;
        return {
            phase: p.phase,
            running: p.running,
            completed: p.completed,
            sessions: this._settings.get_int('pomodoro-sessions'),
            remainingMs: this._pomodoroRemaining(),
            durationMs: this._phaseDuration(p.phase),
        };
    }

    togglePomodoro() {
        const p = this._state.pomodoro;
        if (p.running) {
            p.remaining = Math.max(0, p.endAt - Date.now());
            p.running = false;
            p.endAt = 0;
        } else {
            p.remaining = p.remaining ?? this._phaseDuration(p.phase);
            p.endAt = Date.now() + p.remaining;
            p.running = true;
        }
        this._changed();
    }

    resetPomodoro() {
        Object.assign(this._state.pomodoro, this._defaultState().pomodoro);
        this._changed();
    }

    skipPomodoro() {
        this._advancePomodoro(false);
        this._changed();
    }

    // Plus or minus time on the current phase (running, paused or not started).
    adjustPomodoro(deltaMs) {
        const p = this._state.pomodoro;
        const max = MAX_POMODORO_MS;

        if (p.running) {
            p.endAt = Math.max(Date.now() + 1000, Math.min(p.endAt + deltaMs, Date.now() + max));
        } else {
            const current = p.remaining ?? this._phaseDuration(p.phase);
            p.remaining = Math.max(MIN_TIMER_MS, Math.min(current + deltaMs, max));
        }
        this._changed();
    }

    _phaseDuration(phase) {
        return this._settings.get_int(PHASE_KEYS[phase]) * 60 * 1000;
    }

    _pomodoroRemaining() {
        const p = this._state.pomodoro;
        if (p.running)
            return Math.max(0, p.endAt - Date.now());
        return p.remaining ?? this._phaseDuration(p.phase);
    }

    _advancePomodoro(counted) {
        const p = this._state.pomodoro;
        if (p.phase === 'focus') {
            if (counted)
                p.completed += 1;
            p.phase = this._breakAfterFocus(p.completed);
        } else {
            if (p.phase === 'long')
                p.completed = 0;
            p.phase = 'focus';
        }
        p.running = false;
        p.remaining = null;
        p.endAt = 0;
    }

    // A short break after each focus session, and a long one at the end of the
    // last session of the cycle.
    _breakAfterFocus(completed) {
        return completed >= this._settings.get_int('pomodoro-sessions') ? 'long' : 'short';
    }

    _finishPomodoro(away) {
        const p = this._state.pomodoro;
        const finished = p.phase;
        this._advancePomodoro(true);
        this._alert?.({kind: 'pomodoro', finished, next: p.phase, away});
    }

    // ----------------------------------------------------------- stopwatch

    get stopwatch() {
        const s = this._state.stopwatch;
        return {running: s.running, laps: [...s.laps]};
    }

    stopwatchElapsedMs() {
        const s = this._state.stopwatch;
        return s.accumulated + (s.running ? Date.now() - s.startedAt : 0);
    }

    toggleStopwatch() {
        const s = this._state.stopwatch;
        if (s.running) {
            s.accumulated += Date.now() - s.startedAt;
            s.running = false;
            s.startedAt = 0;
        } else {
            s.startedAt = Date.now();
            s.running = true;
        }
        this._changed();
    }

    lapStopwatch() {
        const s = this._state.stopwatch;
        if (!s.running)
            return;
        s.laps.push(this.stopwatchElapsedMs());
        if (s.laps.length > MAX_LAPS)
            s.laps.shift();
        this._changed();
    }

    resetStopwatch() {
        Object.assign(this._state.stopwatch, this._defaultState().stopwatch);
        this._changed();
    }

    // --------------------------------------------------------------- timer

    get timer() {
        const t = this._state.timer;
        return {
            running: t.running,
            paused: !t.running && t.remaining !== null,
            durationMs: t.duration,
            remainingMs: this._timerRemaining(),
        };
    }

    toggleTimer() {
        const t = this._state.timer;
        if (t.running) {
            t.remaining = Math.max(0, t.endAt - Date.now());
            t.running = false;
            t.endAt = 0;
        } else {
            t.remaining = t.remaining ?? t.duration;
            t.endAt = Date.now() + t.remaining;
            t.running = true;
        }
        this._changed();
    }

    resetTimer() {
        const t = this._state.timer;
        t.running = false;
        t.remaining = null;
        t.endAt = 0;
        this._changed();
    }

    adjustTimer(deltaMs) {
        const t = this._state.timer;
        const clamp = (value, min) => Math.max(min, Math.min(value, MAX_TIMER_MS));

        if (t.running)
            t.endAt = clamp(t.endAt + deltaMs, Date.now() + 1000);
        else if (t.remaining !== null)
            t.remaining = clamp(t.remaining + deltaMs, 1000);
        else
            t.duration = clamp(t.duration + deltaMs, MIN_TIMER_MS);

        this._changed();
    }

    _timerRemaining() {
        const t = this._state.timer;
        if (t.running)
            return Math.max(0, t.endAt - Date.now());
        return t.remaining ?? t.duration;
    }

    _finishTimer(away) {
        const t = this._state.timer;
        t.running = false;
        t.remaining = null;
        t.endAt = 0;
        this._alert?.({kind: 'timer', away});
    }

    // ------------------------------------------------------------ plumbing

    _defaultState() {
        return {
            pomodoro: {phase: 'focus', running: false, endAt: 0, remaining: null, completed: 0},
            stopwatch: {running: false, startedAt: 0, accumulated: 0, laps: []},
            timer: {duration: 5 * 60 * 1000, running: false, endAt: 0, remaining: null},
        };
    }

    _load() {
        let saved = {};
        try {
            saved = JSON.parse(this._settings.get_string('misc-state')) ?? {};
        } catch (e) {
            saved = {};
        }

        const state = this._defaultState();
        for (const key of Object.keys(state)) {
            if (saved[key] && typeof saved[key] === 'object')
                Object.assign(state[key], saved[key]);
        }

        const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
        const p = state.pomodoro;
        if (!PHASES.includes(p.phase))
            p.phase = 'focus';
        p.completed = Math.max(0, number(p.completed, 0));
        p.endAt = number(p.endAt, 0);
        p.remaining = p.remaining === null ? null : number(p.remaining, null);

        const s = state.stopwatch;
        s.accumulated = Math.max(0, number(s.accumulated, 0));
        s.startedAt = number(s.startedAt, 0);
        s.laps = Array.isArray(s.laps)
            ? s.laps.filter(Number.isFinite).slice(-MAX_LAPS)
            : [];

        const t = state.timer;
        t.duration = Math.max(MIN_TIMER_MS, Math.min(number(t.duration, 300000), MAX_TIMER_MS));
        t.endAt = number(t.endAt, 0);
        t.remaining = t.remaining === null ? null : number(t.remaining, null);

        this._state = state;
    }

    _save() {
        this._settings.set_string('misc-state', JSON.stringify(this._state));
    }

    _changed() {
        this._save();
        this._syncTick();
        this.emit('changed');
    }

    _checkFinished(away) {
        const now = Date.now();
        let changed = false;

        const p = this._state.pomodoro;
        if (p.running && now >= p.endAt) {
            this._finishPomodoro(away);
            changed = true;
        }

        const t = this._state.timer;
        if (t.running && now >= t.endAt) {
            this._finishTimer(away);
            changed = true;
        }

        if (changed)
            this._changed();
    }

    _syncTick() {
        const needed = this._state.pomodoro.running || this._state.timer.running;

        if (needed && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                this._inTick = true;
                this._checkFinished(false);
                this._inTick = false;
                if (this._state.pomodoro.running || this._state.timer.running)
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
