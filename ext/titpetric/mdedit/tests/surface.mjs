// Verification for mdedit: one contenteditable surface holding the markdown
// itself. Drives the demo server with playwright and reports each claim.

import { chromium } from "./lib.mjs";

const PORT = process.env.MDEDIT_PORT ?? "18899";
const URL = `http://127.0.0.1:${PORT}/edit?file=welcome.md`;

const problems = [];
const ok = (label, pass, detail = "") => {
	console.log(`${pass ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
	if (!pass) problems.push(label);
};

const browser = await chromium.launch({ executablePath: "/usr/lib/chromium/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

const noise = [];
// One check fakes a failing upload, where the 500 and the browser's
// complaint about it are the point.
let faking = false;
page.on("console", (message) => {
	if (faking) return;
	if (message.type() === "error" || message.type() === "warning") noise.push(`${message.type()}: ${message.text()}`);
});
page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));
page.on("response", (response) => {
	if (response.status() >= 400 && !faking) noise.push(`${response.status()}: ${response.url()}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

// set puts a document in and leaves the caret where it asks.
const set = (markdown, caret = 0) =>
	page.evaluate(
		([text, at]) => {
			window.editor.value = text;
			window.editor.focus();
			window.editor.source.select(at);
		},
		[markdown, caret],
	);

const value = () => page.evaluate(() => window.editor.value);
const field = () => page.inputValue("textarea[data-markdown]");
const caret = () => page.evaluate(() => window.editor.selection.start);

// ── 1. the surface holds the document ─────────────────────────────────────

const start = await page.evaluate(() => {
	const surface = document.querySelector(".mdedit__surface");
	const area = document.querySelector("textarea[data-markdown]");
	return {
		editable: surface.isContentEditable,
		lines: surface.children.length,
		hidden: area.hidden,
		same: window.editor.value === area.value,
		marks: document.querySelector(".mdedit").classList.contains("mdedit--marks"),
		pressed: document.querySelector(".mdedit__tool--marks").getAttribute("aria-pressed"),
	};
});
ok("surface: one editable element holding the lines", start.editable && start.lines > 5, JSON.stringify(start));
ok("surface: the textarea stays hidden and carries the same value", start.hidden && start.same);
ok("surface: a document opens with the markup shown", start.marks && start.pressed === "true");

// ── 2. typing a heading ───────────────────────────────────────────────────

await set("one\n\ntwo\n", 0);
await page.keyboard.type("### Heading");
await page.waitForTimeout(120);

const heading = await page.evaluate(() => {
	const line = document.querySelector(".mdedit__surface").children[0];
	const body = document.querySelector(".mdedit__surface");
	const selection = document.getSelection();
	return {
		klass: line.className,
		size: Number.parseFloat(getComputedStyle(line).fontSize),
		base: Number.parseFloat(getComputedStyle(body).fontSize),
		weight: getComputedStyle(line).fontWeight,
		caretIn: selection.anchorNode?.parentElement?.closest(".mdedit__line") === line,
		caret: window.editor.selection.start,
		value: window.editor.value,
	};
});
ok("typing: `### ` turns the line into a heading as it is typed", heading.klass.includes("mdedit-h3"), heading.klass);
ok("typing: the word after it is in the heading face", heading.size > heading.base && heading.weight === "700",
	`${heading.size}px over ${heading.base}px, weight ${heading.weight}`);
ok("typing: the caret is still in the word", heading.caretIn && heading.caret === 11, `caret ${heading.caret}`);
ok("typing: the markdown holds every character the keys spell", heading.value === "### Headingone\n\ntwo\n", JSON.stringify(heading.value));

// ── 3. typing inside a marked run ────────────────────────────────────────

await set("a **bold** word\n", 6);
await page.keyboard.type("XX");
await page.waitForTimeout(120);
const inside = await page.evaluate(() => ({
	value: window.editor.value,
	strong: document.querySelector(".mdedit-strong")?.textContent,
	caret: window.editor.selection.start,
}));
ok("typing: a word typed inside **bold** keeps its markers", inside.value === "a **boXXld** word\n" && inside.strong === "**boXXld**",
	JSON.stringify(inside));
ok("typing: the caret stands after the characters it spelled", inside.caret === 8, String(inside.caret));

// ── 4. the pilcrow ───────────────────────────────────────────────────────

await set("# Title\n\nsome **bold** text\n", 0);
const shown = await page.evaluate(() => {
	const line = document.querySelector(".mdedit__surface").children[0];
	return { text: line.innerText, top: Math.round(line.getBoundingClientRect().top), value: window.editor.value };
});
await page.click(".mdedit__tool--marks");
await page.waitForTimeout(120);
const quiet = await page.evaluate(() => {
	const line = document.querySelector(".mdedit__surface").children[0];
	const marks = [...document.querySelectorAll(".mdedit-mark")];
	return {
		text: line.innerText,
		top: Math.round(line.getBoundingClientRect().top),
		hidden: marks.every((mark) => getComputedStyle(mark).display === "none"),
		pressed: document.querySelector(".mdedit__tool--marks").getAttribute("aria-pressed"),
		value: window.editor.value,
		strong: getComputedStyle(document.querySelector(".mdedit-strong")).fontWeight,
	};
});
ok("marks: the pilcrow hides every marker", quiet.hidden && quiet.pressed === "false", JSON.stringify({ hidden: quiet.hidden, pressed: quiet.pressed }));
ok("marks: the text keeps its place", quiet.top === shown.top && quiet.text === "Title", JSON.stringify({ shown: shown.text, quiet: quiet.text, top: [shown.top, quiet.top] }));
ok("marks: the document is unchanged", quiet.value === shown.value && quiet.value === "# Title\n\nsome **bold** text\n");
ok("marks: what the markers marked is still styled", quiet.strong === "700", quiet.strong);

// The caret still reaches both ends of a line whose markers are hidden, and
// one arrow press crosses the hidden run into the line above.
await set("x\n## Title\n", 0);
await page.evaluate(() => window.editor.source.select(5));
await page.waitForTimeout(80);
const crossed = await page.evaluate(() => {
	const selection = document.getSelection();
	return { node: selection.anchorNode?.textContent, offset: selection.anchorOffset, at: window.editor.selection.start };
});
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(80);
const left = await caret();
await page.evaluate(() => window.editor.source.select(10));
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
const right = await caret();
ok("marks: the caret sits at the start of the text, not in the hidden marker", crossed.node === "Title" && crossed.at === 5, JSON.stringify(crossed));
ok("marks: one arrow press crosses the hidden marker", left === 1, `caret ${left}`);
ok("marks: the caret reaches the end of the line too", right === 10 || right === 11, `caret ${right}`);

// Home, End, a word jump and a shift-arrow all count the characters the
// writer can see, with the markers hidden and the caret kept out of them.
await set("## Title here\n\nplain\n", 0);
await page.evaluate(() => window.editor.source.select(3));
await page.waitForTimeout(80);
const moves = {};
await page.keyboard.press("End");
await page.waitForTimeout(70);
moves.end = await caret();
await page.keyboard.press("Home");
await page.waitForTimeout(70);
moves.home = await caret();
await page.keyboard.press("Control+ArrowRight");
await page.waitForTimeout(70);
moves.word = await caret();
await page.evaluate(() => window.editor.source.select(3));
await page.keyboard.press("Shift+ArrowRight");
await page.keyboard.press("Shift+ArrowRight");
await page.waitForTimeout(70);
moves.held = await page.evaluate(() => window.editor.selection);
ok("marks: End and Home land on the text, not in the hidden hashes",
	moves.end === 13 && moves.home === 3, JSON.stringify(moves));
ok("marks: a word jump and a shift-arrow count the characters that show",
	moves.word === 8 && moves.held.start === 3 && moves.held.text === "Ti", JSON.stringify(moves));

// A construct closed at the end of a line leaves the caret after its closing
// marker, where there is nothing drawn to stand in. Landing on the character
// before it instead would put the caret back inside the construct, and the
// next letter typed would go in with it: a code span would never close.
const closes = [];
for (const [keys, want] of [
	[["`", "x", "`", "y"], "`x`y"],
	[["*", "*", "b", "*", "*", "!"], "**b**!"],
	[["~", "~", "s", "~", "~", "!"], "~~s~~!"],
	[["a", " ", "_", "e", "_", "!"], "a _e_!"],
]) {
	await set("", 0);
	for (const key of keys) {
		await page.keyboard.type(key);
	}
	await page.waitForTimeout(60);
	closes.push([want, await value()]);
}
ok("marks: a marker typed at the end of a line closes its construct, and what follows stands outside it",
	closes.every(([want, got]) => got === want), JSON.stringify(closes));

// An image marker is all marker, so with them hidden the whole line is the
// picture and the end of it is past every character there is.
const marker = "![a](/assets/docs/mdedit-logo.png)";
await set(marker, marker.length);
await page.keyboard.type("!");
await page.waitForTimeout(60);
ok("marks: what follows a picture lands after its marker, not before it",
	(await value()) === `${marker}!`, JSON.stringify(await value()));

await page.click(".mdedit__tool--marks");
await page.waitForTimeout(100);

// ── 5. Enter, Backspace, paste ───────────────────────────────────────────

await set("one two\n", 3);
await page.keyboard.press("Enter");
await page.waitForTimeout(100);
ok("keys: Enter opens the next line at the caret", (await value()) === "one\n two\n", JSON.stringify(await value()));

await page.keyboard.press("Backspace");
await page.waitForTimeout(100);
ok("keys: Backspace at the head of a line joins it to the one above", (await value()) === "one two\n", JSON.stringify(await value()));

await set("start\n", 5);
await page.evaluate(() => {
	const data = new DataTransfer();
	data.setData("text/plain", "plain words");
	data.setData("text/html", "<b>bold markup</b><script>alert(1)</script>");
	document.querySelector(".mdedit__surface").dispatchEvent(
		new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
	);
});
await page.waitForTimeout(100);
const pasted = await page.evaluate(() => ({
	value: window.editor.value,
	tags: document.querySelector(".mdedit__surface").querySelectorAll("b, script, span[style]").length,
}));
ok("keys: a paste arrives as plain text and no markup", pasted.value === "startplain words\n" && pasted.tags === 0, JSON.stringify(pasted));

await set("one\ntwo\n", 3);
await page.keyboard.press("Delete");
await page.waitForTimeout(100);
ok("keys: Delete at the end of a line joins the one below it", (await value()) === "onetwo\n", JSON.stringify(await value()));

await set("line\n", 4);
await page.keyboard.press("Shift+Enter");
await page.waitForTimeout(100);
ok("keys: Shift-Enter writes markdown's hard break", (await value()) === "line  \n\n", JSON.stringify(await value()));

// A paste arrives as the characters it is, wherever it lands.
const paste = (text) =>
	page.evaluate((body) => {
		const data = new DataTransfer();
		data.setData("text/plain", body);
		document.querySelector(".mdedit__surface").dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
		);
	}, text);

await set("a\n", 1);
await paste("one\ntwo\nthree");
await page.waitForTimeout(120);
const pastedLines = await page.evaluate(() => ({
	value: window.editor.value,
	caret: window.editor.selection.start,
	lines: document.querySelectorAll(".mdedit__surface > *").length,
	field: document.querySelector("textarea[data-markdown]").value,
}));
ok("keys: a paste of several lines becomes several lines",
	pastedLines.value === "aone\ntwo\nthree\n" && pastedLines.lines === 4 && pastedLines.caret === 14 && pastedLines.field === pastedLines.value,
	JSON.stringify(pastedLines));

await set("x\n", 1);
await paste("# head\n\n- item\n");
await page.waitForTimeout(120);
const pastedMarkdown = await page.evaluate(() => ({
	value: window.editor.value,
	kinds: [...document.querySelectorAll(".mdedit__surface > *")].map((node) => node.className.replace("mdedit__line mdedit-", "")),
}));
ok("keys: pasted markdown is tokenised where it lands",
	pastedMarkdown.value === "x# head\n\n- item\n\n" && pastedMarkdown.kinds.includes("list"),
	JSON.stringify(pastedMarkdown));

await set("```go\nx\n```\n", 7);
await paste("a\nb");
await page.waitForTimeout(120);
const pastedCode = await page.evaluate(() => ({
	value: window.editor.value,
	kinds: [...document.querySelectorAll(".mdedit__surface > *")].map((node) => node.className.replace("mdedit__line mdedit-", "")),
}));
ok("keys: a paste into a fence stays inside it",
	pastedCode.value === "```go\nxa\nb\n```\n" && pastedCode.kinds.join(",") === "fence,codeline,codeline,fence,para",
	JSON.stringify(pastedCode));

// Tab writes a tab inside a fence.
await set("```go\nx\n```\n", 7);
await page.keyboard.press("Tab");
await page.waitForTimeout(100);
ok("keys: Tab writes a tab in a fenced block", (await value()) === "```go\nx\t\n```\n", JSON.stringify(await value()));

// Undo steps back a word at a time.
await set("word ", 5);
await page.keyboard.type("two three");
await page.waitForTimeout(150);
const typedAll = await value();
await page.keyboard.press("Control+z");
await page.waitForTimeout(120);
const undone = await value();
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(120);
const redone = await value();
ok("keys: undo steps back a word, redo puts it back",
	typedAll === "word two three" && undone === "word two " && redone === typedAll,
	JSON.stringify({ typedAll, undone, redone }));

// ── 5b. undo over every kind of edit ─────────────────────────────────────

await set("make this bold\n", 0);
await page.evaluate(() => window.editor.source.select(10, 14));
await page.click(".mdedit__tool--bold");
await page.waitForTimeout(120);
const toolEdit = await value();
await page.keyboard.press("Control+z");
await page.waitForTimeout(120);
const toolUndone = await value();
await page.keyboard.press("Control+y");
await page.waitForTimeout(120);
ok("undo: a toolbar edit steps back and forward whole",
	toolEdit === "make this **bold**\n" && toolUndone === "make this bold\n" && (await value()) === toolEdit,
	JSON.stringify({ toolEdit, toolUndone }));

// An edit through a panel is one step: the panel writes it, and the caret
// stays in the panel's own field.
await set("look\n\n![cap](/assets/docs/table.png)\n", 0);
await page.waitForTimeout(300);
await page.click(".mdedit__pic", { button: "right" });
await page.waitForTimeout(150);
await page.click(".mdedit__image .mdedit__tool--align-right");
await page.waitForTimeout(150);
const imageEdit = await value();
await page.keyboard.press("Escape");
await page.click(".mdedit__surface");
await page.keyboard.press("Control+z");
await page.waitForTimeout(150);
ok("undo: an image edit steps back",
	imageEdit.includes("table.png#right") && (await value()) === "look\n\n![cap](/assets/docs/table.png)\n",
	JSON.stringify({ imageEdit, undone: await value() }));

// A cell edit the same way.
await set("| a | b |\n| --- | --- |\n| c | d |\n", 0);
await page.waitForTimeout(250);
await page.click(".mdedit__widget td");
await page.keyboard.press("End");
await page.keyboard.type("Z");
await page.waitForTimeout(200);
const cellEdit = await value();
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
ok("undo: a cell edit steps back", cellEdit.includes("| cZ ") && (await value()) === "| a | b |\n| --- | --- |\n| c | d |\n",
	JSON.stringify({ cellEdit, undone: await value() }));

// Hiding the markers is not an edit, so it leaves the stack alone.
await set("one\n", 3);
await page.keyboard.type("!");
await page.waitForTimeout(120);
await page.click(".mdedit__tool--marks");
await page.waitForTimeout(120);
await page.keyboard.press("Control+z");
await page.waitForTimeout(150);
const afterToggle = await value();
await page.click(".mdedit__tool--marks");
await page.waitForTimeout(100);
ok("undo: a mode toggle is not a step", afterToggle === "one\n", JSON.stringify(afterToggle));

// A run of typing coalesces: twelve words are not twelve hundred steps, and
// the stack walks all the way back to where it started.
await set("", 0);
for (let index = 0; index < 12; index += 1) {
	await page.keyboard.type(`w${index} `);
}
await page.waitForTimeout(200);
const typed = await value();
let steps = 0;
let last = typed;
let walkedBack = false;
for (let index = 0; index < 40; index += 1) {
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(40);
	const now = await value();
	if (now === last) break;
	last = now;
	steps += 1;
	if (now === "") {
		walkedBack = true;
		break;
	}
}
ok("undo: a deep run of typing coalesces and walks back to the start",
	typed === "w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 " && walkedBack && steps > 5 && steps <= 26,
	JSON.stringify({ steps, last, walkedBack }));

// ── 6. the toolbar writes markdown ───────────────────────────────────────

await set("make this bold\n", 10);
await page.evaluate(() => window.editor.source.select(10, 14));
await page.click(".mdedit__tool--bold");
await page.waitForTimeout(120);
ok("toolbar: bold wraps the selection in stars", (await value()) === "make this **bold**\n", JSON.stringify(await value()));

await set("a line\n", 2);
await page.click(".mdedit__tool--heading");
await page.waitForTimeout(100);
const headed = await value();
await page.click(".mdedit__tool--quote");
await page.waitForTimeout(100);
const quoted = await value();
await page.click(".mdedit__tool--list");
await page.waitForTimeout(100);
const listed = await value();
ok("toolbar: heading, quote and list write their markers",
	headed === "## a line\n" && quoted === "> ## a line\n" && listed === "- > ## a line\n",
	JSON.stringify({ headed, quoted, listed }));

await set("here\n", 4);
await page.click(".mdedit__tool--fence");
await page.waitForTimeout(100);
const fenced = await value();
ok("toolbar: the fence tool writes a fenced block", fenced.includes("```\ncode\n```"), JSON.stringify(fenced));

// ── 7. the table widget ──────────────────────────────────────────────────

const TABLE = "before\n\n| Tool | Writes |\n| ---- | ------ |\n| B | **bold** |\n\nafter\n";
await set(TABLE, 0);
await page.waitForTimeout(150);
const drawn = await page.evaluate(() => {
	const widget = document.querySelector(".mdedit__widget");
	return {
		widget: Boolean(widget),
		rows: widget?.querySelectorAll("tr").length ?? 0,
		cells: widget?.querySelectorAll("th, td").length ?? 0,
		editable: widget?.querySelector("td")?.isContentEditable,
		island: widget?.isContentEditable === false,
		strong: Boolean(widget?.querySelector(".mdedit-strong")),
		value: window.editor.value,
	};
});
ok("table: a block of rows draws as a table", drawn.widget && drawn.rows === 2 && drawn.cells === 4, JSON.stringify(drawn));
ok("table: the widget holds no caret and its cells do", drawn.island && drawn.editable === true);
ok("table: a cell reads as markdown, styled", drawn.strong);
ok("table: drawing it changed nothing in the document", drawn.value === TABLE);

// Typing in a cell writes the markdown back.
await page.click(".mdedit__widget td");
await page.keyboard.press("End");
await page.keyboard.type(" X");
await page.waitForTimeout(150);
const edited = await value();
ok("table: a cell edit lands in the markdown", edited.includes("| B X") || edited.includes("B X"), JSON.stringify(edited.split("\n")[4] ?? edited));
ok("table: the markdown keeps its shape", /^\| [^|]+\| [^|]+\|$/.test((edited.split("\n")[2] ?? "")), JSON.stringify(edited.split("\n").slice(2, 5)));
ok("table: the textarea carries it too", (await field()) === edited);

// The bar switches the block back to its markdown, and it draws itself again.
await page.click(".mdedit__widget .mdedit__tool--source");
await page.waitForTimeout(120);
const raw = await page.evaluate(() => ({
	widget: Boolean(document.querySelector(".mdedit__widget")),
	rows: document.querySelectorAll(".mdedit-row").length,
	value: window.editor.value,
}));
ok("table: the bar puts the markdown back", !raw.widget && raw.rows >= 2, JSON.stringify({ widget: raw.widget, rows: raw.rows }));

await page.evaluate(() => window.editor.source.select(0));
await page.waitForTimeout(150);
const redrawn = await page.evaluate(() => ({
	widget: Boolean(document.querySelector(".mdedit__widget")),
	value: window.editor.value,
}));
ok("table: it draws itself again once the caret leaves", redrawn.widget && redrawn.value === raw.value, JSON.stringify({ widget: redrawn.widget }));

// The grid still opens over the block and writes through it.
await page.evaluate(() => window.editor.source.select(10));
await page.click(".mdedit__tool--table");
await page.waitForTimeout(150);
const grid = await page.evaluate(() => ({
	open: Boolean(document.querySelector(".mdedit__grid")),
	cells: document.querySelectorAll(".mdedit__grid textarea").length,
	frame: document.querySelector(".mdedit__frame").hidden,
}));
ok("grid: the table tool still opens the grid over the block", grid.open && grid.cells > 0 && grid.frame, JSON.stringify(grid));

const cell = page.locator(".mdedit__grid td textarea").first();
await cell.evaluate((node) => {
	node.hidden = false;
	node.previousElementSibling.hidden = true;
});
await cell.click();
await cell.fill("from the grid");
await page.waitForTimeout(150);
ok("grid: a cell edit lands in the markdown", (await value()).includes("from the grid"), JSON.stringify((await value()).split("\n")[3] ?? ""));
await page.click(".mdedit__tool--grid-done");
await page.waitForTimeout(150);
const closed = await page.evaluate(() => ({
	gone: !document.querySelector(".mdedit__grid"),
	widget: Boolean(document.querySelector(".mdedit__widget")),
	carries: document.querySelector(".mdedit__widget")?.textContent.includes("from the grid"),
}));
ok("grid: Done returns the surface with the table drawn", closed.gone && closed.widget && closed.carries, JSON.stringify(closed));

// A cell holds markdown, and the grid renders it: a code span inside one
// rides past the emphasis patterns behind a placeholder, and has to come out
// the other side as the characters it went in as.
await set("| a | b |\n| --- | --- |\n| `*x*` and **b** | plain |\n", 0);
await page.waitForTimeout(220);
await page.evaluate(() => window.editor.source.select(2));
await page.click(".mdedit__tool--table");
await page.waitForTimeout(250);
const spans = await page.evaluate(() => {
	const view = [...document.querySelectorAll(".mdedit__grid .mdedit__cell-view")].find((node) => node.querySelector("code"));
	return {
		code: view?.querySelector("code")?.textContent,
		strong: view?.querySelector("strong")?.textContent,
		html: view?.innerHTML,
	};
});
await page.click(".mdedit__tool--grid-done");
await page.waitForTimeout(250);
ok("grid: a code span in a cell renders as code and nothing of the sentinel shows",
	spans.code === "*x*" && spans.strong === "b" && !(spans.html ?? "").includes(String.fromCharCode(0)),
	JSON.stringify(spans));
ok("grid: and opening it over a table, then closing it, changes nothing",
	(await value()) === "| a | b |\n| --- | --- |\n| `*x*` and **b** | plain |\n",
	JSON.stringify(await value()));

// A cell field keeps its focus across the write: the edit is not at the
// caret, and a caret placed in the surface would take the focus with it and
// drop the rest of what is being typed.
await set("| a | b |\n| --- | --- |\n| c | d |\n| e | f |\n", 2);
await page.waitForTimeout(200);
await page.click(".mdedit__tool--table");
await page.waitForTimeout(200);
await page.keyboard.type("header");
await page.waitForTimeout(250);
const gridTyped = await page.evaluate(() => ({
	value: window.editor.value,
	active: document.activeElement.className,
}));
ok("grid: typing a word into a cell keeps every character", gridTyped.value.includes("| aheader |") && gridTyped.active === "mdedit__cell-edit",
	JSON.stringify(gridTyped));

// A row or a column action repaints the grid and has to leave the writer
// where the writer left them: the next press acts on whichever cell holds
// the focus.
await page.locator(".mdedit__grid tr").nth(2).locator(".mdedit__cell-view").first().click();
await page.waitForTimeout(150);
await page.click(".mdedit__tool--row-add");
await page.waitForTimeout(200);
const gridHeld = await page.evaluate(() => ({
	row: document.activeElement.dataset?.row,
	column: document.activeElement.dataset?.column,
	lines: window.editor.value.split("\n").length,
}));
await page.click(".mdedit__tool--row-add");
await page.waitForTimeout(200);
// The first cell of every row, in order: the two new rows went in under the
// row the writer stands in.
const gridOrder = (await value())
	.split("\n")
	.filter((line) => line.trim() !== "" && !line.includes("---"))
	.map((line) => line.split("|")[1].trim());
ok("grid: a row action leaves the writer in their own cell", gridHeld.row === "2" && gridHeld.column === "0", JSON.stringify(gridHeld));
ok("grid: so the next one adds the row there too", gridOrder.join(",") === "aheader,c,e,,", JSON.stringify(gridOrder));
await page.click(".mdedit__tool--grid-done");
await page.waitForTimeout(200);

// ── 7b. the caret inside a drawn table ───────────────────────────────────

// A drawn table answers for its block from its first line, so every edit
// made with the caret in a cell has to be made on that cell's own markdown.
// Read through the document they would all land before the table.
const TABLE_ONLY = "| a | b |\n| --- | --- |\n| c | d |";
const CELLS = "intro\n\n| Tool | Writes |\n| ---- | ------ |\n| B | bold |\n\nafter\n";
const inCell = async (run) => {
	await set(CELLS, 0);
	await page.waitForTimeout(180);
	await page.click(".mdedit__widget td");
	await page.keyboard.press("End");
	await run();
	await page.waitForTimeout(200);
	return value();
};

const cellBack = await inCell(() => page.keyboard.press("Backspace"));
ok("cell: Backspace takes a character out of the cell", cellBack.includes("|      | bold   |") && cellBack.startsWith("intro\n\n"),
	JSON.stringify(cellBack));

const cellEnter = await inCell(() => page.keyboard.press("Enter"));
ok("cell: Enter leaves the document alone", cellEnter === CELLS, JSON.stringify(cellEnter));

const cellTab = await inCell(() => page.keyboard.press("Tab"));
const tabbed = await page.evaluate(() => {
	const cell = document.getSelection().anchorNode;
	const holder = (cell?.nodeType === 3 ? cell.parentElement : cell)?.closest("th, td");
	return { column: holder?.dataset.column, row: holder?.dataset.row };
});
ok("cell: Tab steps to the next cell and writes nothing", cellTab === CELLS && tabbed.column === "1",
	JSON.stringify({ cellTab, tabbed }));

const cellPaste = await inCell(() =>
	page.evaluate(() => {
		const data = new DataTransfer();
		data.setData("text/plain", "two\nlines");
		document.querySelector(".mdedit__surface").dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
		);
	}),
);
ok("cell: a paste fills the cell, flattened to one line", cellPaste.includes("| Btwo lines ") && cellPaste.startsWith("intro\n\n"),
	JSON.stringify(cellPaste));

