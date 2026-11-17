// A fenced block with its fences hidden: the language on the top edge of the
// block, and the menu that writes another word onto the fence.

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

await marks(false);

// ── The label ─────────────────────────────────────────────────────────────

const DOC = '```go\n// shipped counts.\necho "hello"\n```\n\nProse.\n';
await set(DOC, 0);

const drawn = await page.evaluate(() => {
	const lines = [...document.querySelectorAll(".mdedit-fence")];
	const open = lines.find((line) => !line.hasAttribute("data-in"));
	const close = lines.find((line) => line.hasAttribute("data-in"));
	const label = open?.querySelector(".mdedit__lang");
	const box = open?.getBoundingClientRect();
	const at = label?.getBoundingClientRect();
	return {
		labels: document.querySelectorAll(".mdedit__lang").length,
		lang: label?.dataset.lang,
		printed: label ? getComputedStyle(label, "::after").content : "",
		text: label?.textContent,
		ticks: open ? getComputedStyle(open.querySelector(".mdedit-mark")).display : "",
		closing: close ? Boolean(close.querySelector(".mdedit__lang")) : null,
		top: at && box ? Math.round(at.top - box.top) : null,
		right: at && box ? Math.round(box.right - at.right) : null,
		open: open?.getBoundingClientRect().height,
		close: close?.getBoundingClientRect().height,
	};
});
ok("each block carries one label", drawn.labels === 1, JSON.stringify(drawn));
ok("the label prints the language the fence names", drawn.lang === "go" && drawn.printed.includes("go"), JSON.stringify(drawn));
ok("the fence characters are hidden", drawn.ticks === "none", drawn.ticks);
// The surface answers the document out of its characters, so a label that
// held one would be in what the form posts.
ok("the label carries no characters of the document", drawn.text === "", JSON.stringify(drawn.text));
ok("a closing fence carries none", drawn.closing === false, JSON.stringify(drawn.closing));
ok("it stands at the top right of the block", drawn.top < 8 && drawn.right < 12, JSON.stringify(drawn));
ok("both fences keep a line to hold the caret", drawn.open > 12 && drawn.close > 4, JSON.stringify(drawn));
ok("nothing was rewritten", (await value()) === DOC, JSON.stringify(await value()));

// ── The menu ──────────────────────────────────────────────────────────────

await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);

const menu = await page.evaluate(() => ({
	items: [...document.querySelectorAll(".mdedit__lang-item")].map((item) => item.dataset.language),
	selected: document.querySelector('.mdedit__lang-item[aria-selected="true"]')?.dataset.language,
	first: document.querySelector(".mdedit__lang-item")?.textContent,
	filter: document.querySelector(".mdedit__lang-filter")?.placeholder,
	focused: document.activeElement?.className,
}));
ok("the label opens the languages", menu.items.includes("go") && menu.items.includes("bash") && menu.items.includes("yaml"), JSON.stringify(menu.items));
ok("the plain entry comes first", menu.items[0] === "" && menu.first === "Plain text", JSON.stringify(menu));
ok("with the one the fence names marked", menu.selected === "go", JSON.stringify(menu.selected));
ok("a field above the list takes a word", menu.filter === "Filter or type a language" && menu.focused === "mdedit__lang-filter", JSON.stringify(menu));

await page.locator('.mdedit__lang-item[data-language="bash"]').click();
await page.waitForTimeout(200);
ok("a language in it writes the fence", (await value()).startsWith("```bash\n"), await value());
ok("the chooser goes away", (await page.locator(".mdedit__langs").count()) === 0);
ok("and the label says what the fence now names", (await page.evaluate(() => document.querySelector(".mdedit__lang").dataset.lang)) === "bash");

const painted = await page.evaluate(() => [...document.querySelectorAll(".mdedit-codeline span")].map((span) => [span.className, span.textContent]));
ok("the code below is painted in the new bag", painted.some(([name, text]) => name === "mdedit-c-builtin" && text === "echo"), JSON.stringify(painted));

// ── Plain text and an alias ───────────────────────────────────────────────

await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);
await page.locator('.mdedit__lang-item[data-language=""]').click();
await page.waitForTimeout(200);
ok("plain text takes the language off the fence", (await value()).startsWith("```\n"), await value());
ok("and the label says so", (await page.evaluate(() => document.querySelector(".mdedit__lang").dataset.lang)) === "text");

