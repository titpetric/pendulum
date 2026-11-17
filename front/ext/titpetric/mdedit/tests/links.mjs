// Links: the table one press of the link tool opens over a whole document -
// every link numbered in the order it stands, an empty address a row to fill
// in, and a picture linking somewhere with its own address beside the link's.
// The rows hold drafts; Save writes them, Cancel and Escape leave the
// document as it was.

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
const openPanel = async () => {
	await page.click(".mdedit__tool--link");
	await page.waitForSelector(".mdedit__links");
};
const rows = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".mdedit__links-row:not([data-head])")].map((row) => ({
			order: row.querySelector(".mdedit__links-order")?.textContent,
			text: row.querySelector(".mdedit__links-text")?.textContent,
			address: row.querySelector(".mdedit__links-cell--address")?.value,
			image: row.querySelector(".mdedit__links-shot")?.getAttribute("src") ?? null,
			imageField: row.querySelector(".mdedit__links-cell--image .mdedit__links-input")?.value ?? null,
			empty: row.dataset.empty,
			dirty: row.dataset.dirty,
		})),
	);
const panel = () =>
	page.evaluate(() => {
		const node = document.querySelector(".mdedit__links");
		return {
			images: node?.dataset.images,
			heads: [...document.querySelectorAll(".mdedit__links-row[data-head] > [data-head]")].map((cell) => cell.textContent),
			kinds: document.querySelectorAll(".mdedit__links-kind").length,
			save: (() => {
				const button = document.querySelector(".mdedit__links-save");
				return button && { disabled: button.disabled, label: button.textContent };
			})(),
		};
	});

const DOC = `# Links

[GitHub]()

[Docs](https://example.com/docs)

[Write](mailto:someone@example.com)

[Top](#links)

[![the logo](/assets/docs/mdedit-logo.png)](/home)

\`[not a link](in-code)\`
`;

// ── 1. the table and what it lists ────────────────────────────────────────

await set(DOC, 3);
await openPanel();
const listed = await rows();
const shell = await panel();
ok(
	"links: the tool over a whole document lists every link",
	listed.length === 5,
	JSON.stringify(listed.map((row) => row.text)),
);
ok(
	"links: each row carries its order in the document",
	listed.map((row) => row.order).join(",") === "1,2,3,4,5",
	JSON.stringify(listed.map((row) => row.order)),
);
ok(
	"links: one table, with the number, the text, the address and the picture",
	shell.heads.join("|") === "#|Link text|Address|Image" &&
		shell.kinds === 0 && shell.images === "true",
	JSON.stringify(shell),
);
ok(
	"links: an empty address is a row to fill in, not one to skip",
	listed[0].address === "" && listed[0].empty === "true",
	JSON.stringify(listed[0]),
);
ok(
	"links: a picture linking somewhere carries its own picture and address",
	listed[4].image === "/assets/docs/mdedit-logo.png" &&
		listed[4].imageField === "/assets/docs/mdedit-logo.png" &&
		listed[4].text === "the logo",
	JSON.stringify(listed[4]),
);
ok(
	"links: code is not a link, and neither is a picture of its own",
	!listed.some((row) => row.text.includes("not a link")),
	JSON.stringify(listed.map((row) => row.text)),
);
ok("links: nothing is written yet, so Save waits", shell.save?.disabled === true, JSON.stringify(shell.save));

// ── 2. drafts, and the Save that writes them ──────────────────────────────

const before = await value();
await page
	.locator(".mdedit__links-row:not([data-head])")
	.nth(0)
	.locator(".mdedit__links-cell--address")
	.fill("https://github.com/titpetric/mdedit");
await page.waitForTimeout(100);
const drafted = await page.evaluate(() => ({
	value: window.editor.value,
	dirty: document.querySelector(".mdedit__links-row:not([data-head])")?.dataset.dirty,
	save: document.querySelector(".mdedit__links-save")?.disabled,
}));
ok(
	"links: typing an address changes the row and not the document",
	drafted.value === before && drafted.dirty === "true" && drafted.save === false,
	JSON.stringify(drafted),
);

await page.click(".mdedit__links-save");
await page.waitForTimeout(150);
const written = await value();
const closed = (await page.locator(".mdedit__links").count()) === 0;
ok(
	"links: Save writes the draft into the document and puts the panel away",
	written.includes("[GitHub](https://github.com/titpetric/mdedit)") && closed,
	JSON.stringify({ closed, written }),
);
ok(
	"links: and the rest of the document is as it was",
	written.includes("[Docs](https://example.com/docs)") &&
		written.includes("[Write](mailto:someone@example.com)") &&
		written.includes("[Top](#links)") &&
		written.includes("[![the logo](/assets/docs/mdedit-logo.png)](/home)") &&
		written.includes("`[not a link](in-code)`"),
	JSON.stringify(written),
);

await openPanel();
const afterWrite = await rows();
ok(
	"links: every row below still points at its own link",
	afterWrite[0].address === "https://github.com/titpetric/mdedit" &&
		afterWrite[0].empty === "false" &&
		afterWrite[1].address === "https://example.com/docs" &&
		afterWrite[2].address === "mailto:someone@example.com" &&
		afterWrite[3].address === "#links" &&
		afterWrite[4].imageField === "/assets/docs/mdedit-logo.png",
	JSON.stringify(afterWrite.map((row) => row.address)),
);