const cellBold = await inCell(() => page.click(".mdedit__tool--bold"));
ok("cell: a toolbar tool writes in the cell", cellBold.includes("| B**bold**"), JSON.stringify(cellBold));

const cellWiped = await inCell(async () => {
	await page.keyboard.press("Control+a");
	await page.keyboard.press("Delete");
});
ok("cell: select-all takes the cell alone", cellWiped.includes("|      | bold   |") && cellWiped.includes("after"),
	JSON.stringify(cellWiped));

// A selection that runs across cells edits no one cell, and the keys that
// would take the table apart do nothing.
await set(CELLS, 0);
await page.waitForTimeout(180);
await page.evaluate(() => {
	const cells = document.querySelectorAll(".mdedit__widget th, .mdedit__widget td");
	const range = document.createRange();
	range.setStart(cells[0].firstChild, 0);
	range.setEnd(cells[3].firstChild, 2);
	const selection = document.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
});
await page.keyboard.press("Backspace");
await page.waitForTimeout(200);
ok("cell: a selection across cells is not an edit", (await value()) === CELLS, JSON.stringify(await value()));

// A pipe is what separates the cells, so a pipe typed into one is escaped
// on the way into the document and reads as the character on the way back.
const piped = await inCell(() => page.keyboard.type(" | more"));
await set(piped, 0);
await page.waitForTimeout(220);
const pipedBack = await page.evaluate(() => {
	const cells = [...document.querySelectorAll(".mdedit__widget td")];
	return { text: cells[0]?.textContent, columns: cells.length, value: window.editor.value };
});
ok("cell: a pipe typed into a cell is escaped, and the table keeps its shape",
	piped.includes("| B \\| more |") && piped.split("\n")[3] === "| --------- | ------ |",
	JSON.stringify(piped));
