// The block a host draws for a marker of its own: the card stands on the
// page, the marker stays the document's, and nothing the card says lands in
// what the form posts.

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

// An editor of its own, configured the way a host configures one: a marker
// syntax of the project's, and a card answered for the key in it.
await page.evaluate(async () => {
	const { MarkdownEditor } = await import("/assets/dist/mdedit.js");

	const field = document.createElement("textarea");
	field.id = "cards";
	document.body.appendChild(field);

	window.cardEditor = new MarkdownEditor(field, {
		toolbar: false,
		cards: {
			pattern: /^<!--\s*article#([0-9A-Z]{6})\s*-->$/,
			styles: ".card { border: 1px solid #333; padding: 4px; } .card b { font-weight: 700; }",
			render: (key) => {
				if (key === "GONE01") {
					return Promise.resolve('<div class="card card--gone">not available</div>');
				}
				return new Promise((answer) =>
					setTimeout(() => answer(`<div class="card"><b>Article ${key}</b><a href="/a/${key}">read it</a></div>`), 10),
				);
			},
		},
	});
});

const set = (markdown) =>
	page.evaluate((text) => {
		window.cardEditor.value = text;
	}, markdown);

const value = () => page.evaluate(() => window.cardEditor.value);

const DOC = "Before it.\n\n<!-- article#ABC123 -->\n\nAfter it.\n";
await set(DOC);
await page.waitForTimeout(150);

const drawn = await page.evaluate(() => {
	const line = document.querySelector("#cards ~ .mdedit .mdedit-card, .mdedit .mdedit-card");
	const holder = line?.querySelector(".mdedit__card");
	return {
		lines: document.querySelectorAll(".mdedit-card").length,
		key: holder?.dataset.key,
		shadow: Boolean(holder?.shadowRoot),
		inside: holder?.shadowRoot?.querySelector(".card b")?.textContent ?? "",
		text: line?.textContent ?? "",
		editable: holder?.getAttribute("contenteditable"),
	};
});
ok("a marker the host claims draws its card", drawn.lines === 1 && drawn.key === "ABC123", JSON.stringify(drawn));
ok("the card holds what the host answered", drawn.inside === "Article ABC123", JSON.stringify(drawn.inside));
ok("in a root of its own", drawn.shadow === true);
ok("and the card takes no caret", drawn.editable === "false", JSON.stringify(drawn.editable));
// The line's text is the marker and nothing the card says.
ok("the line is the marker, character for character", drawn.text === "<!-- article#ABC123 -->", JSON.stringify(drawn.text));
ok("and the document reads back as it went in", (await value()) === DOC, JSON.stringify(await value()));

const posted = await page.evaluate(() => document.getElementById("cards").value);
ok("the form posts the markdown the writer typed", posted === "Before it.\n\n<!-- article#ABC123 -->\n\nAfter it.\n", JSON.stringify(posted));

// The host's stylesheet is the only one that reaches inside.
const styled = await page.evaluate(() => {
	const holder = document.querySelector(".mdedit__card");
	const box = holder.shadowRoot.querySelector(".card");
	return { border: getComputedStyle(box).borderTopWidth, styles: holder.shadowRoot.querySelectorAll("style").length };
});
ok("the styles the host passed are in the card's root", styled.border === "1px" && styled.styles === 1, JSON.stringify(styled));

// A link in a card leaves for another tab: the editor holds an unsaved
// document.
const link = await page.evaluate(() => {
	const anchor = document.querySelector(".mdedit__card").shadowRoot.querySelector("a[href]");
	return { target: anchor.target, rel: anchor.rel };
});
ok("a link in a card opens elsewhere", link.target === "_blank" && link.rel === "noopener", JSON.stringify(link));

// The markers hide with every other marker, and the card stays.
await page.evaluate(() => window.cardEditor.toggleMarks(false));
await page.waitForTimeout(100);
const hidden = await page.evaluate(() => {
	const line = document.querySelector(".mdedit-card");
	return {
		marker: getComputedStyle(line.querySelector(".mdedit-mark")).display,
		card: getComputedStyle(line.querySelector(".mdedit__card")).display,
	};
});
ok("with the markup hidden the marker goes and the card stays", hidden.marker === "none" && hidden.card === "block", JSON.stringify(hidden));
await page.evaluate(() => window.cardEditor.toggleMarks(true));

// A marker inside a fenced block is code to show.
await set("```\n<!-- article#ABC123 -->\n```\n");
await page.waitForTimeout(100);
ok("a marker in a fenced block draws nothing", (await page.locator(".mdedit__card").count()) === 0);

// An id the host has nothing for still draws what the host answers.
await set("<!-- article#GONE01 -->\n");
await page.waitForTimeout(150);
ok(
	"what the host answers for a missing one is what shows",
	(await page.evaluate(() => document.querySelector(".mdedit__card").shadowRoot.textContent.includes("not available"))) === true,
);

// Typing the marker draws the card where it is typed.
await set("");
await page.evaluate(() => {
	window.cardEditor.focus();
	window.cardEditor.source.select(0);
});
await page.keyboard.type("<!-- article#TYPED1 -->");
await page.waitForTimeout(200);
ok("a marker typed by hand draws its card", (await page.locator(".mdedit__card").count()) === 1, await value());
ok("and the document carries the characters typed", (await value()) === "<!-- article#TYPED1 -->", JSON.stringify(await value()));

// Breaking the marker takes the card back off the page. A run of typing is
// one undo step until a word ends or the run goes quiet, so the wait is what
// makes the Backspace a step of its own.
await page.waitForTimeout(800);
await page.keyboard.press("Backspace");
await page.waitForTimeout(150);
ok("breaking the marker takes the card away", (await page.locator(".mdedit__card").count()) === 0, await value());

// Typing the character back draws it again.
await page.keyboard.type(">");
await page.waitForTimeout(200);
ok("and repairing it draws the card again", (await page.locator(".mdedit__card").count()) === 1, await value());
ok("with the line still the characters typed", (await value()) === "<!-- article#TYPED1 -->", JSON.stringify(await value()));

await browser.close();
ok("the page stayed quiet", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((p) => `  ${p}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
