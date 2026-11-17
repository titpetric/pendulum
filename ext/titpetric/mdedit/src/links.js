// Every link in the document, in the order it stands, and one table over all
// of them: the number it holds, its text, its address, and - where the link
// is a picture linking somewhere - the picture's own address beside it.
//
// A writer leaves an address empty on purpose - `[GitHub]()` is a link whose
// target is decided later - so an empty address is a row here like any other,
// not a mistake to skip. The panel is the one place a whole document's
// addresses can be read and written together instead of hunted for in the
// prose.
//
// The rows hold drafts. Typing into one changes the row and nothing else, so
// a half-typed address never lands in the writer's markdown; Save writes every
// changed address back in one pass, and Cancel or Escape puts the panel away
// with the document as it was.
//
// Links are read from the markdown, not from the drawn surface, so a link
// inside a table cell or a card is found the same way as one in a paragraph.
// What is code is not a link: a fenced block and a code span are skipped
// whole, since their brackets are text.

import { dismiss, place, tool } from "./util.js";

// codeRanges answers the parts of a source that are code: fenced blocks and
// code spans. A link found inside one is not a link.
function codeRanges(source) {
	const ranges = [];
	let at = 0;

	while (at < source.length) {
		const char = source[at];
		if (char !== "`" && char !== "~") {
			at += 1;
			continue;
		}

		const lineStart = source.lastIndexOf("\n", at - 1) + 1;
		const before = source.slice(lineStart, at);
		const fence = /^[ \t]{0,3}$/.test(before) && (char === "`" || char === "~") && source.startsWith(char.repeat(3), at);

		if (fence) {
			// The opening line runs to its newline; the block runs to the next
			// line of the same character, or to the end of the document.
			const open = source.indexOf("\n", at);
			if (open < 0) {
				ranges.push([at, source.length]);
				break;
			}
			const closer = new RegExp(`^[ \\t]{0,3}${char}{3,}[ \\t]*$`, "gm");
			closer.lastIndex = open + 1;
			const found = closer.exec(source);
			const end = found ? found.index + found[0].length : source.length;
			ranges.push([at, end]);
			at = end;
			continue;
		}

		if (char === "`") {
			let ticks = 1;
			while (source[at + ticks] === "`") {
				ticks += 1;
			}
			const close = source.indexOf("`".repeat(ticks), at + ticks);
			if (close >= 0) {
				ranges.push([at, close + ticks]);
				at = close + ticks;
				continue;
			}
		}

		at += 1;
	}

	return ranges;
}

const inCode = (ranges, at) => ranges.some(([start, end]) => at >= start && at < end);

// closeBracket answers the bracket matching the one at `open`, counting the
// brackets inside a label - an image in a link is one - and stepping over
// escaped characters.
function closeBracket(source, open) {
	let depth = 0;
	for (let at = open; at < source.length; at += 1) {
		const char = source[at];
		if (char === "\\") {
			at += 1;
			continue;
		}
		if (char === "[") {
			depth += 1;
		} else if (char === "]") {
			depth -= 1;
			if (depth === 0) {
				return at;
			}
		}
	}

	return -1;
}

// closeParen answers the parenthesis matching the one at `open`. An address
// may hold parentheses of its own, so they are counted rather than cut at the
// first one.
function closeParen(source, open) {
	let depth = 0;
	for (let at = open; at < source.length; at += 1) {
		const char = source[at];
		if (char === "\\") {
			at += 1;
			continue;
		}
		if (char === "(") {
			depth += 1;
		} else if (char === ")") {
			depth -= 1;
			if (depth === 0) {
				return at;
			}
		}
	}

	return -1;
}

// splitAddress reads what stands between the parentheses: the address, and an
// optional title after it. The address is the range the panel writes into,
// so its offset inside the body is kept exactly.
function splitAddress(body) {
	const match = body.match(/^(\S*?)(?:\s+"([^"]*)")?$/);
	if (!match) {
		return null;
	}

	return { url: match[1], urlOffset: 0, title: match[2] ?? "" };
}

