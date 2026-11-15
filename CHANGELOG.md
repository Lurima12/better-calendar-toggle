# Changelog

Versions go up one minor step per release: 0.1.0, 0.2.0, 0.3.0, ...

## 0.35.0

- Misc: the Stopwatch and Timer cards now have an "Open GNOME Clocks" button
- Misc: while the extension's Timer is running or paused, its remaining time is
  mirrored into GNOME Clocks' timer list as a stopped timer named "Better
  Calendar Toggle". The entry is updated on pause/adjust and removed on reset or
  completion; the user's own timers in Clocks are preserved
- GNOME Clocks cannot reflect live state: its `timers` key stores only
  `{duration, name}` and reloads as a stopped timer, and it has no stored
  stopwatch at all. The stopwatch card can open Clocks, but its running state
  cannot be mirrored
- No other page changed

## 0.34.0

- Notifications: added breathing room between the last notification and the
  Do Not Disturb / Clear buttons, in both the extension's list and the stock one
- Weather & Clocks: the right column is now fixed — Alarms at the top and World
  clocks at the bottom, whatever either card contains
- World clocks: the empty state is now the same card with the "World clocks"
  title and a "No world clocks" line, instead of a separate placeholder that
  moved the alarms around; the stock fallback keeps its placeholder below the
  clocks
- No other page changed

## 0.33.0

- Media: the player now has the cover on the left and the title, album (or
  artist), seek bar and playback controls on the right, which uses the tab
  width better on small screens
- Media: the lyrics are now a separate view of the Media tab instead of a
  column beside the player. Two buttons above the player dots switch between
  the player and the lyrics; the choice is remembered, and no lyrics are looked
  up while the player view is shown
- Media: the player dots moved from the card to the page, so the switcher sits
  above them and they keep their position in both views
- No other page changed

## 0.32.0

- Media: cover art no longer decodes and writes images on the shell's main
  thread. The image is read, decoded (downscaled while decoding when it is
  large) and written back asynchronously, so a big or slow cover cannot stall
  the menu or the compositor
- Media: cover processing moved to `src/services/coverArt.js`. The cache key
  still follows the source file's modification time and size, and an image that
  is already square is used as it is (it is never upscaled)
- Media: cached covers now survive a reload instead of being deleted on every
  disable. A bounded, asynchronous sweep keeps the 64 newest entries and runs
  once when the media client starts
- Media: a missing or unreadable cover still falls back to the original path,
  and pending work is cancelled with the player
- Grayscale covers are measured correctly instead of reading past their pixel
  data
- No user-facing feature changed

## 0.31.0

- GNOME 50 cleanup: removed the stock-media reparent code and the `_sectionList`
  layout adjustment. GNOME 50's date menu has no media section (media lives in
  Quick Settings), and its notification list is a `CalendarMessageList` with a
  `MessageView`, so both paths were dead code
- Media: removed the temporary per-click diagnostic log trail; a player whose app
  cannot be found is still reported once, and real activation failures are still
  logged
- Stability: restoring stock actor properties and visibility in `disable()` is now
  guarded per actor, so one stale actor cannot abort the rest of the cleanup
- Compatibility: the declared `shell-version` is now 50 only, the version tested
  here; earlier versions can be added back once tested
- No user-facing feature changed

## 0.30.0

- Packaging: the archive now includes `src/`, `README.md`, `CHANGELOG.md` and
  `COPYING`. A plain `gnome-extensions pack` left the modules out, so an
  installed copy could not load; `make pack` builds the complete archive and
  fails if `src/` is absent
- Build: `make check`, `make compile`, `make pack`, `make install`, `make enable`
  and `make clean` wrap schema validation, compilation, packaging and
  installation
- Metadata: added the integer `version` (30) used by extensions.gnome.org and
  the review tools, and updated the version name to 0.30.0
- Repository: the extension now lives in its own Git repository, with a
  `.gitignore` for generated files (compiled schemas, packages) and a `COPYING`
  licence file
- No user-facing behaviour changed

## 0.29.0

