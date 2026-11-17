// MarkdownEditor: a toolbar over one editing surface that holds the markdown
// itself.
//
// The surface is a contenteditable element, one line of source per element,
// each line tokenised into the runs that style it. The characters the writer
// types are the characters the document is made of: type `### ` and the word
// after it is already in the heading face, with the caret still in it. The
// pilcrow decides whether the marker characters show.
//
// The textarea under the editor stays in the page, hidden, and is written on
// every edit. It keeps its name, its value and its form, so the no-JS
// fallback and the server-side validation go on working unchanged.

import { LevelMenu } from "./heading.js";
import { CodeMenu } from "./language.js";
import { ImagePanel } from "./images.js";
import { LinkPanel } from "./links.js";
import { ProofPanel } from "./proof.js";
import { TableMenu } from "./menu.js";
import { UploadPanel } from "./queue.js";
import { Surface } from "./surface.js";
import { TableGrid } from "./table.js";
import { TOOLBAR_FULL, defaultTools } from "./tools.js";
import { Uploads } from "./uploads.js";
import { roving, tool } from "./util.js";

// Every string the editor can put on screen. Override what the project says
// differently through the `texts` option.
export const TEXTS = {
	formatting: "Formatting",
	document: "Markdown",
	upload: "Upload files",
	uploading: "uploading",
	uploadEta: "ETA",
	uploadFailed: "Upload failed",
	uploadUnreachable: "network error",
	uploadUnconfigured: "uploads are not configured",
	uploadRetry: "Choose a file again",
	uploadQueue: "Uploads",
	uploadChoose: "Choose files",
	uploadEmpty: "Nothing is uploading. Choose files to send them all at once.",
	uploadForget: "Put this away",
	uploadDone: "Uploaded",
	notAccepted: "That file cannot be uploaded here.",
	tooLarge: "That file is too large.",
	tableGrid: "Table",
	linkPanel: "Links",
	linkOrder: "#",
	linkText: "Link text",
	linkAddress: "Address",
	linkImage: "Image",
	linkImageAddress: "Image address",
	linkNone: "This document has no links.",
	linkEmpty: "No address yet",
	linkPicture: "Picture",
	linkView: "View the picture",
	save: "Save",
	cancel: "Cancel",
	marks: "Show the markup",
	heading: "Heading",
	headingText: "Plain text",
	headingLevel: "Heading level",
	imagePanel: "Image",
	imageCaption: "Caption",
	imageAddress: "Address",
	imageMissing: "That address answers no image.",
	imageReplace: "Replace this image",
	imageLeft: "Float left",
	imageCenter: "Centre",
	imageRight: "Float right",
	cell: "Cell",
	rowAdd: "Add a row",
	rowRemove: "Remove this row",
	columnAdd: "Add a column",
	columnRemove: "Remove this column",
	align: "Align this column",
	tableMenu: "Table",
	frontmatter: "Document front-matter",
	frontmatterName: "Name",
	frontmatterValue: "Value",
	frontmatterRowAdd: "Add a field",
	frontmatterRich: "rich type, edit via source",
	frontmatterInvalid: "This is not a front matter block",
	codeLanguage: "Code language",
	codeText: "Plain text",
	codePlain: "text",
	codeFilter: "Filter or type a language",
	codeCustom: "Enter writes a word the list does not hold.",
	rowAbove: "Row above",
	rowBelow: "Row below",
	columnLeft: "Column to the left",
	columnRight: "Column to the right",
	alignLeft: "Align left",
	alignCenter: "Align centre",
	alignRight: "Align right",
	source: "Edit the markdown",
	delete: "Delete",
	done: "Done",
	proof: "Read it over",
	proofPanel: "Proofing",
	proofReading: "Reading...",
	proofClean: "Nothing to look at.",
	proofFailed: "The proofreader did not answer.",
	proofAgain: "Read again",
	proofShow: "Show it in the document",
	proofWhole: "Read the whole sentence",
	proofEdit: "Write the sentence yourself",
	proofIgnore: "Leave it",
	proofKeep: "Keep",
	proofKeepTitle: "Keep this, here and in everything after it",
};

let sequence = 0;

