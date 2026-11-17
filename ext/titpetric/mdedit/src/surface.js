// The editing surface: one contenteditable element whose text IS the
// markdown.
//
// There is no mirror and no second copy. Every line of the source is one
// element, tokenised into the runs that style it, and the value the form
// posts comes straight back out of those elements. A heading takes the
// heading face as the writer types it, because the characters under the caret
// are the characters the writer typed; the toggle only decides whether the
// marker runs show.
//
// The textarea under the editor stays in the page, hidden, and every edit
// writes to it. It keeps its name and its value, and the form and the no-JS
// fallback go on working unchanged.

import { highlightCode } from "./code.js";
import { LEVELS, PREFIX, levelOf, prefixOf } from "./heading.js";
import { FENCE, ITEM, inlineTokens, tokenise } from "./highlight.js";
import { mediaKind } from "./inline.js";
import { at as frontmatterAt, complete as frontmatterComplete, detect as frontmatterDetect, offsetAt as frontmatterOffset } from "./frontmatter.js";
import { Source } from "./source.js";
// `at` and `offsetAt` are the two ways between a place in the block a widget
// stands for and a place in the cell it draws. The cell names them here,
// since `at` is what half the methods below call a local offset.
import { at as cellAt, format, offsetAt as cellOffset, parse } from "./table.js";
import { frontmatter, isWidget, runs, table, written } from "./widgets.js";
import { tool } from "./util.js";

const ELEMENT = 1;
const TEXT = 3;

// A run of typing stays one undo step until a word ends or this long passes.
const COALESCE = 700;