ok("cell: it reads back as the character it is", pipedBack.text === "B | more" && pipedBack.columns === 2,
	JSON.stringify(pipedBack));

// Markdown draws nothing as a table without the alignment row under the
// header, so neither does the surface: drawing one would write that row into
// the document on the first keystroke in a cell.
const RULELESS = "| a | b |\n| c | d |\n\nafter\n";
await set(RULELESS, 0);
await page.waitForTimeout(220);
const ruleless = await page.evaluate(() => ({
	widget: Boolean(document.querySelector(".mdedit__widget")),
	rows: document.querySelectorAll(".mdedit-row").length,
}));
await page.evaluate(() => window.editor.source.select(6));
await page.keyboard.type("!");
await page.waitForTimeout(200);
ok("table: a block with no alignment row is not drawn as one", !ruleless.widget && ruleless.rows === 2, JSON.stringify(ruleless));
ok("table: and typing in it writes no alignment row", (await value()) === "| a | !b |\n| c | d |\n\nafter\n", JSON.stringify(await value()));

// Where a table stands in the document: at the top, at the foot, and two of
// them in a row.
await set(`${TABLE_ONLY}\n\nafter\n`, 0);
await page.waitForTimeout(250);
const leading = await page.evaluate(() => ({
	first: document.querySelector(".mdedit__surface").children[0].className.includes("widget"),
	value: window.editor.value,
}));
await page.evaluate(() => window.editor.source.select(0));
await page.keyboard.type("X");
await page.waitForTimeout(200);
ok("table: one at the top of the document draws, and the caret reaches above it",
	leading.first && (await value()) === `X${TABLE_ONLY}\n\nafter\n`, JSON.stringify({ leading, after: await value() }));

