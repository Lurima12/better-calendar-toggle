// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PAGE_IDS = ['calendar', 'notifications', 'media', 'world', 'misc'];

function pageLabel(id) {
    switch (id) {
    case 'calendar':
        return _('Calendar & Events');
    case 'notifications':
        return _('Notifications');
    case 'media':
        return _('Media');
    case 'world':
        return _('Weather & Clocks');
    case 'misc':
        return _('Misc');
    default:
        return id;
    }
}

function currentOrder(settings) {
    const order = [];
    for (const id of settings.get_strv('page-order')) {
        if (PAGE_IDS.includes(id) && !order.includes(id))
            order.push(id);
    }
    for (const id of PAGE_IDS) {
        if (!order.includes(id))
            order.push(id);
    }
    return order;
}

function comboRow(settings, key, title, ids, labels) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(labels),
    });
    row.selected = Math.max(0, ids.indexOf(settings.get_string(key)));
    row.connect('notify::selected', () => settings.set_string(key, ids[row.selected]));
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    row.active = settings.get_boolean(key);
    row.connect('notify::active', () => settings.set_boolean(key, row.active));
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper, step = 1) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: step,
            page_increment: step * 5,
            value: settings.get_int(key),
        }),
    });
    row.connect('notify::value', () => settings.set_int(key, Math.round(row.value)));
    return row;
}

