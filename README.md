# Better Calendar Toggle

**Your date menu, rebuilt.** Better Calendar Toggle turns GNOME Shell's date
menu into a set of clean, tabbed pages: calendar and events, notifications, a
music player with synced lyrics, weather and world clocks, and a productivity
page with Pomodoro, stopwatch, timer and tasks.

<img width="400" height="260" alt="Showcase" src="https://github.com/user-attachments/assets/39a34e7d-e9ae-4072-a0de-9cb958f8c71a" />


## Why you might like it

- **One place for your day.** Events, notifications, music, weather and timers
  no longer need separate apps or extensions.
- **It fits your screen.** Pages adapt to the menu size, text scaling and small
  displays instead of clipping or overflowing.
- **It matches your desktop.** Cards and controls follow the Shell theme,
  light/dark mode and your accent colour.
- **Nothing is forced.** Every page can be hidden or reordered, and the layout
  is configurable down to the cover shape and the lyrics provider.

## What is inside

### Calendar & Events

Events and the month calendar share a page. Put the calendar on the left or the
right, and the date header above or below it. Navigation and the “today”
highlight work as you expect.

### Notifications

The page can draw its own notification list so it fills the whole tab, or use
GNOME's stock list. Each notification is a card: hover to highlight it, click
to open it, use the cross to dismiss it, and its action buttons work from the
card. An optional **Do Not Disturb** button can sit in the bottom-left or
bottom-right corner next to **Clear**.

### Media

The cover sits on the left, with the title, artist (or album), seek bar and
controls on the right. Long titles scroll instead of being cut off, and the
title updates as soon as you switch players.

- **Shuffle and repeat** appear for players that support them. The active state
  is an accent-coloured fill; repeat cycles off, repeat-all and repeat-one,
  with a single-track icon for repeat-one.
- **Open the playing app** by clicking the cover. Choose single click, double
  click, right click or middle click (default: double click). On a touch
  screen, a tap opens it.
- **Switch players** by swiping left/right on the card or scrolling over it.
- **Synced lyrics** sit beside the player. Lyrics come from local `.lrc` files,
  LRCLIB, NetEase or BetterLyrics, with optional translation and romanization
  lines.

### Weather & Clocks

Detailed weather for the city configured in GNOME Weather is on the left;
click it to open GNOME Weather. The alarms card stays at the top and the world
clock card at the bottom, so the page does not jump around when either is
empty.

- **Alarms** are shared with GNOME Clocks when it is installed, or kept inside
  the extension. A ringing alarm shows a notification with **Snooze** and
  **Stop**; stopping it from the alarm card dismisses the notification too.
- **World clocks** come from GNOME Clocks and can be scrolled or swiped
  through.
- Weather and clock cards keep a stable height and show a placeholder when
  there is no data.

### Productivity

Pomodoro, stopwatch, timer and tasks share one page.

- **Pomodoro:** configurable focus, short-break and long-break lengths, and a
  configurable number of sessions before a long break.
- **Stopwatch:** lap support.
- **Timer:** quick ±1 and ±5 minute adjustments. A running or paused timer is
  mirrored into GNOME Clocks as a stopped timer.
- **Tasks:** hover a row for edit and pin buttons. Edit changes the text in
  place and Enter saves; pin moves the task to the top.
- Pomodoro, stopwatch, timer and task state survive closing the menu and
  restarting the extension.

## Install

### From the release ZIP (recommended)

