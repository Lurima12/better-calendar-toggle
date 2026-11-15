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

Declared for GNOME Shell 45 to 50 (ES module extensions). The extension relies on
the stock date menu's internals and leaves it untouched if the layout is not recognised.

## Install (development)

    mkdir -p ~/.local/share/gnome-shell/extensions
    cp -r better-calendar-toggle@lurim412 ~/.local/share/gnome-shell/extensions/
    glib-compile-schemas ~/.local/share/gnome-shell/extensions/better-calendar-toggle@lurim412/schemas

The second command is only needed if `schemas/gschemas.compiled` is missing.
    gnome-extensions enable better-calendar-toggle@lurim412

On Wayland, log out and back in for a new extension to be picked up.

## Packaging

    gnome-extensions pack better-calendar-toggle@lurim412

## License

GPL-2.0-or-later. Add a copy of the license text as `COPYING` before publishing.

## Troubleshooting

If the notifications do not line up in the Notifications tab, turn on the layout log, open the
tab, and read the sizes from the journal:

    gsettings set org.gnome.shell.extensions.better-calendar-toggle debug-layout true
    journalctl --user -b -o cat /usr/bin/gnome-shell | grep -A 40 "Better Calendar Toggle layout"

Turn it off again with `gsettings reset org.gnome.shell.extensions.better-calendar-toggle debug-layout`.
