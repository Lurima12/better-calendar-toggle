// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {fadeIn} from '../util/animation.js';
import {ScrollStepper} from '../util/scrollStep.js';

// Tasks shown at once; more tasks are spread over pages.
const TASKS_PER_PAGE = 5;
// Horizontal drag distance (in CSS px) that counts as a swipe.
const SWIPE_DISTANCE = 40;

// The task list card of the Misc page: a title with how many tasks are done, a
// field to add a task, the tasks (tick one to mark it done, the cross removes
// it) and a button that clears the done ones. Up to five tasks are shown at
// once; with more tasks, dots below the list and a swipe or the mouse wheel
// move to the next page.
export class TodoView {
    constructor(model, text) {
        this._model = model;
        this._text = text;
        this._known = new Set();
        this._rendered = false;
        this._page = 0;
        this._revealLast = false;
        this._editing = false;
        this._editEntry = null;
        this._cancelEdit = null;
        this._editVersion = 0;
        this._scroller = new ScrollStepper();
        this._pressX = null;
        this._dots = [];
        this._dotsCount = -1;

        this.actor = new St.BoxLayout({
            style_class: 'bct-todo-card',
            vertical: true,
            x_expand: true,
            reactive: true,
        });
        this.actor.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.actor.connect('event', (_actor, event) => this._onEvent(event));

        // Title and progress
        const header = new St.BoxLayout({style_class: 'bct-todo-header'});
        header.add_child(new St.Label({
            text: text.title,
            style_class: 'bct-card-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._count = new St.Label({
            style_class: 'bct-todo-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._count);

        // Field to add a task (Enter or the plus button)
        this._entry = new St.Entry({
            style_class: 'bct-todo-entry',
            hint_text: text.hint,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._entry.clutter_text.connect('activate', () => this._add());
        const addButton = new St.Button({
            style_class: 'bct-todo-add button',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: text.add,
            child: new St.Icon({icon_name: 'list-add-symbolic', style_class: 'popup-menu-icon'}),
        });
        addButton.connect('clicked', () => this._add());
        const entryRow = new St.BoxLayout({style_class: 'bct-todo-entry-row'});
        entryRow.add_child(this._entry);
        entryRow.add_child(addButton);

        // The tasks, one page of five at a time; the next pages are reached
        // by swiping, scrolling or clicking a dot.
        this._list = new St.BoxLayout({
            style_class: 'bct-todo-list',
            vertical: true,
            x_expand: true,
        });

        // One dot per page, shown when there is more than one.
        this._dotsBox = new St.BoxLayout({
            style_class: 'bct-media-dots',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        this._empty = new St.Label({
            text: text.empty,
            style_class: 'bct-todo-empty',
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._clearButton = new St.Button({
            style_class: 'bct-todo-clear button',
            label: text.clearDone,
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
        });
        this._clearButton.connect('clicked', () => this._model.clearDone());

        this.actor.add_child(header);
        this.actor.add_child(entryRow);
        this.actor.add_child(this._list);
        this.actor.add_child(this._dotsBox);
        this.actor.add_child(this._empty);
        this.actor.add_child(this._clearButton);

        this._changedId = this._model.connect('changed', () => this._render());

        // Closing the menu unmaps the card, and an edit cannot survive that.
        this.actor.connect('notify::mapped', () => {
            if (!this.actor.mapped)
                this._cancelEdit?.();
        });

        this._render();
    }

    // The actor itself is destroyed together with its parent container.
    destroy() {
        if (this._changedId)
            this._model.disconnect(this._changedId);
        this._changedId = 0;
        this._editVersion++;
    }

    _add() {
        if (this._model.add(this._entry.get_text())) {
            // A new task is added to the end; show the page it landed on.
            this._revealLast = true;
            this._entry.set_text('');
        }
    }

    _pageCount() {
        return Math.max(1, Math.ceil(this._model.tasks.length / TASKS_PER_PAGE));
    }

    // Moves to the previous or next page; stops at the ends (no looping).
    _move(step) {
        const next = this._page + step;
        if (this._pageCount() < 2 || next < 0 || next >= this._pageCount())
            return;
        this._page = next;
        this._render(step);
    }

    _select(index) {
        if (index === this._page)
            return;
        const step = index > this._page ? 1 : -1;
        this._page = index;
        this._render(step);
    }

    _onScroll(event) {
        if (this._pageCount() < 2)
            return Clutter.EVENT_PROPAGATE;

        // One page per scroll gesture, so the others are not skipped.
        const step = this._scroller.read(event);
        if (step === null)
            return Clutter.EVENT_PROPAGATE;
        if (step !== 0)
            this._move(step);
        return Clutter.EVENT_STOP;
    }

    // Swipe left or right to change the page; taps are left completely
    // alone, so the check and cross buttons and the field keep working.
    _onEvent(event) {
        switch (event.type()) {
        case Clutter.EventType.BUTTON_PRESS:
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                break;
            // fall through
        case Clutter.EventType.TOUCH_BEGIN:
            [this._pressX] = event.get_coords();
            break;
        case Clutter.EventType.BUTTON_RELEASE:
        case Clutter.EventType.TOUCH_END: {
            if (this._pressX === null)
                break;
            const [x] = event.get_coords();
            const distance = (x - this._pressX) / this._scale();
            this._pressX = null;

            if (Math.abs(distance) >= SWIPE_DISTANCE)
                this._move(distance < 0 ? 1 : -1);
            break;
        }
        case Clutter.EventType.TOUCH_CANCEL:
        case Clutter.EventType.LEAVE:
            this._pressX = null;
            break;
        default:
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    }

    _syncDots(count) {
        if (count !== this._dotsCount) {
            this._dotsCount = count;
            this._dotsBox.destroy_all_children();
            this._dots = [];
            for (let i = 0; i < count; i++) {
                const dot = new St.Button({
                    style_class: 'bct-media-dot',
                    can_focus: true,
                    accessible_name: `${this._text.title} ${i + 1}`,
                });
                dot.connect('clicked', () => this._select(i));
                this._dotsBox.add_child(dot);
                this._dots.push(dot);
            }
        }

        this._dots.forEach((dot, index) => {
            if (index === this._page)
                dot.add_style_class_name('bct-media-dot-active');
            else
                dot.remove_style_class_name('bct-media-dot-active');
        });
    }

    // direction (-1 or 1) slides the page in from that side.
    _render(direction = 0) {
        // The rows are rebuilt below, so any in-place edit is over and its
        // pending callbacks must not touch the old actors.
        this._editing = false;
        this._editVersion++;
        const tasks = this._model.tasks;
        const done = tasks.filter(task => task.done).length;

        this._count.text = tasks.length > 0 ? `${done}/${tasks.length}` : '';
        this._list.visible = tasks.length > 0;
        this._empty.visible = tasks.length === 0;
        this._clearButton.visible = done > 0;

        // A new task is added to the end; show the page it landed on.
        if (this._revealLast) {
            this._page = Math.max(0, Math.ceil(tasks.length / TASKS_PER_PAGE) - 1);
            this._revealLast = false;
        }
        this._page = Math.max(0, Math.min(this._page, this._pageCount() - 1));

        const slice = tasks.slice(
            this._page * TASKS_PER_PAGE, (this._page + 1) * TASKS_PER_PAGE);
        this._list.destroy_all_children();
        for (const task of slice) {
            const row = this._makeRow(task);
            this._list.add_child(row);

            // A task that was just added slides in (the first draw does not animate).
            if (this._rendered && !this._known.has(task.id))
                fadeIn(row, {y: -8});
        }
        this._known = new Set(tasks.map(task => task.id));
        this._rendered = true;

        this._dotsBox.visible = this._pageCount() > 1;
        this._syncDots(this._pageCount());

        if (direction !== 0)
            fadeIn(this._list, {x: direction * 24});
    }

    _makeRow(task) {
        const row = new St.BoxLayout({
            style_class: 'bct-todo-row',
            x_expand: true,
        });

        // A round tick box
        const check = new St.Button({
            style_class: 'bct-todo-check button',
            toggle_mode: true,
            checked: task.done,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: this._text.toggle,
            child: new St.Icon({
                icon_name: 'object-select-symbolic',
                style_class: 'bct-todo-check-icon',
            }),
        });
        check.child.opacity = task.done ? 255 : 0;
        check.connect('clicked', () => this._model.toggle(task.id));

        const label = new St.Label({
            text: task.text,
            style_class: task.done ? 'bct-todo-text bct-todo-done' : 'bct-todo-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.opacity = task.done ? 140 : 255;

        // Pin button (priority) sits left of edit; pinned tasks move to the top.
        // Both row buttons stay hidden until the pointer is over the row.
        const pin = new St.Button({
            style_class: task.pinned
                ? 'bct-todo-pin bct-todo-pin-active button'
                : 'bct-todo-pin button',
            can_focus: false,
            reactive: false,
            opacity: 0,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: this._text.pin,
            child: new St.Icon({icon_name: 'draw-pin-symbolic', style_class: 'popup-menu-icon'}),
        });
        pin.connect('clicked', () => {
            // Jump to the top so the pinned task stays in view.
            this._page = 0;
            this._model.togglePin(task.id);
        });

        // Edit button (replaces delete), right of pin
        const edit = new St.Button({
            style_class: 'bct-todo-edit button',
            can_focus: false,
            reactive: false,
            opacity: 0,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: this._text.edit,
            child: new St.Icon({icon_name: 'document-edit-symbolic', style_class: 'popup-menu-icon'}),
        });
        row.add_child(check);
        row.add_child(label);
        row.add_child(pin);
        row.add_child(edit);

        // The row itself is a button, so a click anywhere on it toggles the
        // task. A click that lands on one of the inner buttons must not toggle
        // it as well, so remember where the press landed; St.Button clicks
        // are not Clutter events, so they cannot be stopped at the source.
        let pressedOnButton = false;

        const rowButton = new St.Button({
            style_class: 'bct-todo-row-click',
            x_expand: true,
            can_focus: true,
            accessible_name: task.text,
            child: row,
        });
        rowButton.connect('clicked', () => {
            if (pressedOnButton) {
                pressedOnButton = false;
                return;
            }
            this._model.toggle(task.id);
        });

        edit.connect('clicked', () => this._startEdit(task, row, label, rowButton));

        // Container for the hover effect. The button lives inside it so the
        // highlight and the click area are the same rectangle. The wrapper
        // tracks the pointer itself: St keeps hover on an ancestor while the
        // pointer is over one of its children, so the buttons do not vanish
        // when the pointer reaches them.
        const rowWrapper = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            reactive: true,
            track_hover: true,
            style_class: 'bct-todo-row-wrapper',
        });
        rowWrapper.add_child(rowButton);

        // The edit and pin buttons are only shown while the pointer is over
        // the row. While hidden they are also not reactive, so a click near
        // the right edge of a row still toggles the task instead of landing
        // on an invisible button.
        const revealButtons = () => {
            const shown = rowWrapper.hover;
            for (const button of [pin, edit]) {
                button.opacity = shown ? 255 : 0;
                button.reactive = shown;
                button.can_focus = shown;
            }
        };
        rowWrapper.connect('notify::hover', revealButtons);
        revealButtons();

        rowWrapper.connect('event', (_actor, event) => {
            if (event.type() === Clutter.EventType.BUTTON_PRESS ||
                event.type() === Clutter.EventType.TOUCH_BEGIN) {
                const source = event.get_source();
                pressedOnButton = Boolean(source) &&
                    (check.contains(source) || edit.contains(source) || pin.contains(source));
            }
            return Clutter.EVENT_PROPAGATE;
        });

        return rowWrapper;
    }

    // Swaps the task label for an entry so the text can be changed in place.
    // Enter saves, Escape or losing focus cancels. The row button is disabled
    // while editing, so clicking into the field cannot toggle the task.
    _startEdit(task, row, label, rowButton) {
        // Only one field is open at a time; editing another task first
        // discards the text that was being typed, like clicking away.
        if (this._editing)
            this._cancelEdit?.();

        // The click may have rebuilt the list (a click that also reached the
        // row button toggles the task), leaving the row and label detached.
        if (label.get_parent() !== row || !row.get_parent())
            return;

        this._editing = true;
        const version = ++this._editVersion;
        rowButton.reactive = false;
        rowButton.can_focus = false;

        const entry = new St.Entry({
            style_class: 'bct-todo-edit-entry',
            text: task.text,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.replace_child(label, entry);

        let finished = false;

        const cleanup = () => {
            if (this._cancelEdit === cancel)
                this._cancelEdit = null;
        };

        const finish = save => {
            if (finished || version !== this._editVersion)
                return;
            finished = true;
            this._editing = false;
            cleanup();

            // A saved change rebuilds the list from the model, so this row and
            // everything in it is replaced; there is nothing left to restore.
            if (save && this._model.edit(task.id, entry.get_text()))
                return;

            rowButton.reactive = true;
            rowButton.can_focus = true;
            if (entry.get_parent() === row) {
                row.replace_child(entry, label);
                entry.destroy();
            }
        };
        const cancel = () => finish(false);
        this._cancelEdit = cancel;

        // Losing the entry (the menu closed, the page was rebuilt) ends the
        // edit as well; without this _editing would stay set and the next
        // click on edit would be ignored.
        this._editEntry = entry;
        entry.connect('destroy', () => {
            if (this._editEntry !== entry)
                return;
            this._editEntry = null;
            this._editing = false;
            this._editVersion++;
            cleanup();
        });

        // The date menu handles Escape itself (its capture handler runs before
        // anything inside the field), so Escape closes the menu and the
        // key-focus-out below discards the edit. Enter is handled by activate.
        entry.clutter_text.connect('activate', () => finish(true));
        entry.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                cancel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        // An St.Entry never keeps key focus itself: on key-focus-in it hands
        // the focus to its inner ClutterText, which emits key-focus-out on the
        // entry. That is not the user leaving the field, so only cancel when
        // the focus really moved outside the entry.
        entry.connect('key-focus-out', () => {
            const focus = global.stage.get_key_focus();
            if (focus && (focus === entry || entry.contains(focus)))
                return;
            cancel();
        });

        entry.grab_key_focus();
        if (entry.get_parent() === row)
            entry.clutter_text.set_selection(0, task.text.length);
    }
}
