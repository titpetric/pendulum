// The YAML block at the head of a document: drawn as fields, edited in place
// and in its source, with the lines nobody touched left alone.

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

const value = () => page.evaluate(() => window.editor.value);
const set = (markdown, caret = 0) =>
	page.evaluate(
		([text, at]) => {
			window.editor.value = text;
			window.editor.focus();
			window.editor.source.select(at);
		},
		[markdown, caret],
	);
const fields = () =>
	page.evaluate(() => {
		const widget = document.querySelector(".mdedit__widget--frontmatter");
		if (!widget) return null;
		return {
			name: widget.querySelector(".mdedit__widget-name")?.dataset.name ?? widget.querySelector(".mdedit__widget-name")?.textContent,
			rows: [...widget.querySelectorAll("tbody tr")].map((line) => [...line.children].map((cell) => cell.textContent)),
			groups: [...widget.querySelectorAll(".mdedit__frontmatter-group")].map((line) => line.textContent),
			source: Boolean(widget.querySelector(".mdedit__frontmatter-source")),
			invalid: widget.hasAttribute("data-invalid"),
		};
	});
const focus = (row, column) =>
	page.evaluate(
		([at, by]) => {
			const cell = document.querySelector(`.mdedit__widget--frontmatter [data-row="${at}"][data-column="${by}"]`);
			if (!cell) return false;
			cell.focus();
			const range = document.createRange();
			range.selectNodeContents(cell);
			document.getSelection().removeAllRanges();
			document.getSelection().addRange(range);
			return true;
		},
		[row, column],
	);
const sourceButton = () => page.locator(".mdedit__widget--frontmatter .mdedit__tool--source");

// ── 1. the block draws, and its bytes are the document's ────────────────

const POST = '---\ntitle: Salt, fat, and the water\ndate: 2026-10-25\ntags: cooking, notes\n---\n\nBody.\n';
await set(POST);
await page.waitForTimeout(250);
const drawn = await fields();
ok("draw: the block at the head is fields", drawn !== null, JSON.stringify(drawn));
ok("draw: the bar names it", drawn?.name === "Document front-matter", JSON.stringify(drawn?.name));
ok("draw: a root value is a row", drawn?.rows?.[0]?.join(" | ") === "title | Salt, fat, and the water", JSON.stringify(drawn?.rows));
ok("draw: nothing was rewritten", (await value()) === POST, JSON.stringify(await value()));

// ── 2. typing a value encodes it ────────────────────────────────────────

await focus(0, 1);
await page.keyboard.press("Backspace");
await page.keyboard.type("Salt: water");
await page.waitForTimeout(250);
ok(
	"edit: a colon is encoded and quoted",
	(await value()).includes('title: "Salt: water"'),
	JSON.stringify(await value()),
);
ok(
	"edit: the untouched lines are byte for byte",
	(await value()).includes("date: 2026-10-25\ntags: cooking, notes"),
	JSON.stringify(await value()),
);

// A value that needs quoting is quoted, and its quote is escaped.
await focus(0, 1);
await page.keyboard.press("Backspace");
await page.keyboard.type('A: "quoted" title');
await page.waitForTimeout(250);
ok(
	"edit: a quote in a quoted value is escaped",
	(await value()).includes('title: "A: \\"quoted\\" title"'),
	JSON.stringify(await value()),
);

// ── 3. a field is added, and an abandoned one writes nothing ────────────

await set(POST);
await page.waitForTimeout(200);
const before = await value();
await page.locator(".mdedit__widget--frontmatter .mdedit__tool--row-add").click();
await page.waitForTimeout(100);
ok("add: a row lands at the foot", (await fields())?.rows?.length === 4, JSON.stringify((await fields())?.rows));
ok("add: and the document is unchanged", (await value()) === before, JSON.stringify(await value()));
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
ok("add: Backspace takes the empty row out", (await fields())?.rows?.length === 3, JSON.stringify((await fields())?.rows));

await page.locator(".mdedit__widget--frontmatter .mdedit__tool--row-add").click();
await page.keyboard.type("author");
await page.keyboard.press("Tab");
await page.keyboard.type("Ana");
await page.waitForTimeout(250);
ok(
	"add: a typed pair is a line of the document",
	(await value()).includes('author: Ana\n---'),
	JSON.stringify(await value()),
);

// ── 4. the source view ──────────────────────────────────────────────────

await sourceButton().click();
await page.waitForTimeout(150);
ok("source: the table is replaced by YAML", (await fields())?.source === true, JSON.stringify(await fields()));
const source = page.locator(".mdedit__frontmatter-source");
const current = await value();
ok(
	"source: it holds the whole block",
	(await source.inputValue()) === current.slice(0, current.indexOf("\n\n")),
	JSON.stringify(await source.inputValue()),
);

await source.fill("---\ntitle: New\nlist:\n  - one\n  - two\n---");
await page.waitForTimeout(150);
ok("source: an edit is the document", (await value()).startsWith("---\ntitle: New\nlist:"), JSON.stringify(await value()));

await sourceButton().click();
await page.waitForTimeout(250);
const back = await fields();
ok("source: the table draws again", back?.source === false, JSON.stringify(back));
ok("source: a list is a rich row", back?.rows?.some((row) => row.join(" | ") === "list | rich type, edit via source"), JSON.stringify(back?.rows));

