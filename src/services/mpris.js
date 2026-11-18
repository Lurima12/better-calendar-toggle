// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {coverCachePath, ensureCoverCacheDir, makeSquareCover, trimCoverCache} from './coverArt.js';

const BUS_PREFIX = 'org.mpris.MediaPlayer2.';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const ROOT_IFACE = 'org.mpris.MediaPlayer2';

// One media player on the session bus.
class MprisPlayer {
    constructor(busName, onChanged) {
        this.busName = busName;
        this._onChanged = onChanged;
        this._cancellable = new Gio.Cancellable();

        this._proxy = null;
        this._proxyId = 0;
        this._rootProxy = null;

        this.ready = false;
        this.identity = '';
        this.desktopEntry = '';
        this.canRaise = false;
        this.title = '';
        this.artist = '';
        this.album = '';
        this.status = 'Stopped';
        this.canPrevious = false;
        this.canNext = false;
        this.canPlayPause = false;
        this.canSeek = false;
        this.canShuffle = false;
        this.shuffle = false;
        this.lengthUs = 0;
        this.trackId = '';
        this.url = '';
        this.rate = 1;
        this.artPath = '';

        this._positionUs = 0;
        this._positionStamp = GLib.get_monotonic_time();
        this._signalId = 0;

        this._artUrl = '';
        this._artToken = 0;

        this._connect();
    }

    isActive() {
        return this.ready && (this.title !== '' || this.status !== 'Stopped');
    }

    isPlaying() {
        return this.status === 'Playing';
    }

    playPause() {
        this._call('PlayPause');
    }

    // Brings the player's window to the front, or starts its app.
    raise() {
        // The app is the most reliable target: activating it raises an
        // existing window to the front, or starts the app when there was
        // none. Asking the player to raise itself over D-Bus only works for
        // the players that support it, so it is only a fallback.
        if (this._activateApp())
            return;

        if (this._rootProxy && this.canRaise) {
            this._rootProxy.call('Raise', null, Gio.DBusCallFlags.NONE, -1, this._cancellable,
                (proxy, result) => {
                    try {
                        proxy.call_finish(result);
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            console.warn(`Better Calendar Toggle: ${
                                this.identity || this.busName} would not open: ${e.message}`);
                    }
                });
            return;
        }

        console.warn(`Better Calendar Toggle: no app found for ${
            this.identity || this.busName} (looked for: ${this._appCandidates().join(', ')})`);
        Main.notify('Better Calendar Toggle',
            `Could not find the app that plays the media (${this.identity || this.busName}).`);
    }

    // The DesktopEntry property is optional in MPRIS, and its value may carry
    // the .desktop suffix or a path. Returns the bare application id, or ''.
    static _cleanId(value) {
        const id = String(value ?? '').trim().split('/').pop();
        return id ? id.replace(/\.desktop$/i, '') : '';
    }

    // Candidates for the app of the media: the DesktopEntry of the MPRIS root
    // interface, the last part of the bus name (media played behind a daemon
    // that relays it is known under the daemon's name), and the name the
    // player calls itself.
    _appCandidates() {
        const candidates = [];
        const push = value => {
            const id = MprisPlayer._cleanId(value);
            if (id && !candidates.includes(id))
                candidates.push(id);
        };
        push(this.desktopEntry);
        push(this.busName.replace(BUS_PREFIX, ''));
        push(this.identity);
        return candidates;
    }

    // Activates the player's app; true when the app was found and raised
    // (or started). Only real failures to activate or start a candidate are
    // logged; the caller reports when no app could be found at all.
    _activateApp() {
        const appSystem = Shell.AppSystem.get_default();
        const candidates = this._appCandidates();
        const activate = app => {
            try {
                app.activate();
                return true;
            } catch (e) {
                console.warn(`Better Calendar Toggle: ${
                    app.get_id?.() ?? 'the app'} would not activate: ${e.message}`);
                return false;
            }
        };

        // Apps that are indexed by the shell, under the exact desktop file id
        // of a candidate (players installed as Flatpaks usually give their id
        // as DesktopEntry directly, like "xyz.lalaggi.semitone").
        for (const candidate of candidates) {
            const app = appSystem.lookup_app(`${candidate}.desktop`);
            if (app)
                return activate(app);
        }

        // Apps that are already running and are called like a candidate: for
        // players without an indexed desktop file (or relayed behind a daemon
        // that has none), the running window is the only hint. Activating
        // raises the window, and starts nothing when there is none.
        for (const app of appSystem.get_running()) {
            const name = String(app.get_name?.() ?? '').toLowerCase();
            if (name && candidates.some(candidate =>
                name.includes(candidate.toLowerCase())))
                return activate(app);
        }

        // Apps whose name, description or keywords mention a candidate.
        try {
            for (const candidate of candidates) {
                for (const group of Gio.DesktopAppInfo.search(candidate.toLowerCase()) ?? []) {
                    for (const id of group) {
                        const other = appSystem.lookup_app(id);
                        if (other)
                            return activate(other);
                    }
                }
            }
        } catch (e) {
            // Searching needs an index that is not available everywhere.
        }

        // Apps that are known to the file system even when the shell did not
        // index them. Launching raises an existing window again for
        // single-instance applications, which most media apps are.
        for (const candidate of candidates) {
            const info = Gio.DesktopAppInfo.new(`${candidate}.desktop`) ??
                Gio.DesktopAppInfo.new(candidate);
            if (info) {
                try {
                    info.launch([], null);
                    return true;
                } catch (e) {
                    console.warn(`Better Calendar Toggle: ${
                        info.get_id()} could not be started: ${e.message}`);
                }
            }
        }
        return false;
    }