export class MarkdownEditor {
	// mount builds an editor over every textarea a selector, an element or a
	// node list names, and answers them. The common case is one call per
	// kind of field:
	//
	//	MarkdownEditor.mount("textarea[data-markdown]", {...});
	static mount(target, options = {}) {
		const nodes =
			typeof target === "string"
				? document.querySelectorAll(target)
				: target instanceof Element
					? [target]
					: (target ?? []);

		return [...nodes].map((node) => new MarkdownEditor(node, options));
	}

	constructor(field, options = {}) {
		this.field = field;
		this.options = options;
		this.prefix = options.prefix ?? "mdedit";
		this.texts = { ...TEXTS, ...options.texts };
		this.listeners = new Map();
		// Set by Escape, read by the next Tab: see keydown().
		this.releasingTab = false;
		// Whether the marker characters show. A document opens with them on.
		this.marks = options.marks !== false;
		// Whether a leading --- block draws as fields.
		this.frontmatter = options.frontmatter !== false;
		// One controller for every listener this editor adds, so destroy()
		// is a single abort and no list of removals has to stay in step.
		this.aborter = new AbortController();
		this.uploads = options.uploads ? new Uploads(this, options.uploads) : null;
		this.uploadPanel = this.uploads ? new UploadPanel(this) : null;
		this.grid = new TableGrid(this);
		this.imagePanel = new ImagePanel(this);
		this.linkPanel = new LinkPanel(this);
		// Only a host that can read a document gets the panel and the tool
		// for it: without `proof` there is nobody to ask.
		this.proofPanel = options.proof ? new ProofPanel(this) : null;
		this.tableMenu = new TableMenu(this);
		this.levelMenu = new LevelMenu(this);
		this.codeMenu = new CodeMenu(this);
		this.tools = {
			...defaultTools(),
			...(this.uploads
				? {
						upload: {
							label: "Img",
							// An upward arrow is a guess on its own: the word
							// says what lands where.
							word: true,
							icon: "icon-upload",
							title: this.texts.upload,
							run: (editor, event) => editor.uploadPanel?.toggle(event),
						},
					}
				: {}),
			...(options.proof
				? {
						proof: {
							label: "Proof",
							icon: "icon-proof",
							title: this.texts.proof,
							run: (editor, event) => editor.proofPanel?.toggle(event),
						},
					}
				: {}),
			...options.tools,
		};

		if (!field.id) {
			sequence += 1;
			field.id = `${this.prefix}-${sequence}`;
		}

		this.build();
	}

	// ── The surface ───────────────────────────────────────────────────────

	build() {
		const field = this.field;
		const name = (part) => `${this.prefix}__${part}`;

		this.root = document.createElement("div");
		this.root.className = this.prefix;
		field.parentNode.insertBefore(this.root, field);

		this.surface = document.createElement("div");
		this.surface.id = `${field.id}-surface`;
		this.surface.className = name("surface");
		this.surface.contentEditable = "true";
		this.surface.spellcheck = this.options.spellcheck !== false;
		this.surface.setAttribute("role", "textbox");
		this.surface.setAttribute("aria-multiline", "true");
		this.surface.setAttribute("aria-label", field.getAttribute("aria-label") ?? this.texts.document);
		// The document is markdown characters and the bar writes them, so a
		// browser correcting the case of a word would be correcting source.
		this.surface.setAttribute("autocorrect", "off");
		this.surface.setAttribute("autocapitalize", "off");

		this.bar = this.buildBar();
		if (this.bar) {
			this.root.appendChild(this.bar);
		}

		this.frame = document.createElement("div");
		this.frame.className = name("frame");
		this.frame.appendChild(this.surface);
		this.root.appendChild(this.frame);

		// The textarea goes on carrying what the form posts. Nothing types
		// into it any more: the surface writes it on every edit.
		field.hidden = true;
		this.frame.appendChild(field);

		this.source = new Surface(this, this.surface, field);
		this.source.load(field.value);

		const signal = this.aborter.signal;
		this.source.attach(signal);
		this.surface.addEventListener("keydown", (event) => this.keydown(event), { signal });
		this.imagePanel.attach(signal);
		this.tableMenu.attach(signal);
		this.levelMenu.attach(signal);
		this.codeMenu.attach(signal);

		this.toggleMarks(this.marks);
	}

