// The menu over a drawn table: the rows, the columns and the alignment of
// the column the writer asked about.
//
// A markdown table is a header, an alignment row and the rows under it, so
// these are every structural edit the format has: a row either side of this
// one, a column either side of this one, the row or column gone, and the
// column laid out left, centre or right. Each one rewrites the block's
// markdown and draws the table again: the document is the edit, and the
// drawing follows it.
//
// Three ways to it, because a table is edited on three kinds of machine: the
// right button, a long press, and a double tap or double click.

import { format, parse } from "./table.js";
import { dismiss, place, tool } from "./util.js";

// How long a finger rests for the press to count, and how far it may wander
// first: past either, the gesture is a tap or a scroll.
const PRESS = 450;
const WANDER = 10;

export class TableMenu {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.element = null;
		this.widget = null;
		this.at = null;
		this.timer = null;
	}

	get open() {
		return Boolean(this.element);
	}

	attach(signal) {
		const surface = this.editor.surface;

		for (const name of ["contextmenu", "dblclick"]) {
			surface.addEventListener(
				name,
				(event) => {
					const found = this.find(event);
					if (!found) {
						return;
					}

					event.preventDefault();
					this.show(found, event);
				},
				{ signal },
			);
		}

		// A finger held still over a cell opens the menu, the way the right
		// button does. Chrome raises contextmenu for a long press of its own
		// on some pages and not on others, and show() closes whatever is
		// open first, so the two together still leave one menu.
		surface.addEventListener(
			"pointerdown",
			(event) => {
				if (event.pointerType !== "touch") {
					return;
				}
				const found = this.find(event);
				if (!found) {
					return;
				}

				this.at = { x: event.clientX, y: event.clientY };
				this.timer = setTimeout(() => {
					this.timer = null;
					this.show(found, { clientX: this.at.x, clientY: this.at.y });
				}, PRESS);
			},
			{ signal },
		);

		const drop = (event) => {
			if (this.timer === null) {
				return;
			}
			if (
				event.type === "pointermove" &&
				Math.abs(event.clientX - this.at.x) < WANDER &&
				Math.abs(event.clientY - this.at.y) < WANDER
			) {
				return;
			}

			clearTimeout(this.timer);
			this.timer = null;
		};
		for (const name of ["pointerup", "pointercancel", "pointermove", "scroll"]) {
			surface.addEventListener(name, drop, { signal, passive: true });
		}

		dismiss({ open: () => this.open, element: () => this.element, close: () => this.close(), signal });
	}

	// find answers the cell the gesture landed on, with the table it belongs
	// to and where in it the cell stands.
	find(event) {
		// A picture in a cell is the image panel's: the gesture names the
		// nearest thing it landed on, and two panels over one cell is one
		// too many.
		if (event.target.closest?.(`.${this.prefix}__pic`)) {
			return null;
		}

		const cell = event.target.closest?.("th, td");
		const widget = cell?.closest(`.${this.prefix}__widget--table`);
		if (!widget || !this.editor.surface.contains(widget)) {
			return null;
		}

		return {
			widget,
			cell,
			row: Number(cell.dataset.row ?? 0),
			column: Number(cell.dataset.column ?? 0),
		};
	}

	// ── The menu ──────────────────────────────────────────────────────────

	show(found, event) {
		this.close();
		this.widget = found.widget;
		this.where = found;

		const texts = this.editor.texts;
		const table = parse(found.widget.dataset.block);
		// The header row is the one row markdown cannot do without, and a
		// table of one column is a table: neither goes away here.
		const rows = table.rows.length;
		const columns = table.alignments.length;

		this.element = document.createElement("div");
		this.element.className = `${this.prefix}__menu`;
		this.element.setAttribute("role", "menu");
		this.element.setAttribute("aria-label", texts.tableMenu);

		this.element.append(
			this.group([
				this.item("row-add-above", texts.rowAbove, "icon-row-add", () => this.addRow(found.row)),
				this.item("row-add-below", texts.rowBelow, "icon-row-add", () => this.addRow(found.row + 1)),
				this.item("row-remove", texts.rowRemove, "icon-row-remove", () => this.removeRow(found.row), {
					enabled: found.row > 0 && rows > 1,
				}),
			]),
			this.group([
				this.item("column-add-left", texts.columnLeft, "icon-column-add", () => this.addColumn(found.column)),
				this.item("column-add-right", texts.columnRight, "icon-column-add", () =>
					this.addColumn(found.column + 1),
				),
				this.item("column-remove", texts.columnRemove, "icon-column-remove", () => this.removeColumn(found.column), {
					enabled: columns > 1,
				}),
			]),
			this.group(
				["left", "center", "right"].map((align) =>
					this.item(
						`align-${align}`,
						texts[`align${align[0].toUpperCase()}${align.slice(1)}`],
						`icon-align-${align}`,
						() => this.align(found.column, align),
						{ checked: table.alignments[found.column] === align },
					),
				),
			),
		);

		this.editor.root.appendChild(this.element);
		place(this.element, this.editor.root, event);
		this.element.querySelector("button:not([disabled])")?.focus();
	}

	group(items) {
		const group = document.createElement("div");
		group.className = `${this.prefix}__menu-group`;
		group.setAttribute("role", "group");
		group.append(...items);

		return group;
	}

	item(key, label, icon, run, { enabled = true, checked = false } = {}) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `${this.prefix}__menu-item ${this.prefix}__menu-item--${key}`;
		button.setAttribute("role", checked === false ? "menuitem" : "menuitemradio");
		if (checked !== false) {
			button.setAttribute("aria-checked", String(checked));
		}
		button.disabled = !enabled;

		const mark = document.createElement("span");
		mark.className = `icon ${icon}`;
		mark.setAttribute("aria-hidden", "true");

		const text = document.createElement("span");
		text.textContent = label;

		button.append(mark, text);
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () => {
			run();
			this.close();
		});

		return button;
	}

	close() {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (!this.open) {
			return;
		}

		this.element.remove();
		this.element = null;
		this.widget = null;
		this.where = null;
	}

	// ── The edits ─────────────────────────────────────────────────────────

	// edit rewrites the block this menu stands over, and leaves the writer
	// in the cell the edit means them to be in.
	edit(change, land) {
		const widget = this.widget;
		const table = parse(widget.dataset.block);
		change(table);

		this.editor.source.rewrite(widget, format(table), land(table));
		this.editor.emit("change", { value: this.editor.value });
	}

	addRow(at) {
		this.edit(
			(table) => table.rows.splice(Math.max(at, 1), 0, Array(table.alignments.length).fill("")),
			() => ({ row: Math.max(at, 1), column: 0 }),
		);
	}

	removeRow(at) {
		this.edit(
			(table) => {
				if (at > 0 && table.rows.length > 1) {
					table.rows.splice(at, 1);
				}
			},
			(table) => ({ row: Math.min(at, table.rows.length - 1), column: this.where?.column ?? 0 }),
		);
	}

	addColumn(at) {
		this.edit(
			(table) => {
				table.alignments.splice(at, 0, "left");
				for (const row of table.rows) {
					row.splice(at, 0, "");
				}
			},
			() => ({ row: 0, column: at }),
		);
	}

	removeColumn(at) {
		this.edit(
			(table) => {
				if (table.alignments.length > 1) {
					table.alignments.splice(at, 1);
					for (const row of table.rows) {
						row.splice(at, 1);
					}
				}
			},
			(table) => ({ row: this.where?.row ?? 0, column: Math.min(at, table.alignments.length - 1) }),
		);
	}

	align(at, alignment) {
		this.edit(
			(table) => {
				table.alignments[at] = alignment;
			},
			() => ({ row: this.where?.row ?? 0, column: at }),
		);
	}
}
