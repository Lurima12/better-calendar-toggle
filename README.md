# Better Calendar Toggle

A GNOME Shell extension that overhauls the date menu into separate pages.

## Pages

- **Calendar & Events**: events on the left, calendar on the right
- **Notifications**: the notification list, drawn by the extension so it fills the tab (GNOME's own list can be chosen instead)
- **Media**: a compact player; the Lyrics button shows synced lyrics on the right (hidden by default)
- **Weather & Clocks**: detailed weather for the city chosen in GNOME Weather (left, click to open it); on the right an alarms card (one alarm at a time, with dots; shares its alarms with GNOME Clocks) above a world clock card; all cards have matching heights with the cities saved in GNOME Clocks
- **Misc**: Pomodoro, Stopwatch and Timer

A tab bar at the top switches pages. The menu opens on the Calendar page.

## Settings

Open them with `gnome-extensions prefs better-calendar-toggle@lurim412` or from the Extensions app.

- **Pages**: reorder the tabs and turn pages on or off
- **Size**: a width or height of 0 is automatic; any other value is a fixed size
- **Calendar side**: calendar on the right or left of the events
- **Page shown on open**: a specific page, or the last used one
- **Tab labels**: automatic, always, or icons only
- **Calendar & Events**: day, month, date and year above or below the calendar; show or hide scroll bars
- **Do Not Disturb button**: optional, in any corner of the notification list
- **Scrolling**: touchpad distance per page for the media player and the alarms
- **Lyrics**: shown or hidden by default (also the Lyrics button in the player's playback row), provider (automatic, LRCLIB, NetEase, BetterLyrics, local .lrc files), 3 to 9 lines, fonts of the highlighted and other lines
- **Media player**: cover size and shape, playback button size, seek bar, album line, title scrolling
- **Pomodoro, stopwatch and timer**: durations, notifications and sound for the Misc page
- **Panel clock**: custom date and time format for the top bar (GLib format codes)
- **Weather indicator**: icon and temperature inside the panel clock, left or right of the time

## Small screens and font scaling

- Sizes are in `em`, so the layout follows the text scaling factor.
- The menu height and width are capped to the work area (works on 1366x768).
- On small screens only the active tab shows its text label.

## Compatibility

Declared for GNOME Shell 45 to 50 (ES module extensions) and developed on GNOME
Shell 50.1. The extension relies on the stock date menu's internals and leaves it
untouched if the layout is not recognised.

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
