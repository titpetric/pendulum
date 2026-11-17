// What a reader would stop at: a misspelling, and the prose patterns a
// host's style names. The editor knows none of them. A host that can read
// its own documents hands this a `proof` option and the panel lists what
// came back, marks each one where it stands, and writes a replacement in
// with one press.
//
// A finding with no replacement leaves nothing to press: a proper noun, or a
// rule that names a problem and no fix. The sentence it stands in is the
// fourth way out of one - the panel opens that sentence as a field and
// writes back what the writer makes of it.
//
// Every finding is a range into the markdown string the editor holds, so the
// panel acts on the document and never on the drawn surface. Applying one
// shifts the ranges after it by the length of the change, the way the links
// panel moves its rows: the list stays usable down to the last finding
// without asking the host again.
//
// The host answers; this draws. Nothing here knows what a rule is, which
// tools raised what, or how to spell anything.

import { dismiss, place, scrollTo, tool } from "./util.js";

// A finding as the host reports it:
//
//   { tool, rule, severity, message, match, start, end, suggestions }
//
// `tool` is what raised it and groups the list, `match` is the text as it
// stands, and `suggestions` are what to write instead, best first.

// What a newline in a draft reads as. The span a field holds is one line of
// markdown, so a break in it is the space it stands for, the way a table
// cell answers one.
const FLATTEN = /\s*\n\s*/g;

export class ProofPanel {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.element = null;
		this.findings = [];
		this.reading = false;
		// The row whose sentence the writer is rewriting: the finding it
		// stands on, what the field holds, the span's text as it stood when
		// the field opened, and the caret in it. Nothing here is in the
		// document until Save.
		this.editing = null;
		this.draft = null;
		this.origin = null;
		this.caret = null;