// The picture's address is editable too, and its link is left alone.
await page
	.locator(".mdedit__links-row:not([data-head])")
	.nth(4)
	.locator(".mdedit__links-cell--image .mdedit__links-input")
	.fill("/assets/docs/table.png");
await page.click(".mdedit__links-save");
await page.waitForTimeout(150);
const rewritten = await value();
ok(
	"links: the picture inside a link has an address of its own",
	rewritten.includes("[![the logo](/assets/docs/table.png)](/home)"),
	JSON.stringify(rewritten),
);

// ── 3. Cancel and Escape leave the document alone ─────────────────────────

await openPanel();
await page
	.locator(".mdedit__links-row:not([data-head])")
	.nth(1)
	.locator(".mdedit__links-cell--address")
	.fill("https://example.com/elsewhere");
await page.click(".mdedit__tool--links-cancel");
await page.waitForTimeout(100);
ok(
	"links: Cancel drops the drafts and writes nothing",
	(await value()) === rewritten && (await page.locator(".mdedit__links").count()) === 0,
	JSON.stringify(await value()),
);

await openPanel();
await page
	.locator(".mdedit__links-row:not([data-head])")
	.nth(2)
	.locator(".mdedit__links-cell--address")
	.fill("mailto:other@example.com");
await page.keyboard.press("Escape");
ok(
	"links: so does Escape",
	(await value()) === rewritten && (await page.locator(".mdedit__links").count()) === 0,
	JSON.stringify(await value()),
);

// A document with no picture link keeps three columns.
await set("[one](https://example.com)\n\n[two](https://example.org)\n", 0);
await openPanel();
const plain = await panel();
ok(
	"links: a document with no picture link hides the picture column",
	plain.images === "false",
	JSON.stringify(plain),
);
await page.keyboard.press("Escape");

// ── 4. the tool with a selection ──────────────────────────────────────────

await page.evaluate(() => {
	window.editor.value = "say this";
	window.editor.focus();
	window.editor.source.select(0, 4);
});
await page.click(".mdedit__tool--link");
await page.waitForSelector(".mdedit__links");
const selected = await page.evaluate(() => ({
	panel: Boolean(document.querySelector(".mdedit__links")),
	value: window.editor.value,
	rows: document.querySelectorAll(".mdedit__links-row:not([data-head])").length,
	focused: document.activeElement?.className ?? "",
	text: document.querySelector(".mdedit__links-row:not([data-head]) .mdedit__links-text")?.textContent,
}));
ok(
	"links: a selection becomes the link's words and the panel takes the address",
	selected.panel && selected.value === "[say ]()this" && selected.text === "say",
	JSON.stringify(selected),
);
ok(
	"links: with the row for it already focused, so the address is typed straight in",
	selected.focused.includes("links-input") || selected.focused.includes("links-cell--address"),
	JSON.stringify(selected.focused),
);
ok(
	"links: and that one row alone, not the table over the document",
	selected.rows === 1,
	JSON.stringify(selected.rows),
);

// Filling the address in writes the link the selection asked for.
await page.locator(".mdedit__links-row:not([data-head]) .mdedit__links-cell--address").first().fill("https://example.com/said");
await page.click(".mdedit__links-save");
await page.waitForTimeout(150);
ok(
	"links: Save writes the address onto the words that were selected",
	(await value()) === "[say ](https://example.com/said)this",
	JSON.stringify(await value()),
);

// Dismissing instead leaves the document as it was before the tool ran.
await page.evaluate(() => {
	window.editor.value = "say this";
	window.editor.focus();
	window.editor.source.select(0, 4);
});
await page.click(".mdedit__tool--link");
await page.waitForSelector(".mdedit__links");
await page.click(".mdedit__tool--links-cancel");
await page.waitForTimeout(150);
ok(
	"links: Cancel takes the half-written link back out",
	(await value()) === "say this" && (await page.locator(".mdedit__links").count()) === 0,
	JSON.stringify(await value()),
);

await page.evaluate(() => {
	window.editor.value = "say this";
	window.editor.focus();
	window.editor.source.select(0, 4);
});
await page.click(".mdedit__tool--link");
await page.waitForSelector(".mdedit__links");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
ok(
	"links: and so does Escape",
	(await value()) === "say this" && (await page.locator(".mdedit__links").count()) === 0,
	JSON.stringify(await value()),
);

// The same two answers with the markers hidden: the view a writer spends
// their time in is the one where a tool writing a `[text](url)` placeholder
// into the document instead of opening the table would be hardest to undo.
await page.keyboard.press("Escape");
await page.evaluate(() => {
	window.editor.value = "one [a](b) two";
	window.editor.toggleMarks(false);
	window.editor.focus();
	window.editor.source.select(3);
});
await page.click(".mdedit__tool--link");
await page.waitForTimeout(100);
const quiet = await page.evaluate(() => ({
	panel: Boolean(document.querySelector(".mdedit__links")),
	value: window.editor.value,
}));
ok(
	"links: with the markers hidden and nothing selected the tool still opens the table and writes nothing",
	quiet.panel && quiet.value === "one [a](b) two",
	JSON.stringify(quiet),
);
await page.keyboard.press("Escape");
await page.evaluate(() => window.editor.toggleMarks(true));

ok("links: the page raised nothing", noise.length === 0, noise.join(" | "));

await browser.close();
console.log(problems.length ? `\n${problems.length} failing` : "\nALL PASS");
process.exit(problems.length ? 1 : 0);
