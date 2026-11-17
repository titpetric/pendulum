// The table grid: a markdown table edited as cells, written straight back
// into the textarea.
//
// The markdown stays the source of truth. Every keystroke in a cell rewrites
// the table in the document underneath, so closing the grid needs no save
// and leaving the page mid-edit loses nothing. With JavaScript off, or with
// the grid never opened, the same table is pipes and dashes the writer types
// by hand.
//
// A cell holds markdown, so the grid carries the inline tools over it: bold,
// italic, strikethrough, link and code run against whichever cell has the
// caret.

import { renderInline } from "./inline.js";
import { Source } from "./source.js";
import { TOOLBAR_INLINE, defaultTools } from "./tools.js";
import { roving, tool } from "./util.js";

const ALIGNMENTS = ["left", "center", "right"];

// The alignment row: the one row of a markdown table that is scaffolding.
//
// A dash is what makes it one. Without that, a row of empty cells - what a
// writer gets the moment they add a row and have yet to fill it in - reads
// as scaffolding and the next parse drops the row.
const RULE = /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/;

// A row is pipe-separated, so a cell that holds a pipe of its own writes it
// \| , the way markdown escapes it. A row is split on the pipes that are not
// escaped, and a cell reads as the character it stands for.
const PIPE = /(?<!\\)\|/;
const LAST = /(?<!\\)\|\s*$/;

