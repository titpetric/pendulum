// The default toolbar. A tool is { label, title, icon, word, run(editor) }
// and nothing else, so a host adds one by handing the editor another entry
// under its own key - see `tools` and `toolbar` in the options.
//
// `icon` names a class the stylesheet draws, and `label` is what stands in
// its place where there is no icon: a tool a project adds needs no CSS to
// appear on the bar. Labels stay within what a monospace face actually
// draws, since a colour emoji breaks the monochrome bar and a box-drawing
// glyph the font lacks comes out as tofu.
//
// `word` draws the label beside the icon rather than in place of it. Two
// tools take it, Table and Img, whose marks read as a guess on their own.
// The rest are one glyph for one construct and need no caption.

const TABLE = [
	"| Column | Column | Column |",
	"| --- | --- | --- |",
	"|  |  |  |",
	"|  |  |  |",
].join("\n");

// cycleHeading walks none -> ## -> ### -> none, so one button covers the
// levels an article actually uses.
function cycleHeading(editor) {
	// The line the caret is on, in whatever source holds the caret: a cell of
	// a drawn table is one line of its own.
	const source = editor.source.active;
	const { start, end, text } = source.line();
	const current = text.match(/^(#{1,6})\s/);

	let next;
	if (!current) {
		next = `## ${text}`;
	} else if (current[1].length < 3) {
		next = `#${text}`;
	} else {
		next = text.replace(/^#{1,6}\s/, "");
	}

	source.replace(start, end, next, start + next.length);
}

function insertLink(editor, event) {
	// With nothing selected there is no text to put into a new link, and the
	// writer is more likely to be tending the ones already written: the
	// panel lists every link in the document instead of writing another.
	if (!editor.selection.text && editor.linkPanel) {
		editor.linkPanel.toggle(event);
		return;
	}

	const text = editor.selection.text || "text";
	if (!editor.linkPanel) {
		// No panel: the address is typed in the document, in the slot.
		editor.insert(`[${text}](url)`, text.length + 3, 3);
		return;
	}

	// The selection becomes the link's words and the panel takes the
	// address: one row, for this link, with its address field focused. An
	// empty pair of parentheses is what the panel reads as a row to fill in,
	// and a dismissal puts the document back the way it stands now.
	const before = editor.value;
	const start = editor.selection.start;
	editor.insert(`[${text}]()`, text.length + 3, 0);
	editor.linkPanel.show(event, { at: start, only: true, revert: before });
}

function insertFence(editor) {
	const body = editor.selection.text || "code";
	// The caret lands after the opening fence, where the language goes.
	editor.insertBlock("```\n" + body + "\n```\n", 3, 0);
}

export function defaultTools() {
	return {
		bold: { label: "B", icon: "icon-text-bold", title: "Bold", run: (editor) => editor.wrap("**", "bold") },
		italic: { label: "I", icon: "icon-text-italic", title: "Italic", run: (editor) => editor.wrap("_", "italic") },
		strike: { label: "S", icon: "icon-text-strikethrough", title: "Strikethrough", run: (editor) => editor.wrap("~~", "struck") },
		heading: { label: "H", icon: "icon-text-heading", title: "Heading", run: cycleHeading },
		link: { label: "[ ]", icon: "icon-link", title: "Link", run: insertLink },
		code: { label: "<>", icon: "icon-code", title: "Inline code", run: (editor) => editor.wrap("`", "code") },
		fence: { label: "{ }", icon: "icon-code-block", title: "Code block", run: insertFence },
		quote: { label: '"', icon: "icon-quote", title: "Quote", run: (editor) => editor.prefixLines("> ") },
		list: { label: "≡", icon: "icon-list", title: "Bullet list", run: (editor) => editor.prefixLines("- ") },
		// The pilcrow shows or hides the marker characters. The editor puts
		// this button on the bar itself; the key stays here so a project
		// that lists its own toolbar still finds it.
		marks: {
			label: "\u00b6",
			icon: "icon-paragraph",
			title: "Show the markup",
			run: (editor) => editor.toggleMarks?.(),
		},
		// One button for both: inside a table it opens the grid, and
		// anywhere else it writes a new table. A table needs to start its
		// own line and needs a blank line after it, or the next paragraph
		// joins the last row; the caret lands on the first column heading.
		table: {
			label: "Table",
			// A grid mark reads as a table or as the grid editor; the word
			// settles it.
			word: true,
			icon: "icon-table",
			title: "Table",
			run: (editor) => {
				if (!editor.editTable?.()) {
					editor.insertBlock(`${TABLE}\n\n`, 2, 6);
				}
			},
		},
	};
}

// The full bar: everything, including the tools that write whole lines.
export const TOOLBAR_FULL = [
	"bold",
	"italic",
	"strike",
	"heading",
	"link",
	"code",
	"fence",
	"quote",
	"list",
	"table",
];

// The inline bar: what a one-paragraph field (a description, a comment) can
// use without the block constructs.
export const TOOLBAR_INLINE = ["bold", "italic", "strike", "link", "code"];
