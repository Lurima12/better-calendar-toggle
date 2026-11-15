// SPDX-License-Identifier: GPL-2.0-or-later

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const MAX_TASKS = 100;
const MAX_LENGTH = 200;

// The task list. A task is {id, text, done}. It is kept in the settings, so it
// survives restarts, and changes made elsewhere show up at once.
export class TodoModel extends Signals.EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._settingsId = 0;
        this._tasks = [];
        this._lastSaved = '';
    }

    start() {
        this._load();
        this._settingsId = this._settings.connect('changed::todos', () => {
            // Ignore the echo of our own save.
            if (this._settings.get_string('todos') === this._lastSaved)
                return;
            this._load();
            this.emit('changed');
        });
    }

    destroy() {
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = 0;
        this.disconnectAll();
    }

    get tasks() {
        return this._tasks.map(task => ({...task}));
    }

    // Adds a task at the end of the list. Returns false when the text is empty
    // or the list is full.
    add(text) {
        const clean = text.trim().slice(0, MAX_LENGTH);
        if (clean === '' || this._tasks.length >= MAX_TASKS)
            return false;

        let id = Date.now();
        while (this._tasks.some(task => task.id === id))
            id++;
        this._tasks.push({id, text: clean, done: false, pinned: false});
        this._changed();
        return true;
    }

    toggle(id) {
        const task = this._tasks.find(candidate => candidate.id === id);
        if (!task)
            return;
        task.done = !task.done;
        this._changed();
    }

    edit(id, newText) {
        const task = this._tasks.find(candidate => candidate.id === id);
        if (!task)
            return;
        const clean = newText.trim().slice(0, MAX_LENGTH);
        if (clean === '')
            return;
        task.text = clean;
        this._changed();
    }

    togglePin(id) {
        const task = this._tasks.find(candidate => candidate.id === id);
        if (!task)
            return;
        task.pinned = !task.pinned;
        this._changed();
    }

    remove(id) {
        this._tasks = this._tasks.filter(task => task.id !== id);
        this._changed();
    }

    clearDone() {
        this._tasks = this._tasks.filter(task => !task.done);
        this._changed();
    }

    _load() {
        let saved = [];
        try {
            saved = JSON.parse(this._settings.get_string('todos'));
        } catch (e) {
            saved = [];
        }

        this._tasks = (Array.isArray(saved) ? saved : [])
            .filter(task => task && typeof task.text === 'string' && task.text.trim() !== '')
            .slice(0, MAX_TASKS)
            .map((task, index) => ({
                id: Number.isFinite(task.id) ? task.id : Date.now() + index,
                text: task.text.slice(0, MAX_LENGTH),
                done: task.done === true,
                pinned: task.pinned === true,
            }));
        this._lastSaved = this._settings.get_string('todos');
    }

    _changed() {
        this._lastSaved = JSON.stringify(this._tasks);
        this._settings.set_string('todos', this._lastSaved);
        this.emit('changed');
    }
}
