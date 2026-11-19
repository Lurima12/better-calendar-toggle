# Better Calendar Toggle

Better Calendar Toggle replaces the GNOME Shell date menu with a page-based
panel: calendar and events, notifications, a media player with synced lyrics,
weather and clocks, and a productivity page with Pomodoro, stopwatch, timer and
tasks.

- **Current release:** 0.52.0
- **Repository:** <https://github.com/Lurima12/better-calendar-toggle>
- **Shell version:** GNOME Shell 50
- **License:** GPL-2.0-or-later

## Pages

### Calendar & Events

Events and the month calendar share the page, with either side configurable.
The day, month, date and year can sit above or below the calendar. The calendar
keeps its normal navigation and “today” highlighting.

### Notifications

The page can draw its own notification list, so it fills the whole tab, or use
GNOME Shell’s stock list. Each notification is a card that highlights on hover
and focus; clicking it activates the notification, the close button dismisses
it, and notification actions work from the card. An optional Do Not Disturb
button can be placed in the bottom-left or bottom-right corner, next to Clear.

### Media

The player shows the cover on the left and the title, artist (or album), seek
bar and controls on the right. Long titles scroll instead of being cut off, and
the title updates immediately when switching players.

- Shuffle and repeat buttons appear only for players that expose the optional
  MPRIS properties. The active state is an accent-coloured fill; repeat cycles
  off, repeat-all and repeat-one, with a single-track icon for repeat-one.
- The cover gesture opens the playing app or raises its running window. Choose
  single click, double click, right click or middle click (default: double
  click). On touch screens a tap always opens the player.
- Swipe left/right anywhere on the card, or scroll over it, to move between
  players.
- The Media player and Lyrics buttons below the player switch views. Synced
  lyrics support LRCLIB, NetEase, BetterLyrics and local `.lrc` files, with
  optional translation and romanization lines.

### Weather & Clocks

Detailed weather for the location configured in GNOME Weather appears on the
left; clicking it opens GNOME Weather. The alarms card is always at the top and
the world clock card always at the bottom, so the page does not jump around
when either is empty.

- Alarms are shared with GNOME Clocks when it is installed, or kept in the
  extension. A ringing alarm shows a resident notification with **Snooze** and
  **Stop** buttons; the notification also goes away when the alarm is stopped
  from the card.
- World clocks come from GNOME Clocks and can be scrolled or swiped through.
- Weather and clock cards keep a stable height and show a placeholder when
  there is no data.

### Misc

Pomodoro, stopwatch, timer and tasks share one page.

- Pomodoro has configurable focus, short-break and long-break lengths, and a
  configurable number of sessions before a long break.
- Stopwatch supports laps. Timer supports quick ±1 and ±5 minute adjustments.
- A running or paused timer is mirrored into GNOME Clocks as a stopped timer.
- Pomodoro, stopwatch and timer state survive closing the menu and restarting
  the extension.
- Task rows show edit and pin buttons on hover. Edit changes the text in place
  and Enter saves; pin moves the task to the top. Tasks persist across restarts.

## Requirements

- GNOME Shell 50 (tested on 50.1).
- GNOME Weather for the weather card and weather indicator.
- GNOME Clocks for shared alarms, world clocks, and timer mirroring. These
  features degrade gracefully when Clocks is not installed.
- GJS, GLib, Gio, St, Clutter, Soup 3 and GWeather 4, all provided by the Shell
  runtime.

## Installation

### From source (recommended for development)

The extension is modular: `extension.js` imports the files in `src/`, so a
plain `gnome-extensions pack` would leave them out. The Makefile wraps the
correct commands:

```bash
git clone https://github.com/Lurima12/better-calendar-toggle.git
cd better-calendar-toggle

make check      # validate the GSettings schema (strict)
make compile    # build schemas/gschemas.compiled
make pack       # build dist/better-calendar-toggle@lurim412.shell-extension.zip
make install    # install the archive and compile its schema
make enable     # enable the extension
make clean      # remove dist/ and the compiled schema
```

On Wayland, log out and back in after `make install` so the Shell loads the
new code. On X11, <kbd>Alt</kbd>+<kbd>F2</kbd>, then `r`, is enough.

### Manual installation

```bash
glib-compile-schemas schemas
gnome-extensions pack --force \
    --extra-source=src \
    --extra-source=README.md \
    --extra-source=CHANGELOG.md \
    --extra-source=COPYING \
    --out-dir=dist .

mkdir -p ~/.local/share/gnome-shell/extensions
unzip -q dist/better-calendar-toggle@lurim412.shell-extension.zip \
    -d ~/.local/share/gnome-shell/extensions/better-calendar-toggle@lurim412
glib-compile-schemas \
    ~/.local/share/gnome-shell/extensions/better-calendar-toggle@lurim412/schemas
gnome-extensions enable better-calendar-toggle@lurim412
```

`schemas/gschemas.compiled` and `dist/` are generated and ignored by Git.

## Settings

Open the preferences with:

```bash
gnome-extensions prefs better-calendar-toggle@lurim412
```

or from the Extensions app.

### Layout

- **Pages:** turn pages on or off and reorder the tabs with the arrow buttons.
- **Size:** automatic, or a fixed width/height in pixels. Automatic is capped
  to the work area; fixed sizes are capped too.
