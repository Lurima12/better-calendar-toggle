// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

// After a step, further mouse-wheel clicks are ignored for this long.
const WHEEL_COOLDOWN_MS = 250;
// After a touchpad step, more movement is ignored for this long at least.
const STEP_LOCK_MS = 150;
// A touchpad gesture counts as over after this long without new events (or
// when the fingers lift, if the system says so).
const SMOOTH_IDLE_MS = 150;
const DEFAULT_SMOOTH_STEP = 10;

// Turns scroll events into page steps, one page per gesture: a fast spin of the
// mouse wheel or a long touchpad swipe (with its momentum) moves one page, not
// all the way to the end.
//
// getDistance returns the touchpad scroll distance needed for one step; a
// larger number means slower.
export class ScrollStepper {
    constructor(getDistance = () => DEFAULT_SMOOTH_STEP) {
        this._getDistance = getDistance;
        this._accumulator = 0;
        this._stepTaken = false;
        this._lockedUntil = 0;
        this._lastSmooth = 0;
    }

    // Returns -1 (previous) or 1 (next) for a step, 0 when the event should
    // not move anything, and null when it is not a scroll event at all.
    read(event) {
        const now = GLib.get_monotonic_time() / 1000;

        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            return this._wheel(now, -1);
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            return this._wheel(now, 1);
        case Clutter.ScrollDirection.SMOOTH:
            return this._smooth(now, event);
        default:
            return null;
        }
    }

    _wheel(now, step) {
        if (now < this._lockedUntil)
            return 0;
        this._lockedUntil = now + WHEEL_COOLDOWN_MS;
        return step;
    }

    // One step per touchpad gesture: once a step was taken, the rest of that
    // gesture is ignored. A new gesture (fingers lifted, or a short pause) can
    // step again right away.
    _smooth(now, event) {
        const flags = event.get_scroll_finish_flags?.() ?? Clutter.ScrollFinishFlags.NONE;
        const lifted = flags !== Clutter.ScrollFinishFlags.NONE;

        if (lifted || now - this._lastSmooth > SMOOTH_IDLE_MS) {
            this._accumulator = 0;
            this._stepTaken = false;
        }
        this._lastSmooth = now;

        if (lifted || this._stepTaken || now < this._lockedUntil)
            return 0;

        const [dx, dy] = event.get_scroll_delta();
        this._accumulator += Math.abs(dx) > Math.abs(dy) ? dx : dy;
        if (Math.abs(this._accumulator) < Math.max(1, this._getDistance()))
            return 0;

        const step = this._accumulator > 0 ? 1 : -1;
        this._accumulator = 0;
        this._stepTaken = true;
        this._lockedUntil = now + STEP_LOCK_MS;
        return step;
    }
}
