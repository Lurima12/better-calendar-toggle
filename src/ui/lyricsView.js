// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {pulse} from '../util/animation.js';

// Space between lyric lines, in em (the same value as in the stylesheet).
const ROW_SPACING_EM = 0.3;

const TICK_MS = 250;
const POSITION_SYNC_TICKS = 8;
// Wait a moment before searching, so a track whose details arrive in several
// steps is looked up once.
const FETCH_DELAY_MS = 400;

// Lines of time-synced lyrics for the track that is shown in the media player:
// the lines before, the current line (highlighted) and the lines after it.
// The number of lines, the fonts of the highlighted and the other lines, and
// the provider come from settings.
//
// The geometry is fixed: every line has a set height (room for two wrapped
// lines) and the view has a set width, so long lyrics never change the size of
// the menu.
export class LyricsView {
    constructor(client, service, settings, text) {
        this._client = client;
        this._service = service;
        this._settings = settings;
        this._text = text;

        this._destroyed = false;
        this._enabled = false;
        this._player = null;
        this._lines = [];
        this._state = 'none';
        this._index = -2;

        this._token = 0;
        this._cancellable = null;
        this._fetchId = 0;
        this._tickId = 0;
        this._ticks = 0;
        this._rows = [];
        this._extras = {};
        this._hasRoman = false;
        this._hasTranslation = false;
        this._currentRow = 1;
        this._settingsIds = [];

        this.actor = new St.BoxLayout({
            style_class: 'bct-lyrics',
            vertical: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._rowsBox = new St.BoxLayout({
            style_class: 'bct-lyrics-rows',
            vertical: true,
            x_expand: true,
        });
        this._status = new St.Label({
            style_class: 'bct-lyrics-status',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        // The lines (or a status message) fill the area, centered; the buttons
        // for the romanization and the translation sit at the bottom right.
        this._body = new St.BoxLayout({
            style_class: 'bct-lyrics-body',
            vertical: true,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._body.add_child(this._rowsBox);
        this._body.add_child(this._status);

        this._tools = new St.BoxLayout({
            style_class: 'bct-lyrics-tools',
            x_align: Clutter.ActorAlign.END,
        });
        this._romanButton = this._makeTool('preferences-desktop-font-symbolic',
            text.romanization, 'lyrics-romanization');
        this._translationButton = this._makeTool('preferences-desktop-locale-symbolic',
            text.translation, 'lyrics-translation');
        this._tools.add_child(this._romanButton);
        this._tools.add_child(this._translationButton);

        this.actor.add_child(this._body);
        this.actor.add_child(this._tools);

        this.actor.connect('notify::mapped', () => this._syncTimer());
        this._clientId = this._client.connect('changed', () => this._syncTimer());

        for (const key of ['lyrics-lines', 'lyrics-current-size', 'lyrics-other-size',
            'lyrics-other-opacity', 'lyrics-romanization', 'lyrics-translation']) {
            this._settingsIds.push(this._settings.connect(`changed::${key}`, () => {
                this._buildRows();
                this._render();
            }));
        }
        this._settingsIds.push(this._settings.connect('changed::lyrics-provider', () => this._schedule()));

        this._buildRows();
        this._render();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        this._destroyed = true;
        this._token++;
        this._cancellable?.cancel();

        if (this._fetchId) {
            GLib.Source.remove(this._fetchId);
            this._fetchId = 0;
        }
        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = 0;
        }
        if (this._clientId)
            this._client.disconnect(this._clientId);
        this._clientId = 0;

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
    }

    // The player whose lyrics are shown (null when nothing is playing).
    setPlayer(player) {
        this._player = player;
        this._schedule();
    }

    // Lyrics are only looked up while they are shown.
    setEnabled(enabled) {
        if (this._enabled === enabled)
            return;
        this._enabled = enabled;
        this._schedule();
    }

    // ------------------------------------------------------------ fetching

    _schedule() {
        this._token++;
        this._cancellable?.cancel();
        if (this._fetchId) {
            GLib.Source.remove(this._fetchId);
            this._fetchId = 0;
        }

        this._lines = [];
        this._hasRoman = false;
        this._hasTranslation = false;
        this._index = -2;

        const player = this._player;
        if (!this._enabled || !player || !player.title) {
            this._state = 'none';
            this._render();
            this._syncTimer();
            return;
        }

        this._state = 'searching';
        this._render();
        this._syncTimer();

        this._fetchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FETCH_DELAY_MS, () => {
            this._fetchId = 0;
            this._fetch(player);
            return GLib.SOURCE_REMOVE;
        });
    }

    _fetch(player) {
        const token = ++this._token;
        this._cancellable = new Gio.Cancellable();

        const track = {
            title: player.title,
            // Players join several artists with commas; the first one matches best.
            artist: player.artist.split(',')[0].trim(),
            album: player.album,
            duration: player.lengthUs / 1000000,
            url: player.url,
        };

        this._service.fetch(track, this._cancellable)
            .then(result => {
                if (!this._destroyed && token === this._token)
                    this._apply(result);
            })
            .catch(e => {
                if (this._destroyed || token !== this._token)
                    return;
                if (!(e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)))
                    console.warn(`Better Calendar Toggle: lyrics failed: ${e.message}`);
                this._apply(null);
            });
    }

    _apply(result) {
        this._index = -2;

        if (result?.instrumental) {
            this._lines = [];
            this._state = 'instrumental';
        } else if (result?.lines?.length > 0) {
            this._lines = result.lines;
            this._state = 'found';
            this._hasRoman = this._lines.some(line => line.roman);
            this._hasTranslation = this._lines.some(line => line.translation);
        } else {
            this._lines = [];
            this._state = 'none';
        }

        this._player?.syncPosition();
        this._render();
        this._syncTimer();
    }

    // ------------------------------------------------------------- display

    _buildRows() {
        this._rowsBox.destroy_all_children();
        this._rows = [];
        this._extras = {};

        const count = Math.max(3, Math.min(9, this._settings.get_int('lyrics-lines')));
        // Up to four lines: one before the current line; more: centered on it.
        this._currentRow = count <= 4 ? 1 : Math.floor((count - 1) / 2);

        const font = current => ({
            size: this._settings.get_int(current ? 'lyrics-current-size' : 'lyrics-other-size') / 100,
            // The highlighted line is bold, the others are normal.
            weight: current ? 'bold' : 'normal',
        });
        const opacity = Math.round(this._settings.get_int('lyrics-other-opacity') * 2.55);

        let totalEm = 0;
        for (let i = 0; i < count; i++) {
            const current = i === this._currentRow;
            const {size, weight} = font(current);

            const label = new St.Label({
                style_class: current ? 'bct-lyric bct-lyric-current' : 'bct-lyric bct-lyric-other',
                style: `font-size: ${size}em; font-weight: ${weight};`,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.opacity = current ? 255 : opacity;

            if (!current) {
                // The other lines are one compact line each, shortened if long.
                label.clutter_text.line_wrap = false;
                label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                const heightEm = Math.round(size * 1.6 * 10) / 10;
                this._rowsBox.add_child(new St.Bin({
                    style_class: 'bct-lyric-slot',
                    style: `height: ${heightEm}em;`,
                    x_expand: true,
                    child: label,
                }));
                this._rows.push(label);
                totalEm += heightEm;
                continue;
            }

            // The highlighted line wraps, with room for three lines so none of
            // its words run into the lines around it.
            label.clutter_text.line_wrap = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            let heightEm = Math.round((size * 3.75 + 0.4) * 10) / 10;

            const column = new St.BoxLayout({vertical: true, x_expand: true});
            column.add_child(new St.Bin({
                style: `height: ${heightEm}em;`,
                x_expand: true,
                child: label,
            }));

            // Below it, the romanization and the translation when they are
            // switched on (one smaller line each).
            const extraSize = Math.round(size * 0.75 * 100) / 100;
            const extraEm = Math.round(extraSize * 1.7 * 10) / 10;
            for (const [field, key] of [['roman', 'lyrics-romanization'],
                ['translation', 'lyrics-translation']]) {
                if (!this._settings.get_boolean(key))
                    continue;

                const extra = new St.Label({
                    style_class: 'bct-lyric bct-lyric-extra',
                    style: `font-size: ${extraSize}em;`,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                extra.clutter_text.line_wrap = false;
                extra.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                column.add_child(new St.Bin({
                    style: `height: ${extraEm}em;`,
                    x_expand: true,
                    child: extra,
                }));
                this._extras[field] = extra;
                heightEm += extraEm;
            }

            column.set_style(`height: ${Math.round(heightEm * 10) / 10}em;`);
            this._rowsBox.add_child(column);
            this._rows.push(label);
            totalEm += heightEm;
        }

        // Keep the same height when there are no lyrics to show.
        const gapsEm = ROW_SPACING_EM * (count - 1);
        this.actor.set_style(`min-height: ${Math.round((totalEm + gapsEm + 1) * 10) / 10}em;`);
        this._index = -2;
    }

    // The buttons for the romanization and the translation: toggles that only
    // appear when the lyrics have them.
    _makeTool(iconName, name, key) {
        const button = new St.Button({
            style_class: 'bct-lyrics-tool button',
            toggle_mode: true,
            can_focus: true,
            accessible_name: name,
            child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
        });
        button.connect('clicked', () => {
            this._settings.set_boolean(key, !this._settings.get_boolean(key));
        });
        return button;
    }

    _syncTools() {
        const found = this._state === 'found';
        this._romanButton.visible = found && this._hasRoman;
        this._translationButton.visible = found && this._hasTranslation;
        this._romanButton.checked = this._settings.get_boolean('lyrics-romanization');
        this._translationButton.checked = this._settings.get_boolean('lyrics-translation');
    }

    _render() {
        const found = this._state === 'found';
        this._rowsBox.visible = found;
        this._status.visible = !found;
        this._syncTools();

        if (!found) {
            this._status.text = {
                searching: this._text.searching,
                instrumental: this._text.instrumental,
                none: this._text.none,
            }[this._state] ?? this._text.none;
            return;
        }

        this._showIndex(this._currentIndex());
    }

    // Index of the line being sung, or -1 before the first line.
    _currentIndex() {
        const player = this._player;
        if (!player || this._lines.length === 0)
            return -1;

        const position = player.positionUs() / 1000;
        let low = 0;
        let high = this._lines.length - 1;
        let found = -1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (this._lines[middle].time <= position) {
                found = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return found;
    }

    // Shows the lines around the current one, with the romanization and the
    // translation (when switched on and available) under the current line.
    _showIndex(index) {
        this._index = index;

        this._rows.forEach((label, row) => {
            const line = this._lines[index - this._currentRow + row];
            let text = line?.text ?? '';
            // A gap between lines (an instrumental part) shows three dots.
            if (row === this._currentRow && index >= 0 && text === '')
                text = '...';
            label.text = text;
        });

        const current = this._lines[index];
        for (const field of ['roman', 'translation']) {
            if (this._extras[field])
                this._extras[field].text = current?.[field] ?? '';
        }
    }

    // ---------------------------------------------------------------- sync

    // Follow the playback position only while the lyrics are on screen and moving.
    _syncTimer() {
        const needed = this.actor.mapped && this._state === 'found' && this._player?.isPlaying();

        if (needed && !this._tickId) {
            this._ticks = 0;
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
                if (!this.actor.mapped || this._state !== 'found' || !this._player?.isPlaying()) {
                    this._tickId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (++this._ticks % POSITION_SYNC_TICKS === 0)
                    this._player.syncPosition();

                const index = this._currentIndex();
                if (index !== this._index) {
                    this._showIndex(index);
                    pulse(this._rows[this._currentRow]);
                }
                return GLib.SOURCE_CONTINUE;
            });
        }

        // Show the right line when paused or when the tab is opened.
        if (!needed && this._state === 'found')
            this._showIndex(this._currentIndex());
    }
}