		dismiss({
			open: () => this.open,
			element: () => this.element,
			close: () => this.close(),
			// A press on the bar is not a dismissal: `run()` refuses it
			// while a draft stands, and it could not refuse it if the panel
			// had already gone and taken the focus with it.
			keep: () => editor.bar,
			signal: editor.aborter.signal,
		});
	}

	get open() {
		return Boolean(this.element);
	}

	async toggle(event) {
		if (this.open) {
			this.close();
			return;
		}

		await this.read(event);
	}

	// read asks the host about the document as it stands and draws the
	// answer. A second press while one is in flight does nothing: the
	// request is the slow part and two of them answer the same thing.
	async read(event) {
		if (this.reading) {
			return;
		}

		this.reading = true;
		this.show(event, null);
		try {
			const answer = await this.editor.options.proof(this.editor.value);
			this.findings = Array.isArray(answer) ? answer : (answer?.findings ?? []);
			this.show(event, this.findings);
		} catch (err) {
			this.show(event, [], err?.message || this.editor.texts.proofFailed);
		} finally {
			this.reading = false;
		}
	}

	show(event, findings, failure = "") {
		const texts = this.editor.texts;
		const name = (part) => `${this.prefix}__${part}`;
		const at = this.element?.getBoundingClientRect();
		// The list is rebuilt and it scrolls, so saving the fifteenth row
		// would otherwise leave the writer looking at the first.
		const scrolled = this.element?.querySelector(`.${name("proof-list")}`)?.scrollTop ?? 0;

		// A draft belongs to the finding it was opened on, and it outlives a
		// redraw only while that finding still stands in the list about to be
		// drawn. That list is the argument and not `this.findings`: read()
		// draws `null` while the answer before it is still held.
		if (!Array.isArray(findings) || !findings.includes(this.editing)) {
			this.forget();
		}
		// Not close(): a panel put away drops the draft with itself, and this
		// one is being drawn again rather than put away.
		this.element?.remove();

		this.element = document.createElement("div");
		this.element.className = name("proof");
		this.element.setAttribute("role", "dialog");
		this.element.setAttribute("aria-label", texts.proofPanel);

		const head = document.createElement("div");
		head.className = name("proof-head");
		const title = document.createElement("span");
		title.className = name("proof-title");
		title.textContent = texts.proofPanel;
		const count = document.createElement("span");
		count.className = name("proof-count");
		head.append(title, count);

		const list = document.createElement("div");
		list.className = name("proof-list");

		if (findings === null) {
			count.textContent = texts.proofReading;
			list.append(this.note(texts.proofReading));
		} else if (failure) {
			count.textContent = "";
			list.append(this.note(failure));
		} else if (findings.length === 0) {
			count.textContent = "0";
			list.append(this.note(texts.proofClean));
		} else {
			count.textContent = String(findings.length);
			for (const finding of findings) {
				list.append(this.row(finding));
			}
		}

		const foot = document.createElement("div");
		foot.className = name("proof-foot");
		const again = tool({
			prefix: this.prefix,
			key: "proof-again",
			title: texts.proofAgain,
			label: texts.proofAgain,
			hold: false,
			run: (click) => this.read(click),
		});
		again.classList.add(name("proof-again"));
		const done = tool({
			prefix: this.prefix,
			key: "proof-done",
			title: texts.done,
			label: texts.done,
			hold: false,
			run: () => this.close(),
		});
		done.classList.add(name("proof-done"));
		foot.append(again, done);

		this.element.append(head, list, foot);
		this.editor.root.appendChild(this.element);
		list.scrollTop = scrolled;

		// A field measures its own text off the page it is drawn on, so it is
		// grown here and not where it was built - and before the panel is
		// placed, since place() reads the height it ends up with.
		const field = this.element.querySelector(`.${name("proof-field")}`);
		if (field) {
			this.grow(field);
		}

		// A redraw stands where the panel already stood: the writer applied
		// a suggestion and the list must not jump out from under the next.
		const box = this.editor.bar?.getBoundingClientRect();
		place(this.element, this.editor.root, at
			? { clientX: at.left, clientY: at.top }
			: (event ?? { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 }));

		// The caret goes into the field the draft belongs to, where the
		// writer left it: a redraw from another row's × or keep must not take
		// the focus out of a sentence being typed, or jump it to the end of
		// one. The opening draw has no caret to put back and lands at the end
		// of the words it was seeded with. Nothing scrolls: the panel already
		// stands where it stood.
		if (field) {
			field.focus({ preventScroll: true });
			const [from, to] = this.caret ?? [field.value.length, field.value.length];
			field.setSelectionRange(from, to);
		}
	}

	// grow keeps the field as tall as what is written in it: a sentence
	// wraps, and a field that scrolls hides the half of it the writer is not
	// looking at. The stylesheet caps it.
	grow(field) {
		field.style.height = "auto";
		field.style.height = `${field.scrollHeight}px`;
	}

	// forget drops the draft. A panel that is gone holds nothing, and neither
	// does one whose draft belongs to a finding no longer in the list.
	forget() {
		this.editing = this.draft = this.origin = this.caret = null;
	}

	note(text) {
		const line = document.createElement("p");
		line.className = `${this.prefix}__proof-note`;
		line.textContent = text;

		return line;
	}

	// context cuts what stands around a finding out of the document, so the
	// row reads without looking at the page behind the panel.
	//
	// The sentence the finding is in is the unit worth reading: a few words
	// either side can stop mid-clause and say less than nothing. A row
	// opens on a short form and the whole sentence is one press away, since
	// a panel of twenty full sentences is a wall.
	//
	// Both cuts stop at the line the finding stands on. Two paragraphs run
	// together say less than one line of the right one.
	//
	// The span comes first and the strings are cut out of it, so the words a
	// row shows and the characters a field over it holds are the same ones.
	context(finding, words = 4) {
		const text = this.editor.value;
		if (text.slice(finding.start, finding.end) !== finding.match) {
			return null;
		}

		const lineStart = text.lastIndexOf("\n", finding.start - 1) + 1;
		let lineEnd = text.indexOf("\n", finding.end);
		if (lineEnd < 0) {
			lineEnd = text.length;
		}

		const head = text.slice(lineStart, finding.start);
		const tail = text.slice(finding.end, lineEnd);

		// A sentence ends at . ! or ? followed by a space or the line's end.
		// An abbreviation inside one is a cut this does not make: the ends
		// of the line are the fallback and a long sentence is no worse to
		// read than a short paragraph.
		const opens = [...head.matchAll(/[.!?](?=\s)/g)];
		const closes = tail.match(/^[\s\S]*?[.!?](?=\s|$)/);

		const sentence = {
			start: opens.length ? lineStart + opens[opens.length - 1].index + 1 : lineStart,
			end: closes ? finding.end + closes[0].length : lineEnd,
		};
		while (sentence.start < finding.start && /\s/.test(text[sentence.start])) {
			sentence.start += 1;
		}
		// Walking the trailing whitespace off the end leaves the two spaces
		// that spell a markdown hard break outside the span: a sentence
		// written over it cannot take the break away with it.
		while (sentence.end > finding.end && /\s/.test(text[sentence.end - 1])) {
			sentence.end -= 1;
		}

		// What a writer may safely retype is narrower than the sentence.
		//
		// With no sentence end in front of the finding the span falls back to
		// the whole line, and the marker that opens a line is what the line
		// is: hand over the `##` of a heading or the `-` of an item and a
		// sentence written back without it demotes the heading or kills the
		// bullet.
		const line = text.slice(lineStart, lineEnd);
		const marker = line.match(/^[>\s]*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/)[0].length;
		sentence.start = Math.max(sentence.start, Math.min(lineStart + marker, finding.start));

		// On a table row the unit is the cell, the way it is on the surface:
		// a field holding the pipes is a row the writer takes apart by typing
		// one more of them.
		if (/^\s*\|/.test(line)) {
			let from = finding.start;
			while (from > lineStart && !(text[from - 1] === "|" && text[from - 2] !== "\\")) {
				from -= 1;
			}
			let to = finding.end;
			while (to < lineEnd && !(text[to] === "|" && text[to - 1] !== "\\")) {
				to += 1;
			}
			while (from < finding.start && /\s/.test(text[from])) {
				from += 1;
			}
			while (to > finding.end && /\s/.test(text[to - 1])) {
				to -= 1;
			}

			sentence.start = from;
			sentence.end = to;
		}

		const sentenceLead = text.slice(sentence.start, finding.start);
		const sentenceRest = text.slice(finding.end, sentence.end);

		const shortLead = head.split(/\s+/).filter(Boolean).slice(-words).join(" ");
		const shortRest = tail.split(/\s+/).filter(Boolean).slice(0, words).join(" ");

		const cut = (text, taken, trailing) => {
			const elided = taken.trim().length < text.trim().length;
			if (!elided) {
				return taken;
			}

			return trailing ? taken.replace(/\s*$/, "") + " ..." : "... " + taken.replace(/^\s*/, "");
		};

		return {
			sentence,
			lead: cut(head, shortLead === head.trim() ? head : " " + shortLead + " ", false),
			rest: cut(tail, shortRest === tail.trim() ? tail : " " + shortRest, true),
			fullLead: cut(head, sentenceLead, false),
			fullRest: cut(tail, sentenceRest, true),
			// Whether the short form left anything out. A finding already
			// standing in its whole sentence has nothing to open.
			more: sentenceLead.trim() !== shortLead.trim() || sentenceRest.trim() !== shortRest.trim(),
		};
	}

	// row draws one finding: what raised it, the words it is about in the
	// line they stand in, what it says, and a button per suggestion. The row
	// holding the draft draws a field where the words would be.
	row(finding) {
		const name = (part) => `${this.prefix}__${part}`;
		const texts = this.editor.texts;
		const element = document.createElement("div");
		element.className = name("proof-row");
		element.dataset.tool = finding.tool ?? "";
		element.dataset.severity = finding.severity ?? "";
		const writing = this.editing === finding;
		element.dataset.editing = String(writing);

		const kind = document.createElement("span");
		kind.className = name("proof-kind");
		kind.textContent = finding.rule || finding.tool || "";

		const body = document.createElement("div");
		body.className = name("proof-body");

		const match = document.createElement("button");
		match.type = "button";
		match.className = name("proof-snippet");

		// The whole line opens the sentence, the marked words included: they
		// sit in the middle of a short snippet, and a press that lands on
		// them is a press on the line.
		const marked = document.createElement("mark");
		marked.className = name("proof-match");
		marked.textContent = finding.match ?? "";

		const around = this.context(finding);
		if (around) {
			const lead = document.createElement("span");
			const rest = document.createElement("span");
			const draw = (whole) => {
				lead.textContent = whole ? around.fullLead : around.lead;
				rest.textContent = whole ? around.fullRest : around.rest;
				match.dataset.whole = String(whole);
			};
			draw(false);
			match.append(lead, marked, rest);

			if (around.more) {
				match.title = this.editor.texts.proofWhole;
				match.addEventListener("click", () => draw(match.dataset.whole !== "true"));
			} else {
				// Already its whole sentence: nothing to open.
				match.disabled = true;
			}
		} else {
			match.append(marked);
			match.disabled = true;
		}

		const message = document.createElement("span");
		message.className = name("proof-message");
		message.textContent = finding.message ?? "";

		const fixes = document.createElement("span");
		fixes.className = name("proof-fixes");
		for (const suggestion of finding.suggestions ?? []) {
			const fix = document.createElement("button");
			fix.type = "button";
			fix.className = name("proof-fix");
			fix.textContent = suggestion;
			// A panel holding a draft takes no one-press write, on this row or
			// any other: the draft was written against the sentence as it
			// stands, and a suggestion landing in the document now would move
			// the ground out from under it.
			fix.disabled = Boolean(this.editing);
			fix.addEventListener("click", () => this.apply(finding, suggestion));
			fixes.append(fix);
		}

		const actions = document.createElement("span");
		actions.className = name("proof-actions");

		// The way into the document, for a writer who would rather read the
		// words where they stand than in a row.
		const show = document.createElement("button");
		show.type = "button";
		show.className = `${name("proof-show")} ${this.prefix}__tool`;
		show.title = texts.proofShow;
		show.setAttribute("aria-label", texts.proofShow);
		show.textContent = "\u21b3";
		show.addEventListener("click", () => this.reveal(finding));
		actions.append(show);

		// The fourth way out of a finding, beside a suggestion, keeping the
		// word and leaving it: the writer writes the sentence. A proper noun,
		// or a rule that names a problem and no fix, leaves nothing to press,
		// and the sentence is what the finding is about anyway.
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = `${name("proof-edit")} ${this.prefix}__tool`;
		edit.title = texts.proofEdit;
		edit.setAttribute("aria-label", texts.proofEdit);
		edit.setAttribute("aria-expanded", String(writing));
		edit.textContent = "\u270e";
		// A span the panel cannot read back is a report the document has
		// moved under, and one holding a line ending is no one line to write:
		// neither is a sentence to hand anybody.
		edit.disabled = !around || this.editor.value.slice(around.sentence.start, around.sentence.end).includes("\n");
		edit.addEventListener("click", () => this.rewrite(finding));
		actions.append(edit);

		// Keeping a word is a different thing from passing over one: the
		// first is the writer telling the host this is a word, for every
		// article after this one. Only a host that remembers draws it.
		if (this.editor.options.allow) {
			const keep = document.createElement("button");
			keep.type = "button";
			keep.className = name("proof-keep");
			keep.textContent = this.editor.texts.proofKeep;
			keep.title = this.editor.texts.proofKeepTitle;
			keep.addEventListener("click", () => this.keep(finding, keep));
			actions.append(keep);
		}

		const ignore = document.createElement("button");
		ignore.type = "button";
		ignore.className = `${name("proof-ignore")} ${this.prefix}__tool`;
		ignore.title = this.editor.texts.proofIgnore;
		ignore.setAttribute("aria-label", this.editor.texts.proofIgnore);
		ignore.textContent = "×";
		ignore.addEventListener("click", () => this.ignore(finding));
		actions.append(ignore);

		// The field stands where the words would: the message says what the
		// finding is, the same either way, and the two presses that end a
		// draft come under it.
		body.append(writing ? this.field(finding) : match, message, fixes);
		if (writing) {
			body.append(this.presses(finding));
		}
		element.append(kind, body, actions);

		return element;
	}

	// field draws the sentence as something to type in. It is seeded from the
	// draft and never from a sentence read out of the document again: a
	// redraw while it stands open - another row's × or keep - would
	// otherwise throw away what the writer has typed.
	//
	// Newlines are forbidden rather than offered. The span is one line of
	// markdown by construction, so a break in it ends a list item, takes a
	// table row apart, or becomes a soft break renderers disagree about. A
	// cell answers a pasted newline the same way, with the space it stands
	// for. It is a textarea for the wrapping and the growing, not for a
	// second line: Enter saves, shifted or not.
	field(finding) {
		const field = document.createElement("textarea");
		field.className = `${this.prefix}__proof-field`;
		field.rows = 1;
		field.spellcheck = false;
		field.value = this.draft ?? "";
		field.setAttribute("aria-label", this.editor.texts.proofEdit);

		field.addEventListener("input", () => this.type(field));
		field.addEventListener("paste", (event) => {
			event.preventDefault();
			const text = (event.clipboardData?.getData("text/plain") ?? "").replace(FLATTEN, " ");
			field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
			this.type(field);
		});
		field.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				// An unchanged sentence is nothing to write, which is what the
				// disabled Save says.
				if (this.draft !== this.origin) {
					this.save(finding);
				}
				return;
			}
			if (event.key === "Escape") {
				// dismiss() closes the panel on an Escape it hears on the
				// document, and this runs first: one press leaves the draft,
				// the next puts the panel away.
				event.preventDefault();
				event.stopPropagation();
				this.cancel(finding);
			}
		});

		return field;
	}

	// presses draws the two ways a draft ends.
	presses(finding) {
		const texts = this.editor.texts;
		const row = document.createElement("div");
		row.className = `${this.prefix}__proof-draft`;

		// Neither of these holds the caret the way a tool on a bar does: a
		// press takes the focus out of the field, and that is what a press on
		// Save or Cancel means. Nothing commits on the way out - a field that
		// cancelled itself on blur would put Save out of reach, since the
		// mousedown lands before the click.
		const save = document.createElement("button");
		save.type = "button";
		save.className = `${this.prefix}__proof-save`;
		save.textContent = texts.save;
		save.disabled = this.draft === this.origin;
		save.addEventListener("click", () => this.save(finding));

		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = `${this.prefix}__proof-cancel`;
		cancel.textContent = texts.cancel;
		cancel.addEventListener("click", () => this.cancel(finding));

		row.append(save, cancel);

		return row;
	}

	// type takes what the writer typed: the draft and the caret are both
	// remembered as they go, so a redraw puts the field back the way they
	// left it.
	type(field) {
		const flat = field.value.replace(FLATTEN, " ");
		if (flat !== field.value) {
			const at = Math.max(0, Math.min(field.selectionStart - (field.value.length - flat.length), flat.length));
			field.value = flat;
			field.setSelectionRange(at, at);
		}

		this.draft = field.value;
		this.caret = [field.selectionStart, field.selectionEnd];
		this.grow(field);

		const save = this.element?.querySelector(`.${this.prefix}__proof-save`);
		if (save) {
			save.disabled = this.draft === this.origin;
		}
	}

	// rewrite opens the sentence a finding stands in as a field. A second
	// press puts the row back: nothing was written, so there is nothing to
	// put back in the document.
	rewrite(finding) {
		if (this.editing === finding) {
			this.cancel(finding);
			return;
		}

		const around = this.context(finding);
		if (!around) {
			this.read();
			return;
		}

		this.editing = finding;
		this.origin = this.editor.value.slice(around.sentence.start, around.sentence.end);
		this.draft = this.origin;
		// No caret to put back: the opening draw lands at the end of the
		// words the field was seeded with.
		this.caret = null;
		this.show(null, this.findings);
	}

	// cancel drops the draft and draws the row again, with the focus back on
	// the button it was opened from.
	cancel(finding) {
		this.forget();
		this.show(null, this.findings);
		this.rowAt(finding)?.querySelector(`.${this.prefix}__proof-edit`)?.focus();
	}

	// rowAt answers the drawn row one finding stands on. The rows are drawn
	// from the list in order, so where a finding stands in the list is which
	// row it is.
	rowAt(finding) {
		const at = this.findings.indexOf(finding);
		return at < 0 ? null : (this.element?.querySelectorAll(`.${this.prefix}__proof-row`)[at] ?? null);
	}

	// reveal puts the caret on the span the finding names, so the writer
	// reads it where it stands. A span that no longer holds the words is one
	// the document has moved under, the way context() and apply() read it:
	// jumping there would send the writer somewhere the report never meant.
	reveal(finding) {
		if (this.editor.value.slice(finding.start, finding.end) !== finding.match) {
			this.read();
			return;
		}

		this.editor.source.select(finding.start, finding.end);
		this.editor.focus({ preventScroll: true });
		scrollTo(document.getSelection());
	}

	// apply writes the suggestion over the span and takes the row away. The
	// findings after it move by the length of the change: the host read the
	// document one state ago, and nothing here asks it again.
	apply(finding, suggestion) {
		const before = this.editor.value;
		if (before.slice(finding.start, finding.end) !== finding.match) {
			// The document moved under the report: the writer typed while
			// the panel stood open. Reading again is the only honest answer.
			this.read();
			return;
		}

		this.editor.source.replace(finding.start, finding.end, suggestion, finding.start + suggestion.length);

		const delta = suggestion.length - (finding.end - finding.start);
		this.findings = this.findings.filter((one) => one !== finding);
		for (const one of this.findings) {
			if (one.start >= finding.end) {
				move(one, one.start + delta, one.end + delta);
			}
		}

		this.show(null, this.findings);
	}

	// save writes the field over the span it was opened on, drops the row and
	// re-anchors the rest of the list, the way applying a suggestion does.
	save(finding) {
		const around = this.context(finding);
		const value = this.editor.value;
		if (!around || value.slice(around.sentence.start, around.sentence.end) !== this.origin) {
			// The span no longer reads as it did when the field opened. The
			// match alone would not catch this: a writer typing elsewhere in
			// the same sentence, or a suggestion written into it from another
			// row, leaves the finding's own words standing while the sentence
			// around them has moved - and the draft, written against the
			// sentence as it was, would put that change back.
			this.read();
			return;
		}

		const { start, end } = around.sentence;
		const origin = this.origin;
		const text = this.draft;
		const at = this.findings.indexOf(finding);

		// The caret lands at the end of what was written, and the offset is a
		// real one: show() takes the field away two lines down, and `false`
		// here would leave the surface's remembered range on nodes that are
		// gone, so the next press on the bar would write at the head of the
		// document.
		this.editor.source.replace(start, end, text, start + text.length);

		this.findings = this.findings.filter((one) => one !== finding);
		this.anchor(start, end, origin, text);
		this.forget();
		this.show(null, this.findings);

		// The focus has to land somewhere the keyboard can carry on from: the
		// row that took this one's place, or the way out of the panel.
		const next = this.element?.querySelectorAll(`.${this.prefix}__proof-row`)[at];
		const land = next?.querySelector(`.${this.prefix}__proof-edit`);
		(land ?? this.element?.querySelector(`.${this.prefix}__proof-done`))?.focus();
	}

	// anchor moves the rest of the list onto the sentence the writer wrote.
	// The host read the document one state ago and nothing here asks it
	// again, so every finding is placed by hand: one before the span stands
	// still, one after it shifts by the length of the change, and one inside
	// it is looked up by its own words.
	//
	// A finding running across one end of the span goes: half of what it was
	// about was rewritten, and there is no honest place to put the rest.
	anchor(start, end, origin, text) {
		const delta = text.length - origin.length;
		const kept = [];

		for (const one of this.findings) {
			if (one.end <= start) {
				kept.push(one);
			} else if (one.start >= end) {
				move(one, one.start + delta, one.end + delta);
				kept.push(one);
			} else if (one.start >= start && one.end <= end) {
				const found = this.relocate(one, start, origin, text);
				if (found !== null) {
					move(one, start + found, start + found + (one.match ?? "").length);
					kept.push(one);
				}
			}
		}

		this.findings = kept;
	}

	// relocate answers where in the sentence the writer wrote one finding's
	// words now stand, counted from the start of the span, or null where they
	// are gone from it.
	//
	// The words alone do not say which of them the row was about: "The repo
	// holds one more repo." is two findings over the same four letters, and
	// dropping both because the sentence was edited would take away a row the
	// writer never touched. So the count carries it. The same number of
	// occurrences means the same one as before; a different number means the
	// one nearest where this finding stood, since something was added or
	// taken away and the order is all that is left to go on.
	relocate(one, start, origin, text) {
		const match = one.match ?? "";
		if (match === "") {
			return null;
		}

		const places = (where) => {
			const out = [];
			for (let found = where.indexOf(match); found >= 0; found = where.indexOf(match, found + 1)) {
				out.push(found);
			}

			return out;
		};

		const was = places(origin);
		const now = places(text);
		if (now.length === 0) {
			return null;
		}

		const want = one.start - start;
		const ordinal = was.indexOf(want);
		if (now.length === was.length && ordinal >= 0) {
			return now[ordinal];
		}

		return now.reduce((best, found) => (Math.abs(found - want) < Math.abs(best - want) ? found : best), now[0]);
	}

	// ignore drops one finding from the list and remembers nothing: the
	// writer has read it and moved on, and the next document starts over.
	ignore(finding) {
		this.findings = this.findings.filter((one) => one !== finding);
		this.show(null, this.findings);
	}

	// keep hands the finding to the host to remember, and drops every row
	// about the same words: a name the writer keeps is kept wherever it
	// stands, not once per place it stands in.
	//
	// The rows go when the host has taken it. A host that refuses leaves
	// the list alone and says so on the row, since a word the writer thinks
	// they kept and did not would be reported again with no explanation.
	async keep(finding, button) {
		button.disabled = true;
		try {
			await this.editor.options.allow(finding);
		} catch (err) {
			button.disabled = false;
			button.textContent = err?.message || this.editor.texts.proofFailed;
			return;
		}

		const same = (one) =>
			one.tool === finding.tool &&
			one.rule === finding.rule &&
			(one.match ?? "").toLowerCase() === (finding.match ?? "").toLowerCase();

		this.findings = this.findings.filter((one) => !same(one));
		this.show(null, this.findings);
	}

	close() {
		if (!this.open) {
			return;
		}

		this.element.remove();
		this.element = null;
		this.forget();
	}
}

// move writes one finding's range in place.
//
// The object is the row's identity: the panel remembers which finding the
// draft was opened on, and a finding rebuilt as a copy - which is what
// `{...one, start, end}` answers - is a finding no longer in the list, so a
// suggestion pressed on one row would silently throw away the draft open on
// another. The links table moves its rows in place for the same reason.
function move(finding, start, end) {
	finding.start = start;
	finding.end = end;
}
