// The blocks that read better drawn than spelled out.
//
// A widget stands in the surface in place of the lines it draws, and carries
// their markdown on itself: the document is still the sum of its segments,
// so nothing above this has to know a table is drawn as a table.
//
// The widget itself holds no caret - it is not editable - and the cells
// inside it are. A cell holds that cell's markdown, tokenised like any other
// run, so `**bold**` reads as bold in the cell while it is typed and the
// pilcrow hides the stars there too. The bar on the widget switches the
// block back to the markdown lines it came from, which is the way to edit
// the alignment row or to paste a column in.
//
// No shadow DOM. document.getSelection() stops at a shadow boundary, so a
// cell inside a shadow root could not answer where the caret is without a
// second path through the non-standard shadowRoot.getSelection(), and the
// caret is what every method below reads. The widget's styles are scoped the
// way the rest of this component scopes them: by the `mdedit__` prefix.

import { encode, encodeKey, parse as parseFrontmatter, rowLine } from "./frontmatter.js";
import { format, parse } from "./table.js";
import { tool } from "./util.js";

// A table is a header row, the alignment row under it, and whatever follows.
// Markdown draws nothing as a table without that second line, so neither
// does this: two lines that merely hold pipes are as likely to be prose, and
// a table drawn over them writes an alignment row into the document on the
// first keystroke in a cell.
const MINIMUM = 2;

export const isRow = (segment, prefix) =>
	segment.classList.contains(`${prefix}-row`) || segment.classList.contains(`${prefix}-align`);

// A node a browser left behind in the surface - a bare text node where the
// caret stood at a widget's edge - is not a widget and has no dataset at all.
export const isWidget = (segment) => segment.dataset?.block !== undefined;

// A front matter widget ends a table run: the block above it is no row.
export const isFrontmatter = (segment) => segment.dataset?.kind === "frontmatter";

// runs answers the stretches of table rows in the surface, each as the list
// of segments it covers.
//
// A table already drawn is part of the stretch it stands in. A writer types
// a table one line at a time, so it draws itself the moment the alignment
// row is behind them - and every row typed after that is a row line standing
// under a widget. Taking the widget into the run is what lets those rows
// join the table they belong to.
export function runs(segments, prefix) {
	const found = [];
	let current = [];

	const drawable = (run) => {
		if (run.length < MINIMUM) {
			return false;
		}

		const drawn = run.filter(isWidget).length;
		// A run that is nothing but what is already drawn has nothing to take
		// in, and drawing it again would throw away the caret standing in it.
		if (drawn === run.length) {
			return false;
		}

		return drawn > 0 || run[1].classList.contains(`${prefix}-align`);
	};

	for (const segment of segments) {
		if (isFrontmatter(segment)) {
			if (drawable(current)) {
				found.push(current);
			}
			current = [];
			continue;
		}
		if (isRow(segment, prefix) || isWidget(segment)) {
			current.push(segment);
			continue;
		}
		if (drawable(current)) {
			found.push(current);
		}
		current = [];
	}
	if (drawable(current)) {
		found.push(current);
	}

	return found;
}

// table draws one widget for a block of rows. `surface` draws the cells, so a
// cell carries the same runs as a line does.
export function table(surface, markdown) {
	const prefix = surface.prefix;
	const widget = document.createElement("div");
	widget.className = `${prefix}__widget ${prefix}__widget--table`;
	widget.contentEditable = "false";
	widget.dataset.block = markdown;
	widget.dataset.kind = "table";

	const { rows, alignments } = parse(markdown);
	const grid = document.createElement("table");
	grid.className = `${prefix}__widget-table`;

	rows.forEach((row, index) => {
		const line = document.createElement("tr");
		row.forEach((value, column) => {
			const cell = document.createElement(index === 0 ? "th" : "td");
			cell.contentEditable = "true";
			cell.dataset.align = alignments[column] ?? "left";
			cell.dataset.row = String(index);
			cell.dataset.column = String(column);
			cell.setAttribute("aria-label", `${surface.editor.texts.cell} ${index + 1}, ${column + 1}`);
			cell.replaceChildren(...surface.cell(value));
			line.appendChild(cell);
		});
		grid.appendChild(line);
	});

	const bar = document.createElement("div");
	bar.className = `${prefix}__widget-bar`;
	// The bar says what the block is, so the strip above a table carries a
	// name on the left and the two ways into it on the right.
	const name = document.createElement("span");
	name.className = `${prefix}__widget-name`;
	name.textContent = surface.editor.texts.tableGrid;
	bar.appendChild(name);
	const texts = surface.editor.texts;
	bar.append(
		tool({ prefix, key: "source", title: texts.source, icon: "icon-code", run: () => surface.undecorate(widget) }),
		tool({ prefix, key: "grid", title: texts.tableGrid, icon: "icon-table", run: () => surface.editor.editTable() }),
	);

	widget.append(bar, grid);
	return widget;
}

