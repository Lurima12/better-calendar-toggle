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

const MARQUEE_START_DELAY_MS = 400;
const MARQUEE_RESTART_DELAY_MS = 1200;
const MARQUEE_MS_PER_PX = 20;
const MARQUEE_RETURN_MS = 400;

// St.Button icons for the optional shuffle and repeat controls.
const SHUFFLE_ICON = 'media-playlist-shuffle-symbolic';
const REPEAT_ICON = 'media-playlist-repeat-symbolic';
const REPEAT_ONE_ICON = 'media-playlist-repeat-song-symbolic';

// Gestures that open the playing app from the cover; the default is safe from
// accidental clicks.
const COVER_ACTIONS = ['single', 'double', 'right', 'middle'];

// Sizing, in text-size units (em). The cover sits on the left of the player
// card and the details column (title, artist, seek bar, controls) fills the
// right. The tab bar and paddings take RESERVED_HEIGHT_EM of the container.
const DEFAULT_RESERVED_WIDTH_EM = 4;
const RESERVED_HEIGHT_EM = 14;
const MIN_COVER_EM = 4;
const MIN_INFO_EM = 10;
const CARD_GAP_EM = 1;
const DETAIL_EM = 18;

const SHAPES = ['rounded', 'square', 'circle'];
const BUTTON_SIZES = ['small', 'medium', 'large'];
const OPTION_KEYS = [
    'media-cover-size', 'media-cover-shape', 'media-button-size',
    'media-show-seekbar', 'media-show-artist',
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

// Repeat cycles through off, all and one, like most players.
function nextLoopStatus(status) {
    switch (status) {
    case 'None':
        return 'Playlist';
    case 'Playlist':
        return 'Track';
    default:
        return 'None';
    }
}

// A label that scrolls sideways when the text is wider than the space it has.
// Otherwise it sits centered, both horizontally and vertically, in a slot of
// fixed height, so it stays in the same place whichever title is shown.
class MarqueeLabel {
    constructor(styleClass) {
        this._token = 0;
        this._scrollTransition = null;
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
        this._scrollTransition = null;
        this._label.remove_transition('bct-marquee');
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
            this._label.x = 0;
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
            this._animate(-distance,
                Math.round(distance * MARQUEE_MS_PER_PX) + 400,
                MARQUEE_START_DELAY_MS, Clutter.AnimationMode.LINEAR,
                () => {
                    if (token !== this._token)
                        return;
                    this._animate(0, MARQUEE_RETURN_MS, MARQUEE_RESTART_DELAY_MS,
                        Clutter.AnimationMode.EASE_OUT_QUAD, run);
                });
        };
        run();
    }

    // Moves the label with an explicit transition. St's ease() uses the
    // actor's implicit easing state, which is left in the "animate" state when
    // a transition is cancelled from its own completion callback; a later
    // direct move then animates with the old duration and delay, so the title
    // can stay off screen for seconds after a track change.
    _animate(to, duration, delay, mode, onComplete) {
        const slow = St.Settings.get().slow_down_factor || 1;
        const transition = new Clutter.PropertyTransition({
            property_name: 'translation-x',
            duration: Math.round(duration * slow),
            delay: Math.round(delay * slow),
            progress_mode: mode,
        });
        transition.set_from(this._label.translation_x);
        transition.set_to(to);

        const id = transition.connect('stopped', (_transition, finished) => {
            transition.disconnect(id);
            // A new transition may have replaced this one in the meantime.
            if (this._scrollTransition !== transition)
                return;
            this._scrollTransition = null;
            this._label.remove_transition('bct-marquee');
            if (finished)
                onComplete?.();
        });

        this._scrollTransition = transition;
        this._label.remove_transition('bct-marquee');
        this._label.add_transition('bct-marquee', transition);
    }
}

