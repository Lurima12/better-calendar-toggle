// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Remote cover art is saved here so it can be drawn as a shaped background.
const COVER_CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'better-calendar-toggle']);

// Covers that are not square (a video thumbnail, often with black bars baked
// in) are cropped to a centered square, so the cover shape always applies.
const pixbufModule = import('gi://GdkPixbuf').then(module => module.default).catch(() => null);

const DARK_LEVEL = 24;
const MAX_BAR_FRACTION = 0.35;
// Upper bound for the decoded image; the square output is at most SQUARE_SIZE.
const DECODE_MAX = 1024;
const SQUARE_SIZE = 512;
// Cached covers kept across sessions; older ones are swept asynchronously.
const MAX_CACHED_COVERS = 64;

// The part of the picture inside black bars at the top and bottom or at the
// left and right.
function findContent(pixbuf) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const channels = pixbuf.get_n_channels();
    const stride = pixbuf.get_rowstride();
    const pixels = pixbuf.get_pixels();

    const dark = (x, y) => {
        const i = y * stride + x * channels;
        // Grayscale covers have one channel; use it for all three weights.
        const r = pixels[i];
        const g = channels > 1 ? pixels[i + 1] : r;
        const b = channels > 2 ? pixels[i + 2] : r;
        return (r * 299 + g * 587 + b * 114) / 1000 <= DARK_LEVEL;
    };
    const rowDark = y => {
        for (let x = 0; x < width; x += 4) {
            if (!dark(x, y))
                return false;
        }
        return true;
    };

    let top = 0;
    while (top < height * MAX_BAR_FRACTION && rowDark(top))
        top++;
    let bottom = height;
    while (height - bottom < height * MAX_BAR_FRACTION && bottom > top + 1 && rowDark(bottom - 1))
        bottom--;

    const columnDark = x => {
        for (let y = top; y < bottom; y += 4) {
            if (!dark(x, y))
                return false;
        }
        return true;
    };
    let left = 0;
    while (left < width * MAX_BAR_FRACTION && columnDark(left))
        left++;
    let right = width;
    while (width - right < width * MAX_BAR_FRACTION && right > left + 1 && columnDark(right - 1))
        right--;

    return {x: left, y: top, width: right - left, height: bottom - top};
}

