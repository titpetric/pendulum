// The document behind the editor, and the moves every tool makes on it.
//
// A move is a range replacement and nothing else: insert, wrap, indent and
// the rest are written here once, against `value`, `selection` and
// `replace()`. A subclass answers those three for whatever holds the text:
// the editing surface does, and Source itself does for a plain textarea, the
// shape a table cell in the grid still has.
//
// Source uses setRangeText so the browser keeps its own undo stack, and
// fires a native `input` event after every change: a host listening for
// `input` hears every edit a tool makes.

export class Source {
	constructor(field) {
		this.field = field;
	}

	// ── What a surface answers ────────────────────────────────────────────

	get value() {
		return this.field.value;
	}

	set value(text) {
		this.replace(0, this.field.value.length, text);
	}

	get selection() {
		const { selectionStart: start, selectionEnd: end } = this.field;
		return { start, end, text: this.field.value.slice(start, end) };
	}

	select(from, to = from) {
		this.field.selectionStart = from;
		this.field.selectionEnd = to;
	}

	focus(options) {
		this.field.focus(options);
	}

	// active answers the source the next move acts on. A plain source is the
	// only one it has; the editing surface answers a table cell here when the
	// caret stands in one.
	get active() {
		return this;
	}

	// replace writes `text` over a range. `selectFrom` and `selectTo` name
	// where the caret lands; a `selectFrom` of false leaves the selection
	// alone, for an edit made from a panel of its own, where the caret the
	// writer is using is in one of that panel's fields and moving it would
	// take the focus away mid-word.
	replace(start, end, text, selectFrom, selectTo) {
		this.field.setRangeText(text, start, end, selectFrom === false ? "preserve" : "end");
		if (selectFrom !== undefined && selectFrom !== false) {
			this.select(selectFrom, selectTo ?? selectFrom);
		}
		this.field.dispatchEvent(new Event("input", { bubbles: true }));
	}

	// ── The moves ─────────────────────────────────────────────────────────

	// insert puts `text` where the selection is. `cursor` is an offset into
	// `text` to land on and `length` selects that many characters from it, so
	// a tool can leave the writer on the part only they can fill in.
	insert(text, cursor = text.length, length = 0) {
		const { start, end } = this.selection;
		this.replace(start, end, text, start + cursor, start + cursor + length);
	}

	// insertBlock is insert() for a block construct: it adds the newline the
	// block needs to own its line, and counts `cursor` from the first
	// character of the block.
	insertBlock(text, cursor = text.length, length = 0) {
		const { start, end } = this.selection;
		const lead = start === 0 || this.value[start - 1] === "\n" ? "" : "\n";
		const at = start + lead.length + cursor;
		this.replace(start, end, lead + text, at, at + length);
	}

	// wrap puts markers around the selection, or drops a placeholder and
	// selects it when nothing is selected. Running it again on an
	// already-wrapped selection takes the markers back off.
	// wrap puts a marker around the selection, or takes it back off: the
	// writer pressing the same key twice means the second press undoes the
	// first, the way every editor behaves.
	//
	// The markers are either side of the selection or inside it, since
	// wrapping leaves the words selected and the markers outside them. Both
	// are read, so a word decorated by one press is bare after the next
	// whichever way the selection fell.
	wrap(marker, placeholder = "") {
		const { start, end, text } = this.selection;
		const width = marker.length;
		const value = this.value;

		// The markers the writer selected along with the words.
		if (text.length >= width * 2 && text.slice(0, width) === marker && text.slice(-width) === marker) {
			const bare = text.slice(width, -width);
			this.replace(start, end, bare, start, start + bare.length);
			return;
		}

		// The markers standing just outside it, which is where the last
		// press left them.
		if (
			text !== "" &&
			start >= width &&
			value.slice(start - width, start) === marker &&
			value.slice(end, end + width) === marker
		) {
			this.replace(start - width, end + width, text, start - width, start - width + text.length);
			return;
		}

		const body = text || placeholder;
		this.insert(marker + body + marker, width, body.length);
	}

	// lines answers the range the selection touches, grown out to whole lines.
	lines() {
		const value = this.value;
		const { start: from, end: to } = this.selection;
		const start = value.lastIndexOf("\n", from - 1) + 1;
		let end = value.indexOf("\n", to);
		if (end < 0) {
			end = value.length;
		}

		return { start, end, text: value.slice(start, end) };
	}

	// line answers the one line the caret sits on, ignoring the rest of a
	// selection: what a per-line tool like the heading cycle acts on.
	line() {
		const value = this.value;
		const from = this.selection.start;
		const start = value.lastIndexOf("\n", from - 1) + 1;
		let end = value.indexOf("\n", from);
		if (end < 0) {
			end = value.length;
		}

		return { start, end, text: value.slice(start, end) };
	}

	// indent puts a tab in front of every line the selection touches, and
	// outdent takes one level of indentation back off. A level is a tab or
	// the spaces someone else's editor left in its place.
	indent(marker = "\t") {
		const { start, end, text } = this.lines();
		const next = text.split("\n").map((line) => marker + line).join("\n");

		this.replace(start, end, next, start, start + next.length);
	}

	outdent() {
		const { start, end, text } = this.lines();
		const next = text
			.split("\n")
			.map((line) => line.replace(/^(\t| {1,4})/, ""))
			.join("\n");

		this.replace(start, end, next, start, start + next.length);
	}

	// prefixLines puts a line marker on every line the selection touches, and
	// takes it off again when every line already carries it.
	prefixLines(marker) {
		const { start, end, text } = this.lines();
		const pattern = new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
		const lines = text.split("\n");
		const carried = lines.every((line) => pattern.test(line));

		const next = lines
			.map((line) => (carried ? line.replace(pattern, "") : marker + line))
			.join("\n");

		this.replace(start, end, next, start, start + next.length);
	}
}
