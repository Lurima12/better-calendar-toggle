# PROGRESS.md

## Project Overview
- **Name:** Better Calendar Toggle (`better-calendar-toggle@lurim412`)
- **Goal:** Turn GNOME Shell's date menu into a multi-page productivity panel: weather and clocks, calendar and events, notifications, media with synced lyrics, and Pomodoro/stopwatch/timer.
- **Tech stack:** GJS ES modules, GNOME Shell 50 APIs, St/Clutter, GSettings, Soup 3, GWeather 4, MPRIS.
- **Target:** GNOME Shell 50 (tested on 50.1), Ubuntu 26.04, Wayland; 1366x768 with font scaling.

## Current Status
- [x] 0.30.0 — packaging, `COPYING`, Makefile, repo isolation
- [x] 0.31.0 — GNOME 50 cleanup, teardown guards
- [x] 0.32.0 — async cover pipeline (`coverArt.js`), bounded cache
- [x] 0.33.0 — media cover-left/details-right, separate Lyrics view
- [x] 0.34.0 — notification spacing, stable weather/clocks cards
- [x] 0.35.0 — open Clocks from Misc, mirror the Timer duration
- [x] 0.36.0 — open the matching Clocks tab; alarm header; gear icon
- [x] 0.37.0 — media view buttons below the player, icon-only
- [x] 0.38.0 — whole notification card clickable; notifications scroll bar preference
- [x] 0.39.0 — notification top spacing; weather icon hover background
- [x] 0.40.0 — task edit button; click-to-toggle; Clocks gear icon; weather hover
- [x] 0.41.0 — task pin button; pinned task rows (click handling regressed here)
- [x] 0.42.0 — repaired task clicks and in-place editing; restored the Clocks button
- [x] 0.43.0 — always-visible pin/edit; pinned tasks on top; centred media placeholder; panel hover on weather
- [x] 0.44.0 — removed the Stopwatch/Timer Clocks gear and the unused card header slot
- [x] 0.45.0 — task editing fixed (entry keeps focus); hover-only edit/pin; edit state resets on menu close
- [ ] Original roadmap — card-interaction refactor (nested buttons -> click actions)

## Architecture & Conventions
- **Entry:** `extension.js` (extension lifecycle) -> `DateMenuOverhaul` orchestrator.
- **Modules:** `src/models` (state), `src/services` (D-Bus/network/GSettings bridges), `src/ui` (views), `src/panel`, `src/util`.
- **Cleanup:** every signal, timeout and idle source must be disconnected or removed in `destroy()`.
- **Versioning:** one minor bump per release; update `metadata.json` (`version`, `version-name`) and `CHANGELOG.md`.
- **Tooling:** `make check` (strict schema), `make pack`, `make install`; repo-local Git identity `lurim412 <lurim412@localhost>`.
- **GNOME Clocks:** `timers` stores only `{duration, name}`; there is no stopwatch persistence; `org.gnome.clocks.state.window` `panel-id` selects the tab.
- **`St.Button::clicked` passes the clicked mouse button number, not a Clutter event.** Never call event methods on it; track the press source instead (`_swallowClick` in `worldClocks.js`, `pressedOnButton` in `todoView.js`).
- **An `St.Entry` never keeps key focus.** On `key-focus-in` it grabs focus for its inner `ClutterText`, so the entry immediately gets `key-focus-out`; treat that as "left the field" only when the new focus is outside the entry (`todoView.js` `_startEdit`).
- **Hover-only buttons need `reactive: true` + `track_hover: true` on the row wrapper**; CSS `:hover` alone does nothing on an `St.BoxLayout`, and opacity alone leaves invisible buttons clickable.

## Known Issues / Caveats
- The running GNOME Shell caches extension code and metadata; log out and back in (Wayland) to load a new build.
- GNOME Clocks cannot persist live timer or stopwatch state. The Timer mirror is a stopped entry.
- `shell-version` is `["50"]` only; older versions need testing before they are re-added.
- The `v0.41.0` tag points at a commit whose `metadata.json` still said `0.40.0`; 0.42.0 corrects the version.
- Card-wide buttons coexist with inner buttons through `_swallowClick`; the planned refactor replaces that pattern.

## Exact Next Step
Start the card-interaction refactor replacing the nested-button and `_swallowClick`
pattern.