await set(`${TABLE_ONLY}\n\n${TABLE_ONLY}\n`, 0);
await page.waitForTimeout(300);
const pair = await page.evaluate(() => ({
	widgets: document.querySelectorAll(".mdedit__widget").length,
	value: window.editor.value,
}));
await page.click(".mdedit__widget .mdedit__tool--source");
await page.waitForTimeout(200);
const opened = await page.evaluate(() => ({
	widgets: document.querySelectorAll(".mdedit__widget").length,
	value: window.editor.value,
}));
ok("table: two in a row are two widgets", pair.widgets === 2 && pair.value === `${TABLE_ONLY}\n\n${TABLE_ONLY}\n`, JSON.stringify(pair));
ok("table: the markdown toggle opens one and leaves the other drawn",
	opened.widgets === 1 && opened.value === pair.value, JSON.stringify(opened));

// A table at the foot with nothing after it: there is no line down there to
// hold a caret, so the gesture that asks to go below it writes one.
await set(`intro\n\n${TABLE_ONLY}`, 0);
await page.waitForTimeout(250);
await page.keyboard.press("Control+End");
await page.waitForTimeout(200);
await page.keyboard.type("tail");
await page.waitForTimeout(200);
ok("table: Ctrl-End below a table that ends the document opens the line",
	(await value()) === `intro\n\n${TABLE_ONLY}\ntail`, JSON.stringify(await value()));