// The elements a browser leaves behind when it restructures the surface
// itself. Reading one of these back is reading a line break.
const BLOCKS = new Set(["DIV", "P", "LI", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TR"]);

const size = (node) => (node.nodeType === TEXT ? node.length : node.textContent.length);

// A browser writes a no-break space where a trailing space would collapse.
// Markdown has no use for one. The read turns it back into a space.
const SPACE = /\u00a0/g;

// The tokens a line holds, with the ones that hold others flattened out: an
// image is a token of its own holding the markers and the picture.
const leaves = (tokens) =>
	(tokens ?? []).flatMap((token) => (token.children ? leaves(token.children) : [token]));

// The line endings a document arrives with when it comes off another system.
// One line of the document is one element here, and a carriage return left on
// the end of one is a character the server would store and the renderer would
// read as part of the text.
const RETURNS = /\r\n?/g;

// A line that is one link and no other text: the shape a file stands in when
// the link is the whole paragraph.
const ALONE = /^\s*\[([^\]\n]*)\]\(([^)\n]*?)(?:\s+"[^"]*")?\)\s*$/;

// The extensions a bare link draws as a file. A link to a page is a link
// wherever it stands; a link to a paper, an archive or a document reads best
// as the file it names.
const FILE_TYPES = new Set([
	"pdf", "doc", "docx", "odt", "rtf", "pages",
	"xls", "xlsx", "ods", "csv", "tsv", "numbers",
	"ppt", "pptx", "odp", "key",
	"txt", "md", "json", "xml", "yaml", "yml", "ics", "epub", "mobi",
	"zip", "gz", "tgz", "tar", "7z", "rar",
]);

// extensionOf answers the extension an address names, lower case and without
// the dot, or "" where it names none.
function extensionOf(href) {
	const path = String(href).split(/[?#]/)[0];
	const found = path.match(/\.([a-z0-9]{1,8})$/i);
	return found ? found[1].toLowerCase() : "";
}

// fileLink reads a link alone on its line as a file, or answers null. The
// marker itself draws a recording as a player and an image as a picture;
// this is the third kind: a paper, an archive, a document.
function fileLink(line) {
	const found = line.match(ALONE);
	if (!found) {
		return null;
	}

	const [, label, href] = found;
	const ext = extensionOf(href);
	if (!FILE_TYPES.has(ext) || mediaKind(href)) {
		return null;
	}

	return { href, label: label || href, ext };
}

// embedKind names what a line of nothing but markers points at, for the bar
// that stands beside it. The stylesheet writes the word.
const embedKind = (parts) => {
	if (parts.some((part) => part.picture !== undefined)) {
		return "Image";
	}

	const media = parts.find((part) => part.media !== undefined);
	if (media) {
		return media.media.kind === "audio" ? "Audio" : "Video";
	}

	return parts.some((part) => part.file !== undefined) ? "File" : "";
};

// The markdown one segment holds. A line holds its own characters; a widget
// holds the lines it stands in place of.
const read = (segment) => segment.dataset.block ?? segment.textContent.replace(SPACE, " ");

// within answers how many of a segment's characters stand before one DOM
// position in that segment.
function within(root, container, offset) {
	let total = 0;

	if (container.nodeType === TEXT) {
		total = offset;
	} else {
		for (let at = 0; at < offset && at < container.childNodes.length; at += 1) {
			total += size(container.childNodes[at]);
		}
	}

	for (let at = container; at && at !== root; at = at.parentNode) {
		for (let sibling = at.previousSibling; sibling; sibling = sibling.previousSibling) {
			total += size(sibling);
		}
	}

	return total;
}

// locate answers the DOM position one offset into an element names.
function locate(root, offset) {
	let total = 0;
	let last = null;

	for (const node of textNodes(root)) {
		if (offset <= total + node.length) {
			return { node, offset: offset - total };
		}
		total += node.length;
		last = node;
	}

	return last ? { node: last, offset: last.length } : { node: root, offset: 0 };
}

// cellOf answers the editable cell a node sits in, or null. A header, a group
// row and a rich row carry no data-row and take no caret.
const cellOf = (node) =>
	(node.nodeType === TEXT ? node.parentElement : node)?.closest('[contenteditable="true"][data-row][data-column]') ?? null;

function textNodes(root) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const out = [];
	while (walker.nextNode()) {
		out.push(walker.currentNode);
	}

	return out;
}

// The undo stack. The browser keeps one of its own, but that one does not
// survive a rewrite of the surface under it. The editor keeps this one.
class History {
	constructor(limit = 200) {
		this.limit = limit;
		this.done = [];
		this.undone = [];
	}

	commit(snapshot) {
		const last = this.done[this.done.length - 1];
		if (last && last.value === snapshot.value) {
			return;
		}

		this.done.push(snapshot);
		if (this.done.length > this.limit) {
			this.done.shift();
		}
		this.undone.length = 0;
	}

	undo(now) {
		const snapshot = this.done.pop();
		if (!snapshot) {
			return null;
		}

		this.undone.push(now);
		return snapshot;
	}

	redo(now) {
		const snapshot = this.undone.pop();
		if (!snapshot) {
			return null;
		}

		this.done.push(now);
		return snapshot;
	}

	forget() {
		this.done.length = 0;
		this.undone.length = 0;
	}
}

// One cell of a drawn table, as a source the ordinary moves run against.
//
// The caret in a cell stands in that cell's markdown and not in the
// document's. The surface answers for a widget from its first line; a
// tool, a paste or a Backspace read through the document would act on the
// table from outside the cell, many lines from where the writer is looking.
// Every move here acts on the cell's own characters, then writes the block's
// markdown back from the cells.
class Cell extends Source {
	constructor(surface, widget, cell) {
		super(null);
		this.surface = surface;
		this.widget = widget;
		this.cell = cell;
	}

	get value() {
		return this.cell.textContent.replace(SPACE, " ");
	}

	set value(text) {
		this.replace(0, this.value.length, text);
	}

	get selection() {
		const range = this.surface.live();
		if (!range || !this.cell.contains(range.startContainer)) {
			const end = this.value.length;
			return { start: end, end, text: "" };
		}

		const start = within(this.cell, range.startContainer, range.startOffset);
		const end = this.cell.contains(range.endContainer)
			? within(this.cell, range.endContainer, range.endOffset)
			: start;

		return { start, end, text: this.value.slice(start, end) };
	}

	select(from, to = from) {
		const start = this.surface.visible(locate(this.cell, from), this.cell);
		const end = to === from ? start : this.surface.visible(locate(this.cell, to), this.cell);
		const range = document.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);

		const selection = document.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		this.surface.mark = range.cloneRange();
	}

	focus(options) {
		this.cell.focus(options);
	}

	// replace writes the cell again and the block with it. A cell is one line
	// of one row. A newline in the arriving text becomes a space. Pasting
	// many lines fills the cell and leaves the row whole.
	replace(start, end, text, selectFrom, selectTo) {
		this.surface.commit();
		this.surface.history.commit({
			value: this.surface.value,
			caret: this.surface.startOf(this.widget),
		});

		const value = this.value;
		const insert = text.replace(/\s*\n\s*/g, " ");
		const next = value.slice(0, start) + insert + value.slice(end);

		const nodes = this.widget.dataset.kind === "frontmatter" ? this.surface.plain(next) : this.surface.cell(next);
		this.cell.replaceChildren(...nodes);
		this.widget.dataset.block = written(this.widget);

		if (selectFrom !== false) {
			const to = Math.min(selectFrom ?? start + insert.length, next.length);
			this.select(to, Math.min(selectTo ?? to, next.length));
		}
		this.surface.announce();
	}
}

export class Surface extends Source {
	constructor(editor, element, field) {
		super(field);
		this.editor = editor;
		this.element = element;
		this.prefix = editor.prefix;
		this.history = new History();
		// The state one run of typing started from, held until a word ends.
		this.pending = null;
		this.stamp = 0;
		this.composing = false;
		// The last selection seen inside the surface, for a tool that runs
		// while the focus sits on its button.
		this.mark = null;
		// What the host draws its own blocks for: a pattern over one line and
		// what to put beside it. See card().
		this.cards = editor.options?.cards?.pattern && editor.options.cards.render ? editor.options.cards : null;
		// The lines the writer asked to read as their markdown while the
		// picture, player or file they point at stands hidden. A line is the
		// key: the surface builds its elements again on every edit.
		this.sources = new Set();
	}

	// ── What the editor edits ─────────────────────────────────────────────

	get value() {
		return [...this.element.children].map(read).join("\n");
	}

	set value(text) {
		this.forget();
		this.load(text);
		this.announce();
	}

	// forget drops what the editor remembers of the document it holds. Ctrl-Z
	// cannot take back a host loading another document, and an undo across a
	// load would restore a document the writer never typed.
	forget() {
		this.pending = null;
		this.history.forget();
	}

	get selection() {
		const range = this.live();
		if (!range) {
			return { start: 0, end: 0, text: "" };
		}

		// A selection running from one cell of a drawn table to another is no
		// span of the document to act on: markdown says nothing about what
		// half a row would mean, and a tool handed those two offsets would
		// write over the pipes between them. The block answers for it, from
		// its first line, the way it does for the keys pressed there.
		const widget = this.segmentOf(range.startContainer);
		if (
			widget &&
			isWidget(widget) &&
			widget === this.segmentOf(range.endContainer) &&
			cellOf(range.startContainer) !== cellOf(range.endContainer)
		) {
			const block = this.startOf(widget);
			return { start: block, end: block, text: "" };
		}

		const start = this.offsetOf(range.startContainer, range.startOffset);
		const end = this.offsetOf(range.endContainer, range.endOffset);

		return { start, end, text: this.value.slice(start, end) };
	}

	select(from, to = from) {
		const start = this.positionAt(from);
		const end = to === from ? start : this.positionAt(to);
		const range = document.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);

		const selection = document.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		this.mark = range.cloneRange();
	}

	// `preventScroll` keeps the page at its scroll position. A caller that places the
	// caret scrolls to it itself; a browser that scrolls first lands somewhere
	// else and fights the caller.
	//
	// The focus goes to whichever editing host the caret already stands in. A
	// cell of a drawn table is a host of its own, and focusing the surface
	// over one moves the caret out of the cell to the head of the document: a
	// panel that put the caret on a word in a table would land it at the top
	// of the file.
	focus(options) {
		const range = this.live();
		const cell = range && cellOf(range.startContainer);

		(cell ?? this.element).focus(options);
		if (!this.live()) {
			this.select(0);
		}
	}

	// replace is the one way the document changes from outside the keyboard.
	// The edit rebuilds only the lines it touches. The lines above stay put and
	// the lines below shift.
	replace(start, end, text, selectFrom, selectTo) {
		this.commit();
		const before = this.value;
		this.history.commit({ value: before, caret: start });

		const after = before.slice(0, start) + text + before.slice(end);
		const segments = [...this.element.children];
		const bounds = [];
		let at = 0;
		for (const segment of segments) {
			const length = read(segment).length;
			bounds.push([at, at + length]);
			at += length + 1;
		}

		const find = (offset) => {
			const index = bounds.findIndex(([, to]) => offset <= to);
			return index < 0 ? segments.length - 1 : index;
		};
		const first = find(start);
		const last = find(end);
		const tail = before.length - bounds[last][1];
		const middle = after.slice(bounds[first][0], after.length - tail);

		const built = [];
		let carry = this.contextOf(segments[first]);
		for (const line of middle.split("\n")) {
			const element = document.createElement("div");
			carry = this.paint(element, line, carry);
			built.push(element);
		}

		segments[first].replaceWith(...built);
		for (let index = first + 1; index <= last; index += 1) {
			segments[index].remove();
		}
		this.carry(built[built.length - 1], carry);

		if (selectFrom !== false) {
			const to = selectFrom ?? start + text.length;
			this.select(to, selectTo ?? to);
		}
		this.decorate();
		this.announce();
	}

	// ── Drawing ───────────────────────────────────────────────────────────

	// load builds the whole surface. It runs when the host sets the document
	// and when a browser has restructured the surface past repair, never
	// while the writer types into it.
	load(source) {
		// The build starts over: the lines an upload's preview stood on vanish,
		// and the new lines claim the records again.
		this.editor.uploads?.release();

		const out = [];
		let context = null;

		for (const line of String(source).replace(RETURNS, "\n").split("\n")) {
			const element = document.createElement("div");
			context = this.paint(element, line, context);
			out.push(element);
		}

		this.element.replaceChildren(...out);
		this.decorate();
		this.markOpenFence();
	}

	// decorate draws the blocks that read better drawn than spelled out. The
	// run the caret stands in stays markdown: the typing stays as typed, and
	// the run draws once the writer moves on. The bar on a widget is the way
	// back into its markdown.
	decorate() {
		if (this.drawing || this.composing || this.frontmatterSource(document.activeElement)) {
			return;
		}

		this.drawing = true;
		try {
			this.decorateFrontmatter();

			const caret = this.live();
			const held = caret ? caret.commonAncestorContainer : null;

			for (const run of runs([...this.element.children], this.prefix)) {
				if (held && run.some((segment) => segment.contains(held))) {
					continue;
				}

				const widget = table(this, run.map(read).join("\n"));
				run[0].replaceWith(widget);
				for (const segment of run.slice(1)) {
					segment.remove();
				}
			}
		} finally {
			this.drawing = false;
		}
	}

	// decorateFrontmatter draws the fields at the head of the document.
	decorateFrontmatter() {
		const segments = [...this.element.children];
		if (!segments.length || isWidget(segments[0])) {
			return;
		}

		const model = frontmatterDetect(segments.map(read));
		if (!model) {
			return;
		}

		const run = segments.slice(0, model.closerLine + 1);
		if (run.some((segment) => isWidget(segment))) {
			return;
		}

		const caret = this.live();
		if (caret && run.some((segment) => segment.contains(caret.commonAncestorContainer))) {
			return;
		}

		const widget = frontmatter(this, run.map(read).join("\n"));
		run[0].replaceWith(widget);
		for (const segment of run.slice(1)) {
			segment.remove();
		}
	}

	// undecorate puts one widget back as the markdown lines it stands for,
	// with the caret in them. It draws itself again when the caret leaves.
	undecorate(widget) {
		const built = [];
		let carry = this.contextOf(widget);

		for (const line of read(widget).split("\n")) {
			const element = document.createElement("div");
			carry = this.paint(element, line, carry);
			built.push(element);
		}

		widget.replaceWith(...built);
		this.element.focus();
		this.place(built[0], 0);
	}

	// paint tokenises one line, draws it, and answers the context for the
	// line below.
	paint(element, line, context) {
		const token = tokenise(line, context);

		// A line the host draws its own block for is all marker, like an
		// image: the characters stay the document's and hide with the rest of
		// the markers, and the card stands beside them.
		const key = context === null ? this.cardKey(line) : null;
		if (key !== null) {
			token.name = "card";
			token.children = [{ mark: line }];
		}

		// A link alone on its line to a paper, an archive or a document is
		// drawn as the file it names, the way an image marker is drawn as its
		// picture: the characters stay the document's and the chip stands
		// beside them.
		const file = context === null ? fileLink(line) : null;
		if (file) {
			token.name = "file";
			token.children = [{ mark: line }, { file }];
		}

		element.className = `${this.prefix}__line ${this.prefix}-${token.name}`;
		if (context === null) {
			delete element.dataset.in;
		} else {
			element.dataset.in = context;
		}

		// A list item carries its own depth, so an indented item still reads
		// as a nested one once the markers that spell the indent are hidden.
		// Two spaces or one tab is one level, as markdown counts them.
		const indent = line.match(/^[\t ]*/)[0];
		const depth = indent.includes("\t")
			? indent.split("\t").length - 1
			: Math.floor(indent.length / 2);
		element.style.setProperty("--depth", String(depth));

		element.replaceChildren(...this.nodes(token.children));

		// A heading says which level it is written at, at the end of the line,
		// for the view where the hashes that say it are hidden. A line inside
		// a fenced block is code, hashes and all.
		const level = /^h[1-6]$/.test(token.name) ? levelOf(line) : 0;
		if (level > 0) {
			element.dataset.level = String(level);
			element.appendChild(this.label(level));
		} else {
			delete element.dataset.level;
		}

		element.toggleAttribute("data-card", key !== null);
		if (key !== null) {
			element.appendChild(this.card(key));
		}

		// A file on its way draws its preview beside the placeholder it stands
		// for. The preview carries no text, so the markdown and the caret
		// count the same characters with it there or without it. A line
		// inside a fence is code: nothing is drawn in one.
		const upload = context === null ? this.editor.uploads?.nodeFor(line, element) : null;
		element.toggleAttribute("data-upload", Boolean(upload));
		if (upload) {
			element.appendChild(upload);
			// The placeholder was the writer's promise that a file was on its
			// way, and the preview is that promise being kept, so the markdown
			// of it steps out of view while the file travels. Only the view:
			// the characters stay in the line, and so in the caret's count and
			// in the document. A file that is not a picture reads as a link,
			// so the span hiding it is whichever one holds the placeholder.
			const record = this.editor.uploads?.at(Number(upload.dataset.upload));
			if (record) {
				for (const span of element.querySelectorAll("span")) {
					if (span.textContent === record.placeholder) {
						span.dataset.placeholder = "true";
					}
				}
			}
		}

		// A line of nothing but markers has no text of its own to stand on
		// once they are hidden, and a line with no box in it holds no caret.
		const marked = (token.children ?? []).every((part) => part.mark !== undefined);
		element.toggleAttribute("data-marks-only", marked && token.children.length > 0);
		element.toggleAttribute("data-blank", line.trim() === "");
		// A marker alone on its line is a block wherever the document is
		// published, so what it points at - a picture, a player, a file -
		// stands at the margin here too, with air around it. One written
		// inside a sentence stays in the sentence.
		const parts = leaves(token.children);
		const embeds = parts.filter(
			(part) => part.picture !== undefined || part.media !== undefined || part.file !== undefined,
		);
		const embed = embeds.length > 0 && parts.every((part) => embeds.includes(part) || part.mark !== undefined);
		element.toggleAttribute("data-embed", embed);

		// What the block is and the two ways into it: the markdown it stands
		// for, and the line gone. A bar carries no text - the stylesheet
		// writes the kind - so it lands in no document either.
		if (embed && context === null) {
			element.appendChild(this.embedBar(element, embedKind(embeds)));
		}

		// A line the writer asked to read as its markdown keeps the markers
		// on and the picture, player or file off, until they ask for the
		// preview back.
		element.toggleAttribute("data-source", this.sources.has(line));
		if (element.textContent === "") {
			element.replaceChildren(document.createElement("br"));
		}

		return token.context;
	}

	nodes(tokens) {
		const out = [];

		for (const token of tokens ?? []) {
			if (token.text !== undefined) {
				out.push(document.createTextNode(token.text));
				continue;
			}
			if (token.mark !== undefined) {
				const classes = `${this.prefix}-mark${token.name ? ` ${this.prefix}-${token.name}` : ""}`;
				out.push(this.span(classes, token.mark));
				continue;
			}
			if (token.code !== undefined) {
				const holder = document.createElement("span");
				// The colourer writes escaped markup, so the text that comes
				// back out of the DOM is the line that went into it.
				holder.innerHTML = highlightCode(token.code, this.prefix, token.language);
				out.push(holder);
				continue;
			}
			if (token.picture !== undefined) {
				out.push(this.picture(token.picture));
				continue;
			}
			if (token.media !== undefined) {
				out.push(this.player(token.media));
				continue;
			}
			if (token.file !== undefined) {
				out.push(this.fileChip(token.file));
				continue;
			}

			const element = document.createElement("span");
			element.className = `${this.prefix}-${token.name}`;
			element.append(...this.nodes(token.children));
			out.push(element);
		}

		return out;
	}

	span(className, text) {
		const element = document.createElement("span");
		element.className = className;
		element.textContent = text;

		return element;
	}

	// picture draws what an image marker points at, beside the marker. It
	// carries no text, so the markdown the surface answers is the marker
	// alone and the caret counts the same characters either way.
	picture({ src, alt }) {
		const image = document.createElement("img");
		image.className = `${this.prefix}__pic`;
		image.alt = alt;
		image.src = src;
		image.contentEditable = "false";
		image.draggable = false;
		image.addEventListener("error", () => {
			image.dataset.state = "failed";
		});

		return image;
	}

	// player draws what a link to a playable file points at. A player loads
	// its length and no more until it is played: a document may carry an hour
	// of audio, and opening it to edit a sentence costs one short request.
	player({ src, kind, label }) {
		const media = document.createElement(kind);
		media.className = `${this.prefix}__media`;
		media.controls = true;
		media.preload = "metadata";
		media.src = src;
		media.contentEditable = "false";
		media.draggable = false;
		media.setAttribute("aria-label", label || src);
		media.addEventListener("error", () => {
			media.dataset.state = "failed";
		});

		return media;
	}

	// fileChip draws a link to a paper, an archive or a document as the file
	// it names. Like the picture and the player it carries no text: the label
	// and the extension ride in attributes and the stylesheet writes them.
	fileChip({ href, label, ext }) {
		const chip = document.createElement("span");
		chip.className = `${this.prefix}__file`;
		chip.dataset.label = label;
		chip.dataset.ext = ext;
		chip.dataset.href = href;
		chip.contentEditable = "false";

		const icon = document.createElement("span");
		icon.className = `icon icon-file`;
		icon.setAttribute("aria-hidden", "true");

		const name = document.createElement("span");
		name.className = `${this.prefix}__file-name`;
		name.dataset.name = label;

		const kind = document.createElement("span");
		kind.className = `${this.prefix}__file-ext`;
		kind.dataset.ext = ext.toUpperCase();

		chip.append(icon, name, kind);
		chip.setAttribute("role", "img");
		chip.setAttribute("aria-label", `${label} (${ext})`);

		return chip;
	}

	// embedBar stands beside a line that is nothing but a picture, a player
	// or a file: what the line holds, the way back to its markdown, and the
	// line gone. It is drawn from attributes alone - the kind is generated
	// content - so the bar adds no character to the document.
	embedBar(segment, kind) {
		const texts = this.editor.texts;
		const bar = document.createElement("span");
		bar.className = `${this.prefix}__embed-bar`;
		bar.contentEditable = "false";
		// A press on the bar is the bar's, not the image panel's.
		bar.addEventListener("click", (event) => event.stopPropagation());

		const label = document.createElement("span");
		label.className = `${this.prefix}__embed-kind`;
		label.dataset.kind = kind;
		label.setAttribute("aria-hidden", "true");

		const source = tool({
			prefix: this.prefix,
			key: "embed-source",
			icon: "icon-code",
			title: texts.source,
			run: (event) => {
				event.stopPropagation();
				this.toggleSource(segment, source);
			},
		});
		source.setAttribute("aria-pressed", String(this.sources.has(read(segment))));

		const remove = tool({
			prefix: this.prefix,
			key: "embed-delete",
			icon: "icon-trash",
			title: texts.delete,
			run: (event) => {
				event.stopPropagation();
				this.removeLine(segment);
			},
		});

		bar.append(label, source, remove);
		return bar;
	}

	// toggleSource switches one line between what it draws and the markdown
	// it is written as. The markers show on that line either way: a source
	// view with the source hidden is no source view.
	toggleSource(segment, button) {
		const line = read(segment);
		const on = !this.sources.has(line);

		if (on) {
			this.sources.add(line);
		} else {
			this.sources.delete(line);
		}

		segment.toggleAttribute("data-source", on);
		button.setAttribute("aria-pressed", String(on));
		this.editor.emit("source", { line, source: on });
	}

	// removeLine takes one line out of the document, with the newline that
	// ended it, and leaves the caret where the line began: the writer is
	// looking at the block they just took away.
	removeLine(segment) {
		if (!segment || !this.element.contains(segment)) {
			return;
		}

		const start = this.startOf(segment);
		const length = read(segment).length;
		const last = segment === this.element.lastElementChild;
		const first = segment === this.element.firstElementChild;

		this.sources.delete(read(segment));
		if (!last) {
			this.replace(start, start + length + 1, "", start);
			return;
		}
		if (!first) {
			this.replace(start - 1, start + length, "", start - 1);
			return;
		}

		this.replace(start, start + length, "", 0);
	}

	// cardKey answers what the host would draw a card for on one line, or
	// null. The capture names it where the pattern has one, the whole line
	// where it does not.
	cardKey(line) {
		if (!this.cards) {
			return null;
		}

		const found = line.trim().match(this.cards.pattern);
		return found ? (found[1] ?? found[0]) : null;
	}

	// card draws the block a host answers for one of its own markers: a
	// citation, an embedded video, whatever the project's documents carry a
	// marker for.
	//
	// It is drawn in a root of its own. The surface reads the document out of
	// the characters in its lines, so a title or a byline sitting in one
	// would be in what the form posts; a shadow root keeps the host's markup
	// out of the line's text, the way a picture carries none. The host's own
	// stylesheet goes in with it, since the page's rules do not reach inside.
	//
	// A link in a card leaves for another tab: a click here is a click in an
	// editor holding an unsaved document.
	card(key) {
		const element = document.createElement("span");
		element.className = `${this.prefix}__card`;
		element.dataset.key = key;
		element.contentEditable = "false";

		const root = element.attachShadow({ mode: "open" });
		if (this.cards.styles) {
			const style = document.createElement("style");
			style.textContent = this.cards.styles;
			root.appendChild(style);
		}

		Promise.resolve(this.cards.render(key, this.editor))
			.then((content) => {
				if (typeof content === "string") {
					const holder = document.createElement("div");
					holder.innerHTML = content;
					root.appendChild(holder);
				} else if (content) {
					root.appendChild(content);
				}
				for (const link of root.querySelectorAll("a[href]")) {
					link.target = "_blank";
					link.rel = "noopener";
				}
			})
			.catch((error) => this.editor.emit("error", { phase: "card", error }));

		return element;
	}

	// label draws the level a heading is written at, at the end of its line.
	// It carries no text: the stylesheet writes the level, so the markdown
	// the surface answers is the writer's own characters and the caret counts
	// the same ones either way.
	label(level) {
		const element = document.createElement("span");
		element.className = `${this.prefix}__level`;
		element.dataset.level = String(level);
		element.contentEditable = "false";
		element.setAttribute("role", "button");
		element.setAttribute("aria-label", `${this.editor.texts.heading} ${level}`);

		return element;
	}

	// levelAt answers the level one line of the surface is written at, and 0
	// for a line that is not a heading.
	levelAt(segment) {
		return segment && this.element.contains(segment) ? levelOf(read(segment)) : 0;
	}

	// setLevel writes one line as a heading of the level named, or as a
	// paragraph at level zero, and leaves the caret where the text starts.
	setLevel(segment, level) {
		if (!segment || !this.element.contains(segment)) {
			return;
		}

		const start = this.startOf(segment);
		const had = read(segment).match(PREFIX)?.[0].length ?? 0;
		const want = prefixOf(Math.min(Math.max(level, 0), LEVELS));

		this.replace(start, start + had, want, start + want.length);
	}

	// cell answers the nodes for one table cell: a cell holds markdown, and
	// it reads here the way a line does.
	cell(text) {
		const nodes = this.nodes(inlineTokens(text));
		return nodes.length ? nodes : [document.createElement("br")];
	}

	// plain answers the nodes for one front matter cell.
	plain(text) {
		return text === "" ? [document.createElement("br")] : [document.createTextNode(text)];
	}

	contextOf(segment) {
		return segment && "in" in segment.dataset ? segment.dataset.in : null;
	}

	// carry paints the lines below an edit until the fence context agrees
	// again: opening or closing a fence changes how every line under it
	// reads.
	carry(from, context) {
		let carry = context;
		for (let next = from.nextElementSibling; next; next = next.nextElementSibling) {
			// A widget is a block of its own and reads the same inside a
			// fence or outside one, so the ripple stops at it.
			if (isWidget(next) || this.contextOf(next) === carry) {
				return;
			}
			carry = this.paint(next, read(next), carry);
		}
	}

	// ── Where the caret is ────────────────────────────────────────────────

	live() {
		const selection = document.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			if (this.element.contains(range.commonAncestorContainer)) {
				return range;
			}
		}

		// The focus has moved to a button on the bar: the last place the
		// caret stood is where the tool acts.
		if (this.mark && this.element.contains(this.mark.commonAncestorContainer)) {
			return this.mark;
		}

		return null;
	}

	// active answers the source the next move acts on: one cell of a drawn
	// table when the caret stands in one, and the document itself everywhere
	// else. A tool, a paste and an upload all go through this, so none of
	// them has to know a table is drawn as a table.
	get active() {
		const found = this.widgetAt();
		return found?.cell ? new Cell(this, found.widget, found.cell) : this;
	}

	// cellSource answers one named cell as a source of its own, for a panel
	// that found its cell by something other than the caret.
	cellSource(cell) {
		const widget = this.segmentOf(cell);
		return widget && isWidget(widget) ? new Cell(this, widget, cell) : null;
	}

	// widgetAt answers the drawn table the caret stands in, and the cell with
	// it when the whole selection is inside one. A selection that runs across
	// cells names the widget and no cell: there is no one cell to edit.
	widgetAt() {
		const range = this.live();
		const segment = range && this.segmentOf(range.startContainer);
		if (!segment || !isWidget(segment)) {
			return null;
		}

		const cell = cellOf(range.startContainer);
		return { widget: segment, cell: cell?.contains(range.endContainer) ? cell : null };
	}

	// offsetIn answers how many of an element's characters stand before one
	// of its children: what the image panel needs to find the marker a
	// picture stands on.
	offsetIn(element, child) {
		const parent = child.parentNode;
		return within(element, parent, [...parent.childNodes].indexOf(child));
	}

	segmentOf(node) {
		let at = node;
		while (at && at !== this.element && at.parentNode !== this.element) {
			at = at.parentNode;
		}

		return at && at !== this.element ? at : null;
	}

	startOf(segment) {
		let total = 0;
		for (const child of this.element.children) {
			if (child === segment) {
				return total;
			}
			total += read(child).length + 1;
		}

		return Math.max(0, total - 1);
	}

	offsetOf(container, offset) {
		const segment = this.segmentOf(container);
		if (!segment) {
			// The position names the surface itself and the child it stands
			// before.
			return this.startOf(this.element.children[offset] ?? null);
		}
		if (isWidget(segment)) {
			// A cell carries one stretch of the block's markdown, so a
			// position in a cell is a position in the document and counts
			// back into it. The position has to be read the same way it is
			// written - inside() takes the caret the other way - or a caret
			// put on a word in a table reads back as the table.
			//
			// Anywhere else in a widget - the bar, or a column a short row
			// was padded out to - there is no character of the document under
			// the position, so the block answers from its first line.
			const cell = cellOf(container);
			const map = segment.dataset.kind === "frontmatter" ? frontmatterOffset : cellOffset;
			const found = cell
				? map(read(segment), Number(cell.dataset.row), Number(cell.dataset.column), within(cell, container, offset))
				: null;

			return this.startOf(segment) + (found ?? 0);
		}

		return this.startOf(segment) + within(segment, container, offset);
	}

	positionAt(want) {
		let at = 0;
		for (const segment of this.element.children) {
			const length = read(segment).length;
			if (want <= at + length) {
				return this.inside(segment, want - at);
			}
			at += length + 1;
		}

		const last = this.element.lastElementChild;
		return last ? this.inside(last, read(last).length) : { node: this.element, offset: 0 };
	}

	// inside answers the DOM position one offset into a segment names.
	inside(segment, offset) {
		if (isWidget(segment)) {
			// A widget takes no caret itself, but its cells do: an offset
			// inside the block names a character of one of them, and that is
			// where a panel sending the writer to a word in a table means.
			const block = read(segment);
			if (offset > 0 && offset < block.length) {
				const found = segment.dataset.kind === "frontmatter" ? frontmatterAt(block, offset) : cellAt(block, offset);
				const cell = found && segment.querySelector(`[data-row="${found.row}"][data-column="${found.column}"]`);
				if (cell) {
					return this.visible(locate(cell, found.at), cell);
				}
			}

			// The edges have no cell to stand in, and neither have the pipes
			// and the alignment row between them, so the caret stands beside
			// the block: after it where the offset names the end of its last
			// line, which is the only way to reach the foot of a document a
			// table ends.
			const index = [...this.element.children].indexOf(segment);
			return { node: this.element, offset: offset >= block.length ? index + 1 : index };
		}

		return this.visible(locate(segment, offset), segment);
	}

	// edge answers where a caret standing between two blocks is, or null. A
	// widget takes no caret, so the caret stands before it or after it, and
	// there the browser has no line to move through or to type into.
	edge() {
		const range = this.live();
		if (!range || !range.collapsed || range.startContainer !== this.element) {
			return null;
		}

		return { index: range.startOffset, at: this.offsetOf(this.element, range.startOffset) };
	}

	// visible keeps the caret out of a marker the toggle has hidden: there is
	// no box to draw one in, so it moves to the nearest character the writer
	// can see.
	visible(position, segment) {
		if (this.editor.marks || !this.hidden(position.node)) {
			return position;
		}

		const nodes = textNodes(segment);
		const at = nodes.indexOf(position.node);
		for (let index = at + 1; index < nodes.length; index += 1) {
			if (!this.hidden(nodes[index])) {
				return { node: nodes[index], offset: 0 };
			}
		}

		// Nothing visible follows, so the caret belongs past the markers, at
		// the end of the line - never back before them. The character ahead
		// of a closing marker is inside the construct that marker closes:
		// landing there is how a code span stops closing. Type the backtick
		// that ends `x` and the caret would sit between x and the tick, so
		// the next letter lands inside the span and the span never ends.
		//
		// The end of the segment draws in the same place the last visible
		// character does - the markers take no box - and it is the offset
		// after them, which is where the writer just typed to.
		return { node: segment, offset: segment.childNodes.length };
	}

	hidden(node) {
		return Boolean(node.parentElement?.closest(`.${this.prefix}-mark`));
	}

	// ── Typing ────────────────────────────────────────────────────────────

	attach(signal) {
		const on = (name, handler) => this.element.addEventListener(name, handler, { signal });

		on("beforeinput", (event) => this.before(event));
		on("input", (event) => this.after(event));
		on("keydown", (event) => this.keydown(event));
		on("paste", (event) => this.paste(event));
		on("drop", (event) => this.drop(event));
		on("dragover", (event) => event.preventDefault());
		on("compositionstart", () => {
			this.composing = true;
		});
		on("compositionend", () => {
			this.composing = false;
			this.after();
		});

		document.addEventListener("selectionchange", () => this.remember(), { signal });
	}

	remember() {
		if (this.frontmatterSource(document.activeElement)) {
			return;
		}

		const selection = document.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return;
		}

		const range = selection.getRangeAt(0);
		if (this.element.contains(range.commonAncestorContainer)) {
			this.mark = range.cloneRange();
		}

		// A block the caret has left can draw itself.
		this.decorate();
	}

	// frontmatterSource answers the YAML source field a node belongs to.
	frontmatterSource(node) {
		return node?.closest?.(`.${this.prefix}__frontmatter-source`) ?? null;
	}

	before(event) {
		if (this.frontmatterSource(event.target)) {
			return;
		}

		if (!this.pending) {
			this.pending = { value: this.value, caret: this.selection.start };
		}

		// A word ends at a space, and anything that is not plain typing ends
		// a run of its own: that is where one undo step stops.
		this.boundary =
			event.inputType !== "insertText" ||
			/\s/.test(event.data ?? " ") ||
			Date.now() - this.stamp > COALESCE;

		this.typePastMarkers(event);
	}

	// typePastMarkers writes the character itself when the caret stands past
	// the end of the visible line, after markers the toggle has hidden.
	//
	// There is no box after a hidden marker, so that caret is a position on
	// the line element rather than one inside a character of it. A browser
	// asked to insert there falls back to the last place it can draw, which
	// is before the markers and therefore inside the construct they close:
	// the backtick closing `x` would be stepped over and the next letter
	// would land in the span, which never ends. The offset is not in doubt -
	// visible() put the caret there - so the edit is made against it.
	typePastMarkers(event) {
		if (event.inputType !== "insertText" || typeof event.data !== "string") {
			return;
		}

		const range = this.live();
		// A text node is a position the browser resolves the same way this
		// does; only the element-level one is ambiguous.
		if (!range || range.startContainer.nodeType === TEXT) {
			return;
		}

		// A caret between two blocks, and one in a drawn table, are each
		// somebody else's path.
		const segment = this.segmentOf(range.startContainer);
		if (!segment || isWidget(segment)) {
			return;
		}

		event.preventDefault();
		const { start, end } = this.selection;
		this.replace(start, end, event.data, start + event.data.length);
		this.stamp = Date.now();
	}

	// after is the typing path: one line changed, so one line is tokenised
	// again and the caret goes back where the writer left it.
	after(event) {
		if (this.frontmatterSource(event?.target)) {
			this.frontmatterSourceInput(event.target);
			return;
		}

		if (this.composing) {
			return;
		}

		const range = this.live();
		const segment = range && this.segmentOf(range.startContainer);

		if (segment && isWidget(segment)) {
			this.cellInput(segment, range);
			return;
		}

		if (!segment || !this.intact(segment)) {
			// The browser restructured the surface under us. Read the text
			// back out of whatever it left and build the document again.
			const caret = range ? this.offsetOf(range.startContainer, range.startOffset) : 0;
			this.load(this.text());
			this.select(caret);
		} else {
			const at = within(segment, range.startContainer, range.startOffset);
			this.retokenise(segment);
			this.place(segment, at);
		}

		if (this.boundary) {
			this.commit();
		}
		this.stamp = Date.now();
		this.announce();
	}

	// cellInput takes a keystroke in a table cell. The cell is tokenised
	// again the way a line is, and the block's markdown is written back off
	// its cells: the document is what the widget answers, not what it draws.
	cellInput(widget, range) {
		const cell = cellOf(range.startContainer);
		if (cell) {
			const at = within(cell, range.startContainer, range.startOffset);
			const text = cell.textContent.replace(SPACE, " ");
			const nodes = widget.dataset.kind === "frontmatter" ? this.plain(text) : this.cell(text);
			cell.replaceChildren(...nodes);
			this.place(cell, at);
		}

		widget.dataset.block = written(widget);
		if (this.boundary) {
			this.commit();
		}
		this.stamp = Date.now();
		this.announce();
	}

	intact(segment) {
		return (
			// A bare text node the browser left at a widget's edge is not a
			// line and cannot be tokenised in place.
			segment.nodeType === ELEMENT &&
			segment.classList.contains(`${this.prefix}__line`) &&
			segment.dataset.block === undefined &&
			!segment.querySelector("div, p, li, br + *")
		);
	}

	retokenise(segment) {
		const carry = this.paint(segment, read(segment), this.contextOf(segment));
		this.carry(segment, carry);
	}

	place(segment, offset) {
		const position = this.inside(segment, offset);
		const range = document.createRange();
		range.setStart(position.node, position.offset);
		range.collapse(true);

		const selection = document.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		this.mark = range.cloneRange();
	}

	// text reads the markdown out of a surface a browser has restructured:
	// every block element ends a line, and so does a break that has anything
	// after it. textContent is what it reads, so a hidden marker counts.
	text() {
		const lines = [];
		let current = "";

		const walk = (node) => {
			for (const child of node.childNodes) {
				if (child.nodeType === TEXT) {
					current += child.data;
					continue;
				}
				if (child.nodeName === "BR") {
					if (child.nextSibling) {
						lines.push(current);
						current = "";
					}
					continue;
				}
				// A widget answers for the lines it stands in place of. Reading
				// into it would read the cells and the buttons on its bar.
				if (isWidget(child)) {
					current += child.dataset.block;
					continue;
				}

				const block = BLOCKS.has(child.nodeName);
				if (block && current !== "") {
					lines.push(current);
					current = "";
				}
				walk(child);
				if (block) {
					lines.push(current);
					current = "";
				}
			}
		};

		walk(this.element);
		if (current !== "") {
			lines.push(current);
		}

		return lines.join("\n").replace(SPACE, " ");
	}

	// ── The keys that would restructure the surface ───────────────────────

	keydown(event) {
		if (this.frontmatterSource(event.target)) {
			return;
		}

		const meta = event.metaKey || event.ctrlKey;
		const key = event.key.toLowerCase();

		if (meta && (key === "z" || key === "y")) {
			event.preventDefault();
			if (key === "y" || event.shiftKey) {
				this.redo();
			} else {
				this.undo();
			}
			return;
		}
		// Ctrl-Home and Ctrl-End name the ends of the document. A browser
		// cannot reach the foot of one that ends in a drawn table - there is
		// no line down there to hold a caret - and answers the top instead,
		// which puts the next keystroke at the wrong end of the file.
		if (meta && (key === "home" || key === "end")) {
			event.preventDefault();
			if (key === "end" && !event.shiftKey && this.tail()) {
				return;
			}

			const to = key === "end" ? this.value.length : 0;
			const from = event.shiftKey ? this.selection.start : to;
			this.select(Math.min(from, to), Math.max(from, to));
			return;
		}

		// A drawn table is an island. The keys that would edit the document
		// from inside it are answered against the cell the caret is in.
		const inside = this.widgetAt();
		if (inside) {
			this.widgetKey(event, inside, meta, key);
			return;
		}
		if (meta) {
			return;
		}

		if (!this.editor.marks && this.levelKey(event)) {
			return;
		}

		if (this.edgeKey(event)) {
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			const { start, end } = this.selection;
			if (!event.shiftKey && start === end && (this.fenceEnter(start) || this.listEnter(start))) {
				return;
			}

			// Shift-Enter is markdown's hard break: two spaces and a newline.
			const text = event.shiftKey ? "  \n" : "\n";
			this.replace(start, end, text, start + text.length);
			return;
		}

		if (event.key === "Backspace" || event.key === "Delete") {
			const { start, end } = this.selection;
			if (start !== end) {
				event.preventDefault();
				this.replace(start, end, "", start);
				return;
			}

			const value = this.value;
			const back = event.key === "Backspace";
			// At the head or the foot of a line the browser would join two
			// elements of its own choosing. The markdown says what it means:
			// one newline, gone.
			const joins = back ? start > 0 && value[start - 1] === "\n" : value[start] === "\n";
			if (joins) {
				event.preventDefault();
				const at = back ? start - 1 : start;
				this.replace(at, at + 1, "", at);
			}
		}
	}

	// fenceEnter closes a fenced block nothing closes, and answers whether it
	// had one to close.
	//
	// Inside a block every key is a character of the code, Enter included, so
	// a writer who opened one at the foot of a document has no way out of it
	// but to type the fence again - and nothing on the page says that is what
	// they have to do. A blank line, then Enter on a second blank line, is
	// the gesture a writer reaches for, and it writes the fence: the two
	// blank lines they typed to escape go, and the caret lands below the
	// block.
	fenceEnter(at) {
		const range = this.live();
		const segment = range && this.segmentOf(range.startContainer);
		// `data-in` is the language a line is read in, so a line that carries
		// it stands inside a block.
		if (!segment || isWidget(segment) || !("in" in segment.dataset)) {
			return false;
		}

		const value = this.value;
		const from = value.lastIndexOf("\n", at - 1) + 1;
		const end = value.indexOf("\n", at);
		const to = end < 0 ? value.length : end;

		// This line and the one above it: both blank, or the gesture is not
		// this one. A blank line is a line of code like any other.
		if (from === 0 || value.slice(from, to).trim() !== "") {
			return false;
		}
		const above = value.lastIndexOf("\n", from - 2) + 1;
		if (value.slice(above, from - 1).trim() !== "") {
			return false;
		}

		// A fence anywhere below closes the block already.
		const lines = value.slice(to).split("\n");
		if (lines.some((line) => FENCE.test(line))) {
			return false;
		}

		// The block is closed by what opened it, indent and ticks alike.
		let opener = null;
		for (const line of value.slice(0, above).split("\n").reverse()) {
			const found = line.match(FENCE);
			if (found) {
				opener = `${found[1]}${found[2]}`;
				break;
			}
		}
		if (opener === null) {
			return false;
		}

		this.replace(above, to, `${opener}\n`, above + opener.length + 1);

		return true;
	}

	// listEnter carries a list on to its next item, and answers whether the
	// caret stands in one.
	//
	// A list is a column of lines that each start with the same marker, and
	// typing that marker again on every line is the writer doing the
	// editor's work. Enter at the end of an item opens the next one with its
	// marker already there, indented as deep as the item it came from, and a
	// numbered list counts on. Enter in the middle of one splits it, both
	// halves still items.
	//
	// Enter on an item with nothing in it ends the list: the marker goes, the
	// line it stood on is left blank - which is the line markdown wants
	// between a list and the paragraph after it - and the caret lands on a
	// line of its own below.
	listEnter(at) {
		const value = this.value;
		const from = value.lastIndexOf("\n", at - 1) + 1;
		const end = value.indexOf("\n", at);
		const to = end < 0 ? value.length : end;

		const found = value.slice(from, to).match(ITEM);
		// A caret inside the marker is a caret in the characters themselves,
		// and Enter there is the line break it says it is.
		if (!found || at < from + found[1].length) {
			return false;
		}

		if (found[2].trim() === "") {
			this.replace(from, to, "\n", from + 1);
			return true;
		}

		// A numbered list counts on; a bullet repeats.
		const marker = found[1].replace(/\d+/, (number) => String(Number(number) + 1));
		this.replace(at, at, `\n${marker}`, at + 1 + marker.length);

		return true;
	}

	// levelKey answers the two keys that move a heading between its levels,
	// and whether it had one to move.
	//
	// With the hashes hidden there are no characters on the page to edit: the
	// caret stands at the head of the heading's text, and the keys a writer
	// reaches for there are a hash for one level deeper and Backspace for one
	// back. Backspace on a first-level heading leaves a paragraph, which is
	// the way out of the construct altogether. Left to the browser, both
	// would edit the hidden prefix and leave a line of `##text` that is no
	// longer a heading at all.
	levelKey(event) {
		if ((event.key !== "Backspace" && event.key !== "#") || event.altKey) {
			return false;
		}

		const range = this.live();
		if (!range || !range.collapsed) {
			return false;
		}

		const segment = this.segmentOf(range.startContainer);
		if (!segment || isWidget(segment) || segment.dataset.level === undefined) {
			return false;
		}

		const prefix = read(segment).match(PREFIX);
		if (!prefix || within(segment, range.startContainer, range.startOffset) !== prefix[0].length) {
			return false;
		}

		const level = prefix[1].length;
		const want = event.key === "#" ? Math.min(level + 1, LEVELS) : level - 1;
		// A sixth-level heading has nowhere deeper to go, so the hash is the
		// character it is.
		if (want === level) {
			return false;
		}

		event.preventDefault();
		this.setLevel(segment, want);

		return true;
	}

	// tail opens the line at the foot of a document that ends in a drawn
	// table, and answers whether it had to.
	//
	// A browser keeps no caret beside a block it cannot edit: it abandons the
	// position the moment a key arrives, so there is no standing after such a
	// table to press Enter from. Markdown holds no position after a table
	// either - the end of its last row is the end of the file - so Ctrl-End
	// and Down write the newline that puts a line below it.
	tail(widget = this.element.lastElementChild) {
		const last = this.element.lastElementChild;
		if (!last || last !== widget || !isWidget(last)) {
			return false;
		}

		const at = this.value.length;
		this.replace(at, at, "\n", at + 1);

		return true;
	}

	// edgeKey answers the keys pressed with the caret at the edge of a drawn
	// table. There is no line there for a browser to work on: it drops a
	// keystroke on the floor and a Backspace takes the whole widget out of
	// the surface, so the edit is made in the markdown at that offset. The
	// selection is read at keydown, since a browser moves the caret off the
	// edge of its own accord before it reports the input.
	edgeKey(event) {
		const edge = this.edge();
		if (!edge) {
			return false;
		}

		if (event.key.length === 1 && !event.altKey) {
			event.preventDefault();
			this.replace(edge.at, edge.at, event.key, edge.at + event.key.length);
			return true;
		}
		if (event.key === "Backspace" && edge.at > 0) {
			event.preventDefault();
			this.replace(edge.at - 1, edge.at, "", edge.at - 1);
			return true;
		}
		if (event.key === "Delete" && edge.at < this.value.length) {
			event.preventDefault();
			this.replace(edge.at, edge.at + 1, "", edge.at);
			return true;
		}

		return false;
	}

	// widgetKey answers the keys pressed inside a drawn table. Inside one
	// cell the browser may edit the characters itself - a cell is an editing
	// host of its own and cellInput() writes the block back off it - and
	// everything that would reach past the cell is answered here.
	widgetKey(event, { widget, cell }, meta, key) {
		if (meta) {
			// Select-all in a cell takes the cell. The browser takes the whole
			// surface, which puts the whole document behind the next
			// keystroke.
			if (key === "a" && cell) {
				event.preventDefault();
				const source = new Cell(this, widget, cell);
				source.select(0, source.value.length);
			}
			return;
		}

		// A selection across cells: no one cell is being edited, and the
		// markdown says nothing about what half a row would mean. The browser
		// would take the table apart, so these keys do nothing instead.
		if (!cell) {
			if (event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") {
				event.preventDefault();
			}
			return;
		}

		// A cell of a markdown table is one line, so Enter writes nothing.
		// Tab at the foot of the table is what adds a row.
		if (event.key === "Enter") {
			event.preventDefault();
		}

		if (event.key === "Backspace" && this.backCell(widget, cell)) {
			event.preventDefault();
			return;
		}

		// Down out of the last row of a table that ends the document: there
		// is no line under it to move into, so the key opens one.
		const rows = [...widget.querySelectorAll("tr")];
		if (event.key === "ArrowDown" && cell.closest("tr") === rows[rows.length - 1] && this.tail(widget)) {
			event.preventDefault();
		}
	}

	// backCell answers Backspace in an empty cell, and whether it had
	// anything to answer.
	//
	// There are no characters left to take out, so the key means the cell
	// before this one. In the first cell of a row with nothing in any of its
	// cells it means the row: the writer added it with Tab, left it empty,
	// and Backspace is how a row goes away again.
	backCell(widget, cell) {
		const source = new Cell(this, widget, cell);
		if (source.value !== "" || source.selection.start !== 0) {
			return false;
		}

		if (widget.dataset.kind === "frontmatter") {
			return this.backFrontmatterCell(widget, cell);
		}

		const line = cell.closest("tr");
		const first = cell === line.firstElementChild;
		const bare = [...line.children].every((other) => other.textContent.trim() === "");
		const row = Number(cell.dataset.row ?? 0);

		if (first && bare && row > 0) {
			const table = parse(widget.dataset.block);
			table.rows.splice(row, 1);
			this.rewrite(widget, format(table), {
				row: Math.max(row - 1, 0),
				column: Math.max(table.alignments.length - 1, 0),
			});
			this.editor.emit("change", { value: this.value });
			return true;
		}

		const cells = [...widget.querySelectorAll("th, td")];
		const back = cells[cells.indexOf(cell) - 1];
		if (!back) {
			return true;
		}

		const previous = this.enter(widget, back);
		previous.select(previous.value.length);

		return true;
	}

	// stepCell moves the caret on to the next cell of a drawn table, or back
	// to the one before it, and answers whether the caret stands in a cell:
	// Tab in a table is how a writer crosses it.
	stepCell(forward) {
		const found = this.widgetAt();
		if (!found?.cell) {
			return false;
		}

		const cells = [...found.widget.querySelectorAll('[contenteditable="true"][data-row][data-column]')];
		const next = cells[cells.indexOf(found.cell) + (forward ? 1 : -1)];
		if (next) {
			this.enter(found.widget, next);
			return true;
		}

		// Tab off the last cell grows the table: a row of empty cells, with
		// the writer in the first of them. A table is left by clicking or
		// tapping outside it, so Shift-Tab off the first cell keeps the
		// caret where it stands.
		if (forward) {
			this.addRow(found.widget);
		}

		return true;
	}

	// enter puts the caret in one cell of a drawn table, with what the cell
	// already holds selected, the way Tab arrives in a cell.
	enter(widget, cell) {
		const source = new Cell(this, widget, cell);
		cell.focus();
		source.select(0, source.value.length);

		return source;
	}

	// addRow puts a row of empty cells at the foot of a drawn table and the
	// caret in the first of them.
	addRow(widget) {
		if (widget.dataset.kind === "frontmatter") {
			this.frontmatterAddRow(widget);
			return;
		}

		const table = parse(widget.dataset.block);
		table.rows.push(Array(table.alignments.length).fill(""));

		this.rewrite(widget, format(table), { row: table.rows.length - 1, column: 0 });
		this.editor.emit("change", { value: this.value });
	}

	// frontmatterAddRow puts an empty key and value at the foot of the fields.
	frontmatterAddRow(widget) {
		if (widget.dataset.mode === "source") {
			return;
		}

		const body = widget.querySelector("tbody");
		if (!body) {
			return;
		}

		const last = [...body.querySelectorAll("tr")].pop();
		const lastKey = last?.querySelector('[data-column="0"]');
		if (last?.hasAttribute("data-new") && lastKey) {
			this.enter(widget, lastKey);
			return;
		}

		const index = String(widget.querySelectorAll("tbody tr[data-row]").length);
		const line = document.createElement("tr");
		line.dataset.new = "true";
		line.dataset.row = index;

		const key = document.createElement("td");
		key.className = `${this.prefix}__frontmatter-key`;
		key.contentEditable = "true";
		key.dataset.row = index;
		key.dataset.column = "0";
		key.replaceChildren(...this.plain(""));

		const value = document.createElement("td");
		value.className = `${this.prefix}__frontmatter-value`;
		value.contentEditable = "true";
		value.dataset.row = index;
		value.dataset.column = "1";
		value.replaceChildren(...this.plain(""));

		line.append(key, value);
		body.appendChild(line);
		this.enter(widget, key);
	}

	// backFrontmatterCell answers Backspace in an empty field.
	backFrontmatterCell(widget, cell) {
		const line = cell.closest("tr");

		if (line?.hasAttribute("data-new")) {
			const key = line.querySelector('[data-column="0"]');
			if (key && key !== cell) {
				const previous = this.enter(widget, key);
				previous.select(previous.value.length);
				return true;
			}

			const rows = [...widget.querySelectorAll("tbody tr")].filter(
				(row) => !row.classList.contains(`${this.prefix}__frontmatter-group`),
			);
			const at = rows.indexOf(line);
			line.remove();
			const before = rows[at - 1];
			const target = before?.querySelector('[contenteditable="true"][data-column="1"]') ?? before?.querySelector('[contenteditable="true"][data-column="0"]');
			if (target) {
				const previous = this.enter(widget, target);
				previous.select(previous.value.length);
			}
			return true;
		}

		const cells = [...widget.querySelectorAll('[contenteditable="true"][data-row][data-column]')];
		const before = cells[cells.indexOf(cell) - 1];
		if (before) {
			const previous = this.enter(widget, before);
			previous.select(previous.value.length);
		}

		return true;
	}

	// toggleFrontmatterSource swaps the fields for the YAML source and back.
	toggleFrontmatterSource(widget, button) {
		const field = widget.querySelector(`textarea.${this.prefix}__frontmatter-source`);

		if (field) {
			const source = field.value.replace(RETURNS, "\n");
			const model = frontmatterComplete(source);
			if (!model) {
				widget.setAttribute("data-invalid", "");
				field.setAttribute("aria-invalid", "true");
				field.title = this.editor.texts.frontmatterInvalid;
				return;
			}

			widget.removeAttribute("data-invalid");
			widget.removeAttribute("data-mode");
			field.removeAttribute("aria-invalid");
			const markdown = model.lines.join("\n");
			const first = model.data.find((row) => row.editableValue);
			widget.dataset.block = markdown;
			this.rewrite(widget, markdown, first ? { row: first.row, column: first.editableKey ? 0 : 1 } : null);
			return;
		}

		this.commit();
		this.history.commit({ value: this.value, caret: this.startOf(widget) });

		const textarea = document.createElement("textarea");
		textarea.className = `${this.prefix}__frontmatter-source`;
		textarea.spellcheck = false;
		textarea.value = widget.dataset.block;
		textarea.rows = Math.max(3, widget.dataset.block.split("\n").length);
		textarea.setAttribute("aria-label", this.editor.texts.frontmatter);
		widget.setAttribute("data-mode", "source");
		widget.appendChild(textarea);
		button?.setAttribute("aria-pressed", "true");
		textarea.focus();
		textarea.setSelectionRange(0, 0);
	}

	// frontmatterSourceInput writes the YAML source view back into the block.
	frontmatterSourceInput(field) {
		const widget = field.closest(`.${this.prefix}__widget--frontmatter`);
		if (!widget) {
			return;
		}

		const source = field.value.replace(RETURNS, "\n");
		if (source !== field.value) {
			field.value = source;
		}

		widget.dataset.block = source;
		widget.toggleAttribute("data-invalid", !frontmatterComplete(source));
		this.stamp = Date.now();
		this.announce();
	}

	// rewrite swaps the markdown a widget stands for and draws it again.
	rewrite(widget, markdown, land) {
		this.commit();
		this.history.commit({ value: this.value, caret: this.startOf(widget) });

		const fresh = widget.dataset.kind === "frontmatter" ? frontmatter(this, markdown) : table(this, markdown);
		widget.replaceWith(fresh);
		this.announce();

		if (land) {
			const cell = fresh.querySelector(`[data-row="${land.row}"][data-column="${land.column}"]`);
			if (cell) {
				this.enter(fresh, cell);
			}
		}

		return fresh;
	}

	paste(event) {
		if (this.frontmatterSource(event.target)) {
			return;
		}

		const files = [...(event.clipboardData?.files ?? [])];
		if (files.length && this.editor.uploads?.accepts("paste")) {
			event.preventDefault();
			this.editor.uploads.files(files);
			return;
		}

		// Whatever the page it came from dressed it in, a paste arrives here
		// as the characters it is - bar the carriage returns another system's
		// line endings carry, which are not characters a markdown document
		// has any use for.
		event.preventDefault();
		const text = (event.clipboardData?.getData("text/plain") ?? "").replace(RETURNS, "\n");
		if (text === "") {
			return;
		}

		const source = this.active;
		const { start, end } = source.selection;
		source.replace(start, end, text, start + text.length);
	}

	drop(event) {
		if (this.frontmatterSource(event.target)) {
			event.preventDefault();
			return;
		}

		const files = [...(event.dataTransfer?.files ?? [])];
		if (files.length && this.editor.uploads?.accepts("drop")) {
			event.preventDefault();
			this.editor.uploads.files(files);
		}
	}

	// ── Undo ──────────────────────────────────────────────────────────────

	commit() {
		if (!this.pending) {
			return;
		}

		this.history.commit(this.pending);
		this.pending = null;
	}

	undo() {
		this.commit();
		this.step(this.history.undo({ value: this.value, caret: this.selection.start }));
	}

	redo() {
		this.step(this.history.redo({ value: this.value, caret: this.selection.start }));
	}

	step(snapshot) {
		if (!snapshot) {
			return;
		}

		this.load(snapshot.value);
		this.select(snapshot.caret);
		this.announce();
	}

	// announce puts the markdown in the textarea the form posts and tells the
	// host the document changed.
	announce() {
		const value = this.value;
		if (this.field) {
			this.field.value = value;
		}
		this.markOpenFence();
		this.editor.emit("change", { value });
	}

	// markOpenFence says at the foot of the surface that the document ends
	// inside a fenced block. The last line carries the language it is read
	// in, so one attribute answers it; what the foot says is the
	// stylesheet's, and generated content lands in no document.
	markOpenFence() {
		const last = this.element.lastElementChild;
		this.element.toggleAttribute("data-open-fence", Boolean(last && "in" in last.dataset));
	}
}