// frontmatter draws the block that opens a document as fields.
export function frontmatter(surface, markdown) {
	const prefix = surface.prefix;
	const texts = surface.editor.texts;
	const model = parseFrontmatter(markdown) ?? { rows: [] };
	const widget = document.createElement("div");
	widget.className = `${prefix}__widget ${prefix}__widget--frontmatter`;
	widget.contentEditable = "false";
	widget.dataset.block = markdown;
	widget.dataset.kind = "frontmatter";

	const grid = document.createElement("table");
	grid.className = `${prefix}__widget-table ${prefix}__frontmatter-table`;

	const head = document.createElement("thead");
	const headLine = document.createElement("tr");
	headLine.dataset.head = "";
	for (const label of [texts.frontmatterName, texts.frontmatterValue]) {
		const cell = document.createElement("th");
		cell.textContent = label;
		headLine.appendChild(cell);
	}
	head.appendChild(headLine);

	const body = document.createElement("tbody");
	for (const row of model.rows) {
		if (row.kind === "group") {
			const line = document.createElement("tr");
			line.className = `${prefix}__frontmatter-group`;
			const cell = document.createElement("th");
			cell.colSpan = 2;
			cell.textContent = row.key;
			line.appendChild(cell);
			body.appendChild(line);
			continue;
		}

		const line = document.createElement("tr");
		line.dataset.row = String(row.row);
		line.dataset.line = String(row.line);
		if (row.kind === "child") {
			line.className = `${prefix}__frontmatter-child`;
		}
		if (row.kind === "rich") {
			line.className = `${prefix}__frontmatter-rich-row`;
		}

		const key = document.createElement("td");
		key.className = `${prefix}__frontmatter-key`;
		key.contentEditable = String(Boolean(row.editableKey));
		key.dataset.row = String(row.row);
		key.dataset.column = "0";
		key.dataset.line = String(row.line);
		key.setAttribute("aria-label", `${texts.frontmatter} ${row.row + 1}`);
		key.replaceChildren(...surface.plain(row.key));

		const value = document.createElement("td");
		value.className = `${prefix}__frontmatter-value`;
		value.contentEditable = String(Boolean(row.editableValue));
		value.dataset.row = String(row.row);
		value.dataset.column = "1";
		value.dataset.line = String(row.line);
		if (row.kind === "rich") {
			value.className = `${prefix}__frontmatter-value ${prefix}__frontmatter-rich`;
			value.textContent = texts.frontmatterRich;
		} else {
			value.replaceChildren(...surface.plain(row.value));
		}

		line.append(key, value);
		body.appendChild(line);
	}

	grid.append(head, body);

	const bar = document.createElement("div");
	bar.className = `${prefix}__widget-bar`;
	const name = document.createElement("span");
	name.className = `${prefix}__widget-name`;
	name.textContent = texts.frontmatter;
	bar.appendChild(name);
	bar.append(
		tool({
			prefix,
			key: "row-add",
			title: texts.frontmatterRowAdd,
			icon: "icon-row-add",
			run: () => surface.frontmatterAddRow(widget),
		}),
		tool({
			prefix,
			key: "source",
			title: texts.source,
			icon: "icon-code",
			run: (event) => surface.toggleFrontmatterSource(widget, event.currentTarget),
		}),
	);

	widget.append(bar, grid);
	return widget;
}

// written answers the markdown the widget now holds, read back off its cells.
export function written(widget) {
	return widget.dataset.kind === "frontmatter" ? frontmatterWritten(widget) : tableWritten(widget);
}

// tableWritten answers the markdown a table widget now holds.
function tableWritten(widget) {
	const { alignments } = parse(widget.dataset.block);
	const rows = [...widget.querySelectorAll("tr")].map((line) =>
		[...line.children].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()),
	);

	return format({ rows, alignments });
}

// frontmatterWritten rewrites the lines that changed and keeps the rest.
function frontmatterWritten(widget) {
	const model = parseFrontmatter(widget.dataset.block);
	if (!model) {
		return widget.dataset.block;
	}

	const lines = [...model.lines];
	let changed = false;

	for (const line of widget.querySelectorAll("tbody tr[data-row]")) {
		const key = line.querySelector('[data-column="0"]');
		const value = line.querySelector('[data-column="1"]');
		const row = model.data.find((candidate) => candidate.row === Number(line.dataset.row));
		if (!key || !value || !row || !row.editableValue) {
			continue;
		}

		const next = rowLine(row, text(key), text(value));
		if (next !== lines[row.line]) {
			lines[row.line] = next;
			changed = true;
		}
	}

	let added = 0;
	for (const line of widget.querySelectorAll('tbody tr[data-new="true"]')) {
		const key = line.querySelector('[data-column="0"]');
		const value = line.querySelector('[data-column="1"]');
		if (!key || !value || text(key) === "") {
			continue;
		}

		const at = lines.findIndex((entry, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(entry));
		if (at < 0) {
			continue;
		}

		lines.splice(at, 0, `${encodeKey(text(key))}: ${encode(text(value))}`);
		line.dataset.line = String(at);
		line.dataset.row = String(model.data.length + added);
		for (const cell of line.children) {
			cell.dataset.line = line.dataset.line;
			cell.dataset.row = line.dataset.row;
		}
		line.removeAttribute("data-new");
		added += 1;
		changed = true;
	}

	return changed ? lines.join("\n") : widget.dataset.block;
}

// NBSP reads a no-break space as the space it stands for.
const NBSP = new RegExp(String.fromCharCode(160), "g");
const text = (cell) => cell.textContent.replace(NBSP, " ");
