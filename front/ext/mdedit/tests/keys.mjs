// Tab inside the editor: the key writes a tab character and the focus stays
// in the document. Escape first is the one way out, for anyone driving the
// page from the keyboard.

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
page.on("pageerror", (err) => ok(`pageerror: ${err.message}`, false));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

const set = (markdown, caret = 0) =>
	page.evaluate(
		([text, at]) => {
			window.editor.value = text;
			window.editor.focus();
			window.editor.source.select(at);
		},
		[markdown, caret],
	);

// where answers what holds the focus, named the way a reader would name it.
const where = () =>
	page.evaluate(() => {
		const node = document.activeElement;
		if (!node) return "nothing";
		if (node.classList?.contains("mdedit__surface")) return "surface";
		if (node.classList?.contains("mdedit__tool")) return `tool:${node.className.match(/tool--(\S+)/)?.[1]}`;
		if (node.closest?.(".mdedit__widget--table")) return `cell:${node.tagName.toLowerCase()}`;
		return `${node.tagName.toLowerCase()}${node.name ? `[${node.name}]` : ""}`;
	});

const state = () => page.evaluate(() => ({ value: window.editor.value, caret: window.editor.selection.start }));

// ── 1. prose ──────────────────────────────────────────────────────────────

await set("one", 3);
await page.keyboard.press("Tab");
let now = await state();
ok("prose: Tab writes a tab character", now.value === "one\t", JSON.stringify(now));
ok("prose: the focus stays in the document", (await where()) === "surface");

await page.keyboard.type("two");
now = await state();
ok("prose: what follows the tab lands after it", now.value === "one\ttwo", JSON.stringify(now));

// ── 2. the middle of a word, and a second tab ─────────────────────────────

await set("abcd", 2);
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
now = await state();
ok("prose: two tabs mid-word both land", now.value === "ab\t\tcd" && now.caret === 4, JSON.stringify(now));

// ── 3. inside a code fence, where a tab is the writer's indentation ───────

await set("```go\nfunc main() {\n}\n```\n", 20);
await page.keyboard.press("Tab");
await page.keyboard.type("return");
now = await state();
ok(
	"fence: a tab indents a line of code",
	now.value === "```go\nfunc main() {\n\treturn}\n```\n",
	JSON.stringify(now.value),
);
ok("fence: the focus is still the document", (await where()) === "surface");

// ── 4. a selection over lines: Tab indents the block, Shift+Tab takes it back

await page.evaluate(() => {
	window.editor.value = "one\ntwo\nthree\n";
	window.editor.focus();
	window.editor.source.select(0, 13);
});
await page.keyboard.press("Tab");
now = await state();
ok("block: Tab over lines indents every one", now.value === "\tone\n\ttwo\n\tthree\n", JSON.stringify(now.value));

await page.keyboard.press("Shift+Tab");
now = await state();
ok("block: Shift+Tab takes the level back off", now.value === "one\ntwo\nthree\n", JSON.stringify(now.value));
ok("block: and the focus never left", (await where()) === "surface");

// A list is the construct this matters for: Tab makes a nested item.
await set("- one\n- two\n", 8);
await page.keyboard.press("Tab");
now = await state();
ok("list: Tab on an item nests it", now.value === "- one\n-\t two\n" || now.value === "- one\n- \ttwo\n", JSON.stringify(now.value));

// ── 5. Shift+Tab on one line with nothing to outdent ──────────────────────

await set("flat\n", 2);
await page.keyboard.press("Shift+Tab");
now = await state();
ok("outdent: a line with no indentation is left alone", now.value === "flat\n", JSON.stringify(now.value));
ok("outdent: and the focus is still the document", (await where()) === "surface");

// ── 6. a drawn table: Tab crosses it cell by cell ─────────────────────────

await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0);
await page.waitForTimeout(80);
const stepped = await page.evaluate(() => {
	const cells = [...document.querySelectorAll(".mdedit__widget--table th, .mdedit__widget--table td")];
	cells[0].focus();
	return cells.length;
});
ok("table: the document draws a cell per heading and per body cell", stepped === 4, String(stepped));

await page.keyboard.press("Tab");
const after = await page.evaluate(() => {
	const cells = [...document.querySelectorAll(".mdedit__widget--table th, .mdedit__widget--table td")];
	return { at: cells.indexOf(document.activeElement), text: document.activeElement?.textContent };
});
ok("table: Tab steps to the next cell, not out of the editor", after.at === 1, JSON.stringify(after));

await page.keyboard.press("Shift+Tab");
const back = await page.evaluate(() => {
	const cells = [...document.querySelectorAll(".mdedit__widget--table th, .mdedit__widget--table td")];
	return { at: cells.indexOf(document.activeElement), value: window.editor.value };
});
ok("table: Shift+Tab steps back a cell", back.at === 0, JSON.stringify(back));
ok("table: and the markdown took no tab character", !back.value.includes("\t"), JSON.stringify(back.value));