// Pipes inside a fenced block are code the colourer paints.
await set("```\n| a | b |\n| --- | --- |\n```\n", 0);
await page.waitForTimeout(250);
const fencedPipes = await page.evaluate(() => ({
	widget: Boolean(document.querySelector(".mdedit__widget")),
	kinds: [...document.querySelectorAll(".mdedit__surface > *")].map((node) => node.className.replace("mdedit__line mdedit-", "")),
	value: window.editor.value,
}));
ok("table: pipes inside a fence stay code", !fencedPipes.widget && fencedPipes.kinds.join(",") === "fence,codeline,codeline,fence,para",
	JSON.stringify(fencedPipes));

// An image in a cell: the panel finds it in the cell's own markdown and
// writes it back there.
await set("| a | b |\n| --- | --- |\n| ![p](/assets/docs/table.png) | x |\n", 0);
await page.waitForTimeout(350);
await page.click(".mdedit__widget .mdedit__pic", { button: "right" });
await page.waitForTimeout(200);
const cellPanel = await page.evaluate(() => ({
	open: Boolean(document.querySelector(".mdedit__image")),
	address: document.querySelectorAll(".mdedit__image input")[1]?.value ?? "",
}));
await page.click(".mdedit__image .mdedit__tool--align-left");
await page.waitForTimeout(250);
const cellImage = await value();
await page.keyboard.press("Escape");
ok("cell: the panel opens over an image in a cell", cellPanel.open && cellPanel.address === "/assets/docs/table.png", JSON.stringify(cellPanel));
ok("cell: what it writes lands in the cell", cellImage.includes("![p](/assets/docs/table.png#left)") && cellImage.split("\n").length === 4,
	JSON.stringify(cellImage));

// ── 8. images ────────────────────────────────────────────────────────────

const PICTURE = "look\n\n![The panel](/assets/docs/editor.png)\n\nafter\n";
await set(PICTURE, 0);
await page.waitForTimeout(250);
const picture = await page.evaluate(() => {
	const image = document.querySelector(".mdedit__pic");
	return {
		drawn: Boolean(image),
		src: image?.getAttribute("src"),
		wide: (image?.getBoundingClientRect().width ?? 0) > 40,
		text: image?.textContent ?? "",
		value: window.editor.value,
	};
});
ok("image: an image marker draws the picture it points at", picture.drawn && picture.src === "/assets/docs/editor.png" && picture.wide,
	JSON.stringify({ drawn: picture.drawn, src: picture.src, wide: picture.wide }));
ok("image: the picture carries no text of its own", picture.text === "" && picture.value === PICTURE);

await page.click(".mdedit__pic", { button: "right" });
await page.waitForTimeout(150);
const panel = await page.evaluate(() => {
	const node = document.querySelector(".mdedit__image");
	return {
		open: Boolean(node),
		address: node?.querySelectorAll("input")[1]?.value ?? "",
		aligners: node?.querySelectorAll('[class*="tool--align-"]').length ?? 0,
		replace: Boolean(node?.querySelector(".mdedit__tool--image-replace")),
	};
});
ok("image: a right-click on the picture opens the panel", panel.open && panel.address === "/assets/docs/editor.png", JSON.stringify(panel));
ok("image: the panel carries the alignment buttons and Replace", panel.aligners === 3 && panel.replace);

await page.click(".mdedit__image .mdedit__tool--align-center");
await page.waitForTimeout(150);
const aligned = await page.evaluate(() => ({
	value: window.editor.value,
	display: getComputedStyle(document.querySelector(".mdedit__pic")).display,
	src: document.querySelector(".mdedit__pic").getAttribute("src"),
}));
ok("image: the alignment button writes the anchor onto the address",
	aligned.value.includes("](/assets/docs/editor.png#center)") && aligned.src.endsWith("#center"),
	JSON.stringify(aligned));
ok("image: the stylesheet reads the anchor", aligned.display === "block", aligned.display);
await page.keyboard.press("Escape");

// The panel's own fields keep their focus across the write, the same way a
// grid cell does: typed a character at a time, a caption has to arrive whole.
await set("look\n\n![](/assets/docs/table.png)\n", 0);
await page.waitForTimeout(300);
await page.click(".mdedit__pic", { button: "right" });
await page.waitForTimeout(200);
await page.keyboard.type("A caption");
await page.waitForTimeout(250);
const captioned = await page.evaluate(() => ({
	value: window.editor.value,
	field: document.querySelectorAll(".mdedit__image input")[0].value,
	active: document.activeElement.tagName,
}));
const panelAddress = page.locator(".mdedit__image input").nth(1);
await panelAddress.click();
await panelAddress.press("End");
await page.keyboard.type("?v=2");
await page.waitForTimeout(250);
const readdressed = await value();
ok("image: a caption typed a character at a time arrives whole",
	captioned.value === "look\n\n![A caption](/assets/docs/table.png)\n" && captioned.field === "A caption",
	JSON.stringify(captioned));
ok("image: so does an address", readdressed === "look\n\n![A caption](/assets/docs/table.png?v=2)\n", JSON.stringify(readdressed));
await page.keyboard.press("Escape");

// ── 9. uploads ───────────────────────────────────────────────────────────

await set("upload here\n", 11);
await page.click(".mdedit__tool--upload");
await page.waitForSelector(".mdedit__queue");
await page.click(".mdedit__tool--queue-choose");
await page.setInputFiles(".mdedit input[type=file]", "docs/table.png");
await page.waitForTimeout(900);
const uploaded = await page.evaluate(() => ({
	value: window.editor.value,
	pictures: document.querySelectorAll(".mdedit__pic").length,
}));
ok("uploads: the picked file lands in the document as an image marker",
	/!\[\]\(\/uploads\/[^)]+\)/.test(uploaded.value) && uploaded.pictures === 1,
	JSON.stringify(uploaded));
await page.keyboard.press("Escape");

// An image marker with no address has no picture to draw, so the caption
// stays on the page as text: the placeholder an upload leaves behind has to
// read in both views, and a broken picture reads as nothing.
await set("![uploading 1...]()\n", 0);
await page.waitForTimeout(250);
const pending = await page.evaluate(() => {
	const line = document.querySelector(".mdedit__surface").children[0];
	return {
		pictures: document.querySelectorAll(".mdedit__pic").length,
		text: line.innerText,
		value: window.editor.value,
	};
});
await page.click(".mdedit__tool--marks");
await page.waitForTimeout(150);
const pendingQuiet = await page.evaluate(() => document.querySelector(".mdedit__surface").children[0].innerText);
await page.click(".mdedit__tool--marks");
await page.waitForTimeout(100);
ok("uploads: a marker with no address draws no picture", pending.pictures === 0 && pending.value === "![uploading 1...]()\n",
	JSON.stringify(pending));
ok("uploads: its caption reads with the markers hidden", pendingQuiet.trim() === "uploading 1...", JSON.stringify(pendingQuiet));

// A refused file and a failed request both keep the line the file landed on,
// and neither writes a reason into the document: the preview says why, and
// the markdown stays the writer's.
await set("here\n", 4);
await page.evaluate(() => window.editor.upload(new File(["words"], "notes.txt", { type: "text/plain" })));
await page.waitForTimeout(250);
const refused = await value();
const refusedBadge = await page.evaluate(() => ({
	state: document.querySelector(".mdedit__upload")?.dataset.state,
	error: document.querySelector(".mdedit__upload-error")?.dataset.error,
}));

