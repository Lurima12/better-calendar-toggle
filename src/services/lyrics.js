// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const LRCLIB_URL = 'https://lrclib.net/api';
const NETEASE_URL = 'https://music.163.com/api';
const BETTERLYRICS_URL = 'https://lyrics-api.boidu.dev';

const MAX_CACHED_TRACKS = 40;
// How far (in seconds) a search result's length may differ from the track's.
const DURATION_TOLERANCE_S = 5;
// How far apart (in ms) a translation or romanization line may be from the
// lyric line it belongs to.
const EXTRA_TOLERANCE_MS = 700;

// "Automatic" tries the providers in this order, so a later one is only asked
// when the earlier ones found nothing or could not be reached.
const AUTO_ORDER = ['local', 'lrclib', 'netease', 'betterlyrics'];

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

// Parses time-synced text in the LRC format: lines that start with one or more
// [mm:ss.xx] stamps. Returns [{time (ms), text}] sorted by time.
export function parseLrc(text) {
    const lines = [];

    for (const raw of text.split(/\r?\n/)) {
        const stamps = [...raw.matchAll(TIMESTAMP)];
        if (stamps.length === 0)
            continue;

        const content = raw.replace(TIMESTAMP, '').trim();
        for (const stamp of stamps) {
            const seconds = Number(stamp[1]) * 60 + Number(stamp[2].replace(':', '.'));
            lines.push({time: Math.round(seconds * 1000), text: content});
        }
    }

    return lines.sort((a, b) => a.time - b.time);
}

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
        const lower = entity.toLowerCase();
        switch (lower) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return '\'';
        default:
            try {
                return String.fromCodePoint(lower.startsWith('#x')
                    ? parseInt(lower.slice(2), 16)
                    : parseInt(lower.slice(1), 10));
            } catch (e) {
                return match;
            }
        }
    });
}

