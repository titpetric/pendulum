// What a heading reads as with its hashes hidden.
//
// The pilcrow off, the markers go and a heading is a line in the heading
// face with nothing on it that says which level it is: `##` and `###` differ
// by a few points of type, and the writer has no way back to the characters
// without turning the markers on again. The level stands at the right of the
// line instead, as a label, and the label is the way to change it.
//
// The label holds no text of its own. The surface answers the document out of
// the characters in its lines, so anything drawn into one that is not the
// writer's own typing would be in what the form posts; this is a box the
// stylesheet writes the level into, the way the picture beside an image
// marker carries nothing either.

import { dismiss, place } from "./util.js";

// The hashes and the space after them: what a heading line carries before the
// text begins.
export const PREFIX = /^(#{1,6})([ \t]+)/;

// As deep as markdown counts.
export const LEVELS = 6;

// levelOf answers the heading level one line is written at, or 0 for a line
// that is not a heading.
export function levelOf(line) {
	return line.match(PREFIX)?.[1].length ?? 0;
}

// prefixOf answers the characters a heading of one level starts with. Level
// zero is a paragraph, which starts with nothing.
export const prefixOf = (level) => (level > 0 ? `${"#".repeat(level)} ` : "");

export class LevelMenu {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.element = null;
		this.line = null;
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
				const label = event.target.closest?.(`.${this.prefix}__level`);
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

	// show opens the levels over the line the label belongs to. Each one is
	// drawn at the size it writes, so the choice reads as what it does.
	show(line, event) {
		this.close();
		this.line = line;

		const texts = this.editor.texts;
		const current = this.editor.source.levelAt(line);

		this.element = document.createElement("div");
		this.element.className = `${this.prefix}__menu ${this.prefix}__levels`;
		this.element.setAttribute("role", "menu");
		this.element.setAttribute("aria-label", texts.headingLevel);

		for (let level = 1; level <= LEVELS; level += 1) {
			this.element.appendChild(this.item(level, `${texts.heading} ${level}`, current === level));
		}
		this.element.appendChild(this.item(0, texts.headingText, current === 0));

		this.editor.root.appendChild(this.element);
		place(this.element, this.editor.root, event);
		this.element.querySelector("button")?.focus();
	}

	item(level, label, checked) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `${this.prefix}__menu-item ${this.prefix}__level-item`;
		button.dataset.level = String(level);
		button.setAttribute("role", "menuitemradio");
		button.setAttribute("aria-checked", String(checked));

		const mark = document.createElement("span");
		mark.className = `${this.prefix}__level-mark`;
		mark.textContent = level > 0 ? `H${level}` : "¶";
		mark.setAttribute("aria-hidden", "true");

		const text = document.createElement("span");
		text.textContent = label;

		button.append(mark, text);
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () => {
			const line = this.line;
			this.close();
			this.editor.source.setLevel(line, level);
			this.editor.focus();
		});

		return button;
	}

	close() {
		if (!this.open) {
			return;
		}

		this.element.remove();
		this.element = null;
		this.line = null;
	}
}
