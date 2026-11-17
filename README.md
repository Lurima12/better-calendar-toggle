# Better Calendar Toggle

A GNOME Shell extension that overhauls the date menu into separate pages.

## Pages

- **Calendar & Events**: events on the left, calendar on the right
- **Notifications**: the notification list, drawn by the extension so it fills the tab (GNOME's own list can be chosen instead). Each notification is a card that highlights on hover; clicking it opens it, the cross dismisses it, and its action buttons work
- **Media**: the cover on the left and the title, album, seek bar and controls on the right; Media player and Lyrics buttons below the player switch between the player and synced lyrics (lyrics hidden by default)
- **Weather & Clocks**: detailed weather for the city chosen in GNOME Weather (left, click to open it); on the right the alarms card (one alarm at a time, with dots; shares its alarms with GNOME Clocks) always at the top, and the world clock card (cities saved in GNOME Clocks) always at the bottom; the cards keep their places and look the same when empty
- **Misc**: Pomodoro, Stopwatch, Timer and Tasks; a running or paused Timer is mirrored into GNOME Clocks as a stopped timer. The play/pause button in each clock card highlights on hover. Task rows show their edit and pin buttons on hover: edit changes the text in place (Enter saves), pin moves the task to the top of the list

A tab bar at the top switches pages. The menu opens on the Calendar page.

## Theming

The pages are drawn as cards on top of the date menu, so their colours come
from the shell theme instead of a fixed palette:

- Every card (weather, clocks, alarm, tasks, Pomodoro/stopwatch/timer,
  notifications) and every small tile inside them has a `1px` border, like the
  date menu and the stock notification cards.
- On a dark menu the cards are a light `7%` white overlay with an `11%` white
  border; on a light menu they are a `5%` black overlay with a `10%` black
  border. Hover and focus raise the tint a little, matching how the stock
  theme lightens menu rows and buttons on hover.
- The play/pause buttons, tabs, day toggles, task rows and notification cards
  draw their own hover, active and checked backgrounds, so the highlight stays
  visible even though the extension stylesheet overrides the theme's own
  `:hover` rules.
- The mode is detected at runtime by sampling the date menu background
  (`extension.js` `_syncTheme()`), so it follows GNOME light/dark as well as
  Yaru or another custom shell theme. It is re-checked when the menu opens and
  when the colour scheme changes.

## Settings

Open them with `gnome-extensions prefs better-calendar-toggle@lurim412` or from the Extensions app.

- **Pages**: reorder the tabs and turn pages on or off
- **Size**: a width or height of 0 is automatic; any other value is a fixed size
- **Calendar side**: calendar on the right or left of the events
- **Page shown on open**: a specific page, or the last used one
- **Tab labels**: automatic, always, or icons only
- **Calendar & Events**: day, month, date and year above or below the calendar; show or hide scroll bars
- **Do Not Disturb button**: optional, in the bottom-left or bottom-right corner of the notification list, with a gap from the Clear button
- **Scrolling**: touchpad distance per page for the media player and the alarms
- **Lyrics**: the view shown by default (Media player or Lyrics; also the two buttons below the player), provider (automatic, LRCLIB, NetEase, BetterLyrics, local .lrc files), 3 to 9 lines, fonts of the highlighted and other lines
- **Media player**: cover size and shape, playback button size, seek bar, album line, title scrolling
- **Pomodoro, stopwatch and timer**: durations, notifications and sound for the Misc page; the timer is mirrored into GNOME Clocks while it is active
- **Panel clock**: custom date and time format for the top bar (GLib format codes)
- **Weather indicator**: icon and temperature inside the panel clock, left or right of the time

## Small screens and font scaling

- Sizes are in `em`, so the layout follows the text scaling factor.
- The menu height and width are capped to the work area (works on 1366x768).
- On small screens only the active tab shows its text label.

## Compatibility

Declared for GNOME Shell 50 (ES module extensions) and tested on 50.1. The
extension relies on the stock date menu's internals and leaves it untouched if
the layout is not recognised. Earlier Shell versions can be added back after
testing; the private date-menu layout is the part that changes between releases.

## Build and install (development)

The extension is modular: `extension.js` imports the modules in `src/`, so a
plain `gnome-extensions pack` leaves them out. The Makefile wraps the correct
commands:

    make check      # validate the GSettings schema (strict)
    make compile    # build schemas/gschemas.compiled
    make pack       # build dist/better-calendar-toggle@lurim412.shell-extension.zip
    make install    # install the archive and compile its schema
    make enable     # enable the extension
    make clean      # remove dist/ and the compiled schema

On Wayland, log out and back in after `make install` so the shell loads the new
code. On X11, Alt+F2 and `r` is enough.

The manual equivalent:

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
    glib-compile-schemas ~/.local/share/gnome-shell/extensions/better-calendar-toggle@lurim412/schemas
    gnome-extensions enable better-calendar-toggle@lurim412

`schemas/gschemas.compiled` is generated and ignored by Git; it is not part of
the source tree.

## Packaging

`make pack` builds `dist/better-calendar-toggle@lurim412.shell-extension.zip`.
The archive includes `src/`, `README.md`, `CHANGELOG.md` and `COPYING` in
addition to the standard files, and the target fails if `src/` is missing.

## License

GPL-2.0-or-later. See `COPYING`.

## Troubleshooting

If the notifications do not line up in the Notifications tab, turn on the layout log, open the
tab, and read the sizes from the journal:

    gsettings set org.gnome.shell.extensions.better-calendar-toggle debug-layout true
    journalctl --user -b -o cat /usr/bin/gnome-shell | grep -A 40 "Better Calendar Toggle layout"

Turn it off again with `gsettings reset org.gnome.shell.extensions.better-calendar-toggle debug-layout`.
