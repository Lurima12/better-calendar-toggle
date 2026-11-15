// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {fadeIn} from '../util/animation.js';
import {ScrollStepper} from '../util/scrollStep.js';

// Horizontal drag distance (in CSS px) that counts as a swipe.
const SWIPE_DISTANCE = 40;
// A press that moves less than this (in CSS px) is a click.
const CLICK_TOLERANCE = 8;

const PROGRESS_INTERVAL_MS = 250;
const POSITION_SYNC_TICKS = 8;

const MARQUEE_PAUSE_MS = 1500;
const MARQUEE_MS_PER_PX = 30;

// Sizing, in text-size units (em). The lyrics column and the spacing around
// the player take the reserved width of the container (given by the page); the
// tab bar, paddings and the rows around the cover take RESERVED_HEIGHT_EM of
// its height. The cover shrinks so the player always fits.
const DEFAULT_RESERVED_WIDTH_EM = 4;
const RESERVED_HEIGHT_EM = 14;
const MIN_CARD_EM = 11;
const MIN_COVER_EM = 4;
const CARD_PADDING_EM = 1.5;

const SHAPES = ['rounded', 'square', 'circle'];
const BUTTON_SIZES = ['small', 'medium', 'large'];
const OPTION_KEYS = [
    'media-cover-size', 'media-cover-shape', 'media-button-size',
    'media-show-seekbar',
];