await set("here\n", 4);
faking = true;
await page.route("**/upload*", (route) => route.fulfill({ status: 500, body: "no" }));
await page.evaluate(() => window.editor.upload(new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" })));
await page.waitForTimeout(400);
const failed = await value();
const failedBadge = await page.evaluate(() => document.querySelector(".mdedit__upload")?.dataset.state);
await page.unroute("**/upload*");
faking = false;
ok("uploads: a refused type keeps the placeholder and no reason is written",
	/^here!?\[uploading \d+\.\.\.\]\(\)\n\n$/.test(refused) &&
		refusedBadge.state === "failed" && refusedBadge.error === "This server stores png, jpeg, gif, webp and svg.",
	JSON.stringify({ refused, refusedBadge }));
ok("uploads: so does a failed request", /^here!?\[uploading \d+\.\.\.\]\(\)\n\n$/.test(failed) &&
		!failed.includes(">") && failedBadge === "failed", JSON.stringify({ failed, failedBadge }));

// A dropped file uploads the same way a picked one does.
await set("drop\n", 4);
await page.evaluate(() => {
	const data = new DataTransfer();
	data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "dropped.png", { type: "image/png" }));
	document.querySelector(".mdedit__surface").dispatchEvent(
		new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
	);
});
await page.waitForTimeout(900);
ok("uploads: a dropped file goes the same way", /!\[\]\(\/uploads\/[^)]+\)/.test(await value()), JSON.stringify(await value()));

// ── 10. a long document still reads back whole ───────────────────────────

const LONG = [
	"# Title",
	"",
	"A paragraph with **bold**, _italic_ and `code`.",
	"",
	"- one",
	"- two",
	"",
	"> quoted",
	"> and on",
	"",
	"| A | B |",
	"| --- | ---: |",
	"| 1 | 2 |",
	"",
	"```go",
	"func main() {",
	"\tprintln(\"x\")",
	"}",
	"```",
	"",
	"last",
	"",
].join("\n");
await set(LONG, 0);
await page.waitForTimeout(200);
const whole = await page.evaluate(() => ({
	value: window.editor.value,
	field: document.querySelector("textarea[data-markdown]").value,
	kinds: [...document.querySelectorAll(".mdedit__surface > *")].map((node) => node.className.replace("mdedit__line mdedit-", "")),
}));
ok("document: every construct reads back exactly as it went in", whole.value === LONG && whole.field === LONG,
	whole.value === LONG ? "" : JSON.stringify(whole.value));
ok("document: the lines are tokenised by what they are", whole.kinds.join(",").includes("h1") && whole.kinds.includes("codeline") && whole.kinds.includes("quote"),
	whole.kinds.join(","));

await page.locator(".mdedit").screenshot({ path: "/tmp/mdedit-marks.png" });
await page.click(".mdedit__tool--marks");
await page.waitForTimeout(200);
await page.locator(".mdedit").screenshot({ path: "/tmp/mdedit-quiet.png" });
const quietValue = await value();
ok("document: hiding the markers changes nothing in the markdown", quietValue === LONG);
await page.click(".mdedit__tool--marks");

// ── the layout a reader judges ────────────────────────────────────────────

await set("- one\n\t- nested\n\n1. first\n\t1. nested\n", 0);
await page.evaluate(() => window.editor.toggleMarks(false));
await page.waitForTimeout(150);
const listEdges = await page.evaluate(() => {
	const at = (node) => {
		const last = [...node.childNodes].filter((part) => part.nodeType === 3 || !part.classList?.contains("mdedit-mark")).pop();
		const range = document.createRange();
		range.selectNodeContents(last ?? node);
		const rect = [...range.getClientRects()][0];
		if (!rect) {
			return null;
		}
		return Math.round(rect.left);
	};
	const lines = [...document.querySelectorAll(".mdedit__surface > *")].filter((node) => node.textContent.trim());
	return lines.map((node) => ({ klass: node.className.match(/mdedit-(\w+)/)?.[1], x: at(node) }));
});
ok(
	"lists: a bullet and a number line their items up at every depth",
	listEdges[0].x === listEdges[2].x && listEdges[1].x === listEdges[3].x && listEdges[1].x > listEdges[0].x,
	JSON.stringify(listEdges),
);
await page.evaluate(() => window.editor.toggleMarks(true));

// A picture on a line of its own is a block at the margin; one in a sentence
// stays in the sentence.
await set("![logo](/assets/docs/mdedit-logo.png)\n\nbadge ![logo](/assets/docs/mdedit-logo.png) after\n", 0);
await page.waitForTimeout(200);
const drawnPics = await page.evaluate(() =>
	[...document.querySelectorAll(".mdedit__surface img.mdedit__pic")].map((pic) => ({
		display: getComputedStyle(pic).display,
		margin: getComputedStyle(pic).marginTop,
		left: Math.round(pic.getBoundingClientRect().left),
		lineLeft: Math.round(pic.closest(".mdedit__line").getBoundingClientRect().left),
	})),
);
ok(
	"images: a marker alone on its line draws a block at the margin",
	drawnPics[0].display === "block" && drawnPics[0].margin !== "0px" && drawnPics[0].left === drawnPics[0].lineLeft,
	JSON.stringify(drawnPics[0]),
);
ok("images: one inside a sentence stays in the sentence", drawnPics[1].display === "inline", JSON.stringify(drawnPics[1]));

// The grid: one layer to a cell, nothing clipped, and the alignment row is
// what lays a column out.
await set("| dish | who |\n| --- | ---: |\n| carbonara | guanciale |\n", 0);
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector(".mdedit__widget--table .mdedit__tool--grid")?.click());
await page.waitForTimeout(200);
const cellLayers = await page.evaluate(() =>
	[...document.querySelectorAll(".mdedit__grid-table th, .mdedit__grid-table td")].map((cell) => {
		const view = cell.querySelector(".mdedit__cell-view");
		const field = cell.querySelector("textarea");
		const shown = field && !field.hidden ? field : view;
		return {
			text: cell.textContent.trim(),
			layers: [view, field].filter((node) => node && getComputedStyle(node).display !== "none").length,
			clipped: shown.scrollHeight > Math.ceil(shown.getBoundingClientRect().height) + 1,
			align: getComputedStyle(shown).textAlign,
		};
	}),
);
ok("grid: a cell draws one layer at a time", cellLayers.every((cell) => cell.layers === 1), JSON.stringify(cellLayers));
ok("grid: and nothing in a cell is cut off", cellLayers.every((cell) => !cell.clipped), JSON.stringify(cellLayers));
ok(
	"grid: the alignment row lays the column out",
	cellLayers[1].align === "right" && cellLayers[2].align === "left",
	JSON.stringify(cellLayers.map((cell) => cell.align)),
);
await page.evaluate(() => document.querySelector(".mdedit__tool--grid-done")?.click());
await page.waitForTimeout(150);

// The bar on a drawn table says what the block is.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0);
await page.waitForTimeout(150);
const blockName = await page.evaluate(() => {
	const name = document.querySelector(".mdedit__widget-name");
	const bar = document.querySelector(".mdedit__widget-bar");
	return { text: name?.textContent, left: Math.round(name?.getBoundingClientRect().left ?? 0), barLeft: Math.round(bar?.getBoundingClientRect().left ?? 0) };
});
ok("table: its bar carries the name of the block, on the left", blockName.text === "Table" && blockName.left > blockName.barLeft, JSON.stringify(blockName));

// ── 11. the browser's own restructuring ──────────────────────────────────

// A selection that spans lines, replaced by typing: the browser merges the
// elements its own way and the surface has to read the text back out.
await set("alpha\nbeta\ngamma\n", 0);
await page.evaluate(() => window.editor.source.select(3, 12));
await page.keyboard.type("X");
await page.waitForTimeout(150);
const across = await page.evaluate(() => ({
	value: window.editor.value,
	lines: document.querySelectorAll(".mdedit__surface > *").length,
	nested: document.querySelectorAll(".mdedit__surface div div").length,
}));
// "alpha\nbeta\ngamma\n" with 3..12 replaced is "alp" + "X" + "amma\n".
ok("keys: typing over a selection that spans lines", across.value === "alpXamma\n" && across.nested === 0, JSON.stringify(across));

// Everything selected and deleted leaves one empty line to type on.
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
await page.keyboard.type("fresh");
await page.waitForTimeout(150);
const emptied = await page.evaluate(() => ({
	value: window.editor.value,
	lines: document.querySelectorAll(".mdedit__surface > *").length,
	field: document.querySelector("textarea[data-markdown]").value,
}));
ok("keys: select-all, delete, type", emptied.value === "fresh" && emptied.lines === 1 && emptied.field === "fresh", JSON.stringify(emptied));