// cells splits one markdown row into its cells, outer pipes dropped.
function cells(row) {
	const trimmed = row.trim().replace(/^\|/, "").replace(LAST, "");
	return trimmed.split(PIPE).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

// parse reads a block of pipe lines into rows and column alignments.
export function parse(markdown) {
	const lines = markdown.split("\n").filter((line) => line.trim() !== "");
	const rows = [];
	let alignments = [];

	// The alignment row is the second line of the table and no other: one
	// further down is a row of dashes the writer typed, and it stays.
	let ruled = false;

	for (const line of lines) {
		if (!ruled && RULE.test(line) && rows.length === 1) {
			ruled = true;
			alignments = cells(line).map((cell) => {
				const left = cell.startsWith(":");
				const right = cell.endsWith(":");
				if (left && right) {
					return "center";
				}
				return right ? "right" : "left";
			});
			continue;
		}

		rows.push(cells(line));
	}

	const width = Math.max(1, ...rows.map((row) => row.length), alignments.length);
	for (const row of rows) {
		while (row.length < width) {
			row.push("");
		}
	}
	while (alignments.length < width) {
		alignments.push("left");
	}

	if (rows.length === 0) {
		rows.push(Array(width).fill(""));
	}

	return { rows, alignments };
}

// format writes rows and alignments back as markdown, with the columns
// padded to one width so the source reads as a table too.
export function format({ rows, alignments }) {
	// Every row to the one width, every pipe in a cell escaped: what goes
	// back into the document has to read as the table it came from.
	const written = (rows.length ? rows : [[]]).map((row) =>
		alignments.map((_, column) => (row[column] ?? "").replace(/\|/g, "\\|")),
	);
	const widths = alignments.map((_, column) =>
		Math.max(3, ...written.map((row) => row[column].length)),
	);

	const pad = (text, column) => text + " ".repeat(Math.max(0, widths[column] - text.length));

	const rule = alignments.map((alignment, column) => {
		const dashes = "-".repeat(Math.max(3, widths[column]));
		if (alignment === "center") {
			return `:${dashes.slice(2)}:`;
		}
		if (alignment === "right") {
			return `${dashes.slice(1)}:`;
		}
		return dashes;
	});

	const line = (values) => `| ${values.map((value, column) => pad(value, column)).join(" | ")} |`;

	const out = [line(written[0])];
	out.push(`| ${rule.join(" | ")} |`);
	for (const row of written.slice(1)) {
		out.push(line(row));
	}

	return out.join("\n");
}

// find answers the range of the table the caret sits in, or null when it
// sits anywhere else.
export function find(value, caret) {
	const lines = value.split("\n");

	let offset = 0;
	let index = 0;
	for (; index < lines.length; index += 1) {
		const next = offset + lines[index].length + 1;
		if (caret < next) {
			break;
		}
		offset = next;
	}

	const row = (at) => at >= 0 && at < lines.length && /^\s*\|/.test(lines[at]);
	if (!row(index)) {
		return null;
	}

	let first = index;
	while (row(first - 1)) {
		first -= 1;
	}
	let last = index;
	while (row(last + 1)) {
		last += 1;
	}

	const start = lines.slice(0, first).reduce((total, line) => total + line.length + 1, 0);
	const end = lines.slice(0, last + 1).reduce((total, line) => total + line.length + 1, 0) - 1;

	return { start, end, markdown: value.slice(start, end) };
}

// grid reads a block of pipe lines as the cells it holds, each with where its
// own text begins in the block. The outer pipes, the ones between the cells
// and the padding around them are the source's and belong to no cell.
//
// The rows are numbered the way parse() numbers them, blank lines and the one
// alignment row taking no number of their own: a drawn table carries those
// numbers on its cells, and a caller looking a cell up by them has to agree.
function grid(markdown) {
	const found = [];
	let offset = 0;
	let row = 0;
	let ruled = false;

	for (const line of markdown.split("\n")) {
		const start = offset;
		offset += line.length + 1;

		if (line.trim() === "") {
			continue;
		}
		if (!ruled && RULE.test(line) && row === 1) {
			ruled = true;
			continue;
		}

		let body = line.trim();
		let base = start + (line.length - line.trimStart().length);
		if (body.startsWith("|")) {
			body = body.slice(1);
			base += 1;
		}
		body = body.replace(LAST, "");

		let walked = 0;
		body.split(PIPE).forEach((part, column) => {
			const pad = part.length - part.trimStart().length;
			found.push({ row, column, start: base + walked + pad, markdown: part.trim() });
			// One character for the pipe the split took out from between them.
			walked += part.length + 1;
		});

		row += 1;
	}

	return found;
}

// A cell draws an escaped pipe as the one character it stands for, so a
// position in a cell counts \| once and a position in the block counts both.
const drawn = (text) => text.replace(/\\\|/g, "|");

// at answers which cell of a block one offset into it falls in, and where in
// that cell's own text it stands, or null for an offset that stands in no
// cell: on a pipe, in the padding, in the alignment row, in a blank line, or
// past the end of the block.
//
// The offset after a cell's last character is that cell's end, since that is
// where a caret at the end of what the cell holds stands.
export function at(markdown, offset) {
	for (const cell of grid(markdown)) {
		if (offset < cell.start || offset > cell.start + cell.markdown.length) {
			continue;
		}

		const before = drawn(markdown.slice(cell.start, offset)).length;

		return { row: cell.row, column: cell.column, at: Math.min(before, drawn(cell.markdown).length) };
	}

	return null;
}

// offsetAt is the way back: where in the block one position inside a named
// cell stands. It answers null for a cell the block has no text for - a
// column a short row was padded out to - the way at() answers null for an
// offset in no cell at all.
export function offsetAt(markdown, row, column, at) {
	const cell = grid(markdown).find((found) => found.row === row && found.column === column);
	if (!cell) {
		return null;
	}

	let index = 0;
	for (let counted = 0; counted < at && index < cell.markdown.length; counted += 1) {
		index += cell.markdown.startsWith("\\|", index) ? 2 : 1;
	}

	return cell.start + index;
}

// cellEditor is the small surface the inline tools act on: the same tool
// functions the toolbar runs, pointed at one cell.
function cellEditor(field) {
	const source = new Source(field);

	return {
		source,
		get selection() {
			return source.selection;
		},
		focus: () => source.focus(),
		wrap: (marker, placeholder) => source.wrap(marker, placeholder),
		insert: (text, cursor, length) => source.insert(text, cursor, length),
		insertBlock: (text, cursor, length) => source.insertBlock(text, cursor, length),
		prefixLines: (marker) => source.prefixLines(marker),
	};
}

export class TableGrid {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.tools = defaultTools();
		this.element = null;
		this.range = null;
		this.focused = null;
		this.stage = null;
	}

	get open() {
		return Boolean(this.element);
	}

	// toggle opens the grid over the table the caret sits in, and closes it
	// again. It answers whether it found a table to edit.
	toggle() {
		if (this.open) {
			this.close();
			return true;
		}

		const found = find(this.editor.value, this.editor.selection.start);
		if (!found) {
			return false;
		}

		return this.openAt(found);
	}

	// openAt opens the grid over one known range: what the rendered view
	// holds when a table is clicked there, where no caret says which table
	// the writer means.
	openAt({ start, end }) {
		if (this.open) {
			this.close();
		}

		this.range = { start, end };
		this.table = parse(this.editor.value.slice(start, end));
		// A new table, and nobody in it yet: the cell the last session ended
		// on belongs to a table this one knows nothing about.
		this.focused = null;
		this.build();

		return true;
	}

	close() {
		if (!this.open) {
			return;
		}

		this.element.remove();
		this.element = null;
		this.stage.hidden = false;
		this.editor.refresh();

		// The caret lands at the top of the table the grid held.
		this.editor.source.select(this.range.start);
		this.editor.focus();
		this.editor.emit("table", { open: false });
	}

	// ── The panel ─────────────────────────────────────────────────────────

	build() {
		const name = (part) => `${this.prefix}__${part}`;

		this.element = document.createElement("div");
		this.element.className = name("grid");
		this.element.setAttribute("role", "group");
		this.element.setAttribute("aria-label", this.editor.texts.tableGrid);

		this.element.appendChild(this.buildBar());
		this.body = document.createElement("div");
		this.body.className = name("grid-body");
		this.element.appendChild(this.body);

		// The grid stands where the editing surface stands.
		this.stage = this.editor.stage;
		this.stage.hidden = true;
		this.stage.parentNode.insertBefore(this.element, this.stage.nextSibling);

		this.paint();
		this.element.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				this.close();
			}
		});

		this.editor.emit("table", { open: true });
	}

	buildBar() {
		const name = (part) => `${this.prefix}__${part}`;
		const bar = document.createElement("div");
		bar.className = `${name("bar")} ${name("grid-bar")}`;
		bar.setAttribute("role", "toolbar");
		bar.setAttribute("aria-label", this.editor.texts.formatting);

		// The inline tools, acting on whichever cell holds the caret.
		for (const key of TOOLBAR_INLINE) {
			const tool = this.tools[key];
			bar.appendChild(
				this.button(key, tool.label, tool.title, tool.icon, () => {
					if (this.focused) {
						tool.run(cellEditor(this.focused));
						this.write();
						this.focused.focus();
					}
				}),
			);
		}

		bar.appendChild(this.divider());

		const actions = [
			["row-add", this.editor.texts.rowAdd, "icon-row-add", () => this.addRow()],
			["row-remove", this.editor.texts.rowRemove, "icon-row-remove", () => this.removeRow()],
			["column-add", this.editor.texts.columnAdd, "icon-column-add", () => this.addColumn()],
			["column-remove", this.editor.texts.columnRemove, "icon-column-remove", () => this.removeColumn()],
			["align", this.editor.texts.align, "icon-align", () => this.cycleAlignment()],
		];

		for (const [key, title, icon, run] of actions) {
			bar.appendChild(this.button(key, title, title, icon, run));
		}

		const done = this.button("grid-done", this.editor.texts.done, this.editor.texts.done, null, () =>
			this.close(),
		);
		done.classList.add(`${this.prefix}__tool--grid-done`);
		bar.appendChild(done);

		roving(bar);

		return bar;
	}

	button(key, label, title, icon, run) {
		return tool({ prefix: this.prefix, key, label, title, icon, run });
	}

	divider() {
		const line = document.createElement("span");
		line.className = `${this.prefix}__grid-divider`;
		line.setAttribute("aria-hidden", "true");
		return line;
	}

	// paint draws the grid from the parsed table. The first row is the
	// header, as markdown reads it.
	paint() {
		// The cell the writer stands in. Every row and column action
		// repaints, and the next one acts on whichever cell holds the focus:
		// with the focus back on the first cell, a second press adds a row at
		// the top of the table or takes the first column out.
		const held = this.focused
			? { row: Number(this.focused.dataset.row), column: Number(this.focused.dataset.column) }
			: null;

		const table = document.createElement("table");
		table.className = `${this.prefix}__grid-table`;

		this.table.rows.forEach((row, rowIndex) => {
			const line = document.createElement("tr");

			row.forEach((value, column) => {
				const cell = document.createElement(rowIndex === 0 ? "th" : "td");
				cell.dataset.align = this.table.alignments[column];

				// A cell reads as the table it is in: the markdown renders
				// where the caret is somewhere else, and the field under it
				// takes over the moment the cell is clicked.
				const view = document.createElement("div");
				view.className = `${this.prefix}__cell-view`;
				view.innerHTML = renderInline(value);

				const field = document.createElement("textarea");
				field.className = `${this.prefix}__cell-edit`;
				field.rows = 1;
				field.value = value;
				field.spellcheck = rowIndex !== 0;
				field.dataset.row = String(rowIndex);
				field.dataset.column = String(column);
				field.setAttribute("aria-label", `${this.editor.texts.cell} ${rowIndex + 1}, ${column + 1}`);

				const show = (editing) => {
					view.hidden = editing;
					field.hidden = !editing;
					if (editing) {
						this.grow(field);
					}
				};

				view.addEventListener("mousedown", (event) => {
					event.preventDefault();
					show(true);
					field.focus();
					field.setSelectionRange(field.value.length, field.value.length);
				});

				field.addEventListener("focus", () => {
					this.focused = field;
					for (const node of this.element.querySelectorAll("[data-focused]")) {
						node.removeAttribute("data-focused");
					}
					cell.setAttribute("data-focused", "");
				});
				field.addEventListener("blur", () => {
					view.innerHTML = renderInline(field.value);
					show(false);
					cell.removeAttribute("data-focused");
				});
				field.addEventListener("input", () => {
					this.table.rows[rowIndex][column] = field.value;
					this.grow(field);
					this.write();
				});

				show(false);
				cell.append(view, field);
				line.appendChild(cell);
			});

			table.appendChild(line);
		});

		this.body.replaceChildren(table);

		const field = (held && this.fieldAt(held.row, held.column)) ?? this.body.querySelector("textarea");
		if (field) {
			field.hidden = false;
			field.previousElementSibling.hidden = true;
			// A field measures its own text off the page it is drawn on, so
			// it is shown before it is grown and not the other way round.
			this.grow(field);
			field.focus();
		}
	}

	// fieldAt answers the cell field at a row and a column, clamped to the
	// grid as it now stands: a removed row or column leaves the writer on
	// the nearest cell.
	fieldAt(row, column) {
		const at = Math.min(Math.max(row, 0), this.table.rows.length - 1);
		const by = Math.min(Math.max(column, 0), this.table.alignments.length - 1);

		return this.body.querySelector(`textarea[data-row="${at}"][data-column="${by}"]`);
	}

	// grow keeps a cell as tall as the text in it: a cell holds markdown,
	// and markdown runs on.
	grow(field) {
		field.style.height = "auto";
		field.style.height = `${field.scrollHeight}px`;
	}

	// write puts the table back in the document and remembers the range it
	// now occupies.
	write() {
		const markdown = format(this.table);
		// Not at the caret: the writer is typing in a cell field of the
		// grid's own, and a caret placed in the surface takes the focus with
		// it, so the rest of what they type lands nowhere.
		this.editor.source.replace(this.range.start, this.range.end, markdown, false);
		this.range.end = this.range.start + markdown.length;
		this.editor.emit("change", { value: this.editor.value });
	}

	// ── Rows, columns, alignment ──────────────────────────────────────────

	position() {
		const row = Number(this.focused?.dataset.row ?? this.table.rows.length - 1);
		const column = Number(this.focused?.dataset.column ?? this.table.alignments.length - 1);
		return { row, column };
	}

	addRow() {
		const { row } = this.position();
		this.table.rows.splice(row + 1, 0, Array(this.table.alignments.length).fill(""));
		this.write();
		this.paint();
	}

	removeRow() {
		const { row } = this.position();
		// The header row stays: a markdown table has one by definition.
		if (this.table.rows.length < 2 || row === 0) {
			return;
		}
		this.table.rows.splice(row, 1);
		this.write();
		this.paint();
	}

	addColumn() {
		const { column } = this.position();
		this.table.alignments.splice(column + 1, 0, "left");
		for (const row of this.table.rows) {
			row.splice(column + 1, 0, "");
		}
		this.write();
		this.paint();
	}

	removeColumn() {
		const { column } = this.position();
		if (this.table.alignments.length < 2) {
			return;
		}
		this.table.alignments.splice(column, 1);
		for (const row of this.table.rows) {
			row.splice(column, 1);
		}
		this.write();
		this.paint();
	}

	cycleAlignment() {
		const { column } = this.position();
		const next = (ALIGNMENTS.indexOf(this.table.alignments[column]) + 1) % ALIGNMENTS.length;
		this.table.alignments[column] = ALIGNMENTS[next];
		this.write();
		this.paint();
	}
}