// Compact media card: the cover is on the left, and the scrolling title, album
// (or artist), seek bar and playback controls are on the right. A configurable
// gesture on the cover (single, double, right or middle click) opens the app
// that plays it; swipe or scroll the mouse wheel to change player (it stops at
// the first and last player instead of looping). The player dots live in the
// page above the card. Cover size, shape, button size and the optional parts
// come from settings, and the player shrinks to fit the container.
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
        this._pressClickCount = 1;
        this._dragging = false;
        this._syncingSlider = false;
        this._progressId = 0;
        this._progressTicks = 0;
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
            x_expand: true,
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
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._info = new St.BoxLayout({
            style_class: 'bct-media-info',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
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
            x_align: Clutter.ActorAlign.START,
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
        // Only shown for players that expose the optional MPRIS Shuffle and
        // LoopStatus properties.
        this._shuffleButton = this._makeButton('bct-media-button bct-media-shuffle button',
            SHUFFLE_ICON, text.shuffle, () => {
                const player = this._player();
                if (player)
                    player.setShuffle(!player.shuffle);
            });
        this._repeatButton = this._makeButton('bct-media-button bct-media-repeat button',
            REPEAT_ICON, text.repeat, () => {
                const player = this._player();
                if (player)
                    player.setLoopStatus(nextLoopStatus(player.loopStatus));
            });
        this._shuffleButton.visible = false;
        this._repeatButton.visible = false;
        controls.add_child(this._shuffleButton);
        controls.add_child(this._previousButton);
        controls.add_child(this._playPauseButton);
        controls.add_child(this._nextButton);
        controls.add_child(this._repeatButton);

        // Cover on the left; title, artist, seek bar and controls on the right.
        controls.x_expand = true;
        this._info.add_child(this._title.actor);
        this._info.add_child(this._subtitle);
        this._info.add_child(this._seekBox);
        this._info.add_child(controls);

        this._card.add_child(this._frame);
        this._card.add_child(this._info);

        this._placeholder = new St.BoxLayout({
            style_class: 'bct-placeholder',
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._placeholder.add_child(new St.Label({
            text: text.noMedia,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this.actor.add_child(this._probe);
        this.actor.add_child(this._card);
        this.actor.add_child(this._placeholder);

        for (const key of OPTION_KEYS) {
            this._settingsIds.push(
                this._settings.connect(`changed::${key}`, () => this._applyOptions()));
        }
        this._changedId = this._client.connect('changed', () => this._update());

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

    // Shows the player with this bus name (used by the page's player dots).
    select(busName) {
        if (busName && busName !== this._currentBus)
            this._select(busName);
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
        // The cover keeps its configured size, bounded by the container; the
        // details take the rest of the card beside it.
        const coverEm = Math.max(MIN_COVER_EM,
            Math.min(wanted, availableWidth - MIN_INFO_EM, availableHeight));
        const cardEm = Math.max(coverEm + MIN_INFO_EM,
            Math.min(coverEm + DETAIL_EM, availableWidth));

        const card = Math.round(cardEm * 10) / 10;
        const cover = Math.round(coverEm * 10) / 10;
        const info = Math.round((cardEm - coverEm - CARD_GAP_EM) * 10) / 10;
        const key = `${card}|${cover}`;
        if (key === this._sizeKey)
            return;
        this._sizeKey = key;

        this._card.set_style(`width: ${card}em;`);
        this._title.widthEm = info;
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

    _coverAction() {
        const action = this._settings.get_string('media-cover-action');
        return COVER_ACTIONS.includes(action) ? action : 'double';
    }

    _isOnCover(event) {
        return Boolean(event.get_source()) && this._frame.contains(event.get_source());
    }

    // Primary-click gestures. Right and middle clicks are handled on press.
    _clickOpensCover(clickCount) {
        switch (this._coverAction()) {
        case 'single':
            return true;
        case 'double':
            return clickCount >= 2;
        default:
            return false;
        }
    }

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

    // Swipe left/right anywhere on the card; the configured gesture on the
    // cover opens the player's app. Buttons and the seek bar handle their own
    // presses first.
    _onEvent(event) {
        switch (event.type()) {
        case Clutter.EventType.BUTTON_PRESS: {
            const button = event.get_button();
            const onArt = this._isOnCover(event);
            const action = this._coverAction();
            if (onArt &&
                ((button === Clutter.BUTTON_SECONDARY && action === 'right') ||
                 (button === Clutter.BUTTON_MIDDLE && action === 'middle'))) {
                // These buttons have no drag to distinguish them from, so act
                // on the press.
                this._openPlayer();
                return Clutter.EVENT_STOP;
            }
            if (button !== Clutter.BUTTON_PRIMARY)
                break;
            [this._pressX] = event.get_coords();
            this._pressedOnArt = onArt;
            this._pressClickCount = event.get_click_count?.() || 1;
            break;
        }
        case Clutter.EventType.TOUCH_BEGIN:
            [this._pressX] = event.get_coords();
            this._pressedOnArt = this._isOnCover(event);
            break;
        case Clutter.EventType.BUTTON_RELEASE:
        case Clutter.EventType.TOUCH_END: {
            if (this._pressX === null)
                break;
            const [x] = event.get_coords();
            const distance = (x - this._pressX) / this._scale();
            const wasOnArt = this._pressedOnArt;
            const clickCount = this._pressClickCount;
            const touch = event.type() === Clutter.EventType.TOUCH_END;
            this._pressX = null;
            this._pressedOnArt = false;

            if (Math.abs(distance) >= SWIPE_DISTANCE) {
                this._move(distance < 0 ? 1 : -1);
            } else if (Math.abs(distance) <= CLICK_TOLERANCE && wasOnArt) {
                // Touch has no buttons, so a tap is always the cover gesture.
                if (touch || this._clickOpensCover(clickCount))
                    this._openPlayer();
            }
            break;
        }
        case Clutter.EventType.TOUCH_CANCEL:
        case Clutter.EventType.LEAVE:
            this._pressX = null;
            this._pressedOnArt = false;
            break;
        default:
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // --------------------------------------------------------------- state

    _update() {
        const players = this._client.players;
        const empty = players.length === 0;

        this._placeholder.visible = empty;
        this._card.visible = !empty;
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
        this._notifyPlayer(player);

        this._renderCover(player);

        this._title.text = player.title || player.identity;
        const showArtist = this._settings.get_boolean('media-show-artist');
        const subtitle = (showArtist ? player.artist : '') || player.album || player.artist;
        this._subtitle.text = subtitle;
        this._subtitle.visible = subtitle !== '';

        this._playPauseButton.child.icon_name = player.isPlaying()
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._setEnabled(this._previousButton, player.canPrevious);
        this._setEnabled(this._nextButton, player.canNext);
        this._setEnabled(this._playPauseButton, player.canPlayPause);
        this._shuffleButton.visible = player.canShuffle;
        this._shuffleButton.checked = player.canShuffle && player.shuffle;
        this._setEnabled(this._shuffleButton, player.canShuffle);
        this._repeatButton.visible = player.canLoop;
        this._repeatButton.checked = player.canLoop && player.loopStatus !== 'None';
        this._repeatButton.child.icon_name = player.loopStatus === 'Track'
            ? REPEAT_ONE_ICON
            : REPEAT_ICON;
        this._setEnabled(this._repeatButton, player.canLoop);

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