// Tab off the last cell: no tab character in the markdown, and a row of
// empty cells at the foot of the table, which tests/tables.mjs drives in
// full. A table is left with the mouse or a tap, so neither Tab takes the
// focus out of it.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter the table\n", 0);
await page.waitForTimeout(80);
await page.evaluate(() => {
	const cells = [...document.querySelectorAll(".mdedit__widget--table th, .mdedit__widget--table td")];
	cells[cells.length - 1].focus();
});
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
const past = await page.evaluate(() => ({
	value: window.editor.value,
	rows: document.querySelectorAll(".mdedit__widget--table tr").length,
	cell: document.activeElement?.closest?.("th, td")?.dataset,
}));
ok("table: Tab off the last cell writes no tab character", !past.value.includes("\t"), JSON.stringify(past.value));
ok(
	"table: it adds a row and stands in the first cell of it",
	past.rows === 3 && past.cell?.row === "2" && past.cell?.column === "0",
	JSON.stringify(past),
);
await page.keyboard.type("x");
await page.waitForTimeout(120);
ok("table: so the next keystroke lands in the table", /\|\s*x\s*\|/.test((await state()).value), JSON.stringify((await state()).value));

// Shift-Tab off the first cell stays in that cell.
await set("before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0);
await page.waitForTimeout(80);
await page.evaluate(() => {
	document.querySelector(".mdedit__widget--table th").focus();
});
await page.keyboard.press("Shift+Tab");
const prior = await page.evaluate(() => ({
	cell: document.activeElement?.closest?.("th, td")?.textContent,
	value: window.editor.value,
}));
ok("table: Shift-Tab off the first cell stays in the table", prior.cell === "a" && !prior.value.includes("\t"), JSON.stringify(prior));

// ── 7. the way out: Escape, then Tab ──────────────────────────────────────

await set("hold", 4);
await page.keyboard.press("Escape");
await page.keyboard.press("Tab");
const released = { value: (await state()).value, focus: await where() };
ok("escape: Escape then Tab moves the focus on", released.focus !== "surface", JSON.stringify(released));
ok("escape: and writes no tab character", released.value === "hold", JSON.stringify(released.value));

// A Tab after that is the browser's again, and the document is untouched.
await page.locator(".mdedit__surface").click();
await page.keyboard.press("Escape");
await page.keyboard.type("x");
await page.keyboard.press("Tab");
const resumed = { value: (await state()).value, focus: await where() };
ok(
	"escape: a keystroke after Escape takes Tab back for the document",
	resumed.value.includes("\t") && resumed.focus === "surface",
	JSON.stringify(resumed),
);

// ── 8. the bar: Tab from the bar reaches the document ─────────────────────

const chain = await page.evaluate(() => {
	document.querySelector(".mdedit__tool--bold").focus();
	return document.activeElement.className;
});
await page.keyboard.press("Tab");
ok("bar: Tab off the bar lands in the document", (await where()) === "surface", `${chain} -> ${await where()}`);

// ── 9. tab: false leaves the key to the browser ──────────────────────────

const released2 = await page.evaluate(async () => {
	const { MarkdownEditor } = await import("/assets/dist/mdedit.js");
	const area = document.createElement("textarea");
	area.value = "plain";
	document.body.appendChild(area);
	const editor = new MarkdownEditor(area, { tab: false });
	editor.focus();
	editor.source.select(5);
	window.plain = editor;
	return editor.value;
});
ok("option: an editor built with tab:false starts clean", released2 === "plain");
await page.keyboard.press("Tab");
const plain = await page.evaluate(() => ({ value: window.plain.value, focus: document.activeElement.tagName }));
ok("option: tab:false writes no tab and lets the focus go", plain.value === "plain", JSON.stringify(plain));

// ── Enter in a list ───────────────────────────────────────────────────────

const value = () => page.evaluate(() => window.editor.value);
const caret = () => page.evaluate(() => window.editor.selection.start);

await set("- one", 5);
await page.keyboard.press("Enter");
ok("list: Enter opens the next item with its marker", (await value()) === "- one\n- ", JSON.stringify(await value()));
ok("list: and the caret stands after it", (await caret()) === 8, String(await caret()));

await page.keyboard.type("two");
await page.keyboard.press("Enter");
ok("list: the next one carries on", (await value()) === "- one\n- two\n- ", JSON.stringify(await value()));

// An item with nothing in it ends the list.
await page.keyboard.press("Enter");
ok("list: Enter on an empty item takes the marker off", (await value()) === "- one\n- two\n\n", JSON.stringify(await value()));
ok("list: and the caret is on a line of its own", (await caret()) === 13, String(await caret()));
await page.keyboard.type("A paragraph.");
ok("list: what follows is a paragraph", (await value()) === "- one\n- two\n\nA paragraph.", JSON.stringify(await value()));

// A numbered list counts on.
await set("1. first", 8);
await page.keyboard.press("Enter");
ok("list: a numbered item counts on", (await value()) === "1. first\n2. ", JSON.stringify(await value()));

// An indented item keeps its depth.
await set("- one\n\t- nested", 15);
await page.keyboard.press("Enter");
ok("list: a nested item opens at its own depth", (await value()) === "- one\n\t- nested\n\t- ", JSON.stringify(await value()));

// Enter in the middle splits the item, both halves items.
await set("- onetwo", 5);
await page.keyboard.press("Enter");
ok("list: Enter inside an item splits it", (await value()) === "- one\n- two", JSON.stringify(await value()));

// Shift-Enter is the hard break, in a list as anywhere else.
await set("- one", 5);
await page.keyboard.press("Shift+Enter");
ok("list: Shift-Enter writes the hard break", (await value()) === "- one  \n", JSON.stringify(await value()));

// A line that is not an item gets the plain line break.
await set("A paragraph.", 12);
await page.keyboard.press("Enter");
ok("list: a paragraph takes no marker", (await value()) === "A paragraph.\n", JSON.stringify(await value()));

// ── Enter in a fenced block ───────────────────────────────────────────────

// A document that ends inside a block says so at its foot.
await set("Before.\n\n```go\nfunc main() {\n", 30);
const open = await page.evaluate(() => ({
	marked: document.querySelector(".mdedit__surface").hasAttribute("data-open-fence"),
	hint: getComputedStyle(document.querySelector(".mdedit__surface"), "::after").content,
}));
ok("fence: a document ending inside a block says so", open.marked && open.hint.includes("```"), JSON.stringify(open));

// Two blank lines close it: the lines typed to escape go, the fence lands.
await page.keyboard.press("Enter");
ok("fence: one blank line leaves the block open", (await value()) === "Before.\n\n```go\nfunc main() {\n\n", JSON.stringify(await value()));
await page.keyboard.press("Enter");
ok("fence: Enter on a second blank line closes it", (await value()) === "Before.\n\n```go\nfunc main() {\n```\n", JSON.stringify(await value()));
ok("fence: and the caret stands below the block", (await caret()) === 33, String(await caret()));
ok(
	"fence: the foot says nothing once it is closed",
	(await page.evaluate(() => document.querySelector(".mdedit__surface").hasAttribute("data-open-fence"))) === false,
);
await page.keyboard.type("After.");
ok("fence: what follows is prose", (await value()) === "Before.\n\n```go\nfunc main() {\n```\nAfter.", JSON.stringify(await value()));

// A block that is closed already keeps its blank lines: they are code.
await set("```\nfirst\n\n\n```\n", 11);
await page.keyboard.press("Enter");
ok("fence: a blank line inside a closed block is code", (await value()) === "```\nfirst\n\n\n\n```\n", JSON.stringify(await value()));

// The fence that closes is the one that opened, ticks and indent alike.
await set("~~~\ncode\n\n", 10);
await page.keyboard.press("Enter");
ok("fence: a tilde block closes with tildes", (await value()) === "~~~\ncode\n~~~\n", JSON.stringify(await value()));

// ── the decoration shortcuts ──────────────────────────────────────────────

// The keys every editor has, over the markers markdown spells the same
// decorations with. Pressing one twice takes the decoration back off: the
// second press undoes the first, which is what a writer means by it.

const select = (text, from, to) =>
	page.evaluate(
		([body, start, end]) => {
			window.editor.value = body;
			window.editor.focus();
			window.editor.source.select(start, end);
		},
		[text, from, to],
	);

for (const [name, chord, want] of [
	["Ctrl+B writes bold", "Control+b", "say **word** here"],
	["Ctrl+I writes italics", "Control+i", "say _word_ here"],
	["Ctrl+Shift+X strikes out", "Control+Shift+x", "say ~~word~~ here"],
	["Ctrl+Shift+S strikes out too", "Control+Shift+s", "say ~~word~~ here"],
]) {
	await select("say word here", 4, 8);
	await page.keyboard.press(chord);
	await page.waitForTimeout(60);
	ok(`keys: ${name}`, (await value()) === want, JSON.stringify(await value()));
	ok(`keys: ${name}, and the words stay selected`, (await page.evaluate(() => window.editor.selection.text)) === "word");

	await page.keyboard.press(chord);
	await page.waitForTimeout(60);
	ok(`keys: ${name}, and a second press takes it off`, (await value()) === "say word here", JSON.stringify(await value()));
}

// The whole set over one word, each inside the last.
await select("say word here", 4, 8);
for (const chord of ["Control+b", "Control+i", "Control+Shift+x"]) {
	await page.keyboard.press(chord);
	await page.waitForTimeout(60);
}
ok("keys: the set nests, each marker inside the last", (await value()) === "say **_~~word~~_** here", JSON.stringify(await value()));

// Ctrl+S is the browser's and the host's: a writer pressing it means save.
await select("say word here", 4, 8);
await page.keyboard.press("Control+s");
await page.waitForTimeout(60);
ok("keys: Ctrl+S alone writes nothing", (await value()) === "say word here", JSON.stringify(await value()));

await browser.close();

console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.join("\n")}`);
if (problems.length) process.exitCode = 1;
