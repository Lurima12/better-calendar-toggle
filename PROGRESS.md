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
- [x] 0.46.0 — theme-adaptive cards/borders (dark/light sampling); hover for the Misc play buttons and notification items
- [x] 0.47.0 — spacing between the DND and Clear buttons; DND limited to the bottom corners
- [x] 0.48.0 — scroll bars above the content; instant title on player switch; shuffle button; artist line preference; shorter preference descriptions
- [x] 0.49.0 — repeat button (off/all/one); configurable cover gesture to open or raise the playing app
- [x] 0.50.0 — accent fill and dot for active shuffle/repeat; working timed double-click cover gesture; alarm notification with Snooze and Stop
- [x] 0.51.0 — shuffle/repeat icons centred again; the active state uses the accent fill only
- [x] 0.52.0 — dead code removed; README rewritten; PROGRESS refreshed; `.gitignore` expanded; GitHub-ready snapshot
- [ ] Original roadmap — card-interaction refactor (nested buttons -> click actions)

## Architecture & Conventions
- **Entry:** `extension.js` (extension lifecycle) -> `DateMenuOverhaul` orchestrator.
- **Modules:** `src/models` (state), `src/services` (D-Bus/network/GSettings bridges), `src/ui` (views), `src/panel`, `src/util`.
- **Cleanup:** every signal, timeout and idle source must be disconnected or removed in `destroy()`.
- **Versioning:** one minor bump per release; update `metadata.json` (`version`, `version-name`) and `CHANGELOG.md`.
- **Tooling:** `make check` (strict schema), `make pack`, `make install`; repo-local Git identity `lurim412 <lurim412@localhost>`.
- **Release workflow:** bump `metadata.json` (`version`, `version-name`), update `CHANGELOG.md`, `README.md` and `PROGRESS.md`, run `make check` + `make pack`, commit, then `make install`.
- **Repository:** <https://github.com/Lurima12/better-calendar-toggle> (public, `main`). Generated `dist/` and `schemas/gschemas.compiled` are ignored.
- **GNOME Clocks:** `timers` stores only `{duration, name}`; there is no stopwatch persistence; `org.gnome.clocks.state.window` `panel-id` selects the tab.
- **`St.Button::clicked` passes the clicked mouse button number, not a Clutter event.** Never call event methods on it; track the press source instead (`_swallowClick` in `worldClocks.js`, `pressedOnButton` in `todoView.js`).
- **An `St.Entry` never keeps key focus.** On `key-focus-in` it grabs focus for its inner `ClutterText`, so the entry immediately gets `key-focus-out`; treat that as "left the field" only when the new focus is outside the entry (`todoView.js` `_startEdit`).
- **Hover-only buttons need `reactive: true` + `track_hover: true` on the row wrapper**; CSS `:hover` alone does nothing on an `St.BoxLayout`, and opacity alone leaves invisible buttons clickable.
- **Theming:** the extension does not hardcode a palette. `_syncTheme()` samples `menu.box.get_theme_node().get_background_color()`, tests the luminance (`< 3*128` = dark), and puts `bct-dark` or `bct-light` on `_root`; it re-runs on menu open and on `St.Settings` `notify::color-scheme`, falling back to `color_scheme !== PREFER_LIGHT`. The tinted styles live at the end of `stylesheet.css`.
- **Extension CSS wins over theme `:hover`:** once the extension stylesheet sets a background for a button, the shell theme's own `:hover`/`:active` rule for that class no longer shows. Every interactive background (tabs, play buttons, notification cards, alarm days, task rows) must therefore declare its hover/active/checked states explicitly, for both `bct-dark` and `bct-light`.
- **Card borders mirror the shell:** `1px` border with the same tint family as the fill (white over dark, black over light), matching the stock `popup-menu-content` and `.message` border relationship.
- **DND position:** `dnd-position` only accepts `bottom-left` and `bottom-right` since 0.47.0. Both layouts ignore the vertical part and always use the bottom row; GSettings itself falls back to the default `bottom-left` when an old `top-*` value is loaded from the keyfile/dconf.
- **Overlay scroll bars paint below the scroll content:** `StScrollView` puts its `St.ScrollBar` children before the content child, so a card that fills the view covers the bar. `_makeScroll()` raises every `St.ScrollBar` with `set_child_above_sibling(bar, null)`.
- **Do not build the marquee on `actor.ease()`:** an implicit transition cancelled from its own completion callback can leave the actor's easing state in "animate", and the next direct `translation_x` assignment then animates with the old duration and delay. `MarqueeLabel` uses explicit `Clutter.PropertyTransition`s and removes only its own `bct-marquee` transition before resetting the position.
- **MPRIS shuffle is optional:** the `Shuffle` property is only present on players that support it. `MprisPlayer` reads the cached property to set `canShuffle`, and `setShuffle()` writes it through `org.freedesktop.DBus.Properties.Set`.
- **MPRIS `LoopStatus` is optional too:** it is one of `None`, `Track` and `Playlist`. `MprisPlayer` sets `canLoop` from the cached property and `setLoopStatus()` writes it. The repeat button cycles `None` → `Playlist` → `Track` and swaps to the one-track icon for `Track`.
- **Media toggle icons stay centred:** the shuffle and repeat buttons keep the icon as the only child of the `St.Button`; the `:checked` accent fill is the active indicator. A dot added as a second layout child shifts the icon upwards.
- **Media cover gestures:** the gesture comes from `media-cover-action` (`single`, `double`, `right`, `middle`; default `double`). GNOME 50's Clutter has no `get_click_count()`, so double clicks are timed with `GLib.get_monotonic_time()` and `Clutter.Settings.double_click_time` (400 ms fallback). The handler is on the cover frame itself (`_onCoverEvent`) so it cannot be swallowed by the view root; right and middle clicks act on the press, primary clicks on the release. Touch taps always open, since touch has no buttons.
- **Alarm notification:** `extension.js` adds a resident `MessageTray.Source` and a CRITICAL `MessageTray.Notification` when an alarm rings, with `Snooze` and `Stop` actions. The notification is dismissed when `AlarmModel.ringing` becomes null, whether the alarm was stopped from the notification or from the alarm card, and the source self-destructs when empty.