function formatTime(us) {
    const total = Math.max(0, Math.floor(us / 1000000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
        : `${minutes}:${seconds}`;
}

// A label that scrolls sideways when the text is wider than the space it has.
// Otherwise it sits centered, both horizontally and vertically, in a slot of
// fixed height, so it stays in the same place whichever title is shown.
class MarqueeLabel {
    constructor(styleClass) {
        this._token = 0;
        this._lastWidth = -1;
        this._lastHeight = -1;
        this._lastText = null;

        this.actor = new St.Widget({
            style_class: 'bct-marquee',
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
            x_expand: true,
        });
        this._label = new St.Label({style_class: styleClass});
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.actor.add_child(this._label);

        this.actor.connect('notify::allocation', () => this._relayout(false));
        this.actor.connect('notify::mapped', () => {
            if (this.actor.mapped)
                this._relayout(true);
            else
                this._stop();
        });
    }

    set text(value) {
        this._label.text = value;
        this._relayout(true);
    }

    // Fixes the width, so a long title is clipped (and scrolls) instead of
    // making the card wider than its container.
    set widthEm(value) {
        this.actor.set_style(`width: ${value}em;`);
    }

    destroy() {
        this._stop();
    }

    _stop() {
        this._token++;
        this._label.remove_all_transitions();
        this._label.translation_x = 0;
    }

    _relayout(force) {
        const width = this.actor.width;
        const height = this.actor.height;
        const text = this._label.text;
        if (width <= 0 || (!force && width === this._lastWidth &&
            height === this._lastHeight && text === this._lastText))
            return;
        this._lastWidth = width;
        this._lastHeight = height;
        this._lastText = text;

        this._stop();

        const [, labelWidth] = this._label.get_preferred_width(-1);
        const [, labelHeight] = this._label.get_preferred_height(-1);

        // Centered vertically, whatever the text (some scripts are taller).
        this._label.y = Math.max(0, Math.round((height - labelHeight) / 2));

        if (labelWidth <= width) {
            this._label.x = Math.round((width - labelWidth) / 2);
            return;
        }

        this._label.x = 0;
        if (this.actor.mapped)
            this._scroll(labelWidth - width);
    }

    _scroll(distance) {
        const token = ++this._token;

        const run = () => {
            if (token !== this._token)
                return;
            this._label.translation_x = 0;
            this._label.ease({
                translation_x: -distance,
                duration: Math.round(distance * MARQUEE_MS_PER_PX) + 400,
                delay: MARQUEE_PAUSE_MS,
                mode: Clutter.AnimationMode.LINEAR,
                onComplete: () => {
                    if (token !== this._token)
                        return;
                    this._label.ease({
                        translation_x: 0,
                        duration: 500,
                        delay: MARQUEE_PAUSE_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: run,
                    });
                },
            });
        };
        run();
    }
}

// Compact media card, centered: dots (one per player), cover art, scrolling
// title, album (or artist), seek bar and playback controls. Click the cover to open the
// app that plays it; swipe, scroll the mouse wheel or click a dot to change
// player (it stops at the first and last player instead of looping). Cover size, shape, button size and the
// optional parts come from settings, and the player shrinks to fit the
// container.
//
// Emits 'player-changed' (player or null) when the shown player or its track
// changes, so other parts (the lyrics) can follow it.
export class MediaView extends Signals.EventEmitter {
    // onActivate runs after the player's app was opened (to close the menu).
    constructor(client, text, settings, onActivate) {
        super();
        this._client = client;
        this._settings = settings;
        this._onActivate = onActivate;
        this._currentBus = null;
        this._scroller = new ScrollStepper(() => this._settings.get_int('scroll-distance'));
        this._pressX = null;
        this._pressedOnArt = false;
        this._dragging = false;
        this._syncingSlider = false;
        this._progressId = 0;
        this._progressTicks = 0;
        this._dots = [];
        this._dotsKey = '';
        this._container = null;
        this._reservedWidthEm = DEFAULT_RESERVED_WIDTH_EM;
        this._trackKey = null;
        this._sizeKey = '';
        this._coverEm = 10;
        this._coverKey = '';
        this._settingsIds = [];

        this.actor = new St.BoxLayout({
            style_class: 'bct-media-view',
            vertical: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.actor.connect('event', (_actor, event) => this._onEvent(event));
        this.actor.connect('notify::mapped', () => {
            this._applySizing();
            this._syncProgressTimer();
        });

        // Zero-height probe that is exactly 1em wide: tells us how many pixels
        // one text-size unit is, so sizes can be fitted to the container.
        this._probe = new St.Widget({
            style: 'width: 1em; height: 0px;',
            x_align: Clutter.ActorAlign.START,
        });

        this._card = new St.BoxLayout({
            style_class: 'bct-media-card',
            vertical: true,
        });

        this._dotsBox = new St.BoxLayout({
            style_class: 'bct-media-dots',
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._frame = new St.Bin({
            style_class: 'bct-media-art-frame',
            x_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        // The real cover is drawn as the frame's background so the shape
        // (rounded, square, circle) clips it; the icon is only a placeholder.
        this._art = new St.Icon({
            style_class: 'bct-media-art',
            icon_name: 'audio-x-generic-symbolic',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._frame.set_child(this._art);
        // The cover opens the app that plays the media; it dims a little under
        // the pointer to show it can be clicked.
        this._frame.connect('enter-event', () => {
            this._frame.opacity = 215;
            return Clutter.EVENT_PROPAGATE;
        });
        this._frame.connect('leave-event', () => {
            this._frame.opacity = 255;
            return Clutter.EVENT_PROPAGATE;
        });

        this._title = new MarqueeLabel('bct-media-title');
        this._subtitle = new St.Label({
            style_class: 'bct-media-subtitle',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._slider = new Slider(0);
        this._slider.add_style_class_name('bct-media-seek');
        this._slider.accessible_name = text.seek;
        this._slider.connect('drag-begin', () => {
            this._dragging = true;
            return Clutter.EVENT_PROPAGATE;
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            this._commitSeek();
            return Clutter.EVENT_PROPAGATE;
        });
        this._slider.connect('notify::value', () => {
            // Keyboard changes arrive without a drag.
            if (!this._syncingSlider && !this._dragging)
                this._commitSeek();
        });

        this._elapsed = new St.Label({style_class: 'bct-media-time'});
        this._total = new St.Label({
            style_class: 'bct-media-time',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        this._timeRow = new St.BoxLayout({style_class: 'bct-media-times'});
        this._timeRow.add_child(this._elapsed);
        this._timeRow.add_child(this._total);

        this._seekBox = new St.BoxLayout({vertical: true, style_class: 'bct-media-seekbox'});
        this._seekBox.add_child(this._slider);
        this._seekBox.add_child(this._timeRow);

        const controls = new St.BoxLayout({
            style_class: 'bct-media-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._previousButton = this._makeButton('bct-media-button button',
            'media-skip-backward-symbolic', text.previousTrack, () => this._player()?.previous());
        this._playPauseButton = this._makeButton('bct-media-button bct-media-primary button',
            'media-playback-start-symbolic', text.playPause, () => this._player()?.playPause());
        this._nextButton = this._makeButton('bct-media-button button',
            'media-skip-forward-symbolic', text.nextTrack, () => this._player()?.next());
        controls.add_child(this._previousButton);
        controls.add_child(this._playPauseButton);
        controls.add_child(this._nextButton);

        this._card.add_child(this._dotsBox);
        this._card.add_child(this._frame);
        this._card.add_child(this._title.actor);
        this._card.add_child(this._subtitle);
        this._card.add_child(this._seekBox);

        // Playback row: the playback buttons stay centered, and the lyrics
        // button sits at the right end (an invisible twin on the left keeps
        // the playback buttons centered).
        controls.x_expand = true;
        const controlsRow = new St.BoxLayout({style_class: 'bct-media-controls-row'});
        controlsRow.add_child(this._makeLyricsButton(text, true));
        controlsRow.add_child(controls);
        this._lyricsButton = this._makeLyricsButton(text, false);
        controlsRow.add_child(this._lyricsButton);
        this._card.add_child(controlsRow);

        this._placeholder = new St.Label({
            text: text.noMedia,
            style_class: 'bct-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
        });

        this.actor.add_child(this._probe);
        this.actor.add_child(this._card);
        this.actor.add_child(this._placeholder);

        for (const key of OPTION_KEYS) {
            this._settingsIds.push(
                this._settings.connect(`changed::${key}`, () => this._applyOptions()));
        }
        this._settingsIds.push(
            this._settings.connect('changed::lyrics-visible', () => this._syncLyricsButton()));
        this._changedId = this._client.connect('changed', () => this._update());

        this._syncLyricsButton();
        this._applyOptions();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        if (this._changedId)
            this._client.disconnect(this._changedId);
        this._changedId = 0;

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._progressId) {
            GLib.Source.remove(this._progressId);
            this._progressId = 0;
        }
        this._title.destroy();
        this.disconnectAll();
    }

    // The player that is currently shown, or null.
    get currentPlayer() {
        return this._player();
    }

    // Size of the menu container in CSS px; the player shrinks to fit it.
    // reservedWidthEm is the width (in em) that other parts of the page need.
    setContainerSize(width, height, reservedWidthEm = DEFAULT_RESERVED_WIDTH_EM) {
        this._container = {width, height};
        this._reservedWidthEm = reservedWidthEm;
        this._sizeKey = '';
        this._applySizing();
    }

    // ------------------------------------------------------------- options

    _applyOptions() {
        const shape = this._settings.get_string('media-cover-shape');
        for (const name of SHAPES)
            this.actor.remove_style_class_name(`bct-media-shape-${name}`);
        this.actor.add_style_class_name(`bct-media-shape-${SHAPES.includes(shape) ? shape : 'rounded'}`);

        const buttons = this._settings.get_string('media-button-size');
        for (const name of BUTTON_SIZES)
            this.actor.remove_style_class_name(`bct-media-buttons-${name}`);
        this.actor.add_style_class_name(
            `bct-media-buttons-${BUTTON_SIZES.includes(buttons) ? buttons : 'medium'}`);

        this._sizeKey = '';
        this._applySizing();
        this._update();
    }

    _applySizing() {
        if (!this._container || !this.actor.get_stage())
            return;

        const [, probeWidth] = this._probe.get_preferred_width(-1);
        if (probeWidth <= 0)
            return;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        const availableWidth = this._container.width * scale / probeWidth - this._reservedWidthEm;
        const availableHeight = this._container.height * scale / probeWidth - RESERVED_HEIGHT_EM;

        const wanted = this._settings.get_int('media-cover-size');
        const cardEm = Math.max(MIN_CARD_EM,
            Math.min(wanted + CARD_PADDING_EM, availableWidth));
        const coverEm = Math.max(MIN_COVER_EM,
            Math.min(wanted, cardEm - CARD_PADDING_EM, availableHeight));

        const card = Math.round(cardEm * 10) / 10;
        const cover = Math.round(coverEm * 10) / 10;
        const key = `${card}|${cover}`;
        if (key === this._sizeKey)
            return;
        this._sizeKey = key;

        this._card.set_style(`width: ${card}em;`);
        this._title.widthEm = card;
        this._coverEm = cover;
        this._renderCover(this._player());
    }

    _renderCover(player) {
        const artPath = player?.artPath ?? '';
        const key = `${this._coverEm}|${artPath}`;
        if (key === this._coverKey)
            return;
        this._coverKey = key;

        let style = `width: ${this._coverEm}em; height: ${this._coverEm}em;`;
        if (artPath) {
            const escaped = artPath.replace(/["\\]/g, '\\$&');
            style += ` background-image: url("${escaped}"); background-size: cover;`;
        }
        this._frame.set_style(style);

        this._art.visible = !artPath;
        this._art.set_style(`icon-size: ${Math.round(this._coverEm * 4.5) / 10}em;`);
    }

    // ------------------------------------------------------------- helpers

    // Shows or hides the lyrics next to the player (remembered). The twin used
    // for centering is invisible and does nothing.
    _makeLyricsButton(text, twin) {
        const button = new St.Button({
            style_class: 'bct-media-button bct-media-lyrics-button button',
            toggle_mode: true,
            can_focus: !twin,
            reactive: !twin,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: twin ? '' : text.lyrics,
            child: new St.Icon({
                icon_name: 'format-justify-left-symbolic',
                style_class: 'popup-menu-icon bct-media-button-icon',
            }),
        });

        if (twin) {
            button.opacity = 0;
            return button;
        }

        button.connect('clicked', () => {
            this._settings.set_boolean('lyrics-visible',
                !this._settings.get_boolean('lyrics-visible'));
            this._syncLyricsButton();
        });
        return button;
    }

    _syncLyricsButton() {
        this._lyricsButton.checked = this._settings.get_boolean('lyrics-visible');
    }

    _makeButton(styleClass, iconName, accessibleName, onClicked) {
        // Centered, so a row never stretches the button into an oval.
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: accessibleName,
            child: new St.Icon({
                icon_name: iconName,
                style_class: 'popup-menu-icon bct-media-button-icon',
            }),
        });
        button.connect('clicked', onClicked);
        return button;
    }

    _setEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }

    _player() {
        return this._client.players.find(player => player.busName === this._currentBus) ?? null;
    }

    _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    }

    // direction (-1 or 1) slides the new player in from that side.
    _select(busName, direction = 0) {
        this._currentBus = busName;
        this._update();
        this._player()?.syncPosition();
        if (direction !== 0)
            fadeIn(this._card, {x: direction * 16});
    }

    // Brings up the app that plays the media, and closes the menu.
    _openPlayer() {
        const player = this._player();
        if (player)
            player.raise();
        this._onActivate?.();
    }

    // Moves to the previous or next player; stops at the ends (no looping).
    _move(step) {
        const players = this._client.players;
        if (players.length < 2)
            return;

        const index = Math.max(0,
            players.findIndex(player => player.busName === this._currentBus));
        const next = index + step;
        if (next < 0 || next >= players.length)
            return;
        this._select(players[next].busName, step);
    }

    _commitSeek() {
        this._player()?.seekToFraction(this._slider.value);
    }

    // -------------------------------------------------------- interaction

    _onScroll(event) {
        if (this._client.players.length < 2)
            return Clutter.EVENT_PROPAGATE;

        // One player per scroll gesture, so the others are not skipped.
        const step = this._scroller.read(event);
        if (step === null)
            return Clutter.EVENT_PROPAGATE;
        if (step !== 0)
            this._move(step);
        return Clutter.EVENT_STOP;
    }

    // Swipe left/right anywhere on the card; a click on the cover opens the
    // player's app. Buttons and the seek bar handle their own presses first.
    _onEvent(event) {
        switch (event.type()) {
        case Clutter.EventType.BUTTON_PRESS:
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                break;
            // fall through
        case Clutter.EventType.TOUCH_BEGIN:
            [this._pressX] = event.get_coords();
            this._pressedOnArt = Boolean(event.get_source()) &&
                this._frame.contains(event.get_source());
            break;
        case Clutter.EventType.BUTTON_RELEASE:
        case Clutter.EventType.TOUCH_END: {
            if (this._pressX === null)
                break;
            const [x] = event.get_coords();
            const distance = (x - this._pressX) / this._scale();
            const wasOnArt = this._pressedOnArt;
            this._pressX = null;

            if (Math.abs(distance) >= SWIPE_DISTANCE) {
                this._move(distance < 0 ? 1 : -1);
            } else if (Math.abs(distance) <= CLICK_TOLERANCE) {
                if (wasOnArt)
                    this._openPlayer();
            }
            break;
        }
        case Clutter.EventType.TOUCH_CANCEL:
        case Clutter.EventType.LEAVE:
            this._pressX = null;
            break;
        default:
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // --------------------------------------------------------------- state

    _syncDots(players) {
        const key = players.map(player => player.busName).join('|');
        if (key !== this._dotsKey) {
            this._dotsKey = key;
            this._dotsBox.destroy_all_children();
            this._dots = players.map(player => {
                const dot = new St.Button({
                    style_class: 'bct-media-dot',
                    can_focus: true,
                    accessible_name: player.identity || player.title,
                });
                dot.connect('clicked', () => this._select(player.busName));
                this._dotsBox.add_child(dot);
                return {dot, busName: player.busName};
            });
        }

        for (const {dot, busName} of this._dots) {
            if (busName === this._currentBus)
                dot.add_style_class_name('bct-media-dot-active');
            else
                dot.remove_style_class_name('bct-media-dot-active');
        }
    }

    _update() {
        const players = this._client.players;
        const empty = players.length === 0;

        this._placeholder.visible = empty;
        this._card.visible = !empty;
        this._dotsBox.visible = players.length > 1;
        if (empty) {
            this._notifyPlayer(null);
            this._syncProgressTimer();
            return;
        }

        // Keep the chosen player; otherwise prefer one that is playing.
        let player = players.find(candidate => candidate.busName === this._currentBus);
        if (!player) {
            player = players.find(candidate => candidate.isPlaying()) ?? players[0];
            this._currentBus = player.busName;
        }
        this._syncDots(players);
        this._notifyPlayer(player);

        this._renderCover(player);

        this._title.text = player.title || player.identity;
        const subtitle = player.album || player.artist;
        this._subtitle.text = subtitle;
        this._subtitle.visible = subtitle !== '';

        this._playPauseButton.child.icon_name = player.isPlaying()
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._setEnabled(this._previousButton, player.canPrevious);
        this._setEnabled(this._nextButton, player.canNext);
        this._setEnabled(this._playPauseButton, player.canPlayPause);

        this._seekBox.visible = player.lengthUs > 0 &&
            this._settings.get_boolean('media-show-seekbar');
        this._slider.reactive = player.canSeek;
        this._updateProgress();
        this._syncProgressTimer();
    }

    // Tells listeners when the shown player or its track changes.
    _notifyPlayer(player) {
        const key = player
            ? [player.busName, player.trackId, player.title, player.artist,
                player.album, player.lengthUs].join('|')
            : '';
        if (key === this._trackKey)
            return;
        this._trackKey = key;
        this.emit('player-changed', player);
    }

    _updateProgress() {
        const player = this._player();
        if (!player || player.lengthUs <= 0)
            return;

        const position = player.positionUs();
        this._elapsed.text = formatTime(position);
        this._total.text = formatTime(player.lengthUs);

        if (!this._dragging) {
            this._syncingSlider = true;
            this._slider.value = position / player.lengthUs;
            this._syncingSlider = false;
        }
    }

    // The progress bar only needs updating while it is on screen and moving.
    _syncProgressTimer() {
        const player = this._player();
        const needed = this.actor.mapped && this._seekBox.visible &&
            player?.isPlaying() && player.lengthUs > 0;

        if (needed && !this._progressId) {
            this._progressTicks = 0;
            player.syncPosition();
            this._progressId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROGRESS_INTERVAL_MS, () => {
                const current = this._player();
                if (!this.actor.mapped || !this._seekBox.visible ||
                    !current?.isPlaying() || current.lengthUs <= 0) {
                    this._progressId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (++this._progressTicks % POSITION_SYNC_TICKS === 0)
                    current.syncPosition();
                this._updateProgress();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }
}
