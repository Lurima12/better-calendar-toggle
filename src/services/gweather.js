// SPDX-License-Identifier: GPL-2.0-or-later

let loading = null;

// GWeather is an optional part of GNOME, so it is loaded on demand and a
// missing library simply resolves to null.
export function loadGWeather() {
    loading ??= import('gi://GWeather?version=4.0')
        .then(module => module.default)
        .catch(() => null);
    return loading;
}
