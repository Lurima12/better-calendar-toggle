// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {openClocks} from '../services/clocksLauncher.js';
import {fadeIn} from '../util/animation.js';
import {loadGWeather} from '../services/gweather.js';
import {ScrollStepper} from '../util/scrollStep.js';

const WORLD_CLOCKS_SCHEMA = 'org.gnome.shell.world-clocks';

// Cities shown at once; more cities are spread over pages.
const CLOCK_PAGE_SIZE = 3;
// Horizontal drag distance (in CSS px) that counts as a swipe.
const SWIPE_DISTANCE = 40;

const pad = value => String(value).padStart(2, '0');

// World clocks as one rounded card: up to three cities at once, one page after
// another (change the page with a swipe, the mouse wheel or the dots below).
// A row shows a day/night icon, the city, the day and time difference, and the
// time. Clicking opens GNOME Clocks. The cities are the ones saved in GNOME
// Clocks.
export class WorldClocks {
    static isSupported() {
        return Boolean(Gio.SettingsSchemaSource.get_default()?.lookup(WORLD_CLOCKS_SCHEMA, true));
    }

    // clock: the wall clock of the date menu, used to refresh once a minute.
    constructor(clock, text, onActivate) {
        this._clock = clock;
        this._text = text;
        this._onActivate = onActivate;
        this._destroyed = false;
        this._locations = [];
        this._entries = [];
        this._page = 0;
        this._scroller = new ScrollStepper();
        this._pressX = null;
        this._pressedOnDot = false;
        this._swallowClick = false;
        this._dots = [];
        this._dotsCount = -1;

        this._settings = null;
        this._settingsId = 0;
        this._interfaceSettings = null;
        this._interfaceId = 0;
        this._clockId = 0;

        // One page of up to three cities at a time; the next pages are
        // reached by swiping, scrolling or clicking a dot.
        this._rows = new St.BoxLayout({
            style_class: 'bct-clock-rows',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        // One dot per page, shown when there is more than one.
        this._dotsBox = new St.BoxLayout({
            style_class: 'bct-media-dots',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        const title = new St.Label({
            text: text.title,
            style_class: 'bct-card-title',
        });
        const content = new St.BoxLayout({
            style_class: 'bct-clocks-card',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        content.add_child(title);
        content.add_child(this._rows);
        this._empty = new St.Label({
            text: text.none,
            style_class: 'bct-clock-empty',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        content.add_child(this._empty);
        content.add_child(this._dotsBox);

        this.actor = new St.Button({
            style_class: 'bct-clocks-button',
            can_focus: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            visible: false,
            accessible_name: text.openClocks,
            child: content,
        });
        // Swipes, wheel steps and taps are handled here; no event is ever
        // stopped, so the dots stay clickable, and taps that another part of
        // the card acted on are held back from the click that opens GNOME
        // Clocks (see _swallowClick in _onEvent).
        this.actor.connect('clicked', () => this._onCardClicked());
        this.actor.connect('event', (_actor, event) => this._onEvent(event));
        this.actor.connect('scroll-event', (_actor, event) => this._onScroll(event));
    }

    start() {
        this._settings = new Gio.Settings({schema_id: WORLD_CLOCKS_SCHEMA});
        this._settingsId = this._settings.connect('changed::locations', () => this._reload());

        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interfaceId = this._interfaceSettings.connect(
            'changed::clock-format', () => this._render());

        if (this._clock)
            this._clockId = this._clock.connect('notify::clock', () => this._render());

        this._reload();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        this._destroyed = true;

        if (this._settings && this._settingsId)
            this._settings.disconnect(this._settingsId);
        if (this._interfaceSettings && this._interfaceId)
            this._interfaceSettings.disconnect(this._interfaceId);
        if (this._clock && this._clockId)
            this._clock.disconnect(this._clockId);

        this._settingsId = 0;
        this._interfaceId = 0;
        this._clockId = 0;
        this._settings = null;
        this._interfaceSettings = null;
        this._clock = null;
    }

    _activate() {
        openClocks('world');
        this._onActivate?.();
    }

    async _reload() {
        const GWeather = await loadGWeather();
        if (this._destroyed || !this._settings)
            return;

        this._locations = [];
        if (GWeather) {
            const world = GWeather.Location.get_world();
            for (const entry of this._settings.get_value('locations').deepUnpack()) {
                try {
                    const location = world?.deserialize(entry);
                    const timezone = location?.get_timezone();
                    if (!location || !timezone)
                        continue;
                    this._locations.push({
                        name: location.get_city_name?.() || location.get_name?.() || '',
                        timezone,
                    });
                } catch (e) {
                    // Skip a location that cannot be read.
                }
            }
        }
        this._render();
    }

    _render() {
        if (this._destroyed)
            return;

        // Earliest time zone list, like the stock world clocks.
        this._entries = this._locations
            .map(({name, timezone}) => ({name, time: GLib.DateTime.new_now(timezone)}))
            .sort((a, b) => a.time.get_utc_offset() - b.time.get_utc_offset());

        // The card stays visible when it is empty: it shows the title and an
        // empty line inside the same card, like the alarms and weather cards.
        const empty = this._entries.length === 0;
        this.actor.visible = true;
        this._rows.visible = !empty;
        this._empty.visible = empty;
        // Keep a small page when cities were removed on other pages.
        this._page = Math.max(0, Math.min(this._page, this._pageCount() - 1));
        this._renderPage(0);
    }

    _pageCount() {
        return Math.max(1, Math.ceil(this._entries.length / CLOCK_PAGE_SIZE));
    }

    _renderPage(direction) {
        const now = GLib.DateTime.new_now_local();
        const hour12 = this._interfaceSettings.get_string('clock-format') === '12h';
        const slice = this._entries.slice(
            this._page * CLOCK_PAGE_SIZE, (this._page + 1) * CLOCK_PAGE_SIZE);

        this._rows.destroy_all_children();
        slice.forEach((entry, index) => {
            if (index > 0)
                this._rows.add_child(new St.Widget({style_class: 'bct-clock-divider'}));
            this._rows.add_child(this._makeRow(entry, now, hour12));
        });

        this._dotsBox.visible = this._pageCount() > 1;
        this._syncDots(this._pageCount());

        if (direction !== 0)
            fadeIn(this._rows, {x: direction * 24});
    }

    // Click of the button around the card: opens GNOME Clocks, unless the tap
    // belonged to a dot or a swipe (their action was done already).
    _onCardClicked() {
        if (this._swallowClick) {
            this._swallowClick = false;
            return;
        }
        this._activate();
    }

    // Moves to the previous or next page; stops at the ends (no looping).
    _move(step) {
        const next = this._page + step;
        if (this._pageCount() < 2 || next < 0 || next >= this._pageCount())
            return;
        this._page = next;
        this._renderPage(step);
    }

    _select(index) {
        if (index === this._page)
            return;
        const step = index > this._page ? 1 : -1;
        this._page = index;
        this._renderPage(step);
    }

    _onScroll(event) {
        if (this._pageCount() < 2)
            return Clutter.EVENT_PROPAGATE;

        // One page per scroll gesture, so the others are not skipped.
        const step = this._scroller.read(event);
        if (step === null)
            return Clutter.EVENT_PROPAGATE;
        if (step !== 0)
            this._move(step);
        return Clutter.EVENT_STOP;
    }

    // Swipe left or right to change the page; a plain tap opens GNOME Clocks
    // through the click of the button around the card. No event is ever
    // stopped, so the dots stay clickable; where this card acted instead,
    // _swallowClick holds the opening back.
    _onEvent(event) {
        switch (event.type()) {
        case Clutter.EventType.BUTTON_PRESS:
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                break;
            // fall through
        case Clutter.EventType.TOUCH_BEGIN: {
            [this._pressX] = event.get_coords();
            const source = event.get_source();
            this._pressedOnDot = Boolean(source) && this._dotsBox.contains(source);
            break;
        }
        case Clutter.EventType.BUTTON_RELEASE:
        case Clutter.EventType.TOUCH_END: {
            if (this._pressX === null)
                break;
            const [x] = event.get_coords();
            const distance = (x - this._pressX) / this._scale();
            const wasOnDot = this._pressedOnDot;
            this._pressX = null;

            this._swallowClick = wasOnDot;
            if (Math.abs(distance) >= SWIPE_DISTANCE) {
                this._swallowClick = true;
                this._move(distance < 0 ? 1 : -1);
            }
            break;
        }
        case Clutter.EventType.TOUCH_CANCEL:
        case Clutter.EventType.LEAVE:
            this._pressX = null;
            this._pressedOnDot = false;
            this._swallowClick = false;
            break;
        default:
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
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
                    accessible_name: `${this._text.title} ${i + 1}`,
                });
                dot.connect('clicked', () => this._select(i));
                this._dotsBox.add_child(dot);
                this._dots.push(dot);
            }
        }

        this._dots.forEach((dot, index) => {
            if (index === this._page)
                dot.add_style_class_name('bct-media-dot-active');
            else
                dot.remove_style_class_name('bct-media-dot-active');
        });
    }

    _makeRow({name, time}, now, hour12) {
        const row = new St.BoxLayout({style_class: 'bct-clock-row', y_expand: true});

        // Sun by day, moon by night
        const daytime = time.get_hour() >= 6 && time.get_hour() < 18;
        row.add_child(new St.Icon({
            icon_name: daytime ? 'weather-clear-symbolic' : 'weather-clear-night-symbolic',
            style_class: 'bct-clock-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const labels = new St.BoxLayout({
            style_class: 'bct-clock-labels',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const city = new St.Label({text: name, style_class: 'bct-clock-city'});
        city.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        labels.add_child(city);
        labels.add_child(new St.Label({
            text: this._relativeText(time, now),
            style_class: 'bct-clock-sub',
        }));
        row.add_child(labels);

        const times = new St.BoxLayout({
            style_class: 'bct-clock-times',
            y_align: Clutter.ActorAlign.CENTER,
        });
        times.add_child(new St.Label({
            text: time.format(hour12 ? '%-I:%M' : '%H:%M'),
            style_class: 'bct-clock-time',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const period = hour12 ? time.format('%p') : '';
        if (period) {
            times.add_child(new St.Label({
                text: period,
                style_class: 'bct-clock-period',
                y_align: Clutter.ActorAlign.END,
            }));
        }
        row.add_child(times);

        return row;
    }

    // "Tomorrow · +5 h", "Today · Same time", "Mon · −2 h"
    _relativeText(time, now) {
        const t = this._text;
        const dayNumber = value =>
            Date.UTC(value.get_year(), value.get_month() - 1, value.get_day_of_month()) / 86400000;

        const dayDifference = Math.round(dayNumber(time) - dayNumber(now));
        let day;
        if (dayDifference === 0)
            day = t.today;
        else if (dayDifference === 1)
            day = t.tomorrow;
        else if (dayDifference === -1)
            day = t.yesterday;
        else
            day = time.format('%a');

        const minutes = Math.round((time.get_utc_offset() - now.get_utc_offset()) / 60000000);
        if (minutes === 0)
            return `${day} · ${t.sameTime}`;

        const sign = minutes > 0 ? '+' : '−';
        const hours = Math.floor(Math.abs(minutes) / 60);
        const remainder = Math.abs(minutes) % 60;
        const amount = remainder > 0 ? `${hours}:${pad(remainder)}` : `${hours}`;
        return `${day} · ${sign}${amount} ${t.hoursShort}`;
    }
}
