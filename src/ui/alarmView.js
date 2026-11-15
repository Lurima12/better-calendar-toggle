// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {openClocks} from '../services/clocksLauncher.js';
import {fadeIn} from '../util/animation.js';
import {ScrollStepper} from '../util/scrollStep.js';

const pad = value => String(value).padStart(2, '0');

// Monday first.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// Horizontal drag distance (in CSS px) that counts as a swipe.
const SWIPE_DISTANCE = 40;
// A press that moves less than this (in CSS px) is a click.
const CLICK_TOLERANCE = 8;

// A card that shows one alarm at a time: the time, the repeat days, an on/off
// switch and an edit button, with a dot for every alarm underneath. Swipe,
// scroll the mouse wheel or click a dot to move between alarms (it stops at
// the first and last, no looping). A banner with Stop and Snooze appears while
// an alarm rings, and an inline editor adds or changes an alarm. The card
// spans the right column of the Weather & Clocks page, whose width follows
// the cards it holds.
export class AlarmView {
    // onOpenClocks runs after GNOME Clocks was opened (to close the menu).
    constructor(model, text, settings, onOpenClocks) {
        this._model = model;
        this._text = text;
        this._settings = settings;
        this._onOpenClocks = onOpenClocks;
        this._edit = null;
        this._index = 0;
        this._selectId = null;
        this._scroller = new ScrollStepper(() => this._settings.get_int('scroll-distance'));
        this._pressX = null;
        this._pressedOnTime = false;
        this._pressedOnControls = false;
        this._swallowClick = false;
        this._dots = [];
        this._dotsCount = -1;

        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        // Short weekday names, indexed 0 (Sunday) to 6 (Saturday)
        this._weekdays = [0, 1, 2, 3, 4, 5, 6].map(day =>
            GLib.DateTime.new_local(2024, 1, 7 + day, 12, 0, 0).format('%a'));
        // Even shorter names for the day buttons (two letters, or three when
        // two letters would not tell the days apart).
        const twoLetters = this._weekdays.map(name => name.slice(0, 2));
        this._dayChips = new Set(twoLetters).size === 7
            ? twoLetters
            : this._weekdays.map(name => name.slice(0, 3));

        this._card = new St.BoxLayout({
            style_class: 'bct-alarm-card',
            vertical: true,
            x_expand: true,
        });

        // Header: title, then Edit and Add on the right.
        const header = new St.BoxLayout({style_class: 'bct-alarm-header'});
        const title = new St.Label({
            text: text.title,
            style_class: 'bct-card-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.clutter_text.y_align = Clutter.ActorAlign.CENTER;
        header.add_child(title);

        // Edit sits to the left of Add; both open the editor.
        this._editButton = this._makeButton({
            icon: 'document-edit-symbolic', name: text.edit,
            onClicked: () => this._openEditor(this._current()),
        });
        this._editButton.y_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._editButton);

        this._addButton = this._makeButton({
            icon: 'list-add-symbolic', name: text.add, onClicked: () => this._openEditor(null),
        });
        this._addButton.y_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._addButton);

        this._banner = this._buildBanner();
        this._editor = this._buildEditor();
        this._pager = this._buildPager();

        this._card.add_child(header);
        this._card.add_child(this._banner);
        this._card.add_child(this._editor);
        this._card.add_child(this._pager);

        // Clicking the card itself (its title and its empty areas) opens GNOME
        // Clocks; the buttons, the time and the dots keep their own actions.
        // Events are never stopped here, so the inner buttons stay clickable;
        // taps that another part of the card acted on are held back from the
        // clock-opening click instead (see _swallowClick).
        this.actor = new St.Button({
            style_class: 'bct-alarm-open',
            can_focus: true,
            reactive: true,
            x_expand: true,
            accessible_name: text.openClocks,
            child: this._card,
        });
        this.actor.connect('clicked', () => this._onCardClicked());
        this.actor.connect('event', (_actor, event) => this._onEvent(event));
        this.actor.connect('scroll-event', (_actor, event) => this._onScroll(event));

        this._changedId = this._model.connect('changed', () => this._render());
        this._formatId = this._interfaceSettings.connect(
            'changed::clock-format', () => this._render());
        this._render();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        if (this._changedId)
            this._model.disconnect(this._changedId);
        this._changedId = 0;

        if (this._formatId)
            this._interfaceSettings.disconnect(this._formatId);
        this._formatId = 0;
        this._interfaceSettings = null;
    }

    // ------------------------------------------------------------- helpers

    _hour12() {
        return this._interfaceSettings.get_string('clock-format') === '12h';
    }

    _makeButton({icon, label, name, onClicked}) {
        const button = new St.Button({
            style_class: 'bct-alarm-button button',
            can_focus: true,
            accessible_name: name ?? label ?? '',
        });
        if (icon)
            button.child = new St.Icon({icon_name: icon, style_class: 'popup-menu-icon'});
        else
            button.label = label;
        button.connect('clicked', onClicked);
        return button;
    }