// An unclosed block stays in the source view.
await sourceButton().click();
await source.fill("---\ntitle: Broken");
await sourceButton().click();
await page.waitForTimeout(200);
const broken = await fields();
ok("source: an unclosed block keeps the field open", broken?.source === true && broken?.invalid === true, JSON.stringify(broken));

// ── 5. the block is a map of fields, or it is markdown ──────────────────

for (const [label, text] of [
	["a rule pair around prose", "---\n\ntext\n---\n"],
	["a list at the root", "---\n- a\n- b\n---\n"],
]) {
	await set(text);
	await page.waitForTimeout(200);
	ok(`shape: ${label} stays markdown`, (await fields()) === null, JSON.stringify(await fields()));
}

await set("intro\n---\ntitle: x\n---\n");
await page.waitForTimeout(200);
ok("shape: a block not at the head stays markdown", (await fields()) === null, JSON.stringify(await fields()));

// A block at the root is fields, and a list under a key is rich.
await set("---\ntags:\n  - one\n  - two\n---\n\nBody\n");
await page.waitForTimeout(200);
ok(
	"shape: a root list is a rich row",
	(await fields())?.rows?.some((row) => row.join(" | ") === "tags | rich type, edit via source"),
	JSON.stringify((await fields())?.rows),
);

// ── 6. an object opens one level, and a table under the block is its own ─

const NESTED = "---\ntitle: A\nauthor:\n  name: Ana\n  address:\n    city: Rome\ntags:\n  - one\n---\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
await set(NESTED);
await page.waitForTimeout(250);
const nested = await page.evaluate(() => ({
	front: Boolean(document.querySelector(".mdedit__widget--frontmatter")),
	table: Boolean(document.querySelector(".mdedit__widget--table")),
	rows: [...document.querySelectorAll(".mdedit__widget--frontmatter tbody tr")].map((line) =>
		[...line.children].map((cell) => cell.textContent),
	),
}));
ok("nested: a root object opens under its name", nested.rows.some((row) => row.join(" | ") === "name | Ana"), JSON.stringify(nested.rows));
ok("nested: a deeper object is rich", nested.rows.some((row) => row.join(" | ") === "address | rich type, edit via source"), JSON.stringify(nested.rows));
ok("nested: the table under the block is a table", nested.front && nested.table, JSON.stringify(nested));
ok("nested: the document is exact", (await value()) === NESTED, JSON.stringify(await value()));

// ── 7. a document offset lands in the cell it names ─────────────────────

const QUOTED = '---\ntitle: "Salt: water"\n---\n\nBody\n';
await set(QUOTED);
await page.waitForTimeout(250);
const at = QUOTED.indexOf("water");
const placed = await page.evaluate((offset) => {
	window.editor.source.select(offset);
	return {
		read: window.editor.selection,
		cell: document.activeElement?.closest?.("[data-row][data-column]")?.textContent,
	};
}, at);
ok("offset: a position in a quoted value lands in its cell", placed.cell === "Salt: water", JSON.stringify(placed));
ok("offset: and reads back at the offset asked for", placed.read.start === at && placed.read.end === at, JSON.stringify(placed.read));

// ── 8. a closer typed at the head draws the block once the caret leaves ──

await set("---\ntitle: A\n", 0);
await page.waitForTimeout(150);
await page.evaluate(() => window.editor.source.select(window.editor.value.length));
await page.keyboard.type("---");
await page.waitForTimeout(150);
ok("typing: the block is markdown while the caret is in it", (await fields()) === null);
await page.keyboard.press("Enter");
await page.keyboard.type("Body");
await page.waitForTimeout(250);
ok("typing: it draws once a line follows", (await fields()) !== null, JSON.stringify(await fields()));

// ── 9. undo takes an edit back ──────────────────────────────────────────

await set(POST);
await page.waitForTimeout(200);
const original = await value();
await focus(0, 1);
await page.keyboard.press("Backspace");
await page.keyboard.type("changed");
await page.waitForTimeout(250);
ok("undo: the edit is in the document", (await value()) !== original, JSON.stringify(await value()));
await page.evaluate(() => window.editor.focus());
for (let press = 0; press < 8; press += 1) {
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(60);
	if ((await value()) === original) break;
}
ok("undo: it comes back", (await value()) === original, JSON.stringify(await value()));

// ── 10. a host with no metadata turns the fields off ────────────────────

const OFF = "---\ntitle: A\n---\n\nBody\n";
const off = await page.evaluate((markdown) => {
	const field = document.createElement("textarea");
	field.value = markdown;
	document.body.appendChild(field);
	const editor = new window.editor.constructor(field, { frontmatter: false });
	const result = {
		drawn: Boolean(editor.root.querySelector(".mdedit__widget--frontmatter")),
		text: editor.root.textContent.includes("title: A"),
		value: editor.value,
	};
	editor.destroy();
	field.remove();
	return result;
}, OFF);
ok("option: frontmatter false draws no fields", off.drawn === false, JSON.stringify(off));
ok("option: and the block stays markdown", off.text && off.value === OFF, JSON.stringify(off.value));

await browser.close();
ok("the page stayed quiet", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((p) => `  ${p}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
