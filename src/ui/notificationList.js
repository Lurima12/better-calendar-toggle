// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {fadeIn, fadeOut} from '../util/animation.js';

// The notification list of the Notifications tab, drawn by this extension
// instead of reusing the list of GNOME Shell. GNOME's list has a fixed width
// that cannot be made to fill the tab; this one is laid out by the extension,
// so the cards always span the whole tab with equal margins.
//
// It shows the notifications that GNOME's message tray holds (newest first):
// click a card to open it, the cross dismisses it, action buttons work, and
// Clear dismisses everything. Notifications of the same app are stacked.
export class NotificationList {
    // Needs the message tray API of GNOME Shell; otherwise the stock list is used.
    static isSupported() {
        try {
            const tray = Main.messageTray;
            if (!tray || typeof tray.getSources !== 'function')
                return false;
            return tray.getSources().every(source => Array.isArray(source.notifications));
        } catch (e) {
            return false;
        }
    }

    // onActivate runs after a notification was opened (to close the menu).
    constructor(settings, text, onActivate) {
        this._settings = settings;
        this._text = text;
        this._onActivate = onActivate;

        this._destroyed = false;
        this._renderId = 0;
        this._trayIds = [];
        this._sourceIds = new Map();
        this._watched = new Map();
        this._expandedSources = new Set();
        this._expandedNotifications = new Set();
        this._seen = new Set();
        // Notifications that are dismissed but whose card is still fading out.
        this._fading = new Set();
        this._focusNotification = null;
        this._focusSource = undefined;
        this._settingsIds = [];
        this._notifSettings = null;
        this._notifId = 0;

        this._build();
    }