- **Calendar side:** calendar on the right or left of the events.
- **Page on open:** a specific page, or the last used page.
- **Tab labels:** automatic (text only on the active tab on small screens),
  always, or icons only.
- **Animations:** page, player, alarm and notification transitions. They are
  also disabled when GNOME’s own animations are off.

### Content

- **Calendar & Events:** date header above or below the calendar; scroll bars
  on or off.
- **Notifications:** custom list or GNOME’s stock list; optional Do Not Disturb
  button and its bottom corner; notifications scroll bar on or off.
- **Media:** cover size and shape (rounded, square, circle); playback button
  size; seek bar; artist instead of album; cover gesture (single, double, right
  or middle click); title scrolling.
- **Lyrics:** default view (player or lyrics); provider (automatic, LRCLIB,
  NetEase, BetterLyrics, local `.lrc` files); number of lines; highlighted and
  other line sizes and opacity; translation and romanization.
- **Scrolling:** touchpad distance per page for the media player and alarms.
- **Alarms:** storage (GNOME Clocks or extension), whether the extension also
  rings Clocks alarms, and snooze length.
- **Pomodoro, stopwatch and timer:** focus, break and long-break lengths;
  sessions before a long break; notifications and sound when a phase or timer
  finishes.

### Panel

- **Clock format:** use GNOME’s clock or a custom GLib date/time format
  (`%a %-d %b  %H:%M` for example), with a live preview.
- **Weather indicator:** show the icon and/or temperature inside the panel
  clock, on the left or right of the time.

## Theming

The pages are drawn as cards on top of the date menu, so their colours come
from the Shell theme instead of a fixed palette:

- Every card (weather, clocks, alarm, tasks, Pomodoro/stopwatch/timer,
  notifications) and every small tile inside them has a `1px` border, like the
  date menu and the stock notification cards.
- On a dark menu the cards are a light `7%` white overlay with an `11%` white
  border; on a light menu they are a `5%` black overlay with a `10%` black
  border. Hover and focus raise the tint a little, matching how the stock
  theme lightens menu rows and buttons.
- The play/pause buttons, tabs, day toggles, task rows and notification cards
  draw their own hover, active and checked backgrounds, so the highlight stays
  visible even though the extension stylesheet overrides the theme’s own
  `:hover` rules.
- The dark/light mode is detected at runtime by sampling the date menu
  background (`extension.js` `_syncTheme()`), so it follows GNOME light/dark as
  well as Yaru or another custom Shell theme. It is re-checked when the menu
  opens and when the colour scheme changes.
- Shuffle and repeat use the theme’s accent colour while active, so they follow
  the accent selected in GNOME Settings.

## Small screens and font scaling

- Sizes are in `em`, so the layout follows the text scaling factor.
- The menu height and width are capped to the work area (tested at 1366×768).
- On small screens only the active tab shows its text label.
- Media cards shrink the cover and spacing before clipping the controls.

## Project structure

```text
extension.js                 Extension lifecycle and DateMenuOverhaul
prefs.js                     Preferences window
metadata.json                Extension metadata
stylesheet.css               All extension styles
schemas/                     GSettings schema
src/
  models/                    Alarm, Misc and Todo state
  panel/                     Panel clock formatter and weather indicator
  services/                  MPRIS, lyrics, weather, Clocks, cover art
  ui/                        Calendar-adjacent page views
  util/                      Animation and scroll helpers
```

## Development

- **Versioning:** one minor bump per release. Update `metadata.json`
  (`version`, `version-name`), `CHANGELOG.md`, `README.md` and `PROGRESS.md`.
- **Packaging:** `make check` validates the schema; `make pack` builds the ZIP
  and fails if `src/` is missing.
- **Installed build:** `make install` replaces the installed copy and compiles
  its schema.
- **Wayland:** the running Shell caches extension code; log out and back in to
  load a new build.
- **Testing:** the repository is tested in a nested headless GNOME Shell with
  fake MPRIS players and synthetic pointer events, as recorded in
  `PROGRESS.md`.

## Troubleshooting

- **The extension does not appear:** confirm the UUID is
  `better-calendar-toggle@lurim412`, the schema is compiled, and the Shell
  version is 50. Check the journal:
  `journalctl --user -b -o cat /usr/bin/gnome-shell`.
- **The menu is untouched:** the extension leaves the stock date menu alone if
  it cannot recognise its private layout. This is expected on unsupported
  Shell versions.
- **Notifications do not line up:** turn on the layout log, open the
  Notifications tab, and read the sizes from the journal:

  ```bash
  gsettings set org.gnome.shell.extensions.better-calendar-toggle debug-layout true
  journalctl --user -b -o cat /usr/bin/gnome-shell | grep -A 40 "Better Calendar Toggle layout"
  gsettings reset org.gnome.shell.extensions.better-calendar-toggle debug-layout
  ```

- **Alarms ring twice:** GNOME Clocks rings its own alarms. Leave
  “Ring GNOME Clocks alarms from the extension” off unless Clocks does not ring
  them.
- **Lyrics lookups:** the automatic provider order is local `.lrc`, LRCLIB,
  NetEase, then BetterLyrics. Only track metadata is sent to the online
  provider; the `local` provider never goes online.

## License

GPL-2.0-or-later. See `COPYING`.