await set("```golang\nfunc main() {}\n```\n", 0);
ok("an alias prints the name it stands for", (await page.evaluate(() => document.querySelector(".mdedit__lang").dataset.lang)) === "go");
await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);
ok("and the menu marks it", (await page.evaluate(() => document.querySelector('.mdedit__lang-item[aria-selected="true"]')?.dataset.language)) === "go");
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
ok("Escape closes it", (await page.locator(".mdedit__langs").count()) === 0);

// ── The field: a filter, and a word of the writer's own ───────────────────

await set("```go\nfunc main() {}\n```\n", 0);
await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);
await page.keyboard.type("ya");
await page.waitForTimeout(100);
const filtered = await page.evaluate(() => [...document.querySelectorAll(".mdedit__lang-item")].filter((item) => !item.hidden).map((item) => item.dataset.language));
ok("typing filters the list", filtered.join(",") === "yaml", JSON.stringify(filtered));

await page.keyboard.press("Enter");
await page.waitForTimeout(200);
ok("Enter writes the word the field holds", (await value()).startsWith("```yaml\n"), await value());
ok("and the menu goes away", (await page.locator(".mdedit__langs").count()) === 0);

await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);
await page.keyboard.type("nix");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
ok("a word the list does not hold is written too", (await value()).startsWith("```nix\n"), await value());
ok("and its block says it", (await page.evaluate(() => document.querySelector(".mdedit__lang").dataset.lang)) === "nix");

await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);
await page.keyboard.type("text");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
ok("typing text leaves the fence without a language", (await value()).startsWith("```\n"), await value());

// A fence that names no language is plain text: no word, no colour.
await set("```\nmkdir -p build && go build ./...\n```\n", 0);
const plain = await page.evaluate(() => ({
	lang: document.querySelector(".mdedit__lang").dataset.lang,
	coloured: document.querySelectorAll(".mdedit-codeline [class^='mdedit-c-']").length,
}));
ok("a fence with no language says text", plain.lang === "text", JSON.stringify(plain));
ok("and its lines are not coloured", plain.coloured === 0, JSON.stringify(plain));

// A fence written with more than the language keeps the rest of the string.
await set("```go linenos\nfunc main() {}\n```\n", 0);
await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);
await page.locator('.mdedit__lang-item[data-language="yaml"]').click();
await page.waitForTimeout(200);
ok("the info string after the word stays", (await value()).startsWith("```yaml linenos\n"), await value());

// ── Undo, and the view with the markers shown ─────────────────────────────

await set(DOC, 0);
const before = await value();
await page.locator(".mdedit__lang").first().click();
await page.waitForTimeout(150);
await page.locator('.mdedit__lang-item[data-language="python"]').click();
await page.waitForTimeout(200);
const after = await value();
await page.evaluate(() => window.editor.focus());
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
ok("undo takes the language back", after !== before && (await value()) === before, JSON.stringify([before, after, await value()]));

await marks(true);
const shown = await page.evaluate(() => {
	const label = document.querySelector(".mdedit__lang");
	return {
		label: label ? getComputedStyle(label).display : null,
		ticks: getComputedStyle(document.querySelector(".mdedit-fence .mdedit-mark")).display,
	};
});
ok("with the markup shown the fence says the language itself", shown.label === "none" && shown.ticks !== "none", JSON.stringify(shown));
await marks(false);

// A tap is the gesture on a phone, and it opens the same menu.
const touch = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 780 } });
const phone = await touch.newPage();
await phone.goto(URL, { waitUntil: "networkidle" });
await phone.waitForSelector(".mdedit__surface");
await phone.evaluate(() => {
	window.editor.toggleMarks(false);
	window.editor.value = "```go\nfunc main() {}\n```\n";
});
await phone.waitForTimeout(150);
await phone.locator(".mdedit__lang").first().tap();
await phone.waitForTimeout(200);
ok("a tap on the label opens the menu", (await phone.locator(".mdedit__langs").count()) === 1);
await phone.locator('.mdedit__lang-item[data-language="php"]').tap();
await phone.waitForTimeout(200);
ok("and a tap in it writes the fence", (await phone.evaluate(() => window.editor.value)).startsWith("```php"));
await touch.close();

await browser.close();
ok("the page stayed quiet", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((p) => `  ${p}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
