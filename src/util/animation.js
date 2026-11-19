// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import St from 'gi://St';

const DEFAULT_MS = 150;

let settings = null;

// The extension gives its settings here when it is enabled, and null when it
// is disabled.
export function setAnimationSettings(value) {
    settings = value;
}

// Animations run only when both the extension setting and GNOME's own
// "Enable Animations" setting are on.
function animationsEnabled() {
    return Boolean(settings?.get_boolean('animations')) && St.Settings.get().enable_animations;
}

// Fades an actor in while it slides in from an offset (in pixels). `to` is the
// opacity it ends with, for actors that are meant to be dimmed.
export function fadeIn(actor, {x = 0, y = 0, to = 255, duration = DEFAULT_MS} = {}) {
    actor.remove_all_transitions();

    if (!animationsEnabled()) {
        actor.opacity = to;
        actor.translation_x = 0;
        actor.translation_y = 0;
        return;
    }

    actor.opacity = 0;
    actor.translation_x = x;
    actor.translation_y = y;
    actor.ease({
        opacity: to,
        translation_x: 0,
        translation_y: 0,
        duration,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

// Fades an actor out while it slides away, then calls onDone (at once when
// animations are off).
export function fadeOut(actor, onDone, {x = 0, y = 0, duration = DEFAULT_MS} = {}) {
    if (!animationsEnabled()) {
        onDone();
        return;
    }

    actor.remove_all_transitions();
    actor.ease({
        opacity: 0,
        translation_x: x,
        translation_y: y,
        duration,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: onDone,
    });
}

// A short flash of brightness, for something that just changed.
export function pulse(actor, {from = 110, duration = 180} = {}) {
    if (!animationsEnabled())
        return;

    actor.remove_all_transitions();
    actor.opacity = from;
    actor.ease({
        opacity: 255,
        duration,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}