    start() {
        const tray = Main.messageTray;

        this._trayIds.push(tray.connect('source-added', (_tray, source) => {
            this._watchSource(source);
            this._scheduleRender();
        }));
        this._trayIds.push(tray.connect('source-removed', (_tray, source) => {
            this._unwatchSource(source);
            this._scheduleRender();
        }));
        for (const source of tray.getSources())
            this._watchSource(source);

        this._settingsIds.push(this._settings.connect('changed::show-scrollbar', () => {
            this._scroll.vscrollbar_policy = this._scrollPolicy();
        }));
        this._settingsIds.push(this._settings.connect('changed::notifications-scrollbar', () => {
            this._scroll.vscrollbar_policy = this._scrollPolicy();
        }));

        // Notifications that are already there are not animated.
        for (const notification of this._notifications())
            this._seen.add(notification);

        this._render();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        this._destroyed = true;

        if (this._renderId) {
            GLib.Source.remove(this._renderId);
            this._renderId = 0;
        }

        for (const id of this._trayIds)
            Main.messageTray.disconnect(id);
        this._trayIds = [];

        for (const [source, id] of this._sourceIds) {
            try {
                source.disconnect(id);
            } catch (e) {
                // The source is already gone.
            }
        }
        this._sourceIds.clear();

        for (const [notification, ids] of this._watched) {
            for (const id of ids) {
                try {
                    notification.disconnect(id);
                } catch (e) {
                    // The notification is already gone.
                }
            }
        }
        this._watched.clear();

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._notifSettings && this._notifId)
            this._notifSettings.disconnect(this._notifId);
        this._notifId = 0;
        this._notifSettings = null;
    }

    // Redraws the cards, for example to update the "minutes ago" texts.
    refresh() {
        this._render();
    }

    // ------------------------------------------------------------- layout

    _build() {
        const t = this._text;

        this._list = new St.BoxLayout({
            style_class: 'bct-notification-list',
            vertical: true,
            x_expand: true,
        });
        this._scroll = new St.ScrollView({
            style_class: 'bct-scroll vfade',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: this._scrollPolicy(),
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this._scroll.add_child(this._list);

        const column = new St.BoxLayout({
            style_class: 'bct-notifications-column',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });

        // Clear button, and the optional Do Not Disturb button in a corner.
        this._clearButton = new St.Button({
            style_class: 'bct-notification-clear button',
            label: t.clear,
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clearButton.connect('clicked', () => this._clear());

        const bottom = new St.BoxLayout({style_class: 'bct-notification-controls'});
        if (this._settings.get_boolean('show-dnd-switch')) {
            const [vertical, side] = this._settings.get_string('dnd-position').split('-');
            const dnd = this._makeDndButton();

            if (vertical === 'top') {
                dnd.x_expand = true;
                dnd.x_align = side === 'right' ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
                const top = new St.BoxLayout({style_class: 'bct-notification-controls'});
                top.add_child(dnd);
                column.add_child(top);
                bottom.add_child(this._clearButton);
            } else if (side === 'left') {
                bottom.add_child(dnd);
                bottom.add_child(this._clearButton);
            } else {
                bottom.add_child(this._clearButton);
                bottom.add_child(dnd);
            }
        } else {
            bottom.add_child(this._clearButton);
        }

        column.add_child(this._scroll);
        column.add_child(bottom);

        // "No Notifications", centered on the whole page.
        this._empty = new St.BoxLayout({
            style_class: 'bct-notification-empty',
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });
        this._empty.add_child(new St.Icon({
            icon_name: 'no-notifications-symbolic',
            style_class: 'bct-notification-empty-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._empty.add_child(new St.Label({
            text: t.none,
            style_class: 'bct-notification-empty-label',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        this.actor = new St.Widget({
            style_class: 'bct-notifications-page',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(column);
        this.actor.add_child(this._empty);
    }

    _scrollPolicy() {
        return this._settings.get_boolean('notifications-scrollbar')
            ? St.PolicyType.AUTOMATIC
            : St.PolicyType.EXTERNAL;
    }

    _makeDndButton() {
        this._dndIcon = new St.Icon({
            icon_name: 'preferences-system-notifications-symbolic',
            style_class: 'popup-menu-icon',
        });
        this._dndButton = new St.Button({
            style_class: 'bct-dnd-button button',
            toggle_mode: true,
            can_focus: true,
            accessible_name: this._text.dnd,
            child: this._dndIcon,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._notifSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._dndButton.connect('clicked', () => {
            const showBanners = this._notifSettings.get_boolean('show-banners');
            this._notifSettings.set_boolean('show-banners', !showBanners);
        });
        this._notifId = this._notifSettings.connect('changed::show-banners', () => this._syncDnd());
        this._syncDnd();
        return this._dndButton;
    }

    _syncDnd() {
        const enabled = !this._notifSettings.get_boolean('show-banners');
        this._dndButton.checked = enabled;
        this._dndIcon.icon_name = enabled
            ? 'notifications-disabled-symbolic'
            : 'preferences-system-notifications-symbolic';
    }

    // ------------------------------------------------------------ tracking

    _watchSource(source) {
        if (this._sourceIds.has(source))
            return;

        this._sourceIds.set(source, source.connect('notification-added', (_source, notification) => {
            this._watchNotification(notification);
            this._scheduleRender();
        }));
        for (const notification of source.notifications ?? [])
            this._watchNotification(notification);
    }

    _unwatchSource(source) {
        const id = this._sourceIds.get(source);
        if (id === undefined)
            return;
        try {
            source.disconnect(id);
        } catch (e) {
            // The source is already gone.
        }
        this._sourceIds.delete(source);
    }

    _watchNotification(notification) {
        if (this._watched.has(notification))
            return;

        const ids = [notification.connect('destroy', () => {
            this._watched.delete(notification);
            this._seen.delete(notification);
            this._expandedNotifications.delete(notification);
            // A fading card is removed when its fade is over.
            if (!this._fading.has(notification))
                this._scheduleRender();
        })];
        try {
            ids.push(notification.connect('updated', () => this._scheduleRender()));
        } catch (e) {
            // This version of GNOME Shell has no such signal.
        }
        this._watched.set(notification, ids);
    }

    _notifications() {
        const found = [];
        for (const source of Main.messageTray.getSources()) {
            for (const notification of source.notifications ?? []) {
                if (!notification.isTransient)
                    found.push(notification);
            }
        }
        return found.sort((a, b) => (b.datetime?.to_unix() ?? 0) - (a.datetime?.to_unix() ?? 0));
    }

    // Everything is dismissed at once; only the look (the list fading out)
    // takes a moment. Waiting for the fade first could lose the dismissal if
    // the list were redrawn meanwhile.
    _clear() {
        const notifications = this._notifications();
        for (const notification of notifications)
            this._fading.add(notification);

        this._fadeWithFinalize(this._list, () => {
            for (const notification of notifications)
                this._fading.delete(notification);
            this._scheduleRender();
        }, {y: -8, duration: 140});

        for (const notification of notifications)
            this._dismiss(notification);
    }

    _dismiss(notification) {
        notification.destroy(MessageTray.NotificationDestroyedReason?.DISMISSED);
    }

    // Dismisses one notification at once, while its card fades out.
    _dismissCard(card, notification, button) {
        button.reactive = false;
        this._fading.add(notification);
        this._fadeWithFinalize(card, () => {
            this._fading.delete(notification);
            this._scheduleRender();
        }, {x: 40});
        this._dismiss(notification);
    }

    // Runs a fade-out whose bookkeeping also happens when the fade itself
    // never completes: a redraw while fading destroys the actor, and with it
    // the fade's onComplete (it removes the notification from the `_fading`
    // bookkeeping and repaints the list). Both paths are idempotent.
    _fadeWithFinalize(actor, onDone, options) {
        actor.connect('destroy', onDone);
        fadeOut(actor, onDone, options);
    }

    // ----------------------------------------------------------- rendering

    _scheduleRender() {
        if (this._renderId || this._destroyed)
            return;
        this._renderId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._renderId = 0;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _render() {
        if (this._destroyed)
            return;

        // Undo the fade of a Clear that was just done.
        this._list.remove_all_transitions();
        this._list.opacity = 255;
        this._list.translation_x = 0;
        this._list.translation_y = 0;

        const notifications = this._notifications();
        const groups = this._groups(notifications);

        // Forget the expanded state of apps that no longer have a stack.
        const stacked = new Set(groups.filter(group => group.notifications.length > 1)
            .map(group => group.source));
        for (const source of [...this._expandedSources]) {
            if (!stacked.has(source))
                this._expandedSources.delete(source);
        }

        // One card for an app with a single notification; a stack for an app
        // with several (expandable to all of them).
        this._list.destroy_all_children();
        for (const group of groups) {
            if (group.notifications.length === 1)
                this._list.add_child(this._makeCard(group.notifications[0]));
            else if (this._expandedSources.has(group.source))
                this._list.add_child(this._makeExpandedGroup(group));
            else
                this._list.add_child(this._makeStack(group));
        }

        this._empty.visible = notifications.length === 0;
        this._clearButton.reactive = notifications.length > 0;
        this._clearButton.can_focus = notifications.length > 0;
        this._clearButton.opacity = notifications.length > 0 ? 255 : 100;
    }

    // The notifications of each app, newest first; the apps are ordered by
    // their newest notification.
    _groups(notifications) {
        const groups = new Map();
        for (const notification of notifications) {
            const source = notification.source ?? null;
            if (!groups.has(source))
                groups.set(source, []);
            groups.get(source).push(notification);
        }
        return [...groups.entries()].map(([source, list]) => ({source, notifications: list}));
    }

    // A round icon button that does not stretch in its row.
    _makeIconButton(iconName, accessibleName, onClicked) {
        const button = new St.Button({
            style_class: 'bct-notification-close button',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: accessibleName,
            child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
        });
        button.connect('clicked', onClicked);
        return button;
    }

    // Several notifications of one app: the newest on top, with the others
    // stacked behind it. Clicking the stack shows them all.
    _makeStack(group) {
        const t = this._text;
        const stack = new St.BoxLayout({
            style_class: 'bct-notification-stack',
            vertical: true,
            x_expand: true,
        });
        stack.add_child(this._makeCard(group.notifications[0]));

        const edges = new St.BoxLayout({
            style_class: 'bct-notification-edges',
            vertical: true,
            x_expand: true,
        });
        edges.add_child(new St.Widget({
            style_class: 'bct-notification-edge bct-notification-edge-1',
            x_expand: true,
        }));
        edges.add_child(new St.Widget({
            style_class: 'bct-notification-edge bct-notification-edge-2',
            x_expand: true,
        }));
        edges.add_child(new St.Label({
            text: t.more.replace('%d', group.notifications.length - 1),
            style_class: 'bct-notification-more',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const button = new St.Button({
            style_class: 'bct-notification-stack-button',
            can_focus: true,
            x_expand: true,
            accessible_name: t.expandGroup,
            child: edges,
        });
        button.connect('clicked', () => {
            this._expandedSources.add(group.source);
            this._focusSource = group.source;
            this._render();
        });
        stack.add_child(button);
        return stack;
    }

    // A stack that was opened: a header with the app name, a button that
    // closes the stack again and one that dismisses them all, then every card.
    _makeExpandedGroup(group) {
        const t = this._text;
        const box = new St.BoxLayout({
            style_class: 'bct-notification-group',
            vertical: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({style_class: 'bct-notification-group-header'});
        header.add_child(new St.Label({
            text: group.source?.title ?? '',
            style_class: 'bct-notification-group-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(this._makeIconButton('view-restore-symbolic', t.collapseGroup, () => {
            this._expandedSources.delete(group.source);
            this._render();
        }));
        header.add_child(this._makeIconButton('window-close-symbolic', t.closeGroup, () => {
            for (const notification of group.notifications)
                this._dismiss(notification);
        }));
        box.add_child(header);

        for (const notification of group.notifications)
            box.add_child(this._makeCard(notification));

        if (this._focusSource === group.source) {
            this._focusSource = undefined;
            fadeIn(box, {y: -6});
        }
        return box;
    }

    _makeCard(notification) {
        const t = this._text;
        const expanded = this._expandedNotifications.has(notification);
        const bodyText = notification.body ?? '';

        const actions = Array.isArray(notification.actions) ? notification.actions : [];
        const usable = actions.filter(action => action && action.label &&
            typeof action.callback === 'function');
        const hasMore = bodyText !== '' || usable.length > 0;

        const card = new St.Button({
            style_class: 'bct-notification',
            x_expand: true,
            can_focus: true,
            accessible_name: notification.title ?? notification.source?.title ?? '',
        });

        // The inner box holds all the card content
        const inner = new St.BoxLayout({
            style_class: 'bct-notification-inner',
            vertical: true,
            x_expand: true,
        });

        // Header: app, time, the expand button and the dismiss button
        const header = new St.BoxLayout({style_class: 'bct-notification-header'});
        header.add_child(new St.Label({
            text: notification.source?.title ?? '',
            style_class: 'bct-notification-app',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            text: this._ago(notification.datetime),
            style_class: 'bct-notification-time',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (hasMore) {
            header.add_child(this._makeIconButton(
                expanded ? 'pan-up-symbolic' : 'pan-down-symbolic',
                expanded ? t.collapse : t.expand,
                () => {
                    if (expanded)
                        this._expandedNotifications.delete(notification);
                    else
                        this._expandedNotifications.add(notification);
                    this._focusNotification = notification;
                    this._render();
                }));
        }
        header.add_child(this._makeIconButton('window-close-symbolic', t.close,
            button => this._dismissCard(card, notification, button)));

        // Content: icon, title and body
        const icon = new St.Icon({
            style_class: 'bct-notification-icon',
            y_align: Clutter.ActorAlign.START,
        });
        const gicon = notification.gicon ?? notification.source?.icon ?? null;
        if (gicon)
            icon.gicon = gicon;
        else
            icon.icon_name = 'dialog-information-symbolic';

        const title = new St.Label({
            text: notification.title ?? '',
            style_class: 'bct-notification-title',
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const body = new St.Label({style_class: 'bct-notification-body'});
        body.clutter_text.line_wrap = expanded;
        body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        body.clutter_text.ellipsize = expanded
            ? Pango.EllipsizeMode.NONE
            : Pango.EllipsizeMode.END;
        if (notification.useBodyMarkup)
            body.clutter_text.set_markup(Util.fixMarkup(bodyText, true));
        else
            body.text = bodyText;

        const texts = new St.BoxLayout({
            style_class: 'bct-notification-texts',
            vertical: true,
            x_expand: true,
        });
        texts.add_child(title);
        if (bodyText !== '')
            texts.add_child(body);

        const contentBox = new St.BoxLayout({
            style_class: 'bct-notification-content-box',
            x_expand: true,
        });
        contentBox.add_child(icon);
        contentBox.add_child(texts);

        inner.add_child(header);
        inner.add_child(contentBox);

        // Action buttons, shown when the notification is expanded
        if (expanded && usable.length > 0) {
            const row = new St.BoxLayout({style_class: 'bct-notification-actions'});
            for (const action of usable) {
                const button = new St.Button({
                    style_class: 'bct-notification-action button',
                    label: action.label,
                    can_focus: true,
                });
                button.connect('clicked', () => {
                    action.callback();
                    if (!notification.resident)
                        this._dismiss(notification);
                });
                row.add_child(button);
            }
            inner.add_child(row);
        }

        card.child = inner;

        // Swallow clicks on inner buttons so they don't also trigger the card
        this._setupSwallowClick(card, [
            ...(hasMore ? [header.get_last_child()] : []), // expand/collapse button
            header.get_children().find(child => child.style_class?.includes('bct-notification-close')), // close button
            ...(expanded && usable.length > 0 ? inner.get_last_child().get_children() : []), // action buttons
        ]);

        // Store notification reference on the card for later retrieval
        card._notification = notification;

        return card;
    }

    _setupSwallowClick(card, controls) {
        let pressX = 0;
        let pressY = 0;
        let wasOnControl = false;

        card.connect('event', (actor, event) => {
            switch (event.type()) {
            case Clutter.EventType.BUTTON_PRESS:
                if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                    break;
                pressX = event.get_coords().x;
                pressY = event.get_coords().y;
                wasOnControl = controls.some(control => control?.contains(event.get_source()));
                break;
            case Clutter.EventType.BUTTON_RELEASE: {
                const dx = event.get_coords().x - pressX;
                const dy = event.get_coords().y - pressY;
                const distance = Math.hypot(dx, dy);
                const CLICK_TOLERANCE = 5;
                if (wasOnControl || distance > CLICK_TOLERANCE)
                    this._cardSwallow = true;
                else
                    this._cardSwallow = false;
                break;
            }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        card.connect('clicked', () => {
            if (this._cardSwallow) {
                this._cardSwallow = false;
                return;
            }
            const notification = card._notification;
            if (notification)
                notification.activate();
            this._onActivate?.();
        });
    }

    _getNotificationForCard(card) {
        return card._notification;
    }

    _ago(datetime) {
        if (!datetime)
            return '';

        const t = this._text;
        const seconds = Math.max(0, GLib.DateTime.new_now_local().to_unix() - datetime.to_unix());
        const minutes = Math.floor(seconds / 60);
        if (minutes < 1)
            return t.justNow;
        if (minutes < 60)
            return t.minutesAgo.replace('%d', minutes);
        const hours = Math.floor(minutes / 60);
        if (hours < 24)
            return t.hoursAgo.replace('%d', hours);
        return t.daysAgo.replace('%d', Math.floor(hours / 24));
    }
}