    _timeParts(hour, minute) {
        if (this._hour12()) {
            return {
                text: `${hour % 12 || 12}:${pad(minute)}`,
                period: hour < 12 ? this._text.am : this._text.pm,
            };
        }
        return {text: `${pad(hour)}:${pad(minute)}`, period: ''};
    }

    _daysSummary(days) {
        const sorted = [...days].sort();
        if (sorted.length === 0)
            return this._text.once;
        if (sorted.length === 7)
            return this._text.everyDay;
        if (sorted.join() === '1,2,3,4,5')
            return this._text.weekdays;
        if (sorted.join() === '0,6')
            return this._text.weekends;
        return WEEK.filter(day => sorted.includes(day))
            .map(day => this._weekdays[day]).join(', ');
    }

    _alarms() {
        return this._model.alarms.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
    }

    _openClocks() {
        openClocks('alarm');
        this._onOpenClocks?.();
    }

    _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    }

    // -------------------------------------------------------------- banner

    _buildBanner() {
        const banner = new St.BoxLayout({
            style_class: 'bct-alarm-banner',
            visible: false,
        });
        this._bannerLabel = new St.Label({
            style_class: 'bct-alarm-banner-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        banner.add_child(this._bannerLabel);
        banner.add_child(this._makeButton({
            label: this._text.snooze, onClicked: () => this._model.snooze(),
        }));
        banner.add_child(this._makeButton({
            label: this._text.stop, onClicked: () => this._model.stopRinging(),
        }));
        return banner;
    }

    // --------------------------------------------------------------- pager

    _buildPager() {
        // The buttons, dots and swipes of the pager are handled via the card
        // around it (see _onEvent), so it does not stop any event itself.
        const pager = new St.BoxLayout({
            style_class: 'bct-alarm-pager',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        this._empty = new St.Label({
            text: this._text.none,
            style_class: 'bct-alarm-empty',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // The alarm shown: time, repeat days, switch and edit button. The
        // time row and the days label are made reactive, so a tap on them
        // opens the alarm editor (plain labels would otherwise not be event
        // sources at all).
        this._slide = new St.BoxLayout({
            style_class: 'bct-alarm-slide',
            vertical: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._time = new St.BoxLayout({
            style_class: 'bct-alarm-time',
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._timeLabel = new St.Label({
            style_class: 'bct-alarm-time-big',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._periodLabel = new St.Label({
            style_class: 'bct-clock-period',
            y_align: Clutter.ActorAlign.END,
        });
        this._time.add_child(this._timeLabel);
        this._time.add_child(this._periodLabel);

        this._daysLabel = new St.Label({
            style_class: 'bct-clock-sub',
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        const controls = new St.BoxLayout({
            style_class: 'bct-alarm-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._switch = new PopupMenu.Switch(false);
        this._toggle = new St.Button({
            style_class: 'bct-alarm-toggle',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: this._text.onOff,
            child: this._switch,
        });
        this._toggle.connect('clicked', () => {
            const alarm = this._current();
            if (alarm)
                this._model.toggle(alarm.id);
        });
        controls.add_child(this._toggle);

        this._slide.add_child(this._time);
        this._slide.add_child(this._daysLabel);
        this._slide.add_child(controls);

        // One dot per alarm, below the alarm
        this._dotsBox = new St.BoxLayout({
            style_class: 'bct-media-dots',
            x_align: Clutter.ActorAlign.CENTER,
        });

        pager.add_child(this._empty);
        pager.add_child(this._slide);
        pager.add_child(this._dotsBox);
        return pager;
    }

    _current() {
        return this._alarms()[this._index] ?? null;
    }

    // Moves to the previous or next alarm; stops at the ends (no looping).
    _move(step) {
        const count = this._alarms().length;
        const next = this._index + step;
        if (count < 2 || next < 0 || next >= count)
            return;

        this._index = next;
        this._render(step);
    }

    _select(index) {
        if (index === this._index)
            return;
        const step = index > this._index ? 1 : -1;
        this._index = index;
        this._render(step);
    }

    // Click of the card around the whole card: opens GNOME Clocks, unless the
    // tap belonged to a part with its own handling (a dot, a button, the big
    // time, a swipe) — those spares are held back and not re-opened as well.
    _onCardClicked() {
        if (this._swallowClick) {
            this._swallowClick = false;
            return;
        }
        this._openClocks();
    }

    _onScroll(event) {
        if (this._alarms().length < 2)
            return Clutter.EVENT_PROPAGATE;

        // One alarm per scroll gesture, so the others are not skipped.
        const step = this._scroller.read(event);
        if (step === null)
            return Clutter.EVENT_PROPAGATE;
        if (step !== 0)
            this._move(step);
        return Clutter.EVENT_STOP;
    }

    // Swipe left or right to change alarm; a click on the time edits it, and
    // a plain click opens GNOME Clocks (through the click of the button
    // around the card). No event is ever stopped, so the buttons, the dots
    // and the switch stay clickable; where this page acted instead, _swallowClick
    // holds the opening back.
    _onEvent(event) {
        switch (event.type()) {
        case Clutter.EventType.BUTTON_PRESS:
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                break;
            // fall through
        case Clutter.EventType.TOUCH_BEGIN: {
            [this._pressX] = event.get_coords();
            const source = event.get_source();
            this._pressedOnTime = Boolean(source) &&
                (this._time.contains(source) || this._daysLabel === source);
            // The switch, the edit button, the dots, the add button and the
            // ringing banner keep their own actions.
            this._pressedOnControls = Boolean(source) &&
                (this._toggle.contains(source) || this._editButton.contains(source) ||
                    this._dotsBox.contains(source) || this._addButton.contains(source) ||
                    this._banner.contains(source));
            break;
        }
        case Clutter.EventType.BUTTON_RELEASE:
        case Clutter.EventType.TOUCH_END: {
            if (this._pressX === null)
                break;
            const [x] = event.get_coords();
            const distance = (x - this._pressX) / this._scale();
            const wasOnTime = this._pressedOnTime;
            const wasOnControls = this._pressedOnControls;
            this._pressX = null;

            this._swallowClick = wasOnControls;
            if (Math.abs(distance) >= SWIPE_DISTANCE) {
                this._swallowClick = true;
                this._move(distance < 0 ? 1 : -1);
            } else if (Math.abs(distance) <= CLICK_TOLERANCE) {
                if (wasOnTime && this._current()) {
                    this._swallowClick = true;
                    this._openEditor(this._current());
                }
                // In the remaining cases the click of the card itself opens
                // GNOME Clocks.
            }
            break;
        }
        case Clutter.EventType.TOUCH_CANCEL:
        case Clutter.EventType.LEAVE:
            this._pressX = null;
            this._pressedOnControls = false;
            this._swallowClick = false;
            break;
        default:
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _syncDots(count) {
        if (count !== this._dotsCount) {
            this._dotsCount = count;
            this._dotsBox.destroy_all_children();
            this._dots = [];
            for (let i = 0; i < count; i++) {
                const dot = new St.Button({
                    style_class: 'bct-media-dot',
                    can_focus: true,
                    accessible_name: `${this._text.alarm} ${i + 1}`,
                });
                dot.connect('clicked', () => this._select(i));
                this._dotsBox.add_child(dot);
                this._dots.push(dot);
            }
        }

        this._dots.forEach((dot, index) => {
            if (index === this._index)
                dot.add_style_class_name('bct-media-dot-active');
            else
                dot.remove_style_class_name('bct-media-dot-active');
        });
    }

    // -------------------------------------------------------------- editor

    _buildEditor() {
        const editor = new St.BoxLayout({
            style_class: 'bct-alarm-editor',
            vertical: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        // Time: hour and minute with minus and plus, and AM/PM in 12 h mode
        const time = new St.BoxLayout({
            style_class: 'bct-alarm-time-row',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const stepper = (onMinus, onPlus, label) => {
            label.y_align = Clutter.ActorAlign.CENTER;
            time.add_child(this._makeButton({label: '−', name: this._text.decrease, onClicked: onMinus}));
            time.add_child(label);
            time.add_child(this._makeButton({label: '+', name: this._text.increase, onClicked: onPlus}));
        };

        this._hourLabel = new St.Label({style_class: 'bct-alarm-spin-value'});
        this._minuteLabel = new St.Label({style_class: 'bct-alarm-spin-value'});
        stepper(() => this._shiftHour(-1), () => this._shiftHour(1), this._hourLabel);
        time.add_child(new St.Label({
            text: ':',
            style_class: 'bct-alarm-spin-value',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        stepper(() => this._shiftMinute(-5), () => this._shiftMinute(5), this._minuteLabel);

        this._periodButton = this._makeButton({
            label: this._text.am, name: this._text.am, onClicked: () => this._shiftHour(12),
        });
        time.add_child(this._periodButton);

        // Repeat days, Monday first
        const days = new St.BoxLayout({style_class: 'bct-alarm-days'});
        days.layout_manager.homogeneous = true;
        this._dayButtons = new Map();
        for (const day of WEEK) {
            const button = new St.Button({
                style_class: 'bct-alarm-day',
                toggle_mode: true,
                can_focus: true,
                x_expand: true,
                label: this._dayChips[day],
                accessible_name: this._weekdays[day],
            });
            button.connect('clicked', () => {
                if (this._edit.days.has(day))
                    this._edit.days.delete(day);
                else
                    this._edit.days.add(day);
                this._renderEditor();
            });
            days.add_child(button);
            this._dayButtons.set(day, button);
        }

        this._repeatHint = new St.Label({
            style_class: 'bct-alarm-hint',
            x_align: Clutter.ActorAlign.CENTER,
        });

        // Delete (when editing), Cancel and Save
        const actions = new St.BoxLayout({style_class: 'bct-alarm-actions'});
        this._deleteButton = this._makeButton({
            icon: 'user-trash-symbolic', name: this._text.delete,
            onClicked: () => {
                this._model.remove(this._edit.id);
                this._closeEditor();
            },
        });
        actions.add_child(this._deleteButton);
        actions.add_child(new St.Widget({x_expand: true}));
        actions.add_child(this._makeButton({
            label: this._text.cancel, onClicked: () => this._closeEditor(),
        }));
        const save = this._makeButton({
            label: this._text.save,
            onClicked: () => {
                // Show the saved alarm afterwards
                this._selectId = this._model.save({
                    id: this._edit.id,
                    hour: this._edit.hour,
                    minute: this._edit.minute,
                    days: this._edit.days,
                });
                this._closeEditor();
            },
        });
        save.add_style_class_name('bct-alarm-save');
        actions.add_child(save);

        editor.add_child(time);
        editor.add_child(days);
        editor.add_child(this._repeatHint);
        editor.add_child(actions);
        return editor;
    }

    _openEditor(alarm) {
        this._edit = alarm
            ? {id: alarm.id, hour: alarm.hour, minute: alarm.minute, days: new Set(alarm.days)}
            : {id: null, hour: 7, minute: 0, days: new Set()};
        this._render();
    }

    _closeEditor() {
        this._edit = null;
        this._render();
    }

    _shiftHour(step) {
        this._edit.hour = (this._edit.hour + step + 24) % 24;
        this._renderEditor();
    }

    _shiftMinute(step) {
        this._edit.minute = (this._edit.minute + step + 60) % 60;
        this._renderEditor();
    }

    _renderEditor() {
        const {hour, minute, days, id} = this._edit;
        const parts = this._timeParts(hour, minute);

        this._hourLabel.text = this._hour12() ? String(hour % 12 || 12) : pad(hour);
        this._minuteLabel.text = pad(minute);
        this._periodButton.visible = this._hour12();
        this._periodButton.label = parts.period;

        for (const [day, button] of this._dayButtons)
            button.checked = days.has(day);
        this._repeatHint.text = this._daysSummary(days);

        this._deleteButton.visible = id !== null;
    }

    // -------------------------------------------------------------- render

    // direction (-1 or 1) slides the new alarm in from that side.
    _render(direction = 0) {
        const alarms = this._alarms();

        // After saving, show the alarm that was saved.
        if (this._selectId !== null) {
            const saved = alarms.findIndex(alarm => alarm.id === this._selectId);
            if (saved >= 0)
                this._index = saved;
            this._selectId = null;
        }
        this._index = Math.max(0, Math.min(this._index, alarms.length - 1));

        // Banner while an alarm rings
        const ringing = this._model.ringing;
        this._banner.visible = ringing !== null;
        if (ringing) {
            const parts = this._timeParts(ringing.hour, ringing.minute);
            this._bannerLabel.text = `${this._text.ringing} ${parts.text} ${parts.period}`.trim();
        }

        // Editor, or the pager
        const editing = this._edit !== null;
        this._editor.visible = editing;
        this._addButton.visible = !editing;
        this._pager.visible = !editing;
        // While an alarm is edited, clicking the card does not leave for Clocks.
        this.actor.reactive = !editing;
        this.actor.can_focus = !editing;
        this._swallowClick = false;
        if (editing)
            this._renderEditor();

        // The alarm that is shown
        const alarm = alarms[this._index] ?? null;
        this._editButton.visible = !editing && alarm !== null;
        this._empty.visible = alarm === null;
        this._slide.visible = alarm !== null;
        this._dotsBox.visible = alarms.length > 1;
        this._syncDots(alarms.length);

        if (alarm) {
            const parts = this._timeParts(alarm.hour, alarm.minute);
            this._timeLabel.text = parts.text;
            this._periodLabel.text = parts.period;
            this._periodLabel.visible = parts.period !== '';
            const summary = this._daysSummary(alarm.days);
            this._daysLabel.text = alarm.name ? `${alarm.name} · ${summary}` : summary;
            this._switch.state = alarm.enabled;
            this._slide.opacity = alarm.enabled ? 255 : 130;

            if (direction !== 0)
                fadeIn(this._slide, {x: direction * 24, to: alarm.enabled ? 255 : 130});
        }
    }

}
