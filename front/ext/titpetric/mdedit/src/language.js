// The language a fenced block is written in, and the menu that changes it.
//
// With the markers hidden the fence line has no characters on the page, so
// the block's top edge says which language colours it: the label at its right
// opens the languages, and a press writes the word onto the opening fence.
// The label carries no text of its own, the way the heading level does not:
// the stylesheet writes the word from the attribute, so nothing it draws can
// land in what the form posts.
//
// A block with no language is plain text and stays uncoloured. The menu is
// the way to name one, and the field above the list takes a word the list
// does not hold, so a fence keeps any language a project writes.

import { FENCE_LANGUAGES, canonical } from "./code.js";
import { dismiss, place } from "./util.js";

export class CodeMenu {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.element = null;
		this.input = null;
		this.list = null;
		this.empty = null;
		this.line = null;
		this.current = "";
		this.anchor = null;
	}

	get open() {
		return Boolean(this.element);
	}

	attach(signal) {
		// A click or a tap on the label, and nothing else: the label is a
		// control, so it answers the one gesture every machine has.
		this.editor.surface.addEventListener(
			"click",
			(event) => {
				const label = event.target.closest?.(`.${this.prefix}__lang`);
				if (!label || !this.editor.surface.contains(label)) {
					return;
				}

				event.preventDefault();
				this.show(label.parentElement, event);
			},
			{ signal },
		);

		dismiss({ open: () => this.open, element: () => this.element, close: () => this.close(), signal });
	}

	// show opens the languages over the fence the label belongs to, with the
	// one the fence names marked and a field to filter them.
	show(line, event) {
		this.close();
		this.line = line;

		const texts = this.editor.texts;
		this.current = this.editor.source.languageAt(line);
		this.anchor = { clientX: event.clientX, clientY: event.clientY };

		this.element = document.createElement("div");
		this.element.className = `${this.prefix}__menu ${this.prefix}__langs`;
		this.element.setAttribute("role", "dialog");
		this.element.setAttribute("aria-label", texts.codeLanguage);

		this.input = document.createElement("input");
		this.input.type = "text";
		this.input.className = `${this.prefix}__lang-filter`;
		this.input.placeholder = texts.codeFilter;
		this.input.setAttribute("aria-label", texts.codeFilter);
		this.input.autocomplete = "off";
		this.input.spellcheck = false;

		this.list = document.createElement("div");
		this.list.className = `${this.prefix}__lang-list`;
		this.list.setAttribute("role", "listbox");
		this.list.setAttribute("aria-label", texts.codeLanguage);

		this.add("", texts.codeText);
		for (const language of FENCE_LANGUAGES) {
			this.add(language, language);
		}

		this.empty = document.createElement("p");
		this.empty.className = `${this.prefix}__lang-empty`;
		this.empty.textContent = texts.codeCustom;
		this.empty.hidden = true;

		this.element.append(this.input, this.list, this.empty);
		this.editor.root.appendChild(this.element);
		place(this.element, this.editor.root, event);

		this.input.addEventListener("input", () => this.filter());
		this.input.addEventListener("keydown", (event) => this.key(event));
		this.list.addEventListener("keydown", (event) => this.step(event));
		this.input.focus();
	}

	// add draws one language in the list. Plain text is the empty word: the
	// fence then names no language and its lines stay uncoloured.
	add(language, label) {
		const item = document.createElement("button");
		item.type = "button";
		item.className = `${this.prefix}__menu-item ${this.prefix}__lang-item`;
		item.dataset.language = language;
		item.setAttribute("role", "option");
		item.setAttribute("aria-selected", String(language === this.current));
		item.textContent = label;

		item.addEventListener("mousedown", (event) => event.preventDefault());
		item.addEventListener("click", () => this.write(language));
		this.list.appendChild(item);

		return item;
	}

	// filter takes the list down to the words the field holds.
	filter() {
		const query = this.input.value.trim().toLowerCase();
		let shown = 0;

		for (const item of this.list.children) {
			item.hidden = query !== "" && !item.textContent.toLowerCase().includes(query);
			if (!item.hidden) {
				shown += 1;
			}
		}

		this.empty.hidden = shown > 0;
		// The list is shorter than it was, and a menu placed for the full one
		// would stand where the full one reached.
		place(this.element, this.editor.root, this.anchor);
	}

	// key holds the field's Enter and Down. Enter takes the one language the
	// field names, the one the list has left, or the word itself, so a
	// language the list does not hold is still a language.
	key(event) {
		if (event.key === "Enter") {
			event.preventDefault();
			this.press();
			return;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.visible()[0]?.focus();
		}
	}

	press() {
		const word = this.word();
		if (word === "") {
			return;
		}

		const exact = this.exact(word);
		if (exact !== null) {
			this.write(exact);
			return;
		}

		const items = this.visible();
		this.write(items.length === 1 ? items[0].dataset.language : word);
	}

	// exact answers the language the field names, or null. Plain text is the
	// empty word on the fence, and the names it is written with answer it.
	exact(word) {
		const name = canonical(word.toLowerCase());
		for (const item of this.list.children) {
			if (item.dataset.language === name || (item.dataset.language === "" && name === "text")) {
				return item.dataset.language;
			}
		}

		return null;
	}

	// step moves the focus down the list and back up it, from the item the
	// arrow keys stand on.
	step(event) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
			return;
		}

		const items = this.visible();
		const at = items.indexOf(document.activeElement);
		const to = at + (event.key === "ArrowDown" ? 1 : -1);
		event.preventDefault();
		items[(to + items.length) % items.length]?.focus();
	}

	visible() {
		return [...this.list.querySelectorAll("button:not([hidden])")];
	}

	// word reads the field as a fence info word: one token, no character a
	// fence is spelled with.
	word() {
		return (this.input.value.trim().split(/\s+/)[0] ?? "").replace(/[`~]/g, "");
	}

	write(language) {
		const line = this.line;
		this.close();
		this.editor.source.setLanguage(line, language);
		this.editor.focus();
	}

	close() {
		if (!this.open) {
			return;
		}

		this.element.remove();
		this.element = null;
		this.input = null;
		this.list = null;
		this.empty = null;
		this.line = null;
		this.current = "";
		this.anchor = null;
	}
}