// An empty document still has somewhere to put the caret.
await set("", 0);
await page.waitForTimeout(100);
const blank = await page.evaluate(() => ({
	lines: document.querySelectorAll(".mdedit__surface > *").length,
	value: window.editor.value,
}));
await page.keyboard.type("# a");
await page.waitForTimeout(120);
ok("keys: an empty document takes a caret and a keystroke",
	blank.lines === 1 && blank.value === "" && (await value()) === "# a",
	JSON.stringify({ ...blank, after: await value() }));

// A click past the last line lands at the end of the document.
await set("one\ntwo\n", 0);
await page.evaluate(() => {
	const surface = document.querySelector(".mdedit__surface");
	const box = surface.getBoundingClientRect();
	surface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: box.left + 20, clientY: box.bottom - 10 }));
});
await page.click(".mdedit__surface", { position: { x: 20, y: 200 } });
await page.keyboard.type("end");
await page.waitForTimeout(150);
ok("keys: a click below the last line types at the end", (await value()) === "one\ntwo\nend", JSON.stringify(await value()));


// ── nested lists, spans in cells, strikeout ──────────────────────────────

await page.evaluate(() => {
	window.editor.value = [
		"- top level",
		"  - nested once",
		"    - nested twice",
		"- top again",
		"",
		"Prose with ~~strikeout~~ in it.",
		"",
		"| Span | In the cell |",
		"| --- | --- |",
		"| struck | ~~struck out~~ |",
		"| bold | **bold** |",
		"| under | __also bold__ |",
		"| em | _em_ |",
		"",
	].join("\n");
});
await page.waitForTimeout(300);

const nestedItems = await page.evaluate(() => {
	const items = [...document.querySelectorAll(".mdedit-list")];
	return items.map((item) => ({
		depth: item.style.getPropertyValue("--depth"),
		left: Math.round(item.getBoundingClientRect().left),
	}));
});
ok("lists: a nested item carries its depth", nestedItems.map((n) => n.depth).join(",") === "0,1,2,0", JSON.stringify(nestedItems.map((n) => n.depth)));

const strikeOn = await page.evaluate(() => ({
	prose: document.querySelectorAll(".mdedit-strike").length,
	cell: document.querySelectorAll("table .mdedit-strike").length,
	strong: document.querySelectorAll("table .mdedit-strong").length,
	em: document.querySelectorAll("table .mdedit-em").length,
}));
ok("cells: a span in a cell is a span", strikeOn.cell === 1 && strikeOn.strong === 2 && strikeOn.em === 1, JSON.stringify(strikeOn));
ok("strikeout: prose and a cell both carry it", strikeOn.prose >= 2, JSON.stringify(strikeOn));

await page.click(".mdedit__tool--marks");
await page.waitForTimeout(250);

const noMarks = await page.evaluate(() => {
	const items = [...document.querySelectorAll(".mdedit-list")];
	const cellMarks = [...document.querySelectorAll("table .mdedit-mark")];
	const blank = [...document.querySelectorAll(".mdedit__line[data-blank]")][0];
	return {
		lefts: items.map((item) => Math.round(item.getBoundingClientRect().left)),
		textLefts: items.map((item) => Math.round(item.getBoundingClientRect().left + parseFloat(getComputedStyle(item).paddingLeft))),
		cellMarksHidden: cellMarks.every((m) => getComputedStyle(m).display === "none"),
		blankHeight: Math.round(blank?.getBoundingClientRect().height ?? 0),
		lineHeight: Math.round(parseFloat(getComputedStyle(document.querySelector(".mdedit__surface")).lineHeight)),
	};
});
ok("lists: the markers hidden, the nesting still steps right",
	noMarks.textLefts[0] < noMarks.textLefts[1] && noMarks.textLefts[1] < noMarks.textLefts[2] && noMarks.textLefts[3] === noMarks.textLefts[0],
	JSON.stringify(noMarks.textLefts));
ok("cells: the markers hide in a cell too", noMarks.cellMarksHidden, String(noMarks.cellMarksHidden));
ok("spacing: a blank line reads as a gap between blocks", noMarks.blankHeight < noMarks.lineHeight, JSON.stringify({ blank: noMarks.blankHeight, line: noMarks.lineHeight }));

await page.click(".mdedit__tool--marks");
await page.waitForTimeout(150);


// ── the marks disturb nothing ────────────────────────────────────────────

await page.evaluate(() => {
	window.editor.value = [
		"A paragraph.",
		"",
		"",
		"```go",
		"\tx := 1",
		"",
		"\treturn x",
		"```",
		"",
		"After.",
	].join("\n");
});
await page.waitForTimeout(300);

const marks = await page.evaluate(() => {
	const seen = (element) => getComputedStyle(element, "::after").content;
	const lines = [...document.querySelectorAll(".mdedit__line")];
	const code = lines.filter((l) => l.className.includes("codeline") || l.className.includes("fence"));
	const blank = lines.filter((l) => l.hasAttribute("data-blank"));
	const prose = lines.filter((l) => l.className.includes("mdedit-para"));
	return {
		codeMarks: code.filter((l) => seen(l).includes("\u00b6")).length,
		blankMarks: blank.filter((l) => seen(l).includes("\u00b6")).length,
		proseMarks: prose.filter((l) => seen(l).includes("\u00b6")).length,
		proseLeft: Math.round(prose[0].getBoundingClientRect().left),
		headingLeft: (() => {
			const heading = document.querySelector(".mdedit-h1, .mdedit-h2, .mdedit-h3");
			if (!heading) {
				return null;
			}
			return Math.round(heading.getBoundingClientRect().left);
		})(),
		value: window.editor.value,
	};
});
ok("marks: a code block carries none", marks.codeMarks === 0, String(marks.codeMarks));
ok("marks: a blank line carries none", marks.blankMarks === 0, String(marks.blankMarks));
ok("marks: a line of prose carries one", marks.proseMarks === 2, String(marks.proseMarks));
ok("paragraphs: they share one left edge with the headings",
	marks.headingLeft === null || marks.proseLeft === marks.headingLeft,
	JSON.stringify({ prose: marks.proseLeft, heading: marks.headingLeft }));
ok("marks: the document is untouched by any of it",
	marks.value === "A paragraph.\n\n\n```go\n\tx := 1\n\n\treturn x\n```\n\nAfter.",
	JSON.stringify(marks.value));

// ── 12. the keyboard and what the buttons say ────────────────────────────

// A toolbar is one stop in the tab order, with the arrows moving along it.
// Eleven buttons between the page and the document is eleven presses before
// a keyboard reaches the text.
await set("plain text\n", 0);
// From the link above the form, so the walk into the editor is the one a
// keyboard actually takes.
await page.evaluate(() => document.querySelector(".crumbs a").focus());
await page.keyboard.press("Tab");
const spot = () =>
	page.evaluate(() => {
		const node = document.activeElement;
		return node.className.replace("mdedit__tool mdedit__tool--", "") || node.tagName;
	});
const stops = [await spot()];
await page.keyboard.press("Tab");
await page.waitForTimeout(80);
stops.push(await spot());
ok("keyboard: the bar is one tab stop and the document is the next",
	stops.join(",") === "bold,mdedit__surface", JSON.stringify(stops));

await page.evaluate(() => document.querySelector(".mdedit__tool--bold").focus());
const along = [];
for (const key of ["ArrowRight", "ArrowLeft", "End", "Home"]) {
	await page.keyboard.press(key);
	await page.waitForTimeout(60);
	along.push(`${key}=${await spot()}`);
}
ok("keyboard: the arrows, Home and End move along the bar",
	along.join(",") === "ArrowRight=italic,ArrowLeft=bold,End=marks,Home=bold", JSON.stringify(along));

