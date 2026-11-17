// The second testing pass over mdedit: undo, paste, the drawn table's own
// bar, the image panel and the uploads, each driven the way a writer drives
// it: by key, by button and by gesture, not through the API.

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
page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));
page.on("console", (message) => {
	if (message.type() === "error") noise.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

const set = (markdown, caret = 0) =>
	page.evaluate(
		([text, at]) => {
			window.editor.value = text;
			window.editor.toggleMarks(true);
			window.editor.focus();
			window.editor.source.select(at);
		},
		[markdown, caret],
	);
const value = () => page.evaluate(() => window.editor.value);
const caret = () => page.evaluate(() => window.editor.selection.start);
const cells = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".mdedit__widget--table th, .mdedit__widget--table td")].map(
			(cell) => cell.textContent,
		),
	);

// ── 1. undo and redo ──────────────────────────────────────────────────────

await set("start\n", 5);
await page.keyboard.type(" here");
await page.waitForTimeout(60);
await page.keyboard.press("Control+z");
await page.waitForTimeout(60);
const once = await value();
await page.keyboard.press("Control+z");
await page.waitForTimeout(60);
ok(
	"undo: a word typed comes back off, a step at a time",
	once === "start \n" && (await value()) === "start\n",
	JSON.stringify([once, await value()]),
);

// Redo mirrors the undo steps, one at a time, and answers to both keys.
await page.keyboard.press("Control+y");
await page.waitForTimeout(60);
const redone = await value();
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(60);
const whole = await value();
ok(
	"undo: redo puts it back, and both keys do it",
	redone === "start \n" && whole === "start here\n",
	JSON.stringify([redone, whole]),
);

// Undo over a tool, which writes through the same path.
await set("plain\n", 0);
await page.evaluate(() => {
	window.editor.source.select(0, 5);
	window.editor.run("bold");
});
await page.waitForTimeout(60);
ok("undo: the tool wrote", (await value()) === "**plain**\n", JSON.stringify(await value()));
await page.keyboard.press("Control+z");
await page.waitForTimeout(80);
const untooled = await value();
ok("undo: and a tool's write comes off too", untooled === "plain\n", JSON.stringify(untooled));

// A document the host loads is the floor: undo cannot reach back past it
// into the one before, which the writer never typed.
await set("floor\n", 0);
for (let step = 0; step < 6; step += 1) {
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(25);
}
const floor = await value();
ok("undo: it cannot reach back past a document the host loaded", floor === "floor\n", JSON.stringify(floor));

// Typing into the loaded document still undoes, down to the loaded text.
await page.keyboard.type(" and more");
await page.waitForTimeout(60);
for (let step = 0; step < 8; step += 1) {
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(25);
}
ok("undo: and it still reaches everything typed since", (await value()) === "floor\n", JSON.stringify(await value()));

// A run of typing undoes in whole words, not character by character: five
// undos must not leave half a word behind.
await set("", 0);
await page.keyboard.type("alpha beta gamma");
await page.waitForTimeout(60);
let steps = 0;
while (steps < 25 && (await value()) !== "") {
	await page.keyboard.press("Control+z");
	await page.waitForTimeout(30);
	steps += 1;
}
ok("undo: a typed line undoes in a handful of steps", (await value()) === "" && steps <= 6, `${steps} steps`);

// ── 2. paste ──────────────────────────────────────────────────────────────

const paste = (text, type = "text/plain") =>
	page.evaluate(
		([body, mime]) => {
			const data = new DataTransfer();
			data.setData(mime, body);
			document
				.querySelector(".mdedit__surface")
				.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
		},
		[text, type],
	);

await set("before\nafter\n", 6);
await paste("\none\ntwo");
await page.waitForTimeout(60);
ok("paste: several lines land as several lines", (await value()) === "before\none\ntwo\nafter\n", JSON.stringify(await value()));
ok("paste: the caret is at the end of what landed", (await caret()) === 14, String(await caret()));