- Alarms: the card gets a little more room on its left and right sides (wider padding and a
  base width), so the time, the days and the buttons are not pressed against the edges
- Media: the app behind the cover is now also found when it is already running without an
  indexed desktop file (players installed as Flatpaks, like Semitone, Mixtapes or Red, whose
  real desktop file ids were verified against this system), and an app that cannot be raised
  is reported instead of failing quietly
- Media: the cover click carries a paper trail — every attempt at finding and opening the
  player's app is noted in the journal, so a cover that stays silent can be traced from the
  outside; these notes are a temporary aid for the open issue and will be quieted once the
  cause is confirmed

## 0.28.0

- Dots: the page dots below the alarms, the world clocks and the tasks are clickable again
  (they stopped reacting when the pages were added, because the cards were marking touches of
  the taps as handled, which cancels the clicks of the buttons inside; only the dots of the
  media player worked). Tapping a dot now moves to its page, and no longer also opens GNOME
  Clocks or toggles anything else
- Alarms: a plain tap on the card opens GNOME Clocks again, and a tap on the big time really
  opens the alarm editor; the switch, the edit button, the add button and the Stop/Snooze
  banner keep their own actions without opening GNOME Clocks with them
- Cards: no card swallows touches anymore, which was also why ticking a task and flipping an
  alarm's switch had stopped working in earlier releases

## 0.27.0

- Weather & Clocks: the right column (alarms above the world clocks) is only as wide as these
  cards need, so the alarm card no longer has large empty sides, and both cards on the right
  keep their sides together; the weather card, which has more content, uses the rest of the
  space (this replaces the centered narrow card of the last release, which broke the alignment)
- Tasks: ticking a task works again (the paging change of the last release accidentally cut
  the clicks of the row buttons off; taps are now left untouched and only a proper swipe pages)
