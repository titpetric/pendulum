# Integration guide

How to put mdedit in a project: mount it, configure it, point its uploads at a server, style it and publish what it writes. The README shows what the editor does; this guide covers what a host page has to do.

## Install

Copy `dist/` into a project and point two tags at it:

```html
<link rel="stylesheet" href="/mdedit/mdedit.min.css">
<textarea id="body" name="body" rows="20"></textarea>
<script type="module">
	import { MarkdownEditor } from "/mdedit/mdedit.min.js";

	new MarkdownEditor(document.getElementById("body"), {
		uploads: { endpoint: "/api/upload", token: "..." },
	});
</script>
```

| File                    | What it holds                                     |
|-------------------------|---------------------------------------------------|
| `dist/mdedit.js`        | ES module, readable                               |
| `dist/mdedit.min.js`    | ES module, minified                               |
| `dist/mdedit.global.js` | classic script, minified, exports `window.mdedit` |
| `dist/mdedit.css`       | the stylesheet                                    |
| `dist/mdedit.min.css`   | the stylesheet, minified                          |

`src/` holds twenty ES modules with relative imports, so `import { MarkdownEditor } from "/mdedit/src/index.js"` serves a page without any build.

## Options

```js
new MarkdownEditor(field, {
	prefix: "mdedit",              // CSS class prefix (rename the CSS too)
	toolbar: TOOLBAR_FULL,         // keys to show, or false for no bar
	tools: { embed: {...} },       // extra tools, or replacements by key
	marks: true,                   // false opens with the markers hidden
	tab: true,                     // false gives Tab back to the browser
	shortcuts: true,               // false gives Ctrl+B, Ctrl+I and the rest back
	uploads: {...},                // absent means no uploads
	cards: {...},                  // the host's own markers, drawn as blocks
	proof: (text) => {...},        // absent means no proofing tool
	allow: (finding) => {...},     // absent means no "keep" on a row
	texts: {...},                  // every string the editor can show
});
```

`toolbar` takes the keys of `tools`: `bold`, `italic`, `strike`, `heading`, `link`, `code`, `fence`, `quote`, `list`, `table`, `upload` once a project configures uploads, and `proof` once it names a `proof` reader. `TOOLBAR_FULL` is the first ten, `TOOLBAR_INLINE` the five that suit a one-paragraph field. A tool is

```js
{ label: "B", icon: "icon-text-bold", title: "Bold", run: (editor) => editor.wrap("**", "bold") }
```

so adding one is adding an entry under a key. `icon` names a class the stylesheet draws as a mask, which takes the colour of the button it sits in: `icon-text-bold`, `icon-text-italic`, `icon-text-strikethrough`, `icon-text-heading`, `icon-link`, `icon-code`, `icon-code-block`, `icon-quote`, `icon-list`, `icon-table`, `icon-image`, `icon-paragraph`, `icon-upload`, `icon-proof`, `icon-file`, `icon-audio`, `icon-video`, `icon-trash`. The classes stand on their own, so a project can put `.icon-table` on a button of its own. A tool that names no icon shows its `label`, and the title and the aria-label state the name either way.

Ctrl+B, Ctrl+I, Ctrl+Shift+X and Ctrl+Shift+S decorate the selection, and pressing one again takes the decoration back off. The toolbar buttons do the same thing, so a word bolded by the button is bare after Ctrl+B. Ctrl+U is not bound: markdown has no underline, and writing one means raw HTML a publisher is as likely to strip as to render. Ctrl+S alone is left to the browser and the host, for whoever means save by it.

The bar holds at the top of the window while the editor is in view, so a writer at the foot of a long document can still press a button about the line they are on, and it leaves with the editor's own foot, so it stands over nobody else's part of the page. `--mdedit-sticky` is how far down it holds, for a page whose own header is already there; `--mdedit-bar-position: static` turns it off.