const aria = await page.evaluate(() => {
	const bar = document.querySelector(".mdedit__bar");
	const buttons = [...bar.querySelectorAll("button")];
	const surface = document.querySelector(".mdedit__surface");
	return {
		role: bar.getAttribute("role"),
		controls: bar.getAttribute("aria-controls") === surface.id,
		labelled: buttons.every((button) => button.getAttribute("aria-label")),
		titled: buttons.every((button) => button.title),
		typed: buttons.every((button) => button.type === "button"),
		icons: [...bar.querySelectorAll(".icon")].every((icon) => icon.getAttribute("aria-hidden") === "true"),
		stops: buttons.filter((button) => button.tabIndex === 0).length,
		textbox: surface.getAttribute("role") === "textbox" && surface.getAttribute("aria-multiline") === "true",
		named: Boolean(surface.getAttribute("aria-label")),
	};
});
ok("keyboard: every button names itself and no icon is read out",
	aria.labelled && aria.titled && aria.typed && aria.icons && aria.stops === 1, JSON.stringify(aria));
ok("keyboard: the bar is a toolbar over the textbox it writes in",
	aria.role === "toolbar" && aria.controls && aria.textbox && aria.named, JSON.stringify(aria));

// The default bar carries the picker once uploads are configured: paste and
// drop are gestures a page shows nothing of to anyone who does not know them.
const bars = await page.evaluate(async () => {
	const { MarkdownEditor } = await import("/assets/dist/mdedit.js");
	const field = document.createElement("textarea");
	document.body.appendChild(field);
	const keys = (options) => {
		const built = new MarkdownEditor(field, options);
		const found = [...built.root.querySelectorAll(".mdedit__bar button")].map((node) =>
			node.className.replace(/.*tool--/, ""),
		);
		built.destroy();
		return found;
	};

	const answer = {
		bare: keys({}),
		uploads: keys({ uploads: { endpoint: "/upload" } }),
		named: keys({ uploads: { endpoint: "/upload" }, toolbar: ["bold"] }),
	};
	field.remove();
	return answer;
});
ok("toolbar: the picker joins the default bar when uploads are configured",
	!bars.bare.includes("upload") && bars.uploads.includes("upload") && bars.named.join(",") === "bold,marks",
	JSON.stringify(bars));

// At a phone width the bar wraps and nothing runs off the screen.
await page.setViewportSize({ width: 360, height: 720 });
await set("# Title\n\nsome text\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0);
await page.waitForTimeout(250);
const narrow = await page.evaluate(() => {
	const bar = document.querySelector(".mdedit__bar");
	const surface = document.querySelector(".mdedit__surface");
	const widget = document.querySelector(".mdedit__widget");
	const line = Number.parseFloat(getComputedStyle(surface).lineHeight);
	return {
		rows: Math.round(bar.getBoundingClientRect().height / bar.querySelector("button").getBoundingClientRect().height),
		barScroll: bar.scrollWidth > bar.clientWidth + 1,
		surfaceScroll: surface.scrollWidth > surface.clientWidth + 1,
		widgetScroll: widget ? widget.scrollWidth > widget.clientWidth + 1 : null,
		page: document.documentElement.scrollWidth <= window.innerWidth + 1,
		line,
	};
});
ok("narrow: the bar wraps to a second row", narrow.rows > 1 && !narrow.barScroll, JSON.stringify(narrow));
ok("narrow: nothing runs off the side", narrow.page && !narrow.surfaceScroll && !narrow.widgetScroll, JSON.stringify(narrow));
await page.setViewportSize({ width: 1100, height: 900 });
await page.waitForTimeout(150);

// ── 13. the form the editor stands in ────────────────────────────────────

// The textarea is what a form posts, and what a browser with no JavaScript
// would have shown. It keeps its name, its form and every edit.
await set("body text\n", 9);
await page.keyboard.type("!");
await page.waitForTimeout(150);
const form = await page.evaluate(() => {
	const area = document.querySelector("textarea[data-markdown]");
	return {
		name: area.name,
		hidden: area.hidden,
		disabled: area.disabled,
		posted: new FormData(area.form).get("body"),
		value: window.editor.value,
	};
});
ok("form: the hidden textarea carries the name and the markdown",
	form.name === "body" && form.hidden && !form.disabled && form.posted === form.value && form.value === "body text!\n",
	JSON.stringify(form));

// Every kind of edit reaches it: a tool, a cell, a panel and a key.
const carried = [];
await set("a word\n", 2);
await page.evaluate(() => window.editor.source.select(2, 6));
await page.click(".mdedit__tool--bold");
await page.waitForTimeout(150);
carried.push((await value()) === (await field()));
await set("| a | b |\n| --- | --- |\n| c | d |\n", 0);
await page.waitForTimeout(250);
await page.click(".mdedit__widget td");
await page.keyboard.press("End");
await page.keyboard.type("!");
await page.waitForTimeout(200);
carried.push((await value()) === (await field()));
await set("![cap](/assets/docs/table.png)\n", 0);
await page.waitForTimeout(300);
await page.click(".mdedit__pic", { button: "right" });
await page.waitForTimeout(150);
await page.click(".mdedit__image .mdedit__tool--align-left");
await page.waitForTimeout(200);
carried.push((await value()) === (await field()));
await page.keyboard.press("Escape");
await page.click(".mdedit__surface");
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
carried.push((await value()) === (await field()));
ok("form: a tool, a cell, a panel and a keystroke all reach the textarea",
	carried.every(Boolean), JSON.stringify(carried));

// ── the bar follows the document ──────────────────────────────────────────

// An article longer than the window puts the bar off the top of it, and a
// writer at the foot of one should not scroll back up to press a button
// about the line they are on. The bar holds at the top of the window while
// the editor is in view and never leaves the editor's own box.

await set("a line of writing\n".repeat(200), 0);
await page.waitForTimeout(150);
const bar = () => page.evaluate(() => document.querySelector(".mdedit__bar").getBoundingClientRect().toJSON());
const root = () => page.evaluate(() => document.querySelector(".mdedit").getBoundingClientRect().toJSON());

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(100);
const resting = await bar();
ok("bar: at rest it stands where the editor put it", resting.top > 0, JSON.stringify(resting.top));

await page.evaluate(() => window.scrollTo(0, 1200));
await page.waitForTimeout(150);
const pinned = await bar();
ok("bar: scrolled into the document it holds at the top of the window", Math.round(pinned.top) === 0, JSON.stringify(pinned.top));

// Held at the top of the window the surface's own top border has scrolled
// away, so the bar carries the line under itself: without it the buttons
// stand on the running text with nothing between them.
const edge = await page.evaluate(() => getComputedStyle(document.querySelector(".mdedit__bar")).boxShadow);
ok("bar: and carries the line that stands under it", edge !== "none", JSON.stringify(edge));

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(200);
const atFoot = await bar();
const box = await root();
ok(
	"bar: and never stands outside the editor it belongs to",
	atFoot.bottom <= Math.ceil(box.bottom) && atFoot.top >= Math.floor(box.top),
	JSON.stringify({ bar: [atFoot.top, atFoot.bottom], root: [box.top, box.bottom] }),
);

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(100);

// A value set behind the editor's back is read back by refresh(), and
// destroy() puts the textarea where it found it.
const given = await page.evaluate(() => {
	document.querySelector("textarea[data-markdown]").value = "from outside\n";
	window.editor.refresh();
	return window.editor.value;
});
ok("form: refresh reads a value set behind the editor", given === "from outside\n", JSON.stringify(given));

const gone = await page.evaluate(() => {
	const area = document.querySelector("textarea[data-markdown]");
	window.editor.destroy();
	return {
		root: Boolean(document.querySelector(".mdedit")),
		hidden: area.hidden,
		inForm: Boolean(area.form),
		value: area.value,
	};
});
ok("form: destroy puts the textarea back, visible and in its form",
	!gone.root && !gone.hidden && gone.inForm && gone.value === "from outside\n", JSON.stringify(gone));


ok("no console or page errors", noise.length === 0, noise.join("\n"));

await browser.close();

console.log(problems.length === 0 ? "\nALL PASS" : `\nFAILED: ${problems.length}\n${problems.join("\n")}`);
process.exit(problems.length === 0 ? 0 : 1);