// imageIn answers the first picture written in a label, with the ranges that
// say where its address stands in the document.
function imageIn(label, start) {
	const match = label.match(/!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)/);
	if (!match) {
		return null;
	}

	const at = start + match.index;
	const srcStart = at + match[0].indexOf("](") + 2;

	return {
		start: at,
		end: at + match[0].length,
		alt: match[1],
		altStart: at + 2,
		altEnd: at + 2 + match[1].length,
		src: match[2],
		srcStart,
		srcEnd: srcStart + match[2].length,
		title: match[3] ?? "",
	};
}

// links answers every link in a source, in the order it stands. A picture of
// its own is not a link - the image panel is where that one is managed - but
// a picture inside a link is the link's own picture, and its address is part
// of the record.
export function links(source) {
	const found = [];
	const code = codeRanges(source);
	let at = 0;

	while (at < source.length) {
		const open = source.indexOf("[", at);
		if (open < 0) {
			break;
		}

		at = open + 1;
		// A picture of its own, an escaped bracket, or a bracket in code: not
		// a link, and the scan moves on.
		if (source[open - 1] === "!" || source[open - 1] === "\\" || inCode(code, open)) {
			continue;
		}

		const close = closeBracket(source, open);
		if (close < 0 || source[close + 1] !== "(") {
			continue;
		}

		const paren = closeParen(source, close + 1);
		if (paren < 0) {
			continue;
		}

		const label = source.slice(open + 1, close);
		const body = source.slice(close + 2, paren);
		const parsed = splitAddress(body);
		if (!parsed) {
			continue;
		}

		const urlStart = close + 2 + parsed.urlOffset;
		found.push({
			start: open,
			end: paren + 1,
			label,
			labelStart: open + 1,
			labelEnd: close,
			url: parsed.url,
			urlStart,
			urlEnd: urlStart + parsed.url.length,
			title: parsed.title,
			image: imageIn(label, open + 1),
			text: label.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim(),
		});

		at = paren + 1;
	}

	return found;
}

// LinkPanel is the table over a document's links: a row a link, numbered in
// the order it stands, with the label read-only and the addresses written as
// drafts. Save writes every changed address back in place and shifts the
// ranges of every link after it, so a row below stays pointed at its own link
// while the row above grows. A close without Save leaves the document alone.
export class LinkPanel {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.element = null;
		this.found = [];
		this.rows = [];
		this.saveButton = null;
		this.revert = null;

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

	toggle(event) {
		if (this.open) {
			this.close();
			return;
		}

		this.show(event);
	}

