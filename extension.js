// SPDX-License-Identifier: GPL-2.0-or-later
//
// Better Calendar Toggle
// Overhauls the GNOME Shell date menu into separate pages.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {fadeIn, setAnimationSettings} from './src/util/animation.js';
import {AlarmModel} from './src/models/alarmModel.js';
import {AlarmView} from './src/ui/alarmView.js';
import {ClockFormatter} from './src/panel/clockFormatter.js';
import {LyricsService} from './src/services/lyrics.js';
import {LyricsView} from './src/ui/lyricsView.js';
import {MediaView} from './src/ui/mediaView.js';
import {MiscModel} from './src/models/miscModel.js';
import {MiscView} from './src/ui/miscView.js';
import {MprisClient} from './src/services/mpris.js';
import {NotificationList} from './src/ui/notificationList.js';
import {ScrollStepper} from './src/util/scrollStep.js';
import {TodoModel} from './src/models/todoModel.js';
import {TodoView} from './src/ui/todoView.js';
import {WeatherDetails} from './src/ui/weatherDetails.js';
import {WeatherIndicator} from './src/panel/weatherIndicator.js';
import {WeatherSource} from './src/services/weatherSource.js';
import {WorldClocks} from './src/ui/worldClocks.js';

// A screen is treated as "small" at or below these logical sizes
// (1366x768 laptops fall in here).
const COMPACT_MAX_WIDTH = 1400;
const COMPACT_MAX_HEIGHT = 800;

// Width (em) the media player needs beside its padding.
const MEDIA_RESERVED_EM = 4;

// Smallest fixed container size (CSS px) that still lays out properly.
const MIN_FIXED_WIDTH = 360;
const MIN_FIXED_HEIGHT = 240;

// Space (in CSS px) kept free around the menu: arrow, menu padding, margins.
const MENU_VERTICAL_MARGIN = 80;
const MENU_HORIZONTAL_MARGIN = 48;

class DateMenuOverhaul {
    constructor(gettext, settings, weatherSource, userAgent) {
        this._ = gettext;
        this._settings = settings;
        this._weatherSource = weatherSource;
        this._userAgent = userAgent;
        this._lyrics = null;
        this._alarms = null;
        this._todos = null;

        this._settingsSignals = [];
        this._rebuildId = 0;
        this._mpris = null;
        this._misc = null;

        this._resetUiState();
    }

    _resetUiState() {
        this._dateMenu = null;
        this._root = null;
        this._tabBar = null;
        this._tabScroll = null;
        this._tabScroller = null;
        this._revealId = 0;
        this._revealTarget = null;
        this._stack = null;

        this._pages = new Map();
        this._tabs = new Map();
        this._activePage = null;
        this._compact = false;

        this._moved = [];
        this._props = [];
        this._hidden = [];
        this._signals = [];
        this._scrolls = [];
        this._mediaViews = [];
        this._lyricsViews = [];
        this._mediaView = null;
        this._lyricsView = null;
        this._mediaDotsBox = null;
        this._mediaDots = [];
        this._mediaDotsKey = '';
        this._mediaButton = null;
        this._lyricsButton = null;
        this._miscView = null;
        this._weatherDetails = null;
        this._worldClocks = null;
        this._alarmView = null;
        this._todoView = null;
        this._notificationList = null;

        this._constraints = [];
        this._debugId = 0;

        this._notifSettings = null;
        this._dndButton = null;
        this._dndIcon = null;
        this._listScroll = null;

        this._events = null;
        this._eventsPlaceholder = null;
        this._clocks = null;
        this._weather = null;
        this._weatherPlaceholder = null;
        this._clocksPlaceholder = null;
    }

    start() {
        this._mpris = new MprisClient();
        this._mpris.start();

        this._lyrics = new LyricsService(this._userAgent, this._settings);

        this._misc = new MiscModel(this._settings, event => this._handleMiscAlert(event));
        this._misc.start();

        this._alarms = new AlarmModel(this._settings, {
            ring: alarm => this._handleAlarmRing(alarm),
            sound: () => this._playAlarmSound(this._('Alarm')),
        });
        this._alarms.start();

        this._todos = new TodoModel(this._settings);
        this._todos.start();

        if (!this.build())
            return false;
        this._connectSettings();
        return true;
    }

    destroy() {
        if (this._rebuildId) {
            GLib.Source.remove(this._rebuildId);
            this._rebuildId = 0;
        }
        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        this._teardownUi();

        this._todos?.destroy();
        this._todos = null;
        this._alarms?.destroy();
        this._alarms = null;
        this._misc?.destroy();
        this._misc = null;
        this._lyrics?.destroy();
        this._lyrics = null;
        this._mpris?.destroy();
        this._mpris = null;
    }

    // ------------------------------------------------------------ building

    build() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        const calendar = dateMenu?._calendar;
        const menuBox = dateMenu?.menu?.box;

        if (!calendar || !menuBox) {
            console.warn('Better Calendar Toggle: unsupported date menu layout, leaving it untouched');
            return false;
        }

        this._dateMenu = dateMenu;

        const messageList = dateMenu._messageList ?? null;
        const originalArea = this._childOfAncestor(calendar, menuBox);