function cleanXml(fragment) {
    return decodeEntities(fragment.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

// "mm:ss.fff", "hh:mm:ss.fff", "12.5" or "12.5s" to milliseconds.
function parseTtmlTime(value) {
    const text = value.trim();
    if (text.endsWith('s') && !text.includes(':')) {
        const seconds = Number(text.slice(0, -1));
        return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
    }

    const parts = text.split(':').map(Number);
    if (parts.length === 0 || parts.some(part => !Number.isFinite(part)))
        return null;
    return Math.round(parts.reduce((total, part) => total * 60 + part, 0) * 1000);
}

// Parses lyrics in TTML (the format of Apple Music style lyrics): every <p> with
// a begin time is a line; spans marked as a translation or a romanization
// become the line's `translation` and `roman`. Returns [{time, text, ...}].
function parseTtml(xml) {
    const lines = [];

    for (const match of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
        const begin = match[1].match(/\bbegin="([^"]+)"/);
        if (!begin)
            continue;
        const time = parseTtmlTime(begin[1]);
        if (time === null)
            continue;

        let roman = '';
        let translation = '';
        const body = match[2].replace(
            /<span\b[^>]*\bttm:role="x-(translation|roman)"[^>]*>([\s\S]*?)<\/span>/g,
            (_match, role, inner) => {
                if (role === 'roman')
                    roman = cleanXml(inner);
                else
                    translation = cleanXml(inner);
                return '';
            });

        const line = {time, text: cleanXml(body)};
        if (roman)
            line.roman = roman;
        if (translation)
            line.translation = translation;
        lines.push(line);
    }

    return lines.sort((a, b) => a.time - b.time);
}

// Adds each line of `extras` (a parsed LRC of translations or romanizations)
// to the lyric line it belongs to, as the given field.
function attachExtras(lines, extras, field) {
    if (extras.length === 0)
        return;

    for (const line of lines) {
        let best = null;
        let bestDifference = EXTRA_TOLERANCE_MS + 1;
        for (const extra of extras) {
            const difference = Math.abs(extra.time - line.time);
            if (extra.text && difference < bestDifference) {
                best = extra;
                bestDifference = difference;
            }
        }
        if (best)
            line[field] = best.text;
    }
}

// Some services put credits ("composer: ...") at the start; they are not lyrics.
function stripCredits(lines) {
    return lines.filter(line => !(line.time < 20000 && /^[^:：]{1,12}\s*[:：]\s*\S/.test(line.text)));
}

function readText(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (source, result) => {
            try {
                const [, contents] = source.load_contents_finish(result);
                resolve(new TextDecoder().decode(contents));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

const encode = value => encodeURIComponent(value);

// Finds time-synced lyrics for a track. It never stores or ships lyrics: text
// is fetched on demand and kept only in memory for the current session.
//
// Providers (the 'lyrics-provider' setting picks which are used):
//   local         a .lrc file next to the audio file (local players)
//   lrclib        LRCLIB (https://lrclib.net), a free community database
//   netease       NetEase Cloud Music (unofficial public endpoints); can also
//                 give a translation and a romanization
//   betterlyrics  the BetterLyrics service (best effort: its format is not
//                 documented, so it is read defensively)
//   auto          all of them in the order above, each one only when the ones
//                 before it found nothing or could not be reached
//
// A track is {title, artist, album, duration (seconds), url}. The result is
// {lines, instrumental, source} or null when nothing was found; a line is
// {time (ms), text, roman?, translation?}.
export class LyricsService {
    constructor(userAgent, settings) {
        this._settings = settings;
        this._cache = new Map();
        this._session = new Soup.Session({user_agent: userAgent, timeout: 10});
    }

    destroy() {
        this._session.abort();
        this._cache.clear();
    }

    async fetch(track, cancellable) {
        const provider = this._settings.get_string('lyrics-provider');
        const order = provider === 'auto' ? AUTO_ORDER : [provider];

        const key = [provider, track.artist, track.title, track.album,
            Math.round(track.duration)].join('|');
        if (this._cache.has(key))
            return this._cache.get(key);

        let result = null;
        let complete = true;

        for (const name of order) {
            const method = this[`_${name}`];
            if (typeof method !== 'function' || (name !== 'local' && !track.title))
                continue;

            try {
                result = await method.call(this, track, cancellable);
            } catch (e) {
                if (isCancelled(e))
                    throw e;
                if (name !== 'local') {
                    // A network problem is not cached, so the next try can succeed.
                    complete = false;
                    console.warn(`Better Calendar Toggle: lyrics lookup (${name}) failed: ${e.message}`);
                }
            }

            if (result)
                break;
        }

        if (result || complete)
            this._remember(key, result);
        return result;
    }

    _remember(key, result) {
        if (this._cache.size >= MAX_CACHED_TRACKS)
            this._cache.delete(this._cache.keys().next().value);
        this._cache.set(key, result);
    }

    // ------------------------------------------------------------ providers

    async _local(track, cancellable) {
        if (!track.url?.startsWith('file://'))
            return null;

        const path = Gio.File.new_for_uri(track.url).get_path();
        if (!path)
            return null;

        const file = Gio.File.new_for_path(`${path.replace(/\.[^./\\]+$/, '')}.lrc`);
        if (!file.query_exists(null))
            return null;

        const lines = parseLrc(await readText(file, cancellable));
        return lines.length > 0 ? {lines, instrumental: false, source: 'local'} : null;
    }

    async _lrclib(track, cancellable) {
        const query = params => Object.entries(params)
            .filter(([, value]) => value !== '' && value !== null && value !== undefined)
            .map(([name, value]) => `${name}=${encode(value)}`)
            .join('&');

        // An exact match needs the album and the length.
        if (track.album && track.duration > 0) {
            const exact = await this._getJson(`${LRCLIB_URL}/get?${query({
                track_name: track.title,
                artist_name: track.artist,
                album_name: track.album,
                duration: Math.round(track.duration),
            })}`, cancellable);
            const parsed = this._fromLrclib(exact);
            if (parsed)
                return parsed;
        }

        const found = await this._getJson(`${LRCLIB_URL}/search?${query({
            track_name: track.title,
            artist_name: track.artist,
        })}`, cancellable);
        if (!Array.isArray(found))
            return null;

        let candidates = found.filter(entry => entry &&
            (entry.instrumental || (typeof entry.syncedLyrics === 'string' &&
                entry.syncedLyrics.trim() !== '')));

        if (track.duration > 0) {
            // Entries that report no length cannot be matched by duration.
            // Old code dropped them (Math.abs(0 - duration) always failed) and
            // the NaN comparisons of the sort made their order undefined, so
            // only rank the ones that actually report a duration.
            const timed = candidates.filter(entry => Number.isFinite(entry.duration));
            if (timed.length > 0) {
                candidates = timed
                    .filter(entry => Math.abs(entry.duration - track.duration) <= DURATION_TOLERANCE_S)
                    .sort((a, b) => Math.abs(a.duration - track.duration) -
                        Math.abs(b.duration - track.duration));
            }
        }

        return this._fromLrclib(candidates[0] ?? null);
    }

    _fromLrclib(entry) {
        if (!entry)
            return null;
        if (entry.instrumental)
            return {lines: [], instrumental: true, source: 'lrclib'};

        if (typeof entry.syncedLyrics !== 'string')
            return null;
        const lines = parseLrc(entry.syncedLyrics);
        return lines.length > 0 ? {lines, instrumental: false, source: 'lrclib'} : null;
    }

    async _netease(track, cancellable) {
        const headers = {Referer: 'https://music.163.com/'};
        const keywords = [track.title, track.artist].filter(Boolean).join(' ');

        const search = await this._getJson(
            `${NETEASE_URL}/search/get?s=${encode(keywords)}&type=1&limit=8`, cancellable, headers);
        let songs = search?.result?.songs;
        if (!Array.isArray(songs) || songs.length === 0)
            return null;

        if (track.duration > 0) {
            const length = song => (song.duration ?? song.dt ?? 0) / 1000;
            songs = songs
                .filter(song => Math.abs(length(song) - track.duration) <= DURATION_TOLERANCE_S)
                .sort((a, b) => Math.abs(length(a) - track.duration) -
                    Math.abs(length(b) - track.duration));
        }
        const song = songs[0];
        if (!song?.id)
            return null;

        const data = await this._getJson(
            `${NETEASE_URL}/song/lyric?id=${song.id}&lv=1&tv=1&rv=1`, cancellable, headers);
        if (!data)
            return null;
        if (data.nolyric === true)
            return {lines: [], instrumental: true, source: 'netease'};

        const synced = data.lrc?.lyric;
        if (typeof synced !== 'string')
            return null;

        const lines = stripCredits(parseLrc(synced));
        if (lines.length === 0)
            return null;

        // A romanization and a translation, when NetEase has them
        attachExtras(lines, parseLrc(data.romalrc?.lyric ?? ''), 'roman');
        attachExtras(lines, parseLrc(data.tlyric?.lyric ?? ''), 'translation');
        return {lines, instrumental: false, source: 'netease'};
    }

    async _betterlyrics(track, cancellable) {
        const params = [`s=${encode(track.title)}`, `a=${encode(track.artist)}`];
        if (track.duration > 0)
            params.push(`d=${Math.round(track.duration)}`);
        if (track.album)
            params.push(`al=${encode(track.album)}`);

        const body = await this._getText(`${BETTERLYRICS_URL}/getLyrics?${params.join('&')}`, cancellable);
        if (!body)
            return null;

        // The answer is either TTML itself or JSON that holds it.
        let lines = [];
        if (body.trimStart().startsWith('<')) {
            lines = parseTtml(body);
        } else {
            const data = JSON.parse(body);
            if (typeof data?.ttml === 'string')
                lines = parseTtml(data.ttml);
            else if (typeof data?.syncedLyrics === 'string')
                lines = parseLrc(data.syncedLyrics);
            else if (typeof data?.lyrics === 'string')
                lines = parseLrc(data.lyrics);
        }

        return lines.length > 0 ? {lines, instrumental: false, source: 'betterlyrics'} : null;
    }

    // ---------------------------------------------------------------- HTTP

    async _getJson(url, cancellable, headers = {}) {
        const text = await this._getText(url, cancellable, headers);
        return text === null ? null : JSON.parse(text);
    }

    _getText(url, cancellable, headers = {}) {
        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            if (!message) {
                reject(new Error('invalid address'));
                return;
            }
            for (const [name, value] of Object.entries(headers))
                message.get_request_headers().append(name, value);

            this._session.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
                    try {
                        const bytes = session.send_and_read_finish(result);
                        const status = message.get_status();
                        if (status === Soup.Status.NOT_FOUND) {
                            resolve(null);
                            return;
                        }
                        if (status !== Soup.Status.OK) {
                            reject(new Error(`HTTP ${status}`));
                            return;
                        }
                        resolve(new TextDecoder().decode(bytes.toArray()));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }
}