## Known Issues / Caveats
- The running GNOME Shell caches extension code and metadata; log out and back in (Wayland) to load a new build.
- GNOME Clocks cannot persist live timer or stopwatch state. The Timer mirror is a stopped entry.
- `shell-version` is `["50"]` only; older versions need testing before they are re-added.
- The `v0.41.0` tag points at a commit whose `metadata.json` still said `0.40.0`; 0.42.0 corrects the version.
- Card-wide buttons coexist with inner buttons through `_swallowClick`; the planned refactor replaces that pattern.

## Exact Next Step
Start the card-interaction refactor replacing the nested-button and `_swallowClick`
pattern.

## Verified for 0.46.0
Nested headless shell (1280x800), Adwaita dark and light:
- dark: `_root` = `bct-dark`, card `rgba(255,255,255,17)` + 1px `rgba(255,255,255,28)` border; play `46` -> hover `61`; notification `17` -> hover `30`
- light (`color-scheme=prefer-light`): menu `#fafafb`, `_root` = `bct-light`, card `rgba(0,0,0,12)` + 1px `rgba(0,0,0,25)` border; play `30` -> hover `23`; notification `12` -> hover `25`
- smoke: all five tabs render, notification card reactive with a 1px border, task editor opens, Pomodoro play toggles to pause

## Verified for 0.47.0
Nested headless shell, both notification-list modes and both bottom corners:
- DND and Clear are separated by 12px (the 0.8em row spacing); no touching edges
- the DND row sits at the bottom in every case, including after an old `top-left` value is loaded (GSettings returns the default `bottom-left`)
- the Preferences combo lists only "Bottom left" and "Bottom right"

## Verified for 0.50.0
Nested headless shell with two fake MPRIS players and synthetic pointer events:
- real double-click on the cover opens the playing app and closes the menu; a single click does not
- right and middle clicks open the player on the press; touch taps always open
- a ringing alarm shows a resident notification with **Snooze** and **Stop**; both actions dismiss it and update `AlarmModel`, and stopping from the card also dismisses it

## Verified for 0.51.0
Nested headless shell, shuffle and repeat both active:
- button `35×35` at `(614, 208)`; icon `16×16` at `(623, 217)`; centres both at `(631.5, 225.5)`
- `:checked` applies the accent fill; repeat-one swaps to `media-playlist-repeat-symbolic`

## Verified for 0.52.0
Static audit (no behaviour change):
- 33 tracked files; no secrets, private keys or personal paths in source; no junk files
- `make check` passes; `make pack` produces the archive
- every one of the 48 schema keys is referenced from `src/` or `prefs.js`
- removed `_getNotificationForCard`, `MEDIA_RESERVED_EM`, and the unnecessary exports of `animationsEnabled` and `parseLrc`