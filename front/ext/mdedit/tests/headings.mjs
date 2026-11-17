// A heading with its hashes hidden: the label that says which level it is,
// the keys that move it between levels, and the chooser the label opens.

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

// The label is the view with the markers off, so every check here runs in it.
const marks = (on) => page.evaluate((state) => window.editor.toggleMarks(state), on);

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
const caret = () => page.evaluate(() => window.editor.selection.start);

await marks(false);

// ── The label ─────────────────────────────────────────────────────────────

await set("## A heading here\n\nProse under it.\n", 3);

const drawn = await page.evaluate(() => {
	const line = document.querySelector(".mdedit-h2");
	const label = line.querySelector(".mdedit__level");
	return {
		level: line.dataset.level,
		printed: getComputedStyle(label, "::after").content,
		hashes: getComputedStyle(line.querySelector(".mdedit-mark")).display,
		text: label.textContent,
	};
});
ok("a heading says which level it is", drawn.level === "2" && drawn.printed.includes("H2"), JSON.stringify(drawn));
ok("and the hashes it stands for are hidden", drawn.hashes === "none", drawn.hashes);
// The surface answers the document out of the characters in its lines, so a
// label that held text would be in what the form posts.
ok("the label carries no characters of the document", drawn.text === "", JSON.stringify(drawn.text));
ok("the document reads back as it went in", (await value()) === "## A heading here\n\nProse under it.\n");

const placed = await page.evaluate(() => {
	const line = document.querySelector(".mdedit-h2");
	const label = line.querySelector(".mdedit__level");
	const box = line.getBoundingClientRect();
	const mark = label.getBoundingClientRect();
	return { lineRight: Math.round(box.right), labelRight: Math.round(mark.right), inside: box.top <= mark.top };
});
ok("it stands at the right of its own line", Math.abs(placed.lineRight - placed.labelRight) < 2 && placed.inside, JSON.stringify(placed));

// ── The caret has room ────────────────────────────────────────────────────

const rail = await page.evaluate(() => {
	const surface = document.querySelector(".mdedit__surface");
	const box = surface.getBoundingClientRect();
	const style = getComputedStyle(surface);
	const line = document.querySelector(".mdedit-para").getBoundingClientRect();
	return { pad: parseFloat(style.paddingLeft), from: Math.round(line.left - box.left) };
});
ok("every line stands off the left edge by more than the padding", rail.from > rail.pad, JSON.stringify(rail));

// ── The keys ──────────────────────────────────────────────────────────────

await page.evaluate(() => window.editor.source.select(3));
await page.keyboard.press("#");
ok("a hash at the head of the text writes one level deeper", (await value()).startsWith("### A heading"), await value());
ok("and the caret stays where the text starts", (await caret()) === 4, String(await caret()));

await page.keyboard.press("Backspace");
ok("Backspace there takes one level back", (await value()).startsWith("## A heading"), await value());
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
ok("and off the last level it leaves a paragraph", (await value()).startsWith("A heading here"), await value());
ok("the line is drawn as one", (await page.locator(".mdedit__level").count()) === 0);

// Six is as deep as markdown counts, so the hash is the character it is.
await set("###### Deepest\n", 7);
await page.keyboard.press("#");
ok("a seventh hash is typed, not counted", (await value()).startsWith("###### #Deepest"), await value());

// Anywhere else in the line a hash is a hash.
await set("## A heading here\n", 5);
await page.keyboard.press("#");
ok("a hash inside the text is the character it is", (await value()).startsWith("## A #heading"), await value());

// With the markers shown the characters are on the page and they are what
// gets edited.
await marks(true);
await set("## A heading here\n", 3);
await page.keyboard.press("Backspace");
ok("with the markup shown Backspace takes a character", (await value()).startsWith("##A heading"), await value());
ok("and no label stands on the line", await page.evaluate(() => getComputedStyle(document.querySelector(".mdedit__level") ?? document.body).display === "none" || document.querySelector(".mdedit__level") === null));
await marks(false);

// A line inside a fenced block is code, hashes and all.
await set("```\n# not a heading\n```\n", 0);
ok("a hash in a fenced block carries no label", (await page.locator(".mdedit__level").count()) === 0);

// ── The chooser ───────────────────────────────────────────────────────────

await set("### Deep heading\n\ntext\n", 4);
await page.locator(".mdedit__level").first().click();
await page.waitForTimeout(150);

const menu = await page.evaluate(() => ({
	items: [...document.querySelectorAll(".mdedit__level-item")].map((item) => item.dataset.level),
	checked: document.querySelector('.mdedit__level-item[aria-checked="true"]')?.dataset.level,
}));
ok("the label opens the six levels and the paragraph", menu.items.join(",") === "1,2,3,4,5,6,0", JSON.stringify(menu.items));
ok("with the one the line is written at marked", menu.checked === "3", JSON.stringify(menu.checked));

await page.locator('.mdedit__level-item[data-level="1"]').click();
await page.waitForTimeout(150);
ok("a level in it writes the line", (await value()) === "# Deep heading\n\ntext\n", await value());
ok("and the chooser goes away", (await page.locator(".mdedit__levels").count()) === 0);

await page.locator(".mdedit__level").first().click();
await page.waitForTimeout(150);
await page.locator('.mdedit__level-item[data-level="0"]').click();
await page.waitForTimeout(150);
ok("the paragraph entry takes the heading off", (await value()) === "Deep heading\n\ntext\n", await value());

// Escape and a press outside both put it away.
await set("## A heading here\n", 3);
await page.locator(".mdedit__level").first().click();
await page.waitForTimeout(150);
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
ok("Escape closes it", (await page.locator(".mdedit__levels").count()) === 0);

await page.locator(".mdedit__level").first().click();
await page.waitForTimeout(150);
await page.mouse.click(5, 5);
await page.waitForTimeout(100);
ok("so does a press outside it", (await page.locator(".mdedit__levels").count()) === 0);

// Undo takes back what the chooser wrote.
await set("## A heading here\n", 3);
const before = await value();
await page.locator(".mdedit__level").first().click();
await page.waitForTimeout(150);
await page.locator('.mdedit__level-item[data-level="4"]').click();
await page.waitForTimeout(150);
const after = await value();
await page.evaluate(() => window.editor.focus());
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
ok("undo takes the level back", after !== before && (await value()) === before, JSON.stringify([before, after, await value()]));

// A tap is the gesture on a phone, and it opens the same chooser.
const touch = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 780 } });
const phone = await touch.newPage();
await phone.goto(URL, { waitUntil: "networkidle" });
await phone.waitForSelector(".mdedit__surface");
await phone.evaluate(() => {
	window.editor.toggleMarks(false);
	window.editor.value = "## A heading here\n\nProse.\n";
});
await phone.waitForTimeout(150);
await phone.locator(".mdedit__level").first().tap();
await phone.waitForTimeout(200);
ok("a tap on the label opens the chooser", (await phone.locator(".mdedit__levels").count()) === 1);
await phone.locator('.mdedit__level-item[data-level="3"]').tap();
await phone.waitForTimeout(200);
ok("and a tap in it writes the line", (await phone.evaluate(() => window.editor.value)).startsWith("### A heading"));
await touch.close();

await browser.close();
ok("the page stayed quiet", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((p) => `  ${p}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
