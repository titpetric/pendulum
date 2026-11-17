// The upload queue: the editor's own panel over the files it is carrying,
// one row each, with the name, the size and the bar for every one of them.
//
// A gallery is ten files at once, and ten files at once is ten bars: the
// preview in the document says what happened to the line it stands on, and
// this says what is happening to all of them. It is opened from the upload
// tool, and it stays open while the writer picks more.
//
// The panel stands outside the surface, so this one may hold text: nothing
// here is part of the document. Every row follows the same `upload` events a
// host sees, so a file pasted or dropped shows here too.

import { iconFor, size } from "./preview.js";
import { dismiss, place, tool } from "./util.js";

export class UploadPanel {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.element = null;
		this.rows = new Map();

		editor.on("upload", (event) => this.note(event));
		editor.on("error", (event) => {
			if (event.phase === "upload") {
				this.fail(event);
			}
		});

		dismiss({
			open: () => this.open,
			element: () => this.element,
			close: () => this.close(),
			signal: editor.aborter.signal,
		});
	}

	get open() {
		return Boolean(this.element);
	}

	// toggle opens the queue under the tool that asked for it, and presses it
	// away again.
	toggle(event) {
		if (this.open) {
			this.close();
			return;
		}

		this.show(event);
	}

	show(event) {
		this.build();
		// Whatever is already on its way, including a file that arrived by
		// paste while the panel was shut, is in the list when it opens.
		for (const record of this.editor.uploads?.list() ?? []) {
			this.row(record);
		}

		this.editor.root.appendChild(this.element);
		const box = this.editor.bar?.getBoundingClientRect();
		const at =
			event && Number.isFinite(event.clientX)
				? { clientX: event.clientX, clientY: event.clientY }
				: { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 };
		place(this.element, this.editor.root, at);
	}

	build() {
		if (this.element) {
			return;
		}

		const texts = this.editor.texts;
		const name = (part) => `${this.prefix}__${part}`;

		this.element = document.createElement("div");
		this.element.className = name("queue");
		this.element.setAttribute("role", "dialog");
		this.element.setAttribute("aria-label", texts.uploadQueue);

		const head = document.createElement("div");
		head.className = name("queue-head");

		const title = document.createElement("span");
		title.className = name("queue-title");
		title.textContent = texts.uploadQueue;

		const done = tool({
			prefix: this.prefix,
			key: "queue-done",
			label: texts.done,
			title: texts.done,
			hold: false,
			run: () => this.close(),
		});

		head.append(title, done);

		this.list = document.createElement("div");
		this.list.className = name("queue-list");
		this.list.setAttribute("role", "list");

		this.empty = document.createElement("p");
		this.empty.className = name("queue-empty");
		this.empty.textContent = texts.uploadEmpty;

		const foot = document.createElement("div");
		foot.className = name("queue-foot");
		const choose = tool({
			prefix: this.prefix,
			key: "queue-choose",
			icon: "icon-upload",
			label: texts.uploadChoose,
			// The one action in the panel's foot, and a mark alone would not
			// say which files it means.
			word: true,
			title: texts.uploadChoose,
			hold: false,
			run: () => this.editor.uploads?.open(),
		});
		choose.dataset.primary = "true";
		foot.appendChild(choose);

		this.element.append(head, this.empty, this.list, foot);

		// A press inside the panel is the panel's: the editor behind it keeps
		// its caret where it was.
		this.element.addEventListener("click", (event) => event.stopPropagation());
	}

	// row answers the row for one record, building it the first time a file
	// is seen.
	row(record) {
		const held = this.rows.get(record.id);
		if (held) {
			this.paint(held, record);
			return held;
		}

		const name = (part) => `${this.prefix}__${part}`;
		const element = document.createElement("div");
		element.className = name("queue-row");
		element.dataset.id = String(record.id);
		element.setAttribute("role", "listitem");

		const icon = document.createElement("span");
		icon.className = `icon ${iconFor(record.file)} ${name("queue-icon")}`;
		icon.setAttribute("aria-hidden", "true");

		const text = document.createElement("span");
		text.className = name("queue-text");

		const title = document.createElement("span");
		title.className = name("queue-name");
		title.textContent = record.name;

		const weight = document.createElement("span");
		weight.className = name("queue-size");
		weight.textContent = size(record.file?.size ?? 0);

		text.append(title, weight);

		const bar = document.createElement("span");
		bar.className = name("queue-bar");
		bar.setAttribute("role", "progressbar");
		bar.setAttribute("aria-valuemin", "0");
		bar.setAttribute("aria-valuemax", "100");
		const fill = document.createElement("span");
		fill.className = name("queue-fill");
		bar.appendChild(fill);

		const state = document.createElement("span");
		state.className = name("queue-state");

		const action = document.createElement("button");
		action.type = "button";
		action.className = `${name("queue-action")} ${name("tool")}`;

		element.append(icon, text, bar, state, action);
		this.list.appendChild(element);

		const held_ = { element, title, weight, bar, fill, state, action, record };
		this.rows.set(record.id, held_);
		this.paint(held_, record);

		return held_;
	}

	// paint puts one file's state on its row: the bar, the word, and the one
	// button the state has - try again when it failed, put it away when it
	// landed.
	paint(row, record) {
		const texts = this.editor.texts;
		const ratio = record.total > 0 ? Math.min(Math.max(record.loaded / record.total, 0), 1) : 0;

		row.record = record;
		row.element.dataset.state = record.state;
		row.title.textContent = record.name;
		row.weight.textContent = size(record.file?.size ?? 0);

		// A file that landed is all the way across, whether the request
		// counted its bytes or not; anything else with no count is still
		// moving, and the bar says so with a band that slides.
		if (record.state === "done") {
			row.element.dataset.known = "true";
			row.bar.setAttribute("aria-valuenow", "100");
			row.fill.style.width = "100%";
		} else if (record.total > 0) {
			row.element.dataset.known = "true";
			row.bar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
			row.fill.style.width = `${Math.round(ratio * 100)}%`;
		} else {
			row.element.dataset.known = "false";
			row.bar.removeAttribute("aria-valuenow");
			row.fill.style.width = "";
		}

		row.state.dataset.state = record.state;
		if (record.state === "failed") {
			row.state.textContent = record.error || texts.uploadFailed;
		} else if (record.state === "done") {
			row.state.textContent = texts.uploadDone;
		} else {
			row.state.textContent =
				record.total > 0 ? `${texts.uploading} ${Math.round(ratio * 100)}%` : texts.uploading;
		}

		row.action.hidden = record.state === "start" || record.state === "progress";
		row.action.textContent = record.state === "failed" ? texts.uploadRetry : texts.uploadForget;
		row.action.title = row.action.textContent;
		row.action.setAttribute("aria-label", `${row.action.textContent}: ${record.name}`);
		row.action.onclick = () => {
			row.action.onclick = null;
			if (record.state === "failed") {
				this.editor.uploads?.retry(record);
				return;
			}

			this.forget(record.id);
		};

		this.empty.hidden = this.rows.size > 0;
	}

	forget(id) {
		const held = this.rows.get(id);
		if (!held) {
			return;
		}

		held.element.remove();
		this.rows.delete(id);
		this.empty.hidden = this.rows.size > 0;
	}

	// note follows one upload event. A row appears with the first event and
	// moves through the states after it.
	note(event) {
		if (event.id === undefined || event.id === null || !this.element) {
			return;
		}

		const record = this.editor.uploads?.at(event.id) ?? this.rows.get(event.id)?.record;
		if (!record) {
			return;
		}

		if (!this.rows.has(event.id)) {
			record.name = event.file?.name || record.name;
			record.file = event.file ?? record.file;
		}
		this.row(record);
	}

	// fail marks the row of a request that answered with nothing usable. The
	// record itself is already in that state - it failed before the event
	// was raised.
	fail(event) {
		if (event.id === undefined || event.id === null || !this.element) {
			return;
		}

		const held = this.rows.get(event.id);
		if (!held) {
			return;
		}

		held.record = this.editor.uploads?.at(event.id) ?? held.record;
		held.record.error = event.error?.message || held.record.error;
		held.record.state = "failed";
		this.paint(held, held.record);
	}

	close() {
		if (!this.open) {
			return;
		}

		this.element.remove();
		this.element = null;
		this.list = null;
		this.empty = null;
		this.rows.clear();
	}
}