        this._root = new St.BoxLayout({
            style_class: 'bct-root',
            vertical: true,
            x_expand: true,
        });
        this._tabBar = new St.BoxLayout({style_class: 'bct-tabbar'});
        // The tabs scroll sideways when they do not all fit, and the mouse
        // wheel or a touchpad over them moves to the previous or next tab.
        this._tabScroll = new St.ScrollView({
            style_class: 'bct-tabscroll',
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._tabScroll.add_child(this._tabBar);
        this._tabScroll.connect('scroll-event', (_actor, event) => this._onTabScroll(event));
        this._tabScroller = new ScrollStepper(() => this._settings.get_int('scroll-distance'));
        this._stack = new St.BoxLayout({
            style_class: 'bct-stack',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this._root.add_child(this._tabScroll);
        this._root.add_child(this._stack);

        // Only pages that are both available and enabled are built, so the
        // stock widgets of a disabled page are never touched.
        const available = new Set(['calendar', 'media', 'world', 'misc']);
        if (messageList)
            available.add('notifications');

        const builders = {
            calendar: () => this._buildCalendarPage(dateMenu, calendar),
            notifications: () => this._buildNotificationsPage(messageList),
            media: () => this._buildMediaPage(),
            world: () => this._buildWorldPage(dateMenu),
            misc: () => this._buildMiscPage(),
        };
        const order = this._resolveOrder(available);
        for (const id of order)
            this._addPage(id, builders[id]());

        // Hide the original two-column layout; its content now lives in our pages.
        if (originalArea)
            this._hide(originalArea);
        menuBox.add_child(this._root);

        this._connectUiSignals();
        this._syncPlaceholders();
        this._applyScrollbars();
        this._updateLayout();
        this._selectPage(this._initialPage());

        return true;
    }

    _teardownUi() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];

        if (this._debugId)
            GLib.Source.remove(this._debugId);
        if (this._revealId)
            GLib.Source.remove(this._revealId);
        for (const {actor, constraint} of this._constraints)
            actor.remove_constraint(constraint);

        for (const view of this._mediaViews)
            view.destroy();
        for (const view of this._lyricsViews)
            view.destroy();
        this._miscView?.destroy();
        this._weatherDetails?.destroy();
        this._worldClocks?.destroy();
        this._alarmView?.destroy();
        this._todoView?.destroy();
        this._notificationList?.destroy();

        // Give every borrowed actor back to the stock date menu before
        // destroying our own container.
        for (const {actor, oldParent, index} of this._moved.reverse()) {
            try {
                actor.get_parent()?.remove_child(actor);
                if (oldParent) {
                    const count = oldParent.get_n_children();
                    const position = index < 0 || index > count ? count : index;
                    oldParent.insert_child_at_index(actor, position);
                }
            } catch (e) {
                console.warn(`Better Calendar Toggle: could not restore an actor: ${e.message}`);
            }
        }

        for (const {actor, values} of this._props.reverse()) {
            try {
                for (const [name, value] of Object.entries(values))
                    actor[name] = value;
            } catch (e) {
                console.warn(`Better Calendar Toggle: could not restore an actor property: ${e.message}`);
            }
        }

        for (const {actor, visible} of this._hidden.reverse()) {
            try {
                actor.visible = visible;
            } catch (e) {
                console.warn(`Better Calendar Toggle: could not restore an actor's visibility: ${e.message}`);
            }
        }

        this._root?.destroy();

        this._resetUiState();
    }

    _rebuild() {
        this._teardownUi();
        this.build();
    }

    _scheduleRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    // --------------------------------------------------------------- pages

    _resolveOrder(available) {
        const hidden = this._settings.get_strv('hidden-pages');
        const ordered = [];
        for (const id of this._settings.get_strv('page-order')) {
            if (available.has(id) && !ordered.includes(id))
                ordered.push(id);
        }
        for (const id of available) {
            if (!ordered.includes(id))
                ordered.push(id);
        }

        const visible = ordered.filter(id => !hidden.includes(id));
        return visible.length > 0 ? visible : [ordered[0]];
    }

    _buildCalendarPage(dateMenu, calendar) {
        const page = new St.BoxLayout({
            style_class: 'bct-calendar-page',
            x_expand: true,
            y_expand: true,
        });

        // Events
        const eventsColumn = new St.BoxLayout({
            style_class: 'bct-events-column',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        const eventsBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        this._eventsPlaceholder = this._makePlaceholder(this._('No events'));
        eventsBox.add_child(this._eventsPlaceholder);
        const eventsScroll = this._makeScroll(eventsBox);
        eventsScroll.add_style_class_name('bct-events-scroll');
        eventsColumn.add_child(eventsScroll);

        this._events = dateMenu._eventsItem ?? null;
        if (this._events)
            this._reparent(this._events, eventsBox);

        // Calendar, with the day/month/date/year header above or below it
        const calendarColumn = new St.BoxLayout({
            style_class: 'bct-calendar-column',
            vertical: true,
        });
        const dateHeader = dateMenu._date ?? null;
        const headerOnTop = this._settings.get_string('date-header-position') !== 'bottom';
        if (dateHeader && headerOnTop)
            this._reparent(dateHeader, calendarColumn);
        this._reparent(calendar, calendarColumn);
        if (dateHeader && !headerOnTop)
            this._reparent(dateHeader, calendarColumn);

        const calendarScroll = this._makeScroll(calendarColumn);
        calendarScroll.x_expand = false;

        if (this._settings.get_string('calendar-side') === 'left') {
            page.add_child(calendarScroll);
            page.add_child(eventsColumn);
        } else {
            page.add_child(eventsColumn);
            page.add_child(calendarScroll);
        }

        return {label: this._('Calendar & Events'), icon: 'x-office-calendar-symbolic', actor: page};
    }

    _buildNotificationsPage(messageList) {
        // The extension's own list fills the whole tab; GNOME's own list
        // (below) is used when it is chosen in the preferences, or when this
        // version of GNOME Shell does not offer what the own list needs.
        if (this._settings.get_string('notification-list') === 'custom' &&
            NotificationList.isSupported()) {
            const list = new NotificationList(this._settings, {
                none: this._('No Notifications'),
                clear: this._('Clear'),
                dnd: this._('Do Not Disturb'),
                close: this._('Close'),
                expand: this._('Show more'),
                collapse: this._('Show less'),
                more: this._('%d more'),
                expandGroup: this._('Show all notifications of this app'),
                collapseGroup: this._('Show only the newest'),
                closeGroup: this._('Close all of this app'),
                justNow: this._('Just now'),
                minutesAgo: this._('%d min ago'),
                hoursAgo: this._('%d h ago'),
                daysAgo: this._('%d d ago'),
            }, () => this._dateMenu?.menu.close());
            list.start();
            this._notificationList = list;

            return {
                label: this._('Notifications'),
                icon: 'preferences-system-notifications-symbolic',
                actor: list.actor,
            };
        }

        const page = new St.BoxLayout({
            style_class: 'bct-notifications-page',
            x_expand: true,
            y_expand: true,
        });
        const column = new St.BoxLayout({
            style_class: 'bct-notifications-column',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        page.add_child(column);

        // The stock list has a fixed width and is aligned to the start, which
        // leaves empty space beside it when the tab is wider. Make it fill the
        // whole width and height of the tab instead.
        this._setProps(messageList, {
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._reparent(messageList, column);

        // Whatever the stock widgets ask for, the list is exactly as wide as
        // the page (a constraint overrides its fixed width and alignment).
        this._bindToPage(messageList, page);

        if (messageList._scrollView) {
            this._listScroll = messageList._scrollView;
            // Records the original values so they are restored on teardown.
            // Overlay scroll bars take no space beside the notifications.
            this._setProps(this._listScroll, {
                vscrollbar_policy: this._notificationsScrollPolicy(),
                hscrollbar_policy: St.PolicyType.NEVER,
                overlay_scrollbars: true,
            });
        }

        if (this._settings.get_boolean('debug-layout'))
            this._logLayoutLater(page, 'Notifications page');

        if (this._settings.get_boolean('show-dnd-switch'))
            this._addDndControls(messageList, column);

        return {
            label: this._('Notifications'),
            icon: 'preferences-system-notifications-symbolic',
            actor: page,
        };
    }

    // A compact Do Not Disturb button in one of the four corners of the
    // notification list. The stock Clear button moves into our bottom row and
    // the stock bottom row is hidden while ours is shown.
    _addDndControls(messageList, column) {
        const [vertical, side] = this._settings.get_string('dnd-position').split('-');
        const alignment = side === 'right' ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;

        const clearButton = messageList._clearButton ?? null;
        const stockRow = clearButton?.get_parent() ?? null;
        const dnd = this._makeDndButton();

        const bottomRow = new St.BoxLayout({style_class: 'message-list-controls bct-controls'});

        if (vertical === 'top') {
            dnd.x_expand = true;
            dnd.x_align = alignment;
            const topRow = new St.BoxLayout({style_class: 'bct-dnd-header'});
            topRow.add_child(dnd);
            column.insert_child_at_index(topRow, 0);

            if (clearButton && stockRow) {
                this._hide(stockRow);
                this._reparent(clearButton, bottomRow);
                column.add_child(bottomRow);
            }
        } else if (clearButton && stockRow) {
            this._hide(stockRow);
            // Left: DND, then Clear on the far side. Right: Clear, then DND beside it.
            if (side === 'left') {
                bottomRow.add_child(dnd);
                this._reparent(clearButton, bottomRow);
            } else {
                this._reparent(clearButton, bottomRow);
                bottomRow.add_child(dnd);
            }
            column.add_child(bottomRow);
        } else {
            console.warn('Better Calendar Toggle: Clear button not found, keeping the stock controls');
            dnd.x_expand = true;
            dnd.x_align = alignment;
            bottomRow.add_child(dnd);
            column.add_child(bottomRow);
        }

        this._notifSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._connect(this._notifSettings, 'changed::show-banners', () => this._syncDnd());
        this._syncDnd();
    }

    _makeDndButton() {
        this._dndIcon = new St.Icon({
            icon_name: 'preferences-system-notifications-symbolic',
            style_class: 'popup-menu-icon',
        });
        this._dndButton = new St.Button({
            style_class: 'bct-dnd-button button',
            toggle_mode: true,
            can_focus: true,
            accessible_name: this._('Do Not Disturb'),
            child: this._dndIcon,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dndButton.connect('clicked', () => {
            const showBanners = this._notifSettings.get_boolean('show-banners');
            this._notifSettings.set_boolean('show-banners', !showBanners);
        });
        return this._dndButton;
    }

    _syncDnd() {
        if (!this._dndButton || !this._notifSettings)
            return;
        const enabled = !this._notifSettings.get_boolean('show-banners');
        this._dndButton.checked = enabled;
        this._dndIcon.icon_name = enabled
            ? 'notifications-disabled-symbolic'
            : 'preferences-system-notifications-symbolic';
    }

// Media page: the player and the lyrics are two views, switched with the
    // buttons above the player dots. The player card has the cover on the left
    // and the title, artist, seek bar and controls on the right. The lyrics
    // view is hidden by default (the setting remembers the choice) and nothing
    // is looked up while it is hidden.
    _buildMediaPage() {
        const page = new St.BoxLayout({
            style_class: 'bct-media-page',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        // Media player / Lyrics switcher, above the player dots.
        const switcher = new St.BoxLayout({
            style_class: 'bct-media-switcher',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._mediaButton = this._makeMediaSwitcher(this._('Media player'),
            'audio-x-generic-symbolic', false);
        this._lyricsButton = this._makeMediaSwitcher(this._('Lyrics'),
            'format-justify-left-symbolic', true);
        switcher.add_child(this._mediaButton);
        switcher.add_child(this._lyricsButton);

        // One dot per player. They live here, not in the player card, so the
        // switcher sits above them and they stay in place in both views.
        this._mediaDotsBox = new St.BoxLayout({
            style_class: 'bct-media-dots',
            x_align: Clutter.ActorAlign.CENTER,
        });

        const view = new MediaView(this._mpris, {
            noMedia: this._('No media playing'),
            previousTrack: this._('Previous track'),
            playPause: this._('Play or pause'),
            nextTrack: this._('Next track'),
            seek: this._('Seek'),
        }, this._settings, () => this._dateMenu?.menu.close());
        this._mediaViews.push(view);
        this._mediaView = view;

        const lyrics = new LyricsView(this._mpris, this._lyrics, this._settings, {
            searching: this._('Searching for lyrics...'),
            none: this._('No synced lyrics found'),
            instrumental: this._('Instrumental'),
            romanization: this._('Show romanization'),
            translation: this._('Show translation'),
        });
        this._lyricsViews.push(lyrics);
        this._lyricsView = lyrics;

        view.connect('player-changed', (_view, player) => {
            lyrics.setPlayer(player);
            this._syncMediaDots();
        });
        lyrics.setPlayer(view.currentPlayer);

        const content = new St.BoxLayout({
            style_class: 'bct-media-content',
            x_expand: true,
            y_expand: true,
        });
        content.add_child(view.actor);
        content.add_child(lyrics.actor);

        page.add_child(this._mediaDotsBox);
        page.add_child(content);
        page.add_child(switcher);

        // Selecting a view remembers the choice; the lyrics are only looked up
        // while their view is shown.
        const applyView = initial => {
            const lyricsView = this._settings.get_boolean('lyrics-visible');
            view.actor.visible = !lyricsView;
            lyrics.actor.visible = lyricsView;
            this._mediaButton.checked = !lyricsView;
            this._lyricsButton.checked = lyricsView;
            lyrics.setEnabled(lyricsView);
            if (!initial)
                this._updateLayout();
        };
        this._connect(this._settings, 'changed::lyrics-visible', () => applyView(false));
        this._connect(this._mpris, 'changed', () => this._syncMediaDots());
        applyView(true);
        this._syncMediaDots();

        return {label: this._('Media'), icon: 'audio-x-generic-symbolic', actor: page};
    }

    _makeMediaSwitcher(label, icon, lyricsView) {
        const button = new St.Button({
            style_class: 'bct-media-switcher-button button',
            toggle_mode: true,
            can_focus: true,
            accessible_name: label,
            child: new St.Icon({
                icon_name: icon,
                style_class: 'popup-menu-icon',
            }),
        });
        button.connect('clicked', () => {
            // Set both states explicitly: clicking the active button would
            // otherwise toggle it off without changing the setting.
            this._mediaButton.checked = !lyricsView;
            this._lyricsButton.checked = lyricsView;
            this._settings.set_boolean('lyrics-visible', lyricsView);
        });
        return button;
    }

    // Keeps the player dots in step with the player list and the current player.
    _syncMediaDots() {
        if (!this._mediaDotsBox || !this._mediaView)
            return;

        const players = this._mpris.players;
        const key = players.map(player => player.busName).join('|');
        if (key !== this._mediaDotsKey) {
            this._mediaDotsKey = key;
            this._mediaDotsBox.destroy_all_children();
            this._mediaDots = players.map(player => {
                const dot = new St.Button({
                    style_class: 'bct-media-dot',
                    can_focus: true,
                    accessible_name: player.identity || player.title,
                });
                dot.connect('clicked', () => this._mediaView.select(player.busName));
                this._mediaDotsBox.add_child(dot);
                return {dot, busName: player.busName};
            });
        }

        this._mediaDotsBox.visible = players.length > 1;
        const current = this._mediaView.currentPlayer?.busName ?? null;
        for (const {dot, busName} of this._mediaDots) {
            if (busName === current)
                dot.add_style_class_name('bct-media-dot-active');
            else
                dot.remove_style_class_name('bct-media-dot-active');
        }
    }

    // Weather on the left, world clocks on the right.
    _buildWorldPage(dateMenu) {
        const page = new St.BoxLayout({
            style_class: 'bct-world-page',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        const row = new St.BoxLayout({
            style_class: 'bct-world-row',
            x_expand: true,
            y_expand: true,
        });

        // Two columns of the same height: the weather card on the left, the
        // alarms and the world clocks stacked on the right. The right column
        // is only as wide as these cards need (the weather card has more
        // content and gets the rest of the space), and all cards stretch, so
        // their top and bottom edges line up and they fill the tab.
        const weatherColumn = new St.BoxLayout({
            style_class: 'bct-world-column',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        const clocksColumn = new St.BoxLayout({
            style_class: 'bct-world-column',
            vertical: true,
            y_expand: true,
        });
        this._weatherPlaceholder = this._makePlaceholder(this._('No weather to show'));
        weatherColumn.add_child(this._weatherPlaceholder);

        this._clocks = dateMenu._clocksItem ?? null;
        this._weather = dateMenu._weatherItem ?? null;
        const closeMenu = () => this._dateMenu?.menu.close();

        // Detailed, clickable weather card for the city chosen in GNOME
        // Weather; the stock weather button is used only without a source.
        if (this._weatherSource) {
            this._weatherDetails = new WeatherDetails(this._weatherSource, {
                feelsLike: this._('Feels like'),
                humidity: this._('Humidity'),
                wind: this._('Wind'),
                pressure: this._('Pressure'),
                visibility: this._('Visibility'),
                dewPoint: this._('Dew point'),
                sunrise: this._('Sunrise'),
                sunset: this._('Sunset'),
                updated: this._('Updated'),
                openWeather: this._('Open Weather'),
            }, closeMenu);
            weatherColumn.add_child(this._weatherDetails.actor);
        } else if (this._weather) {
            this._reparent(this._weather, weatherColumn);
        }

        // Alarms, above the world clocks
        this._alarmView = new AlarmView(this._alarms, {
            title: this._('Alarms'),
            none: this._('No alarms'),
            add: this._('Add alarm'),
            edit: this._('Edit alarm'),
            onOff: this._('Turn alarm on or off'),
            once: this._('Once'),
            everyDay: this._('Every day'),
            weekdays: this._('Weekdays'),
            weekends: this._('Weekends'),
            am: this._('AM'),
            pm: this._('PM'),
            increase: this._('Increase'),
            decrease: this._('Decrease'),
            save: this._('Save'),
            cancel: this._('Cancel'),
            delete: this._('Delete alarm'),
            alarm: this._('Alarm'),
            ringing: this._('Alarm'),
            snooze: this._('Snooze'),
            stop: this._('Stop'),
            openClocks: this._('Open GNOME Clocks'),
        }, this._settings, closeMenu);
        clocksColumn.add_child(this._alarmView.actor);

        // World clocks card; the stock list is used only when the clock
        // locations of GNOME cannot be read.
        if (WorldClocks.isSupported()) {
            this._worldClocks = new WorldClocks(dateMenu._clock ?? null, {
                title: this._('World clocks'),
                openClocks: this._('Open Clocks'),
                none: this._('No world clocks'),
                today: this._('Today'),
                tomorrow: this._('Tomorrow'),
                yesterday: this._('Yesterday'),
                sameTime: this._('Same time'),
                hoursShort: this._('h'),
            }, closeMenu);
            this._worldClocks.start();
            clocksColumn.add_child(this._worldClocks.actor);
        } else if (this._clocks) {
            this._setProps(this._clocks, {x_expand: true});
            this._reparent(this._clocks, clocksColumn);
            // The stock section hides itself when it is empty; keep a
            // placeholder below it so the column still ends with a card.
            this._clocksPlaceholder = this._makePlaceholder(this._('No world clocks to show'));
            clocksColumn.add_child(this._clocksPlaceholder);
        }

        row.add_child(weatherColumn);
        row.add_child(clocksColumn);

        const scroll = this._makeScroll(row);
        scroll.add_style_class_name('bct-world-scroll');
        page.add_child(scroll);

        return {
            label: this._('Weather & Clocks'),
            icon: 'weather-few-clouds-symbolic',
            actor: page,
        };
    }

    _buildMiscPage() {
        // The task list sits above the Pomodoro, the stopwatch and the timer.
        this._todoView = new TodoView(this._todos, {
            title: this._('Tasks'),
            hint: this._('Add a task…'),
            add: this._('Add task'),
            remove: this._('Remove task'),
            toggle: this._('Mark as done or not done'),
            clearDone: this._('Clear done'),
            empty: this._('No tasks yet'),
        });

        this._miscView = new MiscView(this._misc, {
            pomodoro: this._('Pomodoro'),
            stopwatch: this._('Stopwatch'),
            timer: this._('Timer'),
            focus: this._('Focus'),
            shortBreak: this._('Short break'),
            longBreak: this._('Long break'),
            ready: this._('Ready'),
            running: this._('Running'),
            paused: this._('Paused'),
            reset: this._('Reset'),
            startPause: this._('Start or pause'),
            skip: this._('Skip'),
            lap: this._('Lap'),
            laps: this._('Laps'),
            minusFive: this._('−5 min'),
            minusOne: this._('−1 min'),
            plusOne: this._('+1 min'),
            plusFive: this._('+5 min'),
            openClocks: this._('Open GNOME Clocks'),
        }, this._todoView.actor, () => this._dateMenu?.menu.close());

        return {
            label: this._('Misc'),
            icon: 'preferences-system-time-symbolic',
            actor: this._makeScroll(this._miscView.actor),
        };
    }

    _handleAlarmRing(alarm) {
        if (!this._settings.get_boolean('misc-notifications'))
            return;
        const time = `${String(alarm.hour).padStart(2, '0')}:${String(alarm.minute).padStart(2, '0')}`;
        Main.notify(this._('Alarm'), time);
    }

    _playAlarmSound(title) {
        if (!this._settings.get_boolean('misc-sound'))
            return;
        try {
            global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', title, null);
        } catch (e) {
            // No sound theme available.
        }
    }

    _handleMiscAlert(event) {
        let title;
        let body;

        if (event.kind === 'timer') {
            title = this._('Timer finished');
            body = this._('Your timer has run out.');
        } else if (event.finished === 'focus') {
            title = this._('Focus session finished');
            body = event.next === 'long'
                ? this._('Time for a long break.')
                : this._('Time for a short break.');
        } else {
            title = this._('Break finished');
            body = this._('Ready for the next focus session.');
        }

        if (this._settings.get_boolean('misc-notifications'))
            Main.notify(title, body);

        if (this._settings.get_boolean('misc-sound')) {
            try {
                global.display.get_sound_player().play_from_theme(
                    'alarm-clock-elapsed', title, null);
            } catch (e) {
                // No sound theme available.
            }
        }
    }

    _addPage(id, {label, icon, actor}) {
        const content = new St.BoxLayout({style_class: 'bct-tab-content'});
        content.add_child(new St.Icon({
            icon_name: icon,
            style_class: 'popup-menu-icon bct-tab-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const labelActor = new St.Label({
            text: label,
            style_class: 'bct-tab-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(labelActor);

        const button = new St.Button({
            style_class: 'bct-tab',
            toggle_mode: true,
            can_focus: true,
            accessible_name: label,
            child: content,
        });
        button.connect('clicked', () => this._selectPage(id, true));
        this._tabBar.add_child(button);
        this._tabs.set(id, {button, label: labelActor});

        actor.visible = false;
        this._stack.add_child(actor);
        this._pages.set(id, actor);
    }

    _initialPage() {
        const preferred = this._settings.get_string('default-page');
        const wanted = preferred === 'last'
            ? this._settings.get_string('last-page')
            : preferred;
        return this._pages.has(wanted) ? wanted : this._pages.keys().next().value;
    }

    _selectPage(id, remember = false) {
        if (!this._pages.has(id))
            id = this._pages.keys().next().value;
        const previous = this._activePage;
        this._activePage = id;

        const labelMode = this._settings.get_string('tab-labels');
        for (const [pageId, page] of this._pages)
            page.visible = pageId === id;
        for (const [pageId, {button, label}] of this._tabs) {
            button.checked = pageId === id;
            label.visible = labelMode === 'always' ||
                (labelMode === 'auto' && (!this._compact || pageId === id));
        }

        if (remember && this._settings.get_string('last-page') !== id)
            this._settings.set_string('last-page', id);

        // A page the user switched to slides in from its side.
        if (remember && previous && previous !== id) {
            const order = [...this._pages.keys()];
            const direction = order.indexOf(id) > order.indexOf(previous) ? 1 : -1;
            fadeIn(this._pages.get(id), {x: direction * 14});
        }
        this._scheduleRevealTab(id);
    }

    // The previous or next tab (it stops at the first and the last).
    _stepTab(step) {
        const order = [...this._pages.keys()];
        const next = order.indexOf(this._activePage) + step;
        if (next < 0 || next >= order.length)
            return;
        this._selectPage(order[next], true);
    }

    _onTabScroll(event) {
        const step = this._tabScroller?.read(event);
        if (step === null || step === undefined)
            return Clutter.EVENT_PROPAGATE;
        if (step !== 0)
            this._stepTab(step);
        return Clutter.EVENT_STOP;
    }

    // Scrolls the tab bar so the active tab is fully visible (when the tabs do
    // not all fit). It waits a moment so the tab sizes are up to date.
    _scheduleRevealTab(id) {
        this._revealTarget = id;
        if (this._revealId)
            return;
        this._revealId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._revealId = 0;

            const button = this._tabs.get(this._revealTarget)?.button;
            const adjustment = this._tabScroll?.hscroll?.adjustment;
            if (!button || !adjustment)
                return GLib.SOURCE_REMOVE;

            const box = button.get_allocation_box();
            if (box.x1 < adjustment.value)
                adjustment.value = box.x1;
            else if (box.x2 > adjustment.value + adjustment.page_size)
                adjustment.value = box.x2 - adjustment.page_size;
            return GLib.SOURCE_REMOVE;
        });
    }

    // -------------------------------------------------------------- layout

    // Width and height are independent: a fixed one is applied as given, the
    // other stays automatic and is only limited to the screen.
    _updateLayout() {
        if (!this._root)
            return;

        const layoutManager = Main.layoutManager;
        const workArea = layoutManager.getWorkAreaForMonitor(layoutManager.primaryIndex);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;

        const availableWidth = Math.max(320,
            Math.floor(workArea.width / scale) - MENU_HORIZONTAL_MARGIN);
        const availableHeight = Math.max(200,
            Math.floor(workArea.height / scale) - MENU_VERTICAL_MARGIN);

        this._compact = workArea.width / scale <= COMPACT_MAX_WIDTH ||
            workArea.height / scale <= COMPACT_MAX_HEIGHT;
        if (this._compact)
            this._root.add_style_class_name('bct-compact');
        else
            this._root.remove_style_class_name('bct-compact');

        // A value of 0 means automatic; anything else is a fixed size.
        const widthSetting = this._settings.get_int('width');
        const heightSetting = this._settings.get_int('height');
        const fixedWidth = widthSetting > 0;
        const fixedHeight = heightSetting > 0;

        let rootStyle = '';
        let stackStyle = '';
        let containerWidth = availableWidth;
        let containerHeight = availableHeight;

        if (fixedWidth) {
            const width = Math.min(Math.max(widthSetting, MIN_FIXED_WIDTH), availableWidth);
            containerWidth = width;
            rootStyle += `min-width: ${width}px; max-width: ${width}px; `;
        } else {
            rootStyle += `max-width: ${availableWidth}px; `;
        }

        if (fixedHeight) {
            const height = Math.min(Math.max(heightSetting, MIN_FIXED_HEIGHT), availableHeight);
            containerHeight = height;
            rootStyle += `min-height: ${height}px; max-height: ${height}px; `;
        } else {
            const [, tabBarHeight] = this._tabBar.get_preferred_height(-1);
            const stackHeight = Math.max(160,
                availableHeight - Math.ceil(tabBarHeight / scale));
            stackStyle = `max-height: ${stackHeight}px;`;
        }

        this._root.set_style(rootStyle);
        this._stack.set_style(stackStyle);

        // The media player shrinks to fit the container.
        for (const view of this._mediaViews)
            view.setContainerSize(containerWidth, containerHeight);

        for (const [name, active] of [['bct-fixed-width', fixedWidth], ['bct-fixed-height', fixedHeight],
            ['bct-auto-width', !fixedWidth]]) {
            if (active)
                this._root.add_style_class_name(name);
            else
                this._root.remove_style_class_name(name);
        }

        this._selectPage(this._activePage);
    }

    // "Hide" keeps the page scrollable (wheel, touch, keyboard) but draws no bar.
    _scrollPolicy() {
        return this._settings.get_boolean('show-scrollbar')
            ? St.PolicyType.AUTOMATIC
            : St.PolicyType.EXTERNAL;
    }

    _notificationsScrollPolicy() {
        return this._settings.get_boolean('notifications-scrollbar')
            ? St.PolicyType.AUTOMATIC
            : St.PolicyType.EXTERNAL;
    }

    _applyScrollbars() {
        const policy = this._scrollPolicy();
        for (const scroll of this._scrolls)
            scroll.vscrollbar_policy = policy;
        if (this._listScroll)
            this._listScroll.vscrollbar_policy = this._notificationsScrollPolicy();
    }

    // ------------------------------------------------------------- signals

    _connectSettings() {
        const rebuildKeys = [
            'page-order', 'hidden-pages', 'show-dnd-switch', 'dnd-position',
            'date-header-position', 'calendar-side', 'notification-list',
        ];
        for (const key of rebuildKeys) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._scheduleRebuild()));
        }
        for (const key of ['width', 'height', 'tab-labels']) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._updateLayout()));
        }
        this._settingsSignals.push(
            this._settings.connect('changed::show-scrollbar', () => this._applyScrollbars()));
        this._settingsSignals.push(
            this._settings.connect('changed::notifications-scrollbar', () => this._applyScrollbars()));
    }

    _connectUiSignals() {
        this._connect(this._dateMenu.menu, 'open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                return;
            this._updateLayout();
            this._selectPage(this._initialPage());
            this._notificationList?.refresh();
        });

        this._connect(Main.layoutManager, 'monitors-changed', () => this._updateLayout());
        this._connect(global.display, 'workareas-changed', () => this._updateLayout());
        this._connect(St.ThemeContext.get_for_stage(global.stage),
            'notify::scale-factor', () => this._updateLayout());

        for (const actor of [this._events, this._clocks, this._weather,
            this._weatherDetails?.actor, this._worldClocks?.actor]) {
            if (actor)
                this._connect(actor, 'notify::visible', () => this._syncPlaceholders());
        }
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _syncPlaceholders() {
        if (this._eventsPlaceholder)
            this._eventsPlaceholder.visible = !this._events?.visible;
        if (this._weatherPlaceholder) {
            const weatherShown = this._weatherDetails
                ? this._weatherDetails.actor.visible
                : Boolean(this._weather?.visible);
            this._weatherPlaceholder.visible = !weatherShown;
        }
        if (this._clocksPlaceholder) {
            const clocksShown = this._worldClocks
                ? this._worldClocks.actor.visible
                : Boolean(this._clocks?.visible);
            this._clocksPlaceholder.visible = !clocksShown;
        }
    }

    // ------------------------------------------------------------- helpers

    _makeScroll(child) {
        const scroll = new St.ScrollView({
            style_class: 'bct-scroll vfade',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: this._scrollPolicy(),
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        scroll.add_child(child);
        this._scrolls.push(scroll);
        return scroll;
    }

    _makePlaceholder(text) {
        return new St.Label({
            text,
            style_class: 'bct-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
    }

    _reparent(actor, newParent) {
        const oldParent = actor.get_parent();
        const index = oldParent ? oldParent.get_children().indexOf(actor) : -1;
        oldParent?.remove_child(actor);
        newParent.add_child(actor);
        this._moved.push({actor, oldParent, index});
    }

    _setProps(actor, values) {
        const previous = {};
        for (const name of Object.keys(values))
            previous[name] = actor[name];
        this._props.push({actor, values: previous});
        for (const [name, value] of Object.entries(values))
            actor[name] = value;
    }

    // Makes an actor's position and width follow another actor's.
    _bindToPage(actor, source) {
        for (const coordinate of [Clutter.BindCoordinate.X, Clutter.BindCoordinate.WIDTH]) {
            const constraint = new Clutter.BindConstraint({source, coordinate, offset: 0});
            actor.add_constraint(constraint);
            this._constraints.push({actor, constraint});
        }
    }

    // Developer aid ('debug-layout' setting): writes the sizes of an actor tree
    // to the journal shortly after it is shown.
    _logLayoutLater(actor, title) {
        this._connect(actor, 'notify::mapped', () => {
            if (!actor.mapped || this._debugId)
                return;
            this._debugId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._debugId = 0;
                const lines = [];
                this._describeActor(actor, 0, lines);
                console.log(`Better Calendar Toggle layout, ${title}:\n${lines.join('\n')}`);
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _describeActor(actor, depth, lines) {
        if (depth > 6)
            return;
        const [x] = actor.get_transformed_position();
        lines.push(`${'  '.repeat(depth)}${actor.constructor.name} .${actor.style_class ?? ''} ` +
            `x=${Math.round(x)} w=${Math.round(actor.width)} h=${Math.round(actor.height)} ` +
            `visible=${actor.visible}`);
        for (const child of actor.get_children())
            this._describeActor(child, depth + 1, lines);
    }

    _hide(actor) {
        this._hidden.push({actor, visible: actor.visible});
        actor.hide();
    }

    _childOfAncestor(actor, ancestor) {
        let current = actor;
        while (current && current.get_parent() !== ancestor)
            current = current.get_parent();
        return current ?? null;
    }
}

export default class BetterCalendarToggleExtension extends Extension {
    enable() {
        try {
            this._settings = this.getSettings();
        } catch (e) {
            throw new Error(
                `Better Calendar Toggle: could not load its settings (${e.message}). ` +
                'If the schemas folder has no gschemas.compiled, run glib-compile-schemas on it.');
        }

        this._weatherSource = this._startFeature(new WeatherSource());
        const userAgent = `Better Calendar Toggle/${this.metadata['version-name']} (GNOME Shell extension)`;
        setAnimationSettings(this._settings);
        this._overhaul = this._startFeature(
            new DateMenuOverhaul(this.gettext.bind(this), this._settings, this._weatherSource, userAgent));
        this._clockFormatter = this._startFeature(new ClockFormatter(this._settings));
        this._weatherIndicator = this._startFeature(
            new WeatherIndicator(this._settings, this._weatherSource));
    }

    disable() {
        this._weatherIndicator?.destroy();
        this._weatherIndicator = null;
        this._clockFormatter?.destroy();
        this._clockFormatter = null;
        this._overhaul?.destroy();
        this._overhaul = null;
        this._weatherSource?.destroy();
        this._weatherSource = null;
        setAnimationSettings(null);
        this._settings = null;
    }

    // Features are independent: one failing must not take the others down.
    _startFeature(feature) {
        try {
            if (feature.start())
                return feature;
        } catch (e) {
            console.error(`Better Calendar Toggle: ${e.message}`);
        }
        try {
            feature.destroy();
        } catch (e) {
            // A feature that failed to start can also fail to clean up; that
            // must not stop the remaining features from starting either.
            console.error(`Better Calendar Toggle: cleanup failed: ${e.message}`);
        }
        return null;
    }
}