export default class BetterCalendarTogglePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep the settings object alive for as long as the window exists.
        window._settings = settings;

        const layout = new Adw.PreferencesPage({
            title: _('Layout'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        layout.add(this._buildPagesGroup(settings));
        layout.add(this._buildSizeGroup(settings));
        layout.add(this._buildCalendarGroup(settings));
        layout.add(this._buildBehaviorGroup(settings));
        layout.add(this._buildScrollGroup(settings));
        window.add(layout);

        const content = new Adw.PreferencesPage({
            title: _('Content'),
            icon_name: 'preferences-system-symbolic',
        });
        content.add(this._buildNotificationsGroup(settings));
        content.add(this._buildMediaGroup(settings));
        content.add(this._buildLyricsGroup(settings));
        content.add(this._buildMiscGroup(settings));
        content.add(this._buildAlarmGroup(settings));
        window.add(content);

        const panel = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'view-app-grid-symbolic',
        });
        panel.add(this._buildClockGroup(settings));
        panel.add(this._buildWeatherGroup(settings));
        window.add(panel);
    }

    _buildPagesGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Pages'),
            description: _('Turn pages on or off and use the arrows to change the tab order.'),
        });

        let rows = [];
        const rebuild = () => {
            for (const row of rows)
                group.remove(row);
            rows = [];

            const order = currentOrder(settings);
            const hidden = settings.get_strv('hidden-pages');

            order.forEach((id, index) => {
                // Row titles are read as markup, so "&" has to be escaped.
                const row = new Adw.ActionRow({
                    title: GLib.markup_escape_text(pageLabel(id), -1),
                });

                const up = new Gtk.Button({
                    icon_name: 'go-up-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    tooltip_text: _('Move up'),
                    sensitive: index > 0,
                });
                const down = new Gtk.Button({
                    icon_name: 'go-down-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    tooltip_text: _('Move down'),
                    sensitive: index < order.length - 1,
                });
                const toggle = new Gtk.Switch({
                    active: !hidden.includes(id),
                    valign: Gtk.Align.CENTER,
                });

                const move = offset => {
                    const next = [...order];
                    [next[index], next[index + offset]] = [next[index + offset], next[index]];
                    settings.set_strv('page-order', next);
                    rebuild();
                };
                up.connect('clicked', () => move(-1));
                down.connect('clicked', () => move(1));
                toggle.connect('notify::active', () => {
                    const hiddenNow = new Set(settings.get_strv('hidden-pages'));
                    if (toggle.active)
                        hiddenNow.delete(id);
                    else
                        hiddenNow.add(id);

                    // At least one page has to stay visible.
                    if (PAGE_IDS.every(pageId => hiddenNow.has(pageId))) {
                        toggle.active = true;
                        return;
                    }
                    settings.set_strv('hidden-pages', [...hiddenNow]);
                });

                row.add_suffix(up);
                row.add_suffix(down);
                row.add_suffix(toggle);
                row.activatable_widget = toggle;

                group.add(row);
                rows.push(row);
            });
        };
        rebuild();

        return group;
    }

    _buildSizeGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Size'),
            description: _('Width and height are independent. Automatic fits the content to the screen; ' +
                'Fixed sets a size in pixels, in steps of 50. A fixed size is limited to the available ' +
                'screen area, and content that does not fit scrolls.'),
        });

        // Automatic is a size of 0; Fixed uses the value below it.
        const addSize = (key, title, valueTitle, lower, upper, fallback) => {
            const current = settings.get_int(key);
            const fixed = current > 0;

            const modeRow = new Adw.ComboRow({
                title,
                model: Gtk.StringList.new([_('Automatic'), _('Fixed')]),
            });
            modeRow.selected = fixed ? 1 : 0;

            const start = Math.min(upper, Math.max(lower,
                Math.round((fixed ? current : fallback) / 50) * 50));
            const valueRow = new Adw.SpinRow({
                title: valueTitle,
                subtitle: _('Pixels'),
                adjustment: new Gtk.Adjustment({
                    lower,
                    upper,
                    step_increment: 50,
                    page_increment: 100,
                    value: start,
                }),
            });
            valueRow.sensitive = fixed;

            modeRow.connect('notify::selected', () => {
                const nowFixed = modeRow.selected === 1;
                valueRow.sensitive = nowFixed;
                settings.set_int(key, nowFixed ? Math.round(valueRow.value) : 0);
            });
            valueRow.connect('notify::value', () => {
                if (modeRow.selected === 1)
                    settings.set_int(key, Math.round(valueRow.value));
            });

            group.add(modeRow);
            group.add(valueRow);
        };

        addSize('width', _('Width'), _('Width in pixels'), 300, 1600, 650);
        addSize('height', _('Height'), _('Height in pixels'), 200, 1200, 450);
        return group;
    }

    _buildCalendarGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Calendar page')});

        group.add(comboRow(settings, 'calendar-side', _('Calendar side'),
            ['right', 'left'], [_('Calendar on the right, events on the left'),
                _('Calendar on the left, events on the right')]));

        group.add(comboRow(settings, 'date-header-position', _('Day, month, date and year'),
            ['top', 'bottom'], [_('Above the calendar'), _('Below the calendar')]));

        group.add(switchRow(settings, 'show-scrollbar', _('Show scroll bars'),
            _('When off, pages still scroll but no scroll bar is drawn.')));

        return group;
    }

    _buildBehaviorGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Behavior')});

        group.add(comboRow(settings, 'default-page', _('Page shown on open'),
            ['calendar', 'notifications', 'media', 'world', 'misc', 'last'],
            [pageLabel('calendar'), pageLabel('notifications'), pageLabel('media'),
                pageLabel('world'), pageLabel('misc'), _('Last used')]));

        group.add(comboRow(settings, 'tab-labels', _('Tab labels'),
            ['auto', 'always', 'never'],
            [_('Automatic'), _('Always show'), _('Icons only')]));

        group.add(switchRow(settings, 'animations', _('Animations'),
            _('Small fades and slides when you change page, player or alarm, and when notifications ' +
                'arrive or are dismissed. They are also off when GNOME animations are off.')));

        return group;
    }

    _buildNotificationsGroup(settings) {
        const group = new Adw.PreferencesGroup({title: _('Notifications')});

        group.add(comboRow(settings, 'notification-list', _('Notification list'),
            ['custom', 'stock'],
            [_('Drawn by this extension (fills the tab)'), _('The list of GNOME Shell')]));

        group.add(switchRow(settings, 'notifications-scrollbar', _('Show scroll bar'),
            _('When off, the list still scrolls but no scroll bar is drawn.')));

        const dndRow = switchRow(settings, 'show-dnd-switch', _('Do Not Disturb button'),
            _('A compact button on the Notifications page.'));
        const positionRow = comboRow(settings, 'dnd-position', _('Button position'),
            ['bottom-left', 'bottom-right'],
            [_('Bottom left'), _('Bottom right')]);
        const syncPosition = () => {
            positionRow.sensitive = dndRow.active;
        };
        dndRow.connect('notify::active', syncPosition);
        syncPosition();

        group.add(dndRow);
        group.add(positionRow);
        return group;
    }

    _buildMediaGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Media player'),
            description: _('Shown on the Media page. The player shrinks automatically ' +
                'to fit the container, so a large cover is only used when there is room.'),
        });

        group.add(spinRow(settings, 'media-cover-size', _('Cover size'),
            _('Text-size units (em)'), 5, 18));
        group.add(comboRow(settings, 'media-cover-shape', _('Cover shape'),
            ['rounded', 'square', 'circle'], [_('Rounded'), _('Square'), _('Circle')]));
        group.add(comboRow(settings, 'media-button-size', _('Playback button size'),
            ['small', 'medium', 'large'], [_('Small'), _('Medium'), _('Large')]));
        group.add(switchRow(settings, 'media-show-seekbar', _('Seek bar'),
            _('Progress bar and times above the playback buttons.')));
        return group;
    }

    _buildLyricsGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Lyrics'),
            description: _('Time-synced lyrics for the current track, on the right of the Media page. ' +
                'Use the Lyrics button on the Media page to show or hide them; nothing is looked up ' +
                'while they are hidden. Nothing is stored, and only synced lyrics are shown. When a ' +
                'provider has a romanization or a translation, buttons at the bottom right of the ' +
                'lyrics area show them under the current line. The lyrics area has a fixed size, ' +
                'so long lyrics never change the size of the menu.'),
        });

        const providerRow = comboRow(settings, 'lyrics-provider', _('Provider'),
            ['auto', 'lrclib', 'netease', 'betterlyrics', 'local'],
            [_('Automatic (local file, LRCLIB, NetEase, BetterLyrics)'), _('LRCLIB only'),
                _('NetEase only'), _('BetterLyrics only'), _('Local .lrc files only (offline)')]);
        providerRow.subtitle = _('Automatic asks a provider only when the ones before it found nothing ' +
            'or could not be reached. Online providers receive the track name, artist, album and length. ' +
            'NetEase and BetterLyrics are unofficial services and may change or stop working.');
        const linesRow = spinRow(settings, 'lyrics-lines', _('Lines'), _('Lines shown, 3 to 9'), 3, 9);

        const currentSize = spinRow(settings, 'lyrics-current-size', _('Highlighted line size'),
            _('Percent of the normal text size'), 100, 250, 5);
        const otherSize = spinRow(settings, 'lyrics-other-size', _('Other lines size'),
            _('Percent of the normal text size'), 70, 150, 5);
        const otherOpacity = spinRow(settings, 'lyrics-other-opacity', _('Other lines opacity'),
            _('Percent, lower is dimmer'), 20, 100, 5);

        const rows = [providerRow, linesRow, currentSize, otherSize, otherOpacity];
        for (const row of rows)
            group.add(row);
        return group;
    }

    _buildAlarmGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Alarms'),
            description: _('Alarms are added and changed in the Alarms card on the Weather and Clocks page. ' +
                'They use the notification and sound settings of the Pomodoro and timer above.'),
        });

        group.add(comboRow(settings, 'alarm-storage', _('Where alarms are kept'),
            ['auto', 'extension', 'clocks'],
            [_('GNOME Clocks when installed (automatic)'), _('Only in this extension'),
                _('GNOME Clocks')]));
        group.add(switchRow(settings, 'alarm-ring-clocks', _('Ring GNOME Clocks alarms from here'),
            _('GNOME Clocks rings its own alarms. Turn this on only if it does not ring when closed, ' +
                'otherwise an alarm rings twice.')));
        group.add(spinRow(settings, 'alarm-snooze', _('Snooze length'), _('Minutes'), 1, 30));
        return group;
    }

    _buildScrollGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Scrolling'),
            description: _('How the media player and the alarms react to a touchpad scroll. ' +
                'One scroll gesture moves one page.'),
        });
        group.add(spinRow(settings, 'scroll-distance', _('Touchpad distance per page'),
            _('Larger is slower'), 2, 50));
        return group;
    }

    _buildMiscGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Pomodoro, stopwatch and timer'),
            description: _('The Misc page keeps running while the menu is closed.'),
        });

        group.add(spinRow(settings, 'pomodoro-focus', _('Focus length'), _('Minutes'), 1, 180));
        group.add(spinRow(settings, 'pomodoro-short', _('Short break'), _('Minutes'), 1, 60));
        group.add(spinRow(settings, 'pomodoro-long', _('Long break'), _('Minutes'), 1, 120));
        group.add(spinRow(settings, 'pomodoro-sessions', _('Sessions before the long break'),
            _('Focus sessions in a cycle; the long break comes at the end'), 2, 10));
        group.add(switchRow(settings, 'misc-notifications', _('Notify when something ends'),
            _('A Pomodoro phase or the timer finished.')));
        group.add(switchRow(settings, 'misc-sound', _('Play a sound when something ends')));
        return group;
    }

    _buildClockGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Panel clock'),
            description: _('Change how the date and time look on the top bar. ' +
                'Codes: %a weekday, %A full weekday, %-d day, %b month, %B full month, ' +
                '%Y year, %H hour (24 h), %I hour (12 h), %M minute, %S seconds, %p AM/PM. ' +
                'Example: %a %-d %b  %H:%M'),
        });

        const enableRow = switchRow(settings, 'use-custom-clock-format', _('Use a custom format'));

        const entryRow = new Adw.EntryRow({title: _('Format')});
        entryRow.text = settings.get_string('clock-format');

        const previewRow = new Adw.ActionRow({title: _('Preview')});
        const updatePreview = () => {
            const text = entryRow.text === ''
                ? null
                : GLib.DateTime.new_now_local().format(entryRow.text);
            previewRow.subtitle = text ? GLib.markup_escape_text(text, -1) : _('Invalid format');
        };
        entryRow.connect('changed', () => {
            settings.set_string('clock-format', entryRow.text);
            updatePreview();
        });
        updatePreview();

        const sync = () => {
            entryRow.sensitive = enableRow.active;
            previewRow.sensitive = enableRow.active;
        };
        enableRow.connect('notify::active', sync);
        sync();

        group.add(enableRow);
        group.add(entryRow);
        group.add(previewRow);
        return group;
    }

    _buildWeatherGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Weather indicator'),
            description: _('Shows the weather icon and temperature inside the panel clock. ' +
                'It uses the location and weather settings of GNOME and is hidden when they are not set up.'),
        });

        const showRow = switchRow(settings, 'show-weather-indicator', _('Show in the panel clock'));
        const positionRow = comboRow(settings, 'weather-position', _('Position in the clock'),
            ['left', 'right'], [_('Left of the time'), _('Right of the time')]);
        const displayRow = comboRow(settings, 'weather-display', _('Show'),
            ['both', 'icon', 'temp'], [_('Icon and temperature'), _('Icon only'), _('Temperature only')]);

        const sync = () => {
            positionRow.sensitive = showRow.active;
            displayRow.sensitive = showRow.active;
        };
        showRow.connect('notify::active', sync);
        sync();

        group.add(showRow);
        group.add(positionRow);
        group.add(displayRow);
        return group;
    }
}