	// The options a caller opens the panel with:
	//
	//   at      a source offset; the row for the link standing there takes
	//           the focus, which is how a link just written out of a
	//           selection gets its address typed without hunting for a row
	//   only    draw that row and no other: the writer asked for one link,
	//           not for the table over the document
	//   revert  the document to put back if the panel is dismissed, for a
	//           caller that wrote the link before opening this
	show(event, { at = null, only = false, revert = null } = {}) {
		this.close();
		this.revert = revert;
		this.found = links(this.editor.value);
		if (only && at !== null) {
			this.found = this.found.filter((link) => link.start === at);
		}
		this.rows = [];

		const name = (part) => `${this.prefix}__${part}`;
		const texts = this.editor.texts;

		this.element = document.createElement("div");
		this.element.className = name("links");
		this.element.setAttribute("role", "dialog");
		this.element.setAttribute("aria-label", texts.linkPanel);
		// The picture column earns its place only in a document that holds a
		// picture link; with none, the table reads as three columns.
		this.element.dataset.images = String(this.found.some((link) => link.image));

		const head = document.createElement("div");
		head.className = name("links-head");

		const title = document.createElement("span");
		title.className = name("links-title");
		title.textContent = texts.linkPanel;

		const count = document.createElement("span");
		count.className = name("links-count");
		count.textContent = String(this.found.length);

		head.append(title, count);

		const list = document.createElement("div");
		list.className = name("links-list");
		list.setAttribute("role", "table");

		const header = document.createElement("div");
		header.className = name("links-row");
		header.dataset.head = "true";
		header.setAttribute("role", "row");
		for (const [part, label] of [
			["order", texts.linkOrder],
			["text", texts.linkText],
			["address", texts.linkAddress],
			["image", texts.linkImage],
		]) {
			const cell = document.createElement("span");
			cell.className = `${name(`links-${part}`)} ${name(`links-cell--${part}`)}`;
			cell.dataset.head = "true";
			cell.setAttribute("role", "columnheader");
			cell.textContent = label;
			header.appendChild(cell);
		}
		list.appendChild(header);

		this.found.forEach((link, at) => {
			list.appendChild(this.row(link, at + 1));
		});

		if (!this.found.length) {
			const empty = document.createElement("p");
			empty.className = name("links-empty");
			empty.textContent = texts.linkNone;
			list.appendChild(empty);
		}

		const foot = document.createElement("div");
		foot.className = name("links-foot");

		const cancel = tool({
			prefix: this.prefix,
			key: "links-cancel",
			title: texts.cancel,
			label: texts.cancel,
			run: () => this.close(),
		});

		const save = tool({
			prefix: this.prefix,
			key: "links-save",
			title: texts.save,
			label: texts.save,
			run: () => this.save(),
		});
		save.classList.add(name("links-save"));
		save.disabled = true;
		this.saveButton = save;

		foot.append(cancel, save);

		this.element.append(head, list, foot);
		this.editor.root.appendChild(this.element);
		const box = this.editor.bar?.getBoundingClientRect();
		place(this.element, this.editor.root, event ?? { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 });

		const asked = at === null ? null : this.rows.find((row) => row.link.start === at);
		(asked ?? this.rows.find((row) => !row.link.url))?.address.focus();
	}

	// row draws one link: the number it holds, its text, its address, and -
	// for a picture linking somewhere - the picture and the address it comes
	// from. Both addresses are drafts until Save.
	row(link, order) {
		const name = (part) => `${this.prefix}__${part}`;
		const texts = this.editor.texts;

		const element = document.createElement("div");
		element.className = name("links-row");
		element.setAttribute("role", "row");

		const at = document.createElement("span");
		at.className = `${name("links-order")} ${name("links-cell--order")}`;
		at.textContent = String(order);

		const text = document.createElement("span");
		text.className = `${name("links-text")} ${name("links-cell--text")}`;
		text.textContent = link.text || link.image?.alt || (link.image ? texts.linkPicture : "");
		text.title = text.textContent;

		const address = document.createElement("input");
		address.type = "text";
		address.className = `${name("links-input")} ${name("links-cell--address")}`;
		address.value = link.url;
		address.spellcheck = false;
		address.setAttribute("aria-label", texts.linkAddress);
		if (!link.url) {
			address.placeholder = texts.linkEmpty;
		}

		const image = document.createElement("span");
		image.className = `${name("links-image")} ${name("links-cell--image")}`;

		let src = null;
		if (link.image) {
			const shot = document.createElement("img");
			shot.className = name("links-shot");
			shot.alt = "";
			shot.src = link.image.src;
			shot.title = texts.linkView;
			shot.addEventListener("click", () => this.view(link.image.src));
			shot.addEventListener("error", () => {
				shot.hidden = true;
			});

			src = document.createElement("input");
			src.type = "text";
			src.className = name("links-input");
			src.value = link.image.src;
			src.spellcheck = false;
			src.setAttribute("aria-label", texts.linkImageAddress);

			image.append(shot, src);
		}

		element.append(at, text, address, image);
		const held = {
			element,
			link,
			address,
			image,
			urlDraft: link.url,
			srcDraft: link.image?.src ?? "",
			dirty: false,
		};

		address.addEventListener("input", () => this.draft(held, "url", address.value));
		if (src) {
			src.addEventListener("input", () => this.draft(held, "src", src.value));
		}

		this.rows.push(held);
		this.paint(held);
		return element;
	}