	// keydown holds Tab inside the document: a tab is a character in a code
	// block, and markdown reads it as indentation everywhere else. Escape
	// first and the next Tab moves the focus on, which is the way out for
	// anyone driving the page from the keyboard; `tab: false` turns the
	// whole thing off.
	// The shortcuts every editor has, over the markers markdown spells the
	// same decorations with. A host that binds its own takes `shortcuts:
	// false` and reads the keys itself.
	//
	// Ctrl+U is not here: markdown has no underline, and writing one means
	// raw HTML, which a publisher is as likely to strip as to render.
	static SHORTCUTS = {
		b: "bold",
		i: "italic",
		// Strikethrough has no one key. These two are what the editors a
		// writer is coming from use.
		x: "strike",
		s: "strike",
	};

	// shortcut answers the tool a keystroke names, or nothing.
	shortcut(event) {
		if (!(event.ctrlKey || event.metaKey) || event.altKey) {
			return "";
		}

		const key = event.key.toLowerCase();
		const tool = MarkdownEditor.SHORTCUTS[key];
		if (!tool) {
			return "";
		}
		// Bold and italic are the bare chord; strike is the shifted one, so
		// Ctrl+S stays the browser's and the host's to save with.
		if ((key === "x" || key === "s") !== event.shiftKey) {
			return "";
		}

		return this.tools[tool] ? tool : "";
	}

	keydown(event) {
		// The YAML source view is a textarea of its own: its keys, its undo
		// and its Tab belong to it.
		if (event.target?.closest?.(`.${this.prefix}__frontmatter-source`)) {
			return;
		}

		if (this.options.shortcuts !== false) {
			const tool = this.shortcut(event);
			if (tool) {
				event.preventDefault();
				this.run(tool, event);
				return;
			}
		}

		if (event.key === "Escape") {
			this.releasingTab = true;
			return;
		}
		if (event.key !== "Tab") {
			this.releasingTab = false;
			return;
		}
		if (this.options.tab === false) {
			return;
		}
		if (this.releasingTab) {
			this.releasingTab = false;
			return;
		}

		event.preventDefault();

		// Tab in a drawn table crosses it, cell by cell: a tab character in a
		// cell is whitespace a markdown table swallows anyway.
		if (this.source.stepCell(!event.shiftKey)) {
			return;
		}

		const { text } = this.selection;
		if (event.shiftKey) {
			this.source.outdent();
			return;
		}
		if (text.includes("\n")) {
			this.source.indent();
			return;
		}

		this.insert("\t");
	}

	buildBar() {
		// The default bar carries the picker once uploads are configured.
		// Without it a file arrives by paste or by drop alone, and a page
		// shows neither gesture on its face. A project that names its own
		// toolbar gets the keys it named.
		const toolbar =
			this.options.toolbar ?? (this.uploads ? [...TOOLBAR_FULL, "upload"] : TOOLBAR_FULL);
		if (toolbar === false) {
			this.marksButton = null;
			return null;
		}

		const bar = document.createElement("div");
		bar.className = `${this.prefix}__bar`;
		bar.setAttribute("role", "toolbar");
		bar.setAttribute("aria-label", this.texts.formatting);
		bar.setAttribute("aria-controls", this.surface.id);

		for (const key of toolbar) {
			const tool = this.tools[key];
			if (!tool) {
				continue;
			}
			bar.appendChild(
				this.button(key, tool.label, tool.title, (event) => this.run(key, event), tool.icon, tool.word),
			);
		}

		// The pilcrow stands apart from the tools that write: it says whether
		// the markup shows, and a document opens with it pressed.
		this.marksButton = this.button("marks", "¶", this.texts.marks, () => this.toggleMarks(), "icon-paragraph");
		bar.appendChild(this.marksButton);

		roving(bar, this.aborter.signal);

		return bar;
	}

	// button draws one of the bar's buttons through the shared builder: the
	// toolbar holds the caret, so every button on it does.
	button(key, label, title, run, icon, word) {
		return tool({ prefix: this.prefix, key, label, title, icon, word, run });
	}

	// stage is the element the document stands in. The table grid takes its
	// place while it is open.
	get stage() {
		return this.frame;
	}

