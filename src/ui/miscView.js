// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

const DISPLAY_INTERVAL_MS = 100;

const pad = value => String(value).padStart(2, '0');

function formatClock(ms) {
    const total = Math.ceil(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(minutes)}:${pad(seconds)}`;
}

function formatStopwatch(ms) {
    const tenths = Math.floor(ms / 100) % 10;
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}.${tenths}`
        : `${pad(minutes)}:${pad(seconds)}.${tenths}`;
}

// Three equally sized cards: Pomodoro, Stopwatch and Timer. Each card has the
// same rows (title, time, status line, extra row, controls) so they line up.
export class MiscView {
    // todoActor is the task list, shown above the cards.
    constructor(model, text, todoActor = null, onActivate = null) {
        this._model = model;
        this._text = text;
        this._onActivate = onActivate;
        this._tickId = 0;
        this._dots = [];

        // Pomodoro, stopwatch and timer share one row of equal cards.
        this._row = new St.BoxLayout({
            style_class: 'bct-misc-page',
            x_expand: true,
        });
        this._row.layout_manager.homogeneous = true;

        this.actor = new St.BoxLayout({
            style_class: 'bct-misc-root',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        if (todoActor)
            this.actor.add_child(todoActor);
        this.actor.add_child(this._row);

        this._buildPomodoro();
        this._buildStopwatch();
        this._buildTimer();

        this._changedId = this._model.connect('changed', () => this._refresh());
        this.actor.connect('notify::mapped', () => this._syncTick());
        this._refresh();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = 0;
        }
        if (this._changedId)
            this._model.disconnect(this._changedId);
        this._changedId = 0;
    }

    // --------------------------------------------------------------- cards

    _makeCard(title, onOpenClocks = null) {
        const card = new St.BoxLayout({
            style_class: 'bct-misc-card',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        // The title stays centered in the space left by the open button; the
        // button slot is on every card so the three cards still line up.
        const header = new St.BoxLayout({
            style_class: 'bct-misc-header',
            x_expand: true,
        });
        const heading = new St.Label({
            text: title,
            style_class: 'bct-misc-title',
            x_expand: true,
        });
        heading.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
        header.add_child(heading);

        const open = new St.Button({
            style_class: 'bct-misc-open button',
            can_focus: Boolean(onOpenClocks),
            reactive: Boolean(onOpenClocks),
            accessible_name: onOpenClocks ? this._text.openClocks : '',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'preferences-system-time-symbolic',
                style_class: 'popup-menu-icon',
            }),
        });
        if (onOpenClocks)
            open.connect('clicked', onOpenClocks);
        else
            open.opacity = 0;
        header.add_child(open);
        const displayRow = new St.BoxLayout({
            style_class: 'bct-misc-display-row',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        const display = new St.Label({
            style_class: 'bct-misc-display',
            y_align: Clutter.ActorAlign.CENTER,
        });
        displayRow.add_child(display);
        const detail = new St.Label({
            style_class: 'bct-misc-detail',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const extra = new St.BoxLayout({
            style_class: 'bct-misc-extra',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const controls = new St.BoxLayout({
            style_class: 'bct-misc-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });

        card.add_child(header);
        card.add_child(displayRow);
        card.add_child(detail);
        card.add_child(extra);
        card.add_child(controls);
        this._row.add_child(card);

        return {display, displayRow, detail, extra, controls};
    }

    _makeButton({icon, label, name, onClicked, primary = false}) {
        // Icon buttons are circles; buttons with text are pills. Both are
        // centered, so a row never stretches them taller than they are.
        let styleClass = 'bct-misc-pill button';
        if (icon)
            styleClass = primary ? 'bct-misc-button bct-misc-primary button' : 'bct-misc-button button';
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: name,
        });
        if (icon) {
            button.child = new St.Icon({icon_name: icon, style_class: 'popup-menu-icon'});
        } else {
            button.label = label;
        }
        button.connect('clicked', onClicked);
        return button;
    }

    _setEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }

    // Opens GNOME Clocks from the Stopwatch and Timer cards and closes the menu.
    _openClocks() {
        try {
            Gio.DesktopAppInfo.new('org.gnome.clocks.desktop')?.launch([], null);
        } catch (e) {
            console.warn(`Better Calendar Toggle: could not open GNOME Clocks: ${e.message}`);
        }
        this._onActivate?.();
    }

    _buildPomodoro() {
        const t = this._text;
        const card = this._makeCard(t.pomodoro);
        this._pomodoro = card;

        this._pomodoroReset = this._makeButton({
            icon: 'view-refresh-symbolic', name: t.reset,
            onClicked: () => this._model.resetPomodoro(),
        });
        this._pomodoroToggle = this._makeButton({
            icon: 'media-playback-start-symbolic', name: t.startPause, primary: true,
            onClicked: () => this._model.togglePomodoro(),
        });
        this._pomodoroSkip = this._makeButton({
            icon: 'media-skip-forward-symbolic', name: t.skip,
            onClicked: () => this._model.skipPomodoro(),
        });
        card.controls.add_child(this._pomodoroReset);
        card.controls.add_child(this._pomodoroToggle);
        card.controls.add_child(this._pomodoroSkip);

        // Minus and plus five minutes, one on each side of the time.
        const minus = this._makeButton({
            label: '−', name: t.minusFive,
            onClicked: () => this._model.adjustPomodoro(-5 * 60 * 1000),
        });
        const plus = this._makeButton({
            label: '+', name: t.plusFive,
            onClicked: () => this._model.adjustPomodoro(5 * 60 * 1000),
        });
        minus.add_style_class_name('bct-misc-step');
        plus.add_style_class_name('bct-misc-step');
        card.displayRow.insert_child_at_index(minus, 0);
        card.displayRow.add_child(plus);
    }

    _buildStopwatch() {
        const t = this._text;
        const card = this._makeCard(t.stopwatch, () => this._openClocks());
        this._stopwatch = card;

        this._stopwatchLaps = new St.Label({
            style_class: 'bct-misc-note',
            x_align: Clutter.ActorAlign.CENTER,
        });
        card.extra.add_child(this._stopwatchLaps);

        this._stopwatchReset = this._makeButton({
            icon: 'view-refresh-symbolic', name: t.reset,
            onClicked: () => this._model.resetStopwatch(),
        });
        this._stopwatchToggle = this._makeButton({
            icon: 'media-playback-start-symbolic', name: t.startPause, primary: true,
            onClicked: () => this._model.toggleStopwatch(),
        });
        this._stopwatchLap = this._makeButton({
            label: t.lap, name: t.lap,
            onClicked: () => this._model.lapStopwatch(),
        });
        card.controls.add_child(this._stopwatchReset);
        card.controls.add_child(this._stopwatchToggle);
        card.controls.add_child(this._stopwatchLap);
    }

    _buildTimer() {
        const t = this._text;
        const card = this._makeCard(t.timer, () => this._openClocks());
        this._timer = card;

        for (const [label, minutes] of [[t.minusOne, -1], [t.plusOne, 1], [t.plusFive, 5]]) {
            const chip = this._makeButton({
                label, name: label,
                onClicked: () => this._model.adjustTimer(minutes * 60 * 1000),
            });
            chip.add_style_class_name('bct-misc-chip');
            card.extra.add_child(chip);
        }

        this._timerReset = this._makeButton({
            icon: 'view-refresh-symbolic', name: t.reset,
            onClicked: () => this._model.resetTimer(),
        });
        this._timerToggle = this._makeButton({
            icon: 'media-playback-start-symbolic', name: t.startPause, primary: true,
            onClicked: () => this._model.toggleTimer(),
        });
        // Invisible spacer that keeps the controls centered like the other cards.
        const spacer = this._makeButton({
            icon: 'media-skip-forward-symbolic', name: '', onClicked: () => {},
        });
        spacer.opacity = 0;
        spacer.reactive = false;
        spacer.can_focus = false;

        card.controls.add_child(this._timerReset);
        card.controls.add_child(this._timerToggle);
        card.controls.add_child(spacer);
    }

    // ------------------------------------------------------------- updates

    _refresh() {
        const t = this._text;
        const pomodoro = this._model.pomodoro;
        const stopwatch = this._model.stopwatch;
        const timer = this._model.timer;

        // Pomodoro
        this._pomodoro.detail.text = {
            focus: t.focus,
            short: t.shortBreak,
            long: t.longBreak,
        }[pomodoro.phase];
        this._setPlayIcon(this._pomodoroToggle, pomodoro.running);
        this._syncDots(pomodoro.sessions, pomodoro.completed);

        // Stopwatch
        const last = stopwatch.laps.at(-1);
        this._stopwatch.detail.text = last === undefined
            ? t.ready
            : `${t.lap} ${stopwatch.laps.length}  ${formatStopwatch(last)}`;
        this._stopwatchLaps.text = stopwatch.laps.length > 0
            ? `${t.laps}: ${stopwatch.laps.length}`
            : '';
        this._setPlayIcon(this._stopwatchToggle, stopwatch.running);
        this._setEnabled(this._stopwatchLap, stopwatch.running);

        // Timer
        this._timer.detail.text = timer.running ? t.running : (timer.paused ? t.paused : t.ready);
        this._setPlayIcon(this._timerToggle, timer.running);

        this._updateDisplays();
        this._syncTick();
    }

    _setPlayIcon(button, running) {
        button.child.icon_name = running
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
    }

    _syncDots(count, filled) {
        if (this._dots.length !== count) {
            this._pomodoro.extra.destroy_all_children();
            this._dots = [];
            for (let i = 0; i < count; i++) {
                const dot = new St.Widget({
                    style_class: 'bct-misc-dot',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._pomodoro.extra.add_child(dot);
                this._dots.push(dot);
            }
        }
        this._dots.forEach((dot, index) => {
            if (index < filled)
                dot.add_style_class_name('bct-misc-dot-filled');
            else
                dot.remove_style_class_name('bct-misc-dot-filled');
        });
    }

    _updateDisplays() {
        this._pomodoro.display.text = formatClock(this._model.pomodoro.remainingMs);
        this._stopwatch.display.text = formatStopwatch(this._model.stopwatchElapsedMs());
        this._timer.display.text = formatClock(this._model.timer.remainingMs);
    }

    _anyRunning() {
        return this._model.pomodoro.running ||
            this._model.stopwatch.running ||
            this._model.timer.running;
    }

    // Update the readouts frequently, but only while the page is on screen.
    _syncTick() {
        if (this._tickId || !this.actor.mapped || !this._anyRunning())
            return;

        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DISPLAY_INTERVAL_MS, () => {
            this._updateDisplays();
            if (this.actor.mapped && this._anyRunning())
                return GLib.SOURCE_CONTINUE;
            this._tickId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }
}