1. Download the ZIP from the [latest release](https://github.com/Lurima12/better-calendar-toggle/releases/latest).
2. Install and enable it:

   ```bash
   gnome-extensions install --force \
       better-calendar-toggle@lurim412.shell-extension.zip
   gnome-extensions enable better-calendar-toggle@lurim412
   ```

3. **On Wayland, log out and back in.** GNOME Shell caches extension code and
   only loads the new version on a fresh session. On X11, <kbd>Alt</kbd>+<kbd>F2</kbd>
   then `r` is enough.

### From source with git clone

Use this to follow `main` or to build the archive yourself:

```bash
git clone https://github.com/Lurima12/better-calendar-toggle.git
cd better-calendar-toggle

make check      # validate the GSettings schema
make pack       # build dist/better-calendar-toggle@lurim412.shell-extension.zip
make install    # copy it into ~/.local/share/gnome-shell/extensions
gnome-extensions enable better-calendar-toggle@lurim412
```

You need `git`, `make`, `glib-compile-schemas` and `gnome-extensions`; all are
part of a standard GNOME desktop. On Wayland, log out and back in afterwards.
The same commands appear in the [contributor notes](#for-contributors).

Open the date menu from the top panel and use the tabs. If the extension does
not appear, see [Troubleshooting](#troubleshooting).

### What you need

- **GNOME Shell 50** (tested on 50.1).
- **GNOME Weather** for the weather card and the panel weather indicator.
- **GNOME Clocks** for shared alarms, world clocks and timer mirroring. These
  features simply hide or degrade when Clocks is not installed.

No extra packages, daemons or accounts are required.

## Make it yours

Open the preferences from the Extensions app, or run:

```bash
gnome-extensions prefs better-calendar-toggle@lurim412
```

The most useful settings:

- **Pages and order:** show only the pages you use and arrange the tab order.
- **Size:** automatic, or a fixed width and height in pixels.
- **Page on open:** a specific page, or the last one you used.
- **Tab labels:** automatic (text only on the active tab on small screens),
  always, or icons only.
- **Animations:** page, player, alarm and notification transitions.
- **Notifications:** your own list or GNOME's, the Do Not Disturb corner, and
  the scroll bar.
- **Media:** cover size and shape, button size, seek bar, artist instead of
  album, the cover gesture and title scrolling.
- **Lyrics:** default view, provider, number of lines, text sizes and opacity,
  translation and romanization.
- **Alarms:** store them in GNOME Clocks or the extension, choose whether the
  extension rings Clocks alarms, and set the snooze length.
- **Pomodoro, stopwatch and timer:** focus and break lengths, sessions before a
  long break, and notifications or sound when a phase ends.
- **Panel:** a custom clock format, and the weather icon and/or temperature
  inside the panel clock.

## Look and feel

The pages are drawn as cards on top of the date menu, using colours from the
Shell theme rather than a fixed palette. Cards, tiles, tabs and buttons keep a
subtle border and clear hover, active and checked states in both light and dark
mode, and shuffle/repeat follow the accent colour you chose in GNOME Settings.
Sizes are in `em`, so the layout follows your text scaling.

## Privacy

- Weather comes from the location you configured in GNOME Weather.
- Lyrics providers receive only the track title, artist, album and duration.
  The **local** provider never goes online.
- The extension has no analytics, telemetry or accounts.

## Troubleshooting

- **The extension does not appear:** confirm the UUID is
  `better-calendar-toggle@lurim412`, the schema is compiled, and you are on
  GNOME Shell 50. Check the journal:

  ```bash
  journalctl --user -b -o cat /usr/bin/gnome-shell
  ```

- **The menu is untouched:** the extension leaves the stock date menu alone if
  it cannot recognise its private layout. This is expected on unsupported
  Shell versions.
- **Alarms ring twice:** GNOME Clocks rings its own alarms. Leave “Ring GNOME
  Clocks alarms from the extension” off unless Clocks does not ring them.
- **A new build does nothing:** on Wayland, log out and back in. The running
  Shell keeps the old code in memory.
- **Notifications do not line up:** turn on the layout log, open the
  Notifications tab, and read the sizes from the journal:

  ```bash
  gsettings set org.gnome.shell.extensions.better-calendar-toggle debug-layout true
  journalctl --user -b -o cat /usr/bin/gnome-shell | grep -A 40 "Better Calendar Toggle layout"
  gsettings reset org.gnome.shell.extensions.better-calendar-toggle debug-layout
  ```

## For contributors

The extension is modular GJS: `extension.js` starts it, and `src/` holds the
models, services, page views and utilities. Start with
[From source with git clone](#from-source-with-git-clone); `make clean` removes
`dist/` and the compiled schema when you are done.

Release notes live in [`docs/CHANGELOG.md`](docs/CHANGELOG.md), and the
architecture, conventions and verification history are in
[`docs/PROGRESS.md`](docs/PROGRESS.md).

## License

GPL-2.0-or-later. See [`docs/COPYING`](docs/COPYING).