	// refresh builds the surface again from the textarea: for a value a host
	// set behind the editor's back.
	refresh() {
		this.source.forget();
		this.source.load(this.field.value);
	}

	// ── Editing ───────────────────────────────────────────────────────────

	get value() {
		return this.source.value;
	}

	set value(text) {
		this.source.value = text;
	}

	get selection() {
		return this.source.selection;
	}

	focus(options) {
		this.source.focus(options);
	}

	// Every move runs against the source the caret stands in. One cell of a
	// drawn table holds its own markdown, so a tool run with the caret there
	// writes in that cell.
	insert(text, cursor, length) {
		this.source.active.insert(text, cursor, length);
	}

	insertBlock(text, cursor, length) {
		this.source.active.insertBlock(text, cursor, length);
	}

	wrap(marker, placeholder) {
		this.source.active.wrap(marker, placeholder);
	}

	prefixLines(marker) {
		this.source.active.prefixLines(marker);
	}

	// run fires one tool by its key: what the toolbar button does, available
	// to a keyboard shortcut or a menu of the host's own. The event that ran
	// it comes along, for a tool that opens something under the pointer.
	run(key, event) {
		const tool = this.tools[key];
		if (!tool) {
			return;
		}

		// The YAML source view holds the focus while the writer types YAML.
		if (document.activeElement?.closest?.(`.${this.prefix}__frontmatter-source`)) {
			return;
		}

		// A panel holding a draft keeps the press. A tool writes at the caret
		// in the document, and that caret is wherever the writer left it
		// before they opened the panel: the words they are typing are what
		// the press is about, and a tool running now would write into a line
		// nobody is looking at.
		if (this.proofPanel?.editing && this.owns(document.activeElement)) {
			return;
		}

		tool.run(this, event);

		// The caret goes back to the document, since a tool that wrote into
		// it is a tool the writer goes on typing after. A tool that opened a
		// panel and put the caret in one of its fields keeps it: taking it
		// back would land every keystroke in the document instead, and the
		// draft the field holds would go with the focus.
		if (!this.owns(document.activeElement)) {
			this.focus();
		}
	}

	// owns answers whether one of this editor's own fields holds the focus: a
	// panel's draft, an address in the links table, a cell. The caret a
	// writer is typing at is in there and not in the document.
	owns(node) {
		return Boolean(node) && this.root.contains(node) && ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
	}

	// toggleMarks shows or hides the marker characters. Shown, the document
	// reads as markdown with every construct already in its own face; hidden,
	// only what the markers marked shows, and it goes on being edited where
	// it stands.
	toggleMarks(on = !this.marks) {
		this.marks = on;
		this.root.classList.toggle(`${this.prefix}--marks`, on);
		this.marksButton?.setAttribute("aria-pressed", String(on));
		this.emit("marks", { marks: on });

		return on;
	}

	// editTable opens the grid over the table the caret sits in, and
	// answers whether it found one. The table tool calls it before writing a
	// new table, so the button reads as "table" either way.
	editTable() {
		return this.grid.toggle();
	}

	upload(file) {
		if (!this.uploads) {
			return Promise.resolve(null);
		}

		return this.uploads.handle(file);
	}

	// ── Events ────────────────────────────────────────────────────────────

	// on registers a listener and answers the function that removes it.
	// Events: change, marks, table, upload, error.
	on(name, listener) {
		if (!this.listeners.has(name)) {
			this.listeners.set(name, new Set());
		}
		this.listeners.get(name).add(listener);

		return () => this.listeners.get(name)?.delete(listener);
	}

	emit(name, detail) {
		for (const listener of this.listeners.get(name) ?? []) {
			listener({ ...detail, editor: this });
		}
	}

	// destroy puts the textarea back under its original parent and drops
	// everything this editor added, listeners included.
	destroy() {
		this.grid.close();
		this.imagePanel.close();
		this.linkPanel.close();
		this.tableMenu.close();
		this.levelMenu.close();
		this.codeMenu.close();
		this.uploadPanel?.close();
		this.uploads?.destroy();
		this.aborter.abort();
		this.listeners.clear();
		this.field.hidden = false;
		this.root.parentNode?.insertBefore(this.field, this.root);
		this.root.remove();
	}
}