Tab writes a tab, and a selection of lines indents; Shift-Tab takes one level back off. In a drawn table Tab crosses the cells and grows the table at the foot of it, which [Tables](../README.md#tables) sets out. Escape first and the next Tab moves the focus on, which is the way out for anyone driving the page from the keyboard. `tab: false` leaves Tab to the browser.

## Uploads

```js
uploads: {
	endpoint: "/api/upload",      // string or (file) => string
	method: "POST",               // or "PUT"
	encoding: "form",             // "form" (multipart) or "raw" (the bytes)
	field: "file",                // multipart field name
	params: {},                   // object or (file) => object, multipart only
	headers: {},                  // object or (file) => object
	token: "...",                 // string or (file) => string
	tokenHeader: "Authorization",
	tokenScheme: "Bearer",        // "" sends the token bare
	filenameHeader: "X-Filename", // raw encoding; false to omit
	accept: ["image/"],           // mime prefixes, exact types, or (file) => bool
	maxBytes: 2 * 1024 * 1024,    // a number, or (file) => number; 0 for no limit
	allow: (file) => true,        // the project's own gate; a string refuses
	paste: true,
	drop: true,
	url: (answer, response) => answer.url,
	snippet: (url, file) => `![](${url})`,
	placeholder: (file, n) => `![uploading ${n}...]()`,
}
```

Leave `uploads` out and nothing uploads: no paste handler, no drop handler, no picker.

`endpoint`, `params`, `headers` and `token` each take a function returning a promise, for work that has to happen on the way to the request:

```js
uploads: {
	endpoint: "/api/upload",
	params: async () => ({ article_id: await ensureArticle() }),
}
```

The wire format is one request per file:

```
POST /api/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data            (file under `field`, plus `params`)

-> 200 {"url": "/path/the/server/chose"}
-> anything else, or {"error": "..."}, shows as a failed preview in the document
```

With `encoding: "raw"` the body is the bytes themselves, `Content-Type` is the file's own, and the original name rides along in `X-Filename`, percent-encoded. Either way the server names what it stores, a ulid or a hash or anything else, and the URL it answers with is all the editor learns. The original filename stays informational.

A refusal (wrong type, too large, `allow` said no) stops before the network: the placeholder stays where it landed and the preview on it says why, and an `error` event fires. The document gains no character.

The `upload` event names its file and its `id`, so a host can follow one file from `start` through `progress` to `done` or `failed`: `{ state, file, id, loaded, total, ratio, url }`. The `error` event names the same `file` and `id`.

## Publishing the document

The editor lays out images and players with its own stylesheet. The page that publishes the markdown needs the matching rules, or a picture the author floated left renders in the middle of the column.

### Images

A publisher copies the same three rules and swaps the selector for whatever wraps its article body, so what the author laid out is what the reader gets:

```css
.article img[src*="#left"] {
	float: left;
	max-width: min(45%, 20rem);
	margin: 0.4em 1.3em 1.3em 0;
}
.article img[src*="#right"] { float: right; max-width: min(45%, 20rem); margin: 0.4em 0 1.3em 1.3em; }
.article img[src*="#center"] { display: block; margin: 1.3em auto; }
.article img { max-width: 100%; height: auto; }
.article p > img:only-child { display: block; margin: 1.3em 0; }
.article h1, .article h2, .article h3, .article pre, .article table { clear: both; }

/* On a phone a float leaves three words beside it, so the picture takes
   the width and the text goes back under it. */
@media (max-width: 30rem) {
	.article img[src*="#left"],
	.article img[src*="#right"] { float: none; max-width: 100%; margin: 1.3em 0; }
}
```

A browser never sends a fragment, so the server fetches the file and sees nothing of the anchor.

## Proofing

The editor knows nothing about spelling or about a project's house style. A host that can read its own documents names a `proof` reader, and the `proof` tool appears on the bar:

```js
proof: async (text) => {
	const answer = await fetch("/api/proof", { method: "POST", body: new FormData(...) });
	return answer.json();
},
```

It takes the document and answers the findings, as a list or as `{ findings: [...] }`. Each one is

```js
{
	tool: "spelling",            // what raised it; the row is grouped by it
	rule: "VagueVerb",           // the rule inside that tool, where there is one
	severity: "warning",
	message: "No dictionary holds wrod.",
	match: "wrod",               // the text as it stands
	start: 42, end: 46,          // string offsets into the document
	suggestions: ["word"],       // what to write instead, best first
}
```

`start` and `end` are offsets into the document the editor holds, counted the way JavaScript counts a string, so a host whose reader works in bytes converts before it answers.

The panel lists them in document order, each in the line it stands in: a few words either side, cut at both ends, and pressing that line opens the whole sentence. The arrow beside a row selects the words in the document and scrolls them into view, by the least movement that does it; pressing a suggestion writes it over that span and drops the row, and the findings after it move by the length of the change, so a list stays usable to the last row off one answer. The ✎ beside the arrow opens the sentence the finding stands in as a field, with Save and Cancel under it, which is the only way to write over a finding the host offered no suggestion for. What the field holds is the sentence bounded to the line, less the `##`, `-`, `1.` or `>` that opens the line, so a sentence written back cannot demote a heading or kill a bullet; on a table row the span is the one cell and not the row with its pipes. Enter and Shift+Enter save, Escape drops the draft and leaves the panel standing, a newline pasted in reads as the space it stands for, and Save is out of reach until the text differs from what the document holds. Saving writes the field over that span and drops the row: a finding before the span stands still, one after it moves by the length of the change, and one inside the rewritten sentence the panel finds again by its own words, and drops when the rewrite takes those words away. A writer who disagrees leaves a finding, which drops the row and writes nothing. Where the writer edits under an open panel, the span stops matching what the report named, and the editor reads the document again; Save reads it again as well, so a draft lands only on the sentence the field opened on. The bar refuses a press while a field stands open, so the draft survives it, and a row whose words the panel cannot find has no ✎, the same case that disables the snippet.

A reader that refuses says so in the panel; the document is untouched either way.

A host that remembers what a writer keeps names an `allow` callback as well, and each row gains a **keep** beside the ×:

```js
allow: async (finding) => {
	await fetch("/api/dictionary", { method: "POST", body: ... });
},
```

It takes the finding and stores it under whatever identity the host keeps. The rows about the same words go when it resolves; a refusal leaves the list alone and says so on the button, since a word the writer thinks they kept and did not would be reported again with no explanation. The × is the other half: it drops one row and remembers nothing.

## Cards

A project with a marker syntax of its own - a cited article, an embedded recording, a chart - draws its own block for it:

```js
cards: {
	pattern: /^<!--\s*article#([0-9A-HJKMNP-TV-Z]{26})\s*-->$/,
	render: (key, editor) => fetchCard(key),   // a node, HTML, or a promise of either
	styles: "@import url('/assets/css/site.css');",
}
```

The editor matches `pattern` against one trimmed line. The first capture names the card, the whole line where there is none, and the editor calls `render` with that name. A marker inside a fenced block is code to show and draws nothing.

The line goes on holding the characters the writer typed: the marker is a marker like `**` or `###`, so it hides with the pilcrow and the card stands where it sat. The editor draws the card itself in a shadow root, which keeps what it says out of the document: `editor.value` and the textarea hold the marker, never the title the card shows. `styles` names the stylesheet the editor draws that root with, since the page's own rules do not reach into a shadow root; an `@import` of the site's stylesheet is the shortest way to make the card in the editor the card on the published page. A link in a card opens in another tab, since the editor it sits in is holding an unsaved document.

The editor calls `render` each time it draws the line, so a host that fetches keeps its own cache:

```js
const drawn = new Map();
const fetchCard = (id) => {
	if (!drawn.has(id)) {
		drawn.set(id, fetch(`/api/embed?id=${id}`).then((r) => r.json()).then((a) => a.html));
	}
	return drawn.get(id);
};
```

## API

```js
editor.value                      // get and set the markdown
editor.selection                  // { start, end, text }
editor.insert(text, cursor, len)  // at the selection
editor.insertBlock(text, c, len)  // the same, on a line of its own
editor.wrap("**", "bold")
editor.prefixLines("> ")
editor.run("bold")                // what the toolbar button does
editor.upload(file)               // what a paste does
editor.toggleMarks(on)            // the pilcrow, from script
editor.editTable()                // the grid over the table at the caret
editor.refresh()                  // repaint after a change from outside
editor.destroy()                  // put the textarea back, drop the listeners

editor.on("change", ({ value }) => {});
editor.on("upload", ({ state, file, id, loaded, total, ratio, url }) => {}); // start, progress, done
editor.on("marks", ({ marks }) => {});
editor.on("error", ({ phase, file, id, error }) => {});        // phase: upload
```

`MarkdownEditor.mount(selector, options)` builds one per matching textarea and answers them.

## Theming

The stylesheet reads `--mdedit-*` custom properties. The defaults sit in `:where(.mdedit)`, which adds no specificity, so a plain `.mdedit` rule wins whichever stylesheet loads first. Light and dark defaults ship with it.

```css
.mdedit {
	--mdedit-prose-font: var(--ui);    /* the document */
	--mdedit-code-font: var(--mono);   /* code spans, fenced blocks, markers */
	--mdedit-font: var(--mono);        /* what a cell field falls back to */
	--mdedit-size: 0.9rem;
	--mdedit-leading: 1.6;
	--mdedit-pad: 0.5rem 0.75rem;
	--mdedit-rail: 0.75rem;            /* where the caret stands at a line's head */
	--mdedit-gap: 0.25rem;
	--mdedit-radius: 2px;
	--mdedit-ui-font: inherit;
	--mdedit-ui-size: 0.9rem;
	--mdedit-fence-hint: "``` closes this block";
	--mdedit-min-height: 12rem;
	--mdedit-paper: var(--paper);
	--mdedit-ink: var(--ink);
	--mdedit-ink-soft: var(--ink-soft);
	--mdedit-line: var(--line);
	--mdedit-line-strong: var(--line-strong);
	--mdedit-bar: var(--bar);
	--mdedit-code: var(--code);
	--mdedit-keyword: var(--violet);
	--mdedit-string: var(--green);
	--mdedit-number: var(--orange);
	--mdedit-comment: var(--grey);
	--mdedit-accent: var(--accent);
	--mdedit-accent-ink: var(--accent-ink);
	--mdedit-accent-text: var(--accent-text);
}
```

The faces are free: the document sets in `--mdedit-prose-font` and the code runs, the markers and a fenced block in `--mdedit-code-font`. Heading sizes, the quote rule, the list bullets and the code surfaces are the stylesheet's own, and every one of them is a class a project can restyle.

`--mdedit-rail` is the room at the head of every line, over and above the padding: a caret on the first character of a line draws on the edge of the writing area otherwise. The property takes rem, so a heading and the paragraph under it keep one left edge.

---

Previous: [README](../README.md) | Next: [Development guide](development.md)
