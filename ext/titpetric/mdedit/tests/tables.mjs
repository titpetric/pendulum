// A drawn table, driven the way a writer drives one: Tab across it and off
// the end of it, Backspace back through it, and the menu over it.

import { chromium } from "./lib.mjs";

const PORT = process.env.MDEDIT_PORT ?? "18899";
const URL = `http://127.0.0.1:${PORT}/edit?file=welcome.md`;

const problems = [];
const ok = (label, pass, detail = "") => {
	console.log(`${pass ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
	if (!pass) problems.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const noise = [];
page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));
page.on("console", (message) => {
	if (message.type() === "error") noise.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

const TABLE = "| dish | who |\n| --- | --- |\n| carbonara | guanciale |\n";

const set = (markdown = TABLE) =>
	page.evaluate((text) => {
		window.editor.value = text;
		window.editor.focus();
	}, markdown);

const value = () => page.evaluate(() => window.editor.value);
const rows = () => page.evaluate(() => document.querySelectorAll(".mdedit__widget--table tr").length);
const cells = () =>
	page.evaluate(() => [...document.querySelectorAll(".mdedit__widget--table th, .mdedit__widget--table td")]);

// focus puts the caret in one cell by its place in the drawn table.
const focus = (row, column) =>
	page.evaluate(
		([at, by]) => {
			const cell = document.querySelector(`.mdedit__widget--table [data-row="${at}"][data-column="${by}"]`);
			cell.focus();
			const range = document.createRange();
			range.selectNodeContents(cell);
			range.collapse(false);
			document.getSelection().removeAllRanges();
			document.getSelection().addRange(range);
			return Boolean(cell);
		},
		[row, column],
	);

// here answers which cell holds the caret.
const here = () =>
	page.evaluate(() => {
		const cell = document.activeElement?.closest?.("th, td");
		if (!cell) return null;
		return { row: Number(cell.dataset.row), column: Number(cell.dataset.column), text: cell.textContent };
	});

// ── 0. a table typed a line at a time ─────────────────────────────────────

// How a writer makes a table: the lines go in one after another, and the
// block draws itself the moment the alignment row is behind them. Every row
// typed after that joins the table it belongs to.
await page.evaluate(() => {
	window.editor.value = "";
	window.editor.focus();
	window.editor.source.select(0);
});
for (const line of ["| dish | who |", "| --- | --- |", "| carbonara | guanciale |", "| cacio e pepe | pecorino |"]) {
	await page.keyboard.type(line);
	await page.keyboard.press("Enter");
}
await page.keyboard.press("Enter");
await page.keyboard.type("after it");
await page.waitForTimeout(400);
const typedOut = {
	value: await value(),
	rows: await rows(),
	widgets: await page.evaluate(() => document.querySelectorAll(".mdedit__surface .mdedit__widget").length),
	loose: await page.evaluate(() => document.querySelectorAll(".mdedit__surface > .mdedit-row").length),
};
ok("typed: the rows typed under the table join it", typedOut.rows === 3 && typedOut.widgets === 1, JSON.stringify(typedOut));
ok("typed: and none is left outside it", typedOut.loose === 0, JSON.stringify(typedOut.loose));
ok(
	"typed: the markdown is the table the writer typed",
	typedOut.value.split("\n").filter((line) => line.startsWith("|")).length === 4,
	JSON.stringify(typedOut.value),
);

// ── 1. Tab across the table, and off the end of it ────────────────────────

await set();
await page.waitForTimeout(150);
await focus(0, 0);
await page.keyboard.press("Tab");
ok("tab: it steps to the next cell", JSON.stringify(await here()) === JSON.stringify({ row: 0, column: 1, text: "who" }), JSON.stringify(await here()));

await page.keyboard.press("Tab");
ok("tab: and on to the first cell of the row under it", (await here())?.row === 1 && (await here())?.column === 0, JSON.stringify(await here()));

// Off the last cell: a blank row, with the writer in the first cell of it.
await focus(1, 1);
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
const grown = { value: await value(), rows: await rows(), at: await here() };
ok(
	"tab: off the last cell it adds a row",
	grown.rows === 3 && grown.value.split("\n").filter((line) => line.startsWith("|")).length === 4,
	JSON.stringify(grown.value),
);
ok("tab: and lands in the first cell of it", grown.at?.row === 2 && grown.at?.column === 0, JSON.stringify(grown.at));

// The new row is a row of the document, not a drawing: typing fills it.
await page.keyboard.type("cacio e pepe");
await page.keyboard.press("Tab");
await page.keyboard.type("pecorino");
await page.waitForTimeout(200);
ok(
	"tab: what is typed into the new row is in the markdown",
	/\|\s*cacio e pepe\s*\|\s*pecorino\s*\|/.test(await value()),
	JSON.stringify((await value()).split("\n").pop() || (await value())),
);

// Tab again off the end grows it again, however many times.
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
ok("tab: it grows the table every time it reaches the end", (await rows()) === 4, String(await rows()));

// Shift-Tab off the first cell stays in the table: a table is left with the
// mouse or a tap.
await focus(0, 0);
await page.keyboard.press("Shift+Tab");
const held = await here();
ok("tab: Shift-Tab off the first cell stays in the table", held?.row === 0 && held?.column === 0, JSON.stringify(held));

// ── 2. Backspace back through the cells ───────────────────────────────────

await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
await page.waitForTimeout(200);
await focus(1, 1);
await page.keyboard.press("Backspace");
await page.waitForTimeout(120);
ok("backspace: it takes a character while there is one", (await value()).includes("|   |") === false, JSON.stringify(await value()));

// The cell is empty now: the next press is the cell before it.
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
const back = await here();
ok("backspace: in an empty cell it moves one cell left", back?.row === 1 && back?.column === 0, JSON.stringify(back));
ok("backspace: and the caret is at the end of what is there", (await value()).includes("| 1"), JSON.stringify(await value()));

// An empty row: Backspace in its first cell takes the row out.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n");
await page.waitForTimeout(200);
const before = await rows();
await focus(2, 0);
await page.keyboard.press("Backspace");
await page.waitForTimeout(200);
const gone = { rows: await rows(), value: await value(), at: await here() };
ok("backspace: in the first cell of an empty row it takes the row out", before === 3 && gone.rows === 2, JSON.stringify(gone.value));
ok("backspace: and leaves the writer in the row above it", gone.at?.row === 1, JSON.stringify(gone.at));

// The header row stays: markdown has no table without one.
await set("| a | b |\n| --- | --- |\n");
await page.waitForTimeout(200);
await focus(0, 0);
await page.evaluate(() => {
	const cell = document.querySelector('.mdedit__widget--table [data-row="0"][data-column="0"]');
	cell.textContent = "";
});
await focus(0, 0);
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
ok("backspace: the header row does not go away", (await rows()) >= 1 && (await value()).includes("|"), JSON.stringify(await value()));

// A row the writer added with Tab and left empty goes away again with
// Backspace: the two keys answer each other.
await set();
await page.waitForTimeout(200);
await focus(1, 1);
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
const added = await value();
await page.keyboard.press("Backspace");
await page.waitForTimeout(250);
ok("backspace: it undoes a row Tab added", (await value()) !== added && (await rows()) === 2, JSON.stringify(await value()));

// ── 3. the menu ───────────────────────────────────────────────────────────

const menu = () =>
	page.evaluate(() => {
		const open = document.querySelector(".mdedit__menu");
		if (!open) return null;
		const box = open.getBoundingClientRect();
		const root = document.querySelector(".mdedit").getBoundingClientRect();
		return {
			items: [...open.querySelectorAll(".mdedit__menu-item")].map((node) => ({
				key: node.className.match(/menu-item--([\w-]+)/)?.[1],
				text: node.textContent,
				enabled: !node.disabled,
				checked: node.getAttribute("aria-checked"),
			})),
			inside: box.left >= root.left - 1 && box.right <= root.right + 1,
			role: open.getAttribute("role"),
		};
	});

const click = (key) =>
	page.evaluate((name) => {
		document.querySelector(`.mdedit__menu-item--${name}`).click();
	}, key);

const rightClick = async (row, column) => {
	await page.locator(`.mdedit__widget--table [data-row="${row}"][data-column="${column}"]`).click({ button: "right" });
	await page.waitForTimeout(200);
};

await set("| dish | who |\n| --- | --- |\n| carbonara | guanciale |\n| cacio e pepe | pecorino |\n");
await page.waitForTimeout(200);
await rightClick(1, 0);
const opened = await menu();
ok("menu: a right-click on a cell opens it", opened !== null && opened.role === "menu");
ok(
	"menu: it carries every edit a markdown table takes",
	["row-add-above", "row-add-below", "row-remove", "column-add-left", "column-add-right", "column-remove", "align-left", "align-center", "align-right"].every(
		(key) => opened.items.some((item) => item.key === key),
	),
	JSON.stringify(opened.items.map((item) => item.key)),
);
ok("menu: it stands inside the editor", opened.inside === true);
ok(
	"menu: the alignment the column carries is the one marked",
	opened.items.find((item) => item.key === "align-left")?.checked === "true",
	JSON.stringify(opened.items.filter((item) => item.key?.startsWith("align"))),
);

// A row above, a row below, and the row gone.
await click("row-add-above");
await page.waitForTimeout(250);
ok("menu: a row above goes above the row asked about", (await rows()) === 4 && /\|\s+\|\s+\|\n\|\s*carbonara/.test(await value()), JSON.stringify(await value()));

await rightClick(2, 0);
await click("row-add-below");
await page.waitForTimeout(250);
ok("menu: a row below goes under it", (await rows()) === 5 && /carbonara[^\n]*\n\|\s+\|\s+\|/.test(await value()), JSON.stringify(await value()));

await rightClick(1, 0);
await click("row-remove");
await page.waitForTimeout(250);
ok("menu: the row asked about goes away", (await rows()) === 4, String(await rows()));

// The header row cannot go: the item for it is there and does nothing.
await rightClick(0, 0);
const header = await menu();
ok("menu: on the header row, removing the row is offered and refused", header.items.find((item) => item.key === "row-remove")?.enabled === false, JSON.stringify(header.items.find((item) => item.key === "row-remove")));
await page.keyboard.press("Escape");

// Columns, either side.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
await page.waitForTimeout(200);
await rightClick(0, 1);
await click("column-add-left");
await page.waitForTimeout(250);
ok("menu: a column to the left lands left of the one asked about", /\|\s*a\s*\|\s*\|\s*b\s*\|/.test(await value()), JSON.stringify(await value()));

await rightClick(0, 0);
await click("column-add-right");
await page.waitForTimeout(250);
const wide = await page.evaluate(() => document.querySelectorAll('.mdedit__widget--table tr:first-child > *').length);
ok("menu: and one to the right lands right of it", wide === 4, String(wide));

await rightClick(0, 1);
await click("column-remove");
await page.waitForTimeout(250);
ok("menu: the column asked about goes away", (await page.evaluate(() => document.querySelectorAll('.mdedit__widget--table tr:first-child > *').length)) === 3, JSON.stringify(await value()));

// A table of one column keeps it.
await set("| only |\n| --- |\n| one |\n");
await page.waitForTimeout(200);
await rightClick(0, 0);
const single = await menu();
ok("menu: the last column is offered and refused", single.items.find((item) => item.key === "column-remove")?.enabled === false);
await page.keyboard.press("Escape");

// Alignment, as markdown spells it.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
await page.waitForTimeout(200);
await rightClick(0, 1);
await click("align-right");
await page.waitForTimeout(250);
ok("menu: aligning right writes the markdown for it", /\|\s*-+\s*\|\s*-+:\s*\|/.test(await value()), JSON.stringify(await value()));
const laid = await page.evaluate(() =>
	getComputedStyle(document.querySelector('.mdedit__widget--table [data-row="1"][data-column="1"]')).textAlign,
);
ok("menu: and the drawn table follows it", laid === "right", laid);

await rightClick(0, 1);
await click("align-center");
await page.waitForTimeout(250);
ok("menu: centring writes the colons either side", /\|\s*:-+:\s*\|/.test(await value()), JSON.stringify(await value()));

await rightClick(0, 1);
const marked = await menu();
ok("menu: the alignment now carried is the one marked", marked.items.find((item) => item.key === "align-center")?.checked === "true", JSON.stringify(marked.items.filter((item) => item.key?.startsWith("align"))));

// Escape closes it, leaving the document as it stands.
const quiet = await value();
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
ok("menu: Escape closes it and writes nothing", (await menu()) === null && (await value()) === quiet);

// A click elsewhere closes it too.
await rightClick(0, 0);
await page.locator(".mdedit__surface").click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(200);
ok("menu: a click outside closes it", (await menu()) === null);

// A double click opens it, which is the second gesture a trackpad has.
await page.locator('.mdedit__widget--table [data-row="0"][data-column="0"]').dblclick();
await page.waitForTimeout(250);
ok("menu: a double click opens it", (await menu()) !== null);
await page.keyboard.press("Escape");


// A picture in a cell belongs to the image panel: one gesture, one panel.
await set("| dish | picture |\n| --- | --- |\n| carbonara | ![a shot](/assets/docs/table.png) |\n");
await page.waitForTimeout(250);
await page.locator(".mdedit__widget--table img.mdedit__pic").click({ button: "right" });
await page.waitForTimeout(250);
const over = await page.evaluate(() => ({
	menu: document.querySelectorAll(".mdedit__menu").length,
	image: document.querySelectorAll(".mdedit__image").length,
}));
ok("menu: a picture in a cell opens the image panel and not the menu", over.menu === 0 && over.image === 1, JSON.stringify(over));
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// The cell beside it still opens the menu.
await rightClick(1, 0);
const beside = await menu();
ok("menu: the cell beside it still opens the menu", beside !== null && beside.items.length === 9, String(beside?.items.length));
await page.keyboard.press("Escape");

// What the menu writes, undo takes back.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
await page.waitForTimeout(200);
const start = await value();
await rightClick(1, 0);
await click("row-add-below");
await page.waitForTimeout(250);
const more = await value();
await page.evaluate(() => window.editor.focus());
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
ok("menu: undo takes back what it wrote", more !== start && (await value()) === start, JSON.stringify([start, await value()]));

// ── 4. a caret sent into a drawn table ────────────────────────────────────

// Where a proofreader sends the writer: an offset in the document that lands
// inside a table. The block holds no caret of its own, but its cells do, so
// the offset names a cell and a place in it - and the document reads back the
// span that was asked for.

const AROUND = "before it\n\n| dish | who |\n| --- | --- |\n| carbonara | guanciale |\n\nafter it\n";

// pick selects a span of the document and answers where the caret landed and
// what the editor reads back for it.
const pick = (from, to = from) =>
	page.evaluate(
		([start, end]) => {
			window.editor.source.select(start, end);
			const selection = document.getSelection();
			const node = selection.anchorNode;
			const cell = (node?.nodeType === 1 ? node : node?.parentElement)?.closest("th, td");
			return {
				read: window.editor.selection,
				cell: cell ? { row: cell.dataset.row, column: cell.dataset.column } : null,
				root: node === document.querySelector(".mdedit__surface"),
				offset: selection.anchorOffset,
			};
		},
		[from, to],
	);

await set(AROUND);
await page.waitForTimeout(250);

const body = AROUND.indexOf("carbonara");
const inBody = await pick(body, body + "carbonara".length);
ok("reveal: an offset in a body cell puts the caret in that cell", inBody.cell?.row === "1" && inBody.cell?.column === "0", JSON.stringify(inBody));
ok(
	"reveal: and the document reads back the span that was asked for",
	inBody.read.start === body && inBody.read.end === body + 9 && inBody.read.text === "carbonara",
	JSON.stringify(inBody.read),
);

// Mid-word, and collapsed: the one place in the cell, counted both ways.
const inWord = await pick(body + 4);
ok("reveal: a caret inside a cell's word reads back where it stands", inWord.read.start === body + 4 && inWord.read.end === body + 4, JSON.stringify(inWord));

// And the focus follows it in. A cell is an editing host of its own, so a
// panel handing the focus back to the surface over one would take the caret
// out of the cell and to the head of the document.
const held4 = await page.evaluate(
	([start, end]) => {
		window.editor.source.select(start, end);
		window.editor.focus({ preventScroll: true });
		const node = document.getSelection().anchorNode;
		const cell = (node?.nodeType === 1 ? node : node?.parentElement)?.closest("th, td");
		return { read: window.editor.selection, cell: cell?.dataset.row ?? null, active: document.activeElement?.nodeName };
	},
	[body, body + 9],
);
ok("reveal: the focus handed back leaves the caret in the cell", held4.cell === "1" && held4.read.text === "carbonara", JSON.stringify(held4));

const head = AROUND.indexOf("who");
const inHead = await pick(head, head + 3);
ok("reveal: an offset in the header row puts the caret in the header cell", inHead.cell?.row === "0" && inHead.cell?.column === "1", JSON.stringify(inHead));
ok(
	"reveal: and reads back the header span",
	inHead.read.start === head && inHead.read.end === head + 3 && inHead.read.text === "who",
	JSON.stringify(inHead.read),
);

// The two edges stay where they were. A caret before a widget or after one is
// a position on the surface itself: edge(), Ctrl-End and the keys that edit
// the markdown there all read it from the surface.
const block = AROUND.indexOf("| dish");
const before4 = await pick(block);
ok("reveal: the offset where the block begins is still a position on the surface", before4.root === true && before4.read.start === block, JSON.stringify(before4));

const foot = block + "| dish | who |\n| --- | --- |\n| carbonara | guanciale |".length;
const after4 = await pick(foot);
ok("reveal: and so is the one where it ends", after4.root === true && after4.offset === before4.offset + 1, JSON.stringify(after4));

// The alignment row is scaffolding: there is no cell drawn for it, so an
// offset in it answers the way it always has, with the block.
const rule = AROUND.indexOf("---");
const inRule = await pick(rule, rule + 3);
ok("reveal: an offset in the alignment row leaves the caret on the block", inRule.root === true && inRule.cell === null && inRule.read.start === block, JSON.stringify(inRule));

// A selection from one cell to another is not a span of the document: half a
// row means nothing in markdown, so the block answers for it and a tool
// pointed at the document is handed nothing to write over.
const across = await page.evaluate(() => {
	const from = document.querySelector('.mdedit__widget--table [data-row="0"][data-column="0"]');
	const to = document.querySelector('.mdedit__widget--table [data-row="1"][data-column="1"]');
	const range = document.createRange();
	range.setStart(from.firstChild, 0);
	range.setEnd(to.firstChild, 2);
	document.getSelection().removeAllRanges();
	document.getSelection().addRange(range);
	return window.editor.selection;
});
ok("reveal: a selection across two cells reads back as the block", across.start === block && across.end === block && across.text === "", JSON.stringify(across));

// A pipe a cell holds is written \| and counts as the one character it
// stands for, so the offsets on either side of it agree with the document.
const ESCAPED = "| a | b |\n| --- | --- |\n| B \\| more | plain |\n";
await set(ESCAPED);
await page.waitForTimeout(250);
const past = ESCAPED.indexOf("more");
const inEscaped = await pick(past, past + 4);
ok("reveal: an offset past an escaped pipe lands in the cell", inEscaped.cell?.row === "1" && inEscaped.cell?.column === "0", JSON.stringify(inEscaped));
ok(
	"reveal: and reads back the span, the escape counted once",
	inEscaped.read.start === past && inEscaped.read.end === past + 4 && inEscaped.read.text === "more",
	JSON.stringify(inEscaped.read),
);

await browser.close();
ok("the page stayed quiet", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((p) => `  ${p}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