	// paint marks a row with the two things its drawing says: whether its
	// address draft is still empty, and whether it holds a change Save has
	// yet to write. The panel is outside the surface, so it may hold text of
	// its own.
	paint(held) {
		held.element.dataset.empty = String(!held.urlDraft);
		held.element.dataset.dirty = String(held.dirty);
	}

	// draft takes what the writer typed into a row and compares it with the
	// link it stands for. Nothing reaches the document here: Save is the one
	// press that writes.
	draft(held, part, value) {
		if (part === "src") {
			held.srcDraft = value;
		} else {
			held.urlDraft = value;
		}

		held.dirty =
			held.urlDraft !== held.link.url ||
			Boolean(held.link.image) && held.srcDraft !== held.link.image.src;
		this.paint(held);
		this.mark();
	}

	// mark puts Save on or off with the table's drafts.
	mark() {
		if (this.saveButton) {
			this.saveButton.disabled = !this.rows.some((held) => held.dirty);
		}
	}

	// save writes every changed address back into the document, in document
	// order, and puts the panel away. A row that holds no change writes
	// nothing, so a save touches only what the writer edited.
	save() {
		for (const held of this.rows) {
			if (held.urlDraft !== held.link.url) {
				this.write(held.link, "url", held.urlDraft);
			}
			if (held.link.image && held.srcDraft !== held.link.image.src) {
				this.write(held.link, "src", held.srcDraft);
			}
			held.urlDraft = held.link.url;
			held.srcDraft = held.link.image?.src ?? "";
			held.dirty = false;
			this.paint(held);
		}

		this.mark();
		this.revert = null;
		this.close();
	}

	view(address) {
		if (!address) {
			return;
		}

		window.open(address, "_blank", "noopener");
	}

	// write replaces one address of one link - the link's own, or the address
	// of the picture inside it - and leaves the rest of the markdown exactly
	// as the writer wrote it. Every link after it moves by the length of the
	// change, and its row keeps pointing at its own link because the record
	// moves with the document.
	write(link, part, value) {
		const from = part === "src" ? link.image.srcStart : link.urlStart;
		const to = part === "src" ? link.image.srcEnd : link.urlEnd;
		const start = link.start;
		const markdown = this.editor.value.slice(start, link.end);
		const rewrite =
			markdown.slice(0, from - start) + value + markdown.slice(to - start);
		const delta = rewrite.length - markdown.length;

		this.editor.source.replace(start, link.end, rewrite, false);

		// A link below the one just edited stands further along by the length
		// of the change, and its record moves with it.
		for (const other of this.found) {
			if (other !== link && other.start > start) {
				move(other, delta);
			}
		}

		const [fresh] = links(rewrite);
		if (fresh) {
			Object.assign(link, fresh);
			move(link, start);
			link.text = fresh.text;
		} else {
			// An address the parser cannot read back - one holding an
			// unbalanced parenthesis, say - still stands in the document; the
			// record keeps the ranges the typed text implies.
			link.end = start + rewrite.length;
			if (part === "src" && link.image) {
				link.image.src = value;
				link.image.srcEnd = link.image.srcStart + value.length;
			} else {
				link.url = value;
				link.urlEnd = link.urlStart + value.length;
			}
		}

		this.editor.emit("change", { value: this.editor.value });
	}

	close() {
		if (!this.open) {
			return;
		}

		// A panel opened over a link the tool had just written puts the
		// document back when it is dismissed: Cancel and Escape leave the
		// text as the writer left it, and a half-written `[words]()` is not
		// that. Save clears this before it closes.
		if (this.revert !== null) {
			const back = this.revert;
			this.revert = null;
			this.editor.value = back;
		}

		this.element.remove();
		this.element = null;
		this.found = [];
		this.rows = [];
		this.saveButton = null;
	}
}

// move shifts every range in a link by the same distance: the document grew
// or shrank before it.
function move(link, delta) {
	for (const key of ["start", "end", "labelStart", "labelEnd", "urlStart", "urlEnd"]) {
		link[key] += delta;
	}
	if (link.image) {
		for (const key of ["start", "end", "altStart", "altEnd", "srcStart", "srcEnd"]) {
			link.image[key] += delta;
		}
	}
}