- Media: the app of the media is now also guessed from the player's own name and from the end
  of its bus name (media played behind a relay daemon is known under the daemon's name), and an
  app found in the system's desktop files is started even when the shell did not index it; when
  nothing can be opened, a notification says so (and for which player), instead of failing
  silently

## 0.26.0

- Media: clicking the cover now really brings up the app that plays the media. The app is
  activated directly in the shell, which raises its window or starts it when it was not
  running; players that quit telling which app they belong to are asked to raise themselves
  over D-Bus, and without any app to open the log says so instead of doing nothing
- Alarms: clicking anywhere on the card opens GNOME Clocks (before, only its title and
  edges did); the switch, the edit button, the time and the dots keep their own actions
- Alarms: the card keeps to the width of its content and sits centered, so the large empty
  sides are gone
- Alarms: the "GNOME Clocks" label sits in the middle of the header, between the title and
  the add button
- World clocks: up to three clocks are shown; with more cities, dots appear below the card
  and the next cities are reached with a sideways swipe or the mouse wheel, one page of
  three at a time
- Tasks: up to five tasks are shown at once; with more tasks the list is paged the same
  way, with dots underneath (adding a task jumps to the page it was added to)

## 0.25.0

- Media: the seek bar no longer stops working with players that report a track ID that is not a
  D-Bus object path (for example Spotify or some VLC setups); those fall back to a relative seek
  instead of failing, and a possible failure to seek is only noted in the log
- Lyrics: search results of LRCLIB that report no track length are no longer discarded by the
  duration matching (they were treated as very far away), so a result that could not say how long
  the track is can still be used
- Notifications: the bookkeeping of a fade-out (the cross on a card, or Clear) now also runs when
  a redraw destroys the card while its fade-out was still running, so a dismissed notification
  cannot stay behind internally forever
- Alarms: saving an edit no longer turns the alarm on; alarms that are off stay off after they
  were changed (new alarms still start on). The switch in the card turns an alarm on and off
- Stability: when a part of the extension fails to start, cleaning it up can also fail; that
  cleanup error no longer stops the remaining parts from starting

## 0.24.0

- Misc: a task list (Tasks) above the Pomodoro, the stopwatch and the timer: type a task and press
  Enter or the plus button, tick one to mark it done, the cross removes it, and Clear done removes
  the finished ones. The tasks are kept between sessions.
- Weather & Clocks: the Alarms card opens GNOME Clocks when you click it (its title and edges; the
  buttons, the time and the editor keep their own actions)
- Media: clicking the cover opens the app that plays the media (it brings its window to the front,
  or starts the app). Clicking the cover no longer goes to the next player; use the dots, a swipe or
  the scroll wheel for that.

## 0.23.0

- The tabs scroll: with the mouse wheel or a touchpad over the tab bar you move to the previous or
  next tab, and when the tabs do not all fit the bar scrolls sideways to keep the active tab in view
- Small animations: a page slides in when you change tab, the media player and the alarms slide in
  when you change player or alarm, a lyric line brightens when it becomes current, and
  notifications slide in, fade out when dismissed, and fade their text in when expanded. They stop
  when GNOME animations are off, and a new Animations setting turns them off here too.
- A gap between the playback buttons and the Lyrics button
- Padding on the left, right and bottom of the notification area, so the buttons at the bottom no
  longer touch the edge
- Code review: dismissing a notification, or Clear, could be lost if the list was redrawn while
  its fade-out ran (it is now dismissed at once and only the look fades); the tab scrolled into
  view could be a stale one; removed an unused style rule and noisy log lines; fixed an outdated
  comment

## 0.22.0

- Notifications are stacked like in GNOME: several notifications of the same app become one
  stack (the newest on top, the others peeking out behind it); click the stack to show all of them,
  with a header that has a button to close the stack again and one to dismiss them all
- Every notification has a button to show more or less of it: collapsed it shows one shortened
  line of text, expanded it shows all of the text and the action buttons
- Round buttons are perfectly round: in the Misc and Media tabs, the Do Not Disturb button and the
  notification buttons. They were stretched into tall ovals by the row they sit in.

## 0.21.0

- More lyrics providers: NetEase Cloud Music and BetterLyrics join the local .lrc files and
  LRCLIB. In Automatic, each one is asked only when the ones before it found nothing or could not
  be reached, so LRCLIB trouble no longer means no lyrics; any single provider can be chosen too.
  NetEase and BetterLyrics are unofficial services, and BetterLyrics is read on a best-effort basis.
- Romanization and translation: when a provider has them (NetEase does for many tracks, and
  BetterLyrics may), buttons at the bottom right of the lyrics area show them as small lines under
  the current lyric line
- The lyrics area is wider (23 em)
- The marker for a gap between lyric lines is now three dots instead of a note symbol

## 0.20.0

- Tabs renamed: Calendar & Events, Weather & Clocks
- Preferences simplified: removed the options for scrolling long titles, showing lyrics (use the
  Lyrics button), the lyric line weights (highlighted is bold, the others normal), the album line
  (always shown, with the artist when there is no album) and the weather location (always the
  first city saved in GNOME Weather)
- Preferences: the container size has an Automatic or Fixed choice for the width and for the
  height, and the fixed value goes up in steps of 50; the label of the weather tab in the page
  list was missing because of the "&" in its name, now fixed
- Media: the title stays centered, vertically too, when you move between players
- Alarms: the GNOME Clocks label is centered on the header line, and the card is more compact
  (shorter day buttons and a smaller editor) so it no longer widens the tab
- Notifications: a notification with a lot of text no longer stretches the menu to the edges of
  the screen; in automatic width the page is as wide as the other tabs

## 0.19.0

- Notifications: the list is now drawn by the extension from GNOME's message tray, instead of
  reusing GNOME's own list, whose fixed width left empty space on the right. The cards span the
  whole tab with equal margins; click a card to open it, the cross dismisses it, action buttons
  work, Clear dismisses everything, and "No Notifications" is centered on the tab. It does not
  group notifications by app. A setting switches back to GNOME's own list.
- No line between the calendar and the events, so the Calendar tab looks seamless

## 0.18.0

- Notifications: the list is bound to the width of the tab, the stock scroll bar no longer
  reserves a strip beside the cards, and the card list fills the scroll view; this targets the
  empty space that remained on the right of the notifications
- Developer aid: a hidden setting, debug-layout, writes the widget sizes of the Notifications
  page to the journal, for tracking down layout problems

## 0.17.0

- Notifications: the list now fills the whole width of the tab instead of keeping its stock
  fixed width against the left edge, which left empty space on the right; the notifications are
  centered in the tab and the buttons at the bottom line up with the list

## 0.16.0

- Lyrics: the highlighted line has room for three lines, so none of its words run into the lines
  around it, and the lines are a little further apart again
- The Lyrics button moved to the bottom right of the player, in the same row as the playback
  buttons (the playback buttons stay centered)
- Scrolling: a shorter, more natural pause. One touchpad gesture still moves one page, but a new
  swipe can step again as soon as the fingers lift or after a very short pause; the mouse wheel
  waits a quarter of a second between steps

## 0.15.0

- Media cover: covers that are not square (for example a YouTube thumbnail, which also has black
  bars baked in) are cropped to a centered square, so the cover shape option (rounded, square,
  circle) applies to them too
- The Lyrics button shows only an icon
- No line between the media player and the lyrics, so they read as one seamless area
- The lyrics area is wider (20 em), and the lines that are not highlighted are more compact: one
  line each, closer together, shortened with an ellipsis when too long

## 0.14.0

- The Lyrics button is now in a toolbar at the top of the Media page, so it is always visible
  (before, it sat inside the player card and disappeared when nothing was playing)
- Touchpad scrolling in the media player and the alarms is much slower (about three times the
  distance and a longer pause per page), and a new setting, Scrolling, adjusts the distance
- The Alarms card can use the alarms of GNOME Clocks: it lists, adds, edits, turns on and off, and
  deletes the very same alarms as the Clocks app, and changes made in Clocks show up at once;
  GNOME Clocks keeps ringing them, with an option to ring them from the extension too
- A setting chooses where alarms are kept: automatic (GNOME Clocks when installed), the
  extension only, or GNOME Clocks

## 0.13.0

- Scrolling the media player and the alarms is slower: one scroll gesture (a spin of the mouse
  wheel, or a touchpad swipe with its momentum) moves one page or dot, so none are skipped
- A Lyrics button on the Media page shows or hides the lyrics; they are hidden by default, the
  choice is remembered, and nothing is looked up online while they are hidden

## 0.12.0

- Alarms are now a pager instead of a list: one alarm at a time with a dot for each below it;
  swipe, scroll the mouse wheel or click a dot to move between alarms (it stops at the first and
  last), click the time or the pencil to edit, and the switch turns the alarm on or off
- World & Weather: the weather card, the alarms and the world clocks now have matching heights
  and widths and fill the tab; the alarms and clocks column follows the weather card instead of
  being centered against it, and a long list of cities scrolls inside its card

## 0.11.0

- Notifications: the notification list is no longer modified, which fixes notifications
  disappearing in 0.10.0; the page keeps a minimum height so the empty message has room
- World & Weather: the weather card and the alarms and world clocks column are centered on the
  same horizontal line
- Weather location: by default the first city saved in GNOME Weather (or in the shell) is used
  even when automatic location is on; new setting to use the date menu's location, or a city typed
  in the preferences

## 0.10.0

- Alarms card on the World & Weather page, above the world clocks: add, edit and delete
  alarms, pick repeat days (none means once), switch each on or off, and snooze or stop a
  ringing alarm; alarms ring whether or not the menu is open
- Pomodoro: the medium break is gone; short breaks between focus sessions and a long break at
  the end of the last session of the cycle
- Notifications: the empty-state message is now centered on the whole page, no longer shifted by
  the button row

## 0.9.0

- Lyrics: choose the provider (automatic, LRCLIB only, or local .lrc files only), show 3 to 9
  lines, and set the size, weight and opacity of the highlighted line and of the other lines
- Lyrics area has a fixed size (width and line heights), so long lyrics no longer change the
  size of the menu when the container size is automatic
- Media title is clipped to the card and scrolls when it is too long; short titles are centered
- Notifications: with nothing to show, the "No Notifications" message is centered in the container

## 0.8.0

- The media player is back on its own Media tab; the Notifications tab shows only notifications
- The Media tab is split in two: the player on the left, and a few lines of time-synced lyrics on
  the right (3 or 4 lines, current line highlighted); lyrics can be turned off
- Lyrics come from a .lrc file next to a local audio file, or from LRCLIB (lrclib.net, a free
  community lyrics database); nothing is stored and online lookup can be turned off
- Container size is set by the values themselves: a width or height of 0 is automatic, any other
  value is fixed (the separate switches are gone)

## 0.7.0

- World clocks redesigned as one rounded card: a row per city with a sun or moon icon,
  the city, the day and time difference ("Tomorrow · +5 h"), and a large time; click to open
  GNOME Clocks. It follows the 12 h or 24 h setting and refreshes every minute.
- The weather card and the panel indicator now follow the city chosen in the GNOME Weather
  app (for example a custom city) instead of the location the date menu picked; with automatic
  location, or without GNOME Weather, the date menu's weather is used as before
- Media cover shape (rounded, square, circle) now applies to real cover art too; the cover is
  drawn as a shaped background instead of an icon

## 0.6.0

- World & Weather page: weather on the left, world clocks on the right
- The weather card is clickable (opens GNOME Weather) and shows the chosen city name
- Panel weather indicator: icon and temperature sit closer together
- Pomodoro: minus and plus five minutes around the time, and a medium break
  (short after odd sessions, medium after even ones, long after the last; can be turned off)
- Media player is customizable: cover size, cover shape, playback button size, and
  switches for the seek bar, the album line and title scrolling; it shrinks to fit the container
- Media dots no longer loop: scrolling, swiping and clicking stop at the first and last player
- Notifications page: one separator line between the list and the media player instead of two

## 0.5.0

- New Misc page with Pomodoro, Stopwatch and Timer; they keep running while the menu is closed
- The Media page is gone; the media player now lives only on the Notifications page, centered
  in the space right of the list
- Media: rounded cover, dot indicator above it instead of arrows, click the cover, swipe or scroll
  to change player, seek bar with times above the controls, scrolling title for long names
- World & Weather page shows detailed weather (feels like, humidity, wind, pressure, visibility,
  dew point, sunrise, sunset and a short forecast) when GNOME provides it
- Option to swap the sides of the events and the calendar
- Fixed width and fixed height are now separate switches; whatever is not fixed stays automatic
- Preferences are split into Layout, Content and Panel pages

## 0.4.0

- Compact media player: cover art, title, album (artist when there is no album), playback
  controls; arrows, mouse wheel and touchpad scrolling move left and right between players
- Media is shown on the right of the notifications and on the Media page
- Day, month, date and year can sit above or below the calendar
- Option to hide scroll bars (pages still scroll)
- Weather indicator now lives inside the panel clock, left or right of the time
- Do Not Disturb is a compact icon button, placeable in any corner of the notification list

## 0.3.0

- Panel clock formatter: custom date and time format on the top bar, with live preview
- Weather indicator (icon and temperature) on the top bar, left or right of the date menu;
  click it to open the date menu on the World & Weather page
- Fix: the package now includes the compiled settings schema, so a manual copy no longer
  fails with "gschemas.compiled: No such file or directory"

## 0.2.0

- Preferences window
- Automatic or fixed container width and height (fixed content scrolls)
- Custom tab order, and pages can be turned off
- Optional Do Not Disturb switch on the Notifications page, opposite the Clear button
- Choose the page shown on open (or the last used page)
- Tab labels: automatic, always, or icons only
- The calendar column scrolls when the container is too short or the text is large

## 0.1.0

- Initial release
- Date menu split into Calendar, Notifications, Media and World & Weather pages
- Calendar page: events on the left, calendar on the right
- Small-screen layout (1366x768) and font scaling support