    next() {
        this._call('Next');
    }

    previous() {
        this._call('Previous');
    }

    // Shuffle is optional in MPRIS: its property is only present when the
    // player supports it. Set it through the standard Properties interface.
    setShuffle(enabled) {
        if (!this.canShuffle || enabled === this.shuffle)
            return;

        this.shuffle = enabled;
        this._notify();
        Gio.DBus.session.call(
            this.busName, OBJECT_PATH, 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', [PLAYER_IFACE, 'Shuffle', new GLib.Variant('b', enabled)]),
            null, Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (e) {
                    // The player went away or does not accept the change.
                }
            });
    }

    // Current position in microseconds, extrapolated while playing.
    positionUs() {
        let position = this._positionUs;
        if (this.isPlaying()) {
            position += (GLib.get_monotonic_time() - this._positionStamp) * this.rate;
        }
        const limit = this.lengthUs > 0 ? this.lengthUs : Infinity;
        return Math.max(0, Math.min(position, limit));
    }

    // Position is not announced by change signals, so ask the player for it.
    syncPosition() {
        Gio.DBus.session.call(
            this.busName, OBJECT_PATH, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']), new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (connection, result) => {
                try {
                    const [position] = connection.call_finish(result).recursiveUnpack();
                    this._setPosition(Number(position));
                } catch (e) {
                    // Player gone, or it does not report a position.
                }
            });
    }

    seekToFraction(fraction) {
        if (!this.canSeek || this.lengthUs <= 0)
            return;

        const target = Math.round(Math.max(0, Math.min(1, fraction)) * this.lengthUs);
        try {
            // SetPosition needs the trackid to be a D-Bus object path; some
            // players report one that is not (for example "spotify:track:…"),
            // so fall back to a relative Seek for them.
            if (this.trackId && GLib.Variant.is_object_path(this.trackId))
                this._call('SetPosition', new GLib.Variant('(ox)', [this.trackId, target]));
            else
                this._call('Seek', new GLib.Variant('(x)', [target - Math.round(this.positionUs())]));
            this._setPosition(target);
        } catch (e) {
            console.warn(`Better Calendar Toggle: could not seek in ${this.busName}: ${e.message}`);
        }
    }

    destroy() {
        this._cancellable.cancel();
        this._artToken++;
        if (this._proxy && this._proxyId)
            this._proxy.disconnect(this._proxyId);
        if (this._proxy && this._signalId)
            this._proxy.disconnect(this._signalId);
        this._signalId = 0;
        this._proxyId = 0;
        this._proxy = null;
        this._rootProxy = null;
        this._onChanged = null;
    }

    _connect() {
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            this.busName, OBJECT_PATH, PLAYER_IFACE, this._cancellable,
            (_source, result) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(result);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Better Calendar Toggle: cannot reach ${this.busName}: ${e.message}`);
                    return;
                }
                this._proxyId = this._proxy.connect('g-properties-changed', () => this._refresh());
                this._signalId = this._proxy.connect('g-signal', (_proxy, _sender, name, parameters) => {
                    if (name === 'Seeked')
                        this._setPosition(Number(parameters.deepUnpack()[0]));
                });
                this._refresh();
            });

        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            this.busName, OBJECT_PATH, ROOT_IFACE, this._cancellable,
            (_source, result) => {
                try {
                    this._rootProxy = Gio.DBusProxy.new_for_bus_finish(result);
                } catch (e) {
                    return;
                }
                this.identity = this._rootProxy.get_cached_property('Identity')?.unpack() ?? '';
                this.desktopEntry = this._rootProxy.get_cached_property('DesktopEntry')?.unpack() ?? '';
                this.canRaise = this._rootProxy.get_cached_property('CanRaise')?.unpack() ?? false;
                this._notify();
            });
    }

    _property(name) {
        return this._proxy?.get_cached_property(name)?.recursiveUnpack() ?? null;
    }

    _refresh() {
        if (!this._proxy)
            return;

        const metadata = this._property('Metadata') ?? {};
        const artist = metadata['xesam:artist'];

        this.title = String(metadata['xesam:title'] ?? '');
        this.artist = Array.isArray(artist) ? artist.join(', ') : String(artist ?? '');
        this.album = String(metadata['xesam:album'] ?? '');
        this.status = this._property('PlaybackStatus') ?? 'Stopped';
        this.canPrevious = this._property('CanGoPrevious') ?? false;
        this.canNext = this._property('CanGoNext') ?? false;
        this.canPlayPause = (this._property('CanPlay') ?? false) ||
            (this._property('CanPause') ?? false);
        this.canSeek = this._property('CanSeek') ?? false;
        const shuffle = this._proxy?.get_cached_property('Shuffle');
        this.canShuffle = Boolean(shuffle);
        this.shuffle = shuffle?.unpack() ?? false;
        this.rate = Number(this._property('Rate') ?? 1) || 1;
        this.lengthUs = Number(metadata['mpris:length'] ?? 0) || 0;
        this.trackId = String(metadata['mpris:trackid'] ?? '');
        this.url = String(metadata['xesam:url'] ?? '');
        this.ready = true;

        const artUrl = String(metadata['mpris:artUrl'] ?? '');
        if (artUrl !== this._artUrl) {
            this._artUrl = artUrl;
            this._loadArt(artUrl);
        }

        this.syncPosition();
        this._notify();
    }

    _setPosition(positionUs) {
        if (!Number.isFinite(positionUs))
            return;
        this._positionUs = positionUs;
        this._positionStamp = GLib.get_monotonic_time();
    }

    // Resolves the cover to a local file, cropped to a square.
    _loadArt(url) {
        const token = ++this._artToken;
        this.artPath = '';

        if (!url)
            return;

        const finish = path => {
            makeSquareCover(path, this._cancellable).then(square => {
                if (token !== this._artToken)
                    return;
                this.artPath = square;
                this._notify();
            }).catch(() => {
                if (token === this._artToken)
                    this._notify();
            });
        };

        if (url.startsWith('file://')) {
            const path = Gio.File.new_for_uri(url).get_path();
            if (path)
                finish(path);
            return;
        }

        // Remote cover art (for example from a streaming service).
        const cachePath = coverCachePath(url);
        Gio.File.new_for_path(cachePath).query_info_async('standard::type',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this._cancellable,
            (source, result) => {
                let cached = false;
                try {
                    source.query_info_finish(result);
                    cached = true;
                } catch (e) {
                    cached = false;
                }
                if (token !== this._artToken)
                    return;
                if (cached) {
                    finish(cachePath);
                    return;
                }
                this._downloadArt(url, cachePath, token, finish);
            });
    }

    _downloadArt(url, cachePath, token, finish) {
        Gio.File.new_for_uri(url).load_bytes_async(this._cancellable, (file, result) => {
            if (token !== this._artToken)
                return;

            let bytes;
            try {
                [bytes] = file.load_bytes_finish(result);
            } catch (e) {
                this._notify();
                return;
            }

            ensureCoverCacheDir();
            Gio.File.new_for_path(cachePath).replace_contents_bytes_async(
                bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION,
                this._cancellable, (source, replaceResult) => {
                    try {
                        source.replace_contents_finish(replaceResult);
                    } catch (e) {
                        if (token === this._artToken)
                            this._notify();
                        return;
                    }
                    if (token !== this._artToken)
                        return;
                    finish(cachePath);
                });
        });
    }

    _call(method, parameters = null) {
        this._proxy?.call(method, parameters, Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (e) {
                    // The player went away or does not support this action.
                }
            });
    }

    _notify() {
        this._onChanged?.();
    }
}

// Keeps track of every MPRIS player on the session bus.
export class MprisClient extends Signals.EventEmitter {
    constructor() {
        super();
        this._players = new Map();
        this._cancellable = new Gio.Cancellable();
        this._subscriptionId = 0;
    }

    get players() {
        return [...this._players.values()].filter(player => player.isActive());
    }

    start() {
        this._subscriptionId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, parameters) => {
                const [name, , newOwner] = parameters.deepUnpack();
                if (!name.startsWith(BUS_PREFIX))
                    return;
                if (newOwner)
                    this._add(name);
                else
                    this._remove(name);
            });

        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (connection, result) => {
                try {
                    const [names] = connection.call_finish(result).deepUnpack();
                    for (const name of names) {
                        if (name.startsWith(BUS_PREFIX))
                            this._add(name);
                    }
                } catch (e) {
                    // Cancelled while shutting down, or the bus is unavailable.
                }
            });

        trimCoverCache(this._cancellable).catch(() => {});
    }

    destroy() {
        this._cancellable.cancel();
        if (this._subscriptionId)
            Gio.DBus.session.signal_unsubscribe(this._subscriptionId);
        this._subscriptionId = 0;

        for (const player of this._players.values())
            player.destroy();
        this._players.clear();

        this.disconnectAll();
    }

    _add(name) {
        if (this._players.has(name))
            return;
        this._players.set(name, new MprisPlayer(name, () => this.emit('changed')));
    }

    _remove(name) {
        const player = this._players.get(name);
        if (!player)
            return;
        player.destroy();
        this._players.delete(name);
        this.emit('changed');
    }
}