// A paste off a windows machine carries \r\n, which must not reach the document.
await set("", 0);
await paste("one\r\ntwo\r\n");
await page.waitForTimeout(60);
const windows = await value();
ok("paste: carriage returns do not reach the document", !windows.includes("\r"), JSON.stringify(windows));

// A paste over a selection replaces it.
await set("keep THIS keep\n", 0);
await page.evaluate(() => window.editor.source.select(5, 9));
await paste("that");
await page.waitForTimeout(60);
ok("paste: it replaces the selection", (await value()) === "keep that keep\n", JSON.stringify(await value()));

// HTML on the clipboard arrives as the characters it is, not as tags.
await set("", 0);
await page.evaluate(() => {
	const data = new DataTransfer();
	data.setData("text/html", "<b>bold</b> and <i>thin</i>");
	data.setData("text/plain", "bold and thin");
	document
		.querySelector(".mdedit__surface")
		.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(60);
const html = await page.evaluate(() => ({
	value: window.editor.value,
	tags: document.querySelectorAll(".mdedit__surface b, .mdedit__surface i").length,
}));
ok("paste: html arrives as text and leaves no tags behind", html.value === "bold and thin" && html.tags === 0, JSON.stringify(html));

// A paste into a drawn cell goes in the cell, not into the document around it.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0);
await page.waitForTimeout(80);
await page.evaluate(() => {
	const cell = document.querySelector(".mdedit__widget--table td");
	cell.focus();
	const range = document.createRange();
	range.selectNodeContents(cell);
	range.collapse(false);
	document.getSelection().removeAllRanges();
	document.getSelection().addRange(range);
	const data = new DataTransfer();
	data.setData("text/plain", " and more");
	cell.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(80);
const pasted = await value();
ok("paste: into a cell it stays in the cell", /\|\s*1 and more\s*\|/.test(pasted) && pasted.split("\n").length === 4, JSON.stringify(pasted));

// A multi-line paste into a cell must not break the row into lines.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0);
await page.waitForTimeout(80);
await page.evaluate(() => {
	const cell = document.querySelector(".mdedit__widget--table td");
	cell.focus();
	const range = document.createRange();
	range.selectNodeContents(cell);
	range.collapse(false);
	document.getSelection().removeAllRanges();
	document.getSelection().addRange(range);
	const data = new DataTransfer();
	data.setData("text/plain", "one\ntwo");
	cell.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(80);
const broken = await value();
ok(
	"paste: a multi-line paste in a cell does not break the row",
	broken.split("\n").length === 4 && !broken.includes("\n1one"),
	JSON.stringify(broken),
);

// ── 3. the drawn table's bar ──────────────────────────────────────────────

const grid = async (tool) => {
	await page.evaluate((key) => {
		document.querySelector(`.mdedit__widget--table .mdedit__tool--${key}`)?.click();
	}, tool);
	await page.waitForTimeout(120);
};

await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n", 0);
await page.waitForTimeout(80);
const bar = await page.evaluate(() =>
	[...document.querySelectorAll(".mdedit__widget--table .mdedit__tool")].map(
		(node) => node.className.match(/tool--(\S+)/)?.[1],
	),
);
ok("table: the widget carries its own two ways in", bar.includes("source") && bar.includes("grid"), JSON.stringify(bar));

await grid("source");
const sourced = await page.evaluate(() => ({
	widget: document.querySelectorAll(".mdedit__widget--table").length,
	lines: [...document.querySelectorAll(".mdedit__surface > *")].length,
	value: window.editor.value,
}));
ok(
	"table: the source button puts the markdown lines back",
	sourced.widget === 0 && sourced.lines === 4,
	JSON.stringify(sourced),
);
ok("table: and the document is unchanged by the switch", sourced.value === "| a | b |\n| --- | --- |\n| 1 | 2 |\n");

// The block stays as markdown while the caret is in it, and draws itself
// again once the caret leaves: the lines are not a mode to get back out of.
await set("| a | b |\n| --- | --- |\n| 1 | 2 |\n\nprose\n", 0);
await page.waitForTimeout(100);
await grid("source");
const held = await page.evaluate(() => document.querySelectorAll(".mdedit__widget--table").length);
ok("table: the markdown stays while the caret is in it", held === 0, String(held));

await page.evaluate(() => {
	window.editor.focus();
	window.editor.source.select(38);
});
await page.waitForTimeout(150);
const redrawn = await page.evaluate(() => document.querySelectorAll(".mdedit__widget--table").length);
ok("table: and it draws itself again once the caret leaves", redrawn === 1, String(redrawn));

// ── 4. the image panel ────────────────────────────────────────────────────

await set("![a caption](/assets/docs/table.png)\n\nafter\n", 0);
await page.waitForTimeout(100);
await page.locator(".mdedit__surface img.mdedit__pic").click({ button: "right" });
await page.waitForTimeout(120);
const panel = await page.evaluate(() => {
	const open = document.querySelector(".mdedit__image");
	if (!open) return null;
	const rect = open.getBoundingClientRect();
	return {
		caption: open.querySelector("[data-caption]")?.value ?? open.querySelector("input")?.value,
		inView: rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth,
		buttons: [...open.querySelectorAll("button")].map((node) => node.className.match(/tool--(\S+)/)?.[1] ?? node.textContent),
	};
});
ok("image: a right click opens the panel over the picture", panel !== null, JSON.stringify(panel));
ok("image: it opens inside the window", panel?.inView === true, JSON.stringify(panel?.inView));
ok("image: it reads the caption the marker carries", panel?.caption === "a caption", JSON.stringify(panel?.caption));

// The three alignments, each written as an anchor on the address.
for (const [tool, anchor] of [
	["align-left", "#left"],
	["align-center", "#center"],
	["align-right", "#right"],
]) {
	await page.evaluate((key) => document.querySelector(`.mdedit__image .mdedit__tool--${key}`)?.click(), tool);
	await page.waitForTimeout(80);
	const laid = await value();
	ok(`image: ${tool} writes ${anchor} on the address`, laid.includes(anchor), JSON.stringify(laid.split("\n")[0]));
}

// The same button again takes the alignment back off.
await page.evaluate(() => document.querySelector(".mdedit__image .mdedit__tool--align-right")?.click());
await page.waitForTimeout(80);
const bare = await value();
ok("image: pressing the alignment again takes it off", !bare.includes("#"), JSON.stringify(bare.split("\n")[0]));

// Escape closes it, and the caret goes back to the document.
await page.keyboard.press("Escape");
await page.waitForTimeout(80);
const closed = await page.evaluate(() => document.querySelectorAll(".mdedit__image").length);
ok("image: Escape closes the panel", closed === 0, String(closed));

// ── 5. uploads ────────────────────────────────────────────────────────────

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx8gAAAABJRU5ErkJggg==";

const drop = (files) =>
	page.evaluate(
		([list, png]) => {
			const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
			const data = new DataTransfer();
			for (const name of list) data.items.add(new File([bytes], name, { type: "image/png" }));
			document
				.querySelector(".mdedit__surface")
				.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
		},
		[files, PNG],
	);

await set("", 0);
await drop(["one.png", "two.png", "three.png"]);
await page.waitForTimeout(1200);
const many = await value();
const markers = [...many.matchAll(/!\[\]\(\/uploads\/[^)]+\.png\)/g)];
ok("uploads: three files at once each land as their own marker", markers.length === 3, JSON.stringify(many));
ok("uploads: and no placeholder is left behind", !many.includes("uploading"), JSON.stringify(many));
const pictures = await page.evaluate(() => document.querySelectorAll(".mdedit__surface img.mdedit__pic").length);
ok("uploads: each marker draws its picture", pictures === 3, String(pictures));

await browser.close();

if (noise.length) {
	ok(`the page stayed quiet (${noise.length})`, false, noise.slice(0, 4).join(" / "));
} else {
	ok("no console or page errors", true);
}

console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((p) => `  ${p}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