// Resolves to a GLib.FileInfo; rejects when the file is missing or the
// operation is cancelled.
function queryInfo(file, attributes, cancellable) {
    return new Promise((resolve, reject) => {
        file.query_info_async(attributes, Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
                try {
                    resolve(source.query_info_finish(result));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function readStream(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            try {
                resolve(source.read_finish(result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Decodes an image stream. When maxSize is set, the image is scaled down to
// fit it while it is decoded, so a very large cover never becomes a very large
// pixbuf. Small images are decoded as they are (no upscaling).
function decodeStream(GdkPixbuf, stream, cancellable, maxSize = 0) {
    return new Promise((resolve, reject) => {
        const done = result => {
            try {
                resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));
            } catch (e) {
                reject(e);
            }
        };

        if (maxSize > 0) {
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, maxSize, maxSize, true, cancellable, (_source, result) => done(result));
        } else {
            GdkPixbuf.Pixbuf.new_from_stream_async(
                stream, cancellable, (_source, result) => done(result));
        }
    });
}

// Writes a pixbuf as PNG without blocking the main loop.
function savePng(GdkPixbuf, pixbuf, path, cancellable) {
    return new Promise((resolve, reject) => {
        const file = Gio.File.new_for_path(path);
        file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION,
            GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
                let stream;
                try {
                    stream = source.replace_finish(result);
                } catch (e) {
                    reject(e);
                    return;
                }

                const close = error => {
                    stream.close_async(GLib.PRIORITY_DEFAULT, cancellable, (s, closeResult) => {
                        try {
                            s.close_finish(closeResult);
                        } catch (e) {
                            // The data is already written; ignore close errors.
                        }
                        if (error)
                            reject(error);
                        else
                            resolve();
                    });
                };

                pixbuf.save_to_streamv_async(stream, 'png', null, null, cancellable,
                    (_pixbuf, saveResult) => {
                        try {
                            GdkPixbuf.Pixbuf.save_to_stream_finish(saveResult);
                        } catch (e) {
                            close(e);
                            return;
                        }
                        close(null);
                    });
            });
    });
}

function deleteFile(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.delete_async(GLib.PRIORITY_LOW, cancellable, (source, result) => {
            try {
                source.delete_finish(result);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

// Every entry of the cover cache, for the bounded sweep below.
function listCache(cancellable) {
    return new Promise((resolve, reject) => {
        const directory = Gio.File.new_for_path(COVER_CACHE_DIR);
        directory.enumerate_children_async('standard::name,time::modified',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancellable,
            (source, result) => {
                let enumerator;
                try {
                    enumerator = source.enumerate_children_finish(result);
                } catch (e) {
                    reject(e);
                    return;
                }

                const infos = [];
                const next = () => {
                    enumerator.next_files_async(64, GLib.PRIORITY_LOW, cancellable,
                        (src, batchResult) => {
                            let batch;
                            try {
                                batch = src.next_files_finish(batchResult);
                            } catch (e) {
                                reject(e);
                                return;
                            }
                            if (batch.length === 0) {
                                resolve(infos);
                                return;
                            }
                            infos.push(...batch);
                            next();
                        });
                };
                next();
            });
    });
}

// Keeps the cache bounded. Best effort: the directory may not exist yet, and a
// cancellation (the extension was disabled) simply stops the sweep.
export async function trimCoverCache(cancellable) {
    let infos;
    try {
        infos = await listCache(cancellable);
    } catch (e) {
        return;
    }

    if (infos.length <= MAX_CACHED_COVERS)
        return;

    infos.sort((a, b) => a.get_attribute_uint64('time::modified') -
        b.get_attribute_uint64('time::modified'));

    for (const info of infos.slice(0, infos.length - MAX_CACHED_COVERS)) {
        try {
            await deleteFile(Gio.File.new_for_path(
                GLib.build_filenamev([COVER_CACHE_DIR, info.get_name()])), cancellable);
        } catch (e) {
            // Already gone, or the sweep was cancelled.
        }
    }
}

// Returns the path of a square version of the cover at path (or path itself
// when it is already square or cannot be processed). The image is decoded,
// cropped and written asynchronously; only the header read and the bounded
// crop/scale of the already-small pixbuf are synchronous.
export async function makeSquareCover(path, cancellable) {
    const GdkPixbuf = await pixbufModule;
    if (!GdkPixbuf)
        return path;

    try {
        const info = await queryInfo(Gio.File.new_for_path(path),
            'standard::size,time::modified', cancellable);
        const stamp = `${path}|${info.get_attribute_uint64('time::modified')}|${info.get_size()}`;
        const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, stamp, -1);
        const target = GLib.build_filenamev([COVER_CACHE_DIR, `${name}-square.png`]);

        try {
            await queryInfo(Gio.File.new_for_path(target), 'standard::type', cancellable);
            return target;
        } catch (e) {
            // Not cached yet.
        }

        // The header says whether the stream has to be scaled down while it
        // is decoded. Reading only the header is cheap, and it avoids
        // upscaling small covers.
        let longest = 0;
        try {
            const [, width, height] = GdkPixbuf.Pixbuf.get_file_info(path);
            longest = Math.max(width, height);
        } catch (e) {
            // Unknown dimensions: decode as it is.
        }

        const stream = await readStream(Gio.File.new_for_path(path), cancellable);
        let pixbuf;
        try {
            pixbuf = await decodeStream(GdkPixbuf, stream, cancellable,
                longest > DECODE_MAX ? DECODE_MAX : 0);
        } finally {
            stream.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
        }

        const content = findContent(pixbuf);
        const side = Math.min(content.width, content.height);
        const x = content.x + Math.floor((content.width - side) / 2);
        const y = content.y + Math.floor((content.height - side) / 2);

        if (x === 0 && y === 0 && side === pixbuf.get_width() && side === pixbuf.get_height())
            return path;

        let square = pixbuf.new_subpixbuf(x, y, side, side);
        if (side > SQUARE_SIZE)
            square = square.scale_simple(SQUARE_SIZE, SQUARE_SIZE, GdkPixbuf.InterpType.BILINEAR);

        ensureCoverCacheDir();
        await savePng(GdkPixbuf, square, target, cancellable);
        return target;
    } catch (e) {
        return path;
    }
}

export function coverCachePath(url) {
    const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1);
    return GLib.build_filenamev([COVER_CACHE_DIR, `${name}.img`]);
}

export function ensureCoverCacheDir() {
    GLib.mkdir_with_parents(COVER_CACHE_DIR, 0o755);
}