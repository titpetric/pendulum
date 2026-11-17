// The last pass: a document long enough to feel, the ways an upload fails,
// and two editors on one page.

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
let faking = false;
page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));
page.on("console", (message) => {
	if (!faking && message.type() === "error") noise.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

// ── 1. a long document ────────────────────────────────────────────────────

const LONG = Array.from({ length: 400 }, (_, index) =>
	index % 10 === 0
		? `## Section ${index / 10}`
		: index % 10 === 5
			? `| a${index} | b${index} |\n| --- | --- |\n| 1 | 2 |`
			: `A paragraph of prose, number ${index}, with **bold** and \`code\` in it.`,
).join("\n\n");

const loading = await page.evaluate((text) => {
	const started = performance.now();
	window.editor.value = text;
	return { ms: Math.round(performance.now() - started), lines: window.editor.value.split("\n").length };
}, LONG);
ok("long: a document of a thousand lines loads in well under a second", loading.ms < 1000, JSON.stringify(loading));

await page.waitForTimeout(400);
await page.evaluate(() => {
	window.editor.focus();
	window.editor.source.select(0);
});
const typing = await page.evaluate(() => {
	const started = performance.now();
	return { at: started };
});
await page.keyboard.type("hello there", { delay: 0 });
const typed = await page.evaluate((started) => ({
	ms: Math.round(performance.now() - started),
	ok: window.editor.value.startsWith("hello there"),
}), typing.at);
ok("long: typing at the head of it stays responsive", typed.ok && typed.ms < 3000, JSON.stringify(typed));

// An edit at the foot is the same work as an edit at the head: only the
// lines the edit touches are built again.
const far = await page.evaluate(() => {
	window.editor.source.select(window.editor.value.length);
	const started = performance.now();
	window.editor.insert("!");
	return { ms: Math.round(performance.now() - started), tail: window.editor.value.slice(-3) };
});
ok("long: an edit at the foot costs no more than one at the head", far.ms < 500, JSON.stringify(far));

const widgets = await page.evaluate(() => document.querySelectorAll(".mdedit__widget--table").length);
ok("long: every table in it is drawn", widgets === 40, String(widgets));

// ── 2. the ways an upload fails ───────────────────────────────────────────

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx8gAAAABJRU5ErkJggg==";

const paste = (name, type, bytes = PNG, size = 0) =>
	page.evaluate(
		([file, mime, png, pad]) => {
			const data = new DataTransfer();
			const raw = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
			const body = pad ? [raw, new Uint8Array(pad)] : [raw];
			data.items.add(new File(body, file, { type: mime }));
			document
				.querySelector(".mdedit__surface")
				.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
		},
		[name, type, bytes, size],
	);

const set = (text) =>
	page.evaluate((markdown) => {
		window.editor.value = markdown;
		window.editor.focus();
		window.editor.source.select(window.editor.value.length);
	}, text);

// The document keeps the placeholder a file landed on, and whatever went
// wrong is said on the preview standing for it - never written into the
// writer's markdown.
const outcome = () =>
	page.evaluate(() => ({
		value: window.editor.value,
		state: document.querySelector(".mdedit__upload")?.dataset.state,
		error: document.querySelector(".mdedit__upload-error")?.dataset.error,
		failed: document.querySelectorAll(".mdedit__upload[data-state=failed]").length,
	}));
const placeholder = /!\[uploading \d+\.\.\.\]\(\)/;

// A file past the size the project allows never leaves the browser.
await page.evaluate(() => {
	window.editor.uploads.options.maxBytes = 1024;
});
await set("");
await paste("huge.png", "image/png", PNG, 4096);
await page.waitForTimeout(400);
const tooLarge = await outcome();
ok("uploads: a file past the limit says so and uploads nothing", placeholder.test(tooLarge.value) &&
	tooLarge.state === "failed" && /is over/i.test(tooLarge.error ?? ""), JSON.stringify(tooLarge));
await page.evaluate(() => {
	window.editor.uploads.options.maxBytes = 0;
});

// An endpoint that is not there.
faking = true;
await page.route("**/upload", (route) => route.fulfill({ status: 404, body: "no" }));
await set("");
await paste("gone.png", "image/png");
await page.waitForTimeout(600);
const missing = await outcome();
ok("uploads: an endpoint that answers 404 leaves the message off the document", placeholder.test(missing.value) &&
	missing.state === "failed" && /404|not found/i.test(missing.error ?? ""), JSON.stringify(missing));

// A request that never answers at all.
await page.unroute("**/upload");
await page.route("**/upload", (route) => route.abort("connectionrefused"));
await set("");
await paste("dead.png", "image/png");
await page.waitForTimeout(700);
const dead = await outcome();
ok("uploads: a request that cannot be made says so on the preview", placeholder.test(dead.value) &&
	dead.state === "failed" && Boolean(dead.error), JSON.stringify(dead));
await page.unroute("**/upload");
faking = false;

// Two files, one of them refused: the other still lands.
await set("");
await page.evaluate((png) => {
	const raw = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
	const data = new DataTransfer();
	data.items.add(new File([raw], "good.png", { type: "image/png" }));
	data.items.add(new File(["%PDF"], "bad.pdf", { type: "application/pdf" }));
	document
		.querySelector(".mdedit__surface")
		.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}, PNG);
await page.waitForTimeout(900);
const mixed = await page.evaluate(() => ({
	value: window.editor.value,
	placeholders: (window.editor.value.match(/!?\[uploading \d+\.\.\.\]\(\)/g) ?? []).length,
	failed: document.querySelectorAll(".mdedit__upload[data-state=failed]").length,
	error: document.querySelector(".mdedit__upload-error")?.dataset.error,
}));
ok(
	"uploads: one file refused does not take the other with it",
	/!\[\]\(\/uploads\/[^)]+\.png\)/.test(mixed.value) && mixed.placeholders === 1 &&
		mixed.failed === 1 && /png, jpeg/i.test(mixed.error ?? ""),
	JSON.stringify(mixed),
);

// ── 3. two editors on one page ────────────────────────────────────────────

const two = await page.evaluate(async () => {
	const { MarkdownEditor } = await import("/assets/dist/mdedit.js");
	const area = document.createElement("textarea");
	area.name = "second";
	area.value = "![a](/assets/docs/table.png)\n\nthe second editor\n";
	document.body.appendChild(area);
	window.second = new MarkdownEditor(area, {});
	return {
		roots: document.querySelectorAll(".mdedit").length,
		ids: [...document.querySelectorAll(".mdedit__surface")].map((node) => node.id),
		bars: [...document.querySelectorAll('[role="toolbar"]')].map((node) => node.getAttribute("aria-controls")),
	};
});
ok("two: each editor has a surface of its own and a bar that names it", two.roots === 2 && new Set(two.ids).size === 2, JSON.stringify(two));

// A tool on one bar writes in that editor and not the other.
const apart = await page.evaluate(() => {
	window.editor.value = "first";
	window.second.value = "second";
	window.second.focus();
	window.second.source.select(0, 6);
	window.second.run("bold");
	return { first: window.editor.value, second: window.second.value };
});
ok("two: a tool writes in its own editor only", apart.first === "first" && apart.second === "**second**", JSON.stringify(apart));

// The image panel opens over the picture it is asked about.
await page.evaluate(() => {
	window.second.value = "![in the second](/assets/docs/table.png)\n";
});
await page.waitForTimeout(300);
const panels = await page.evaluate(() => {
	const picture = [...document.querySelectorAll(".mdedit__pic")].pop();
	picture.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
	const open = [...document.querySelectorAll(".mdedit__image")];
	return {
		count: open.length,
		inSecond: open[0] ? open[0].closest(".mdedit") === document.querySelectorAll(".mdedit")[1] : false,
		caption: open[0]?.querySelector("input")?.value,
	};
});
ok("two: the panel opens inside the editor that holds the picture", panels.count === 1 && panels.inSecond, JSON.stringify(panels));
ok("two: and it reads that picture's caption", panels.caption === "in the second", JSON.stringify(panels.caption));

// Destroying one leaves the other working.
const after = await page.evaluate(() => {
	window.second.destroy();
	window.editor.value = "still here";
	return { roots: document.querySelectorAll(".mdedit").length, value: window.editor.value, second: document.querySelector("textarea[name=second]")?.hidden };
});
ok("two: destroying one leaves the other editing", after.roots === 1 && after.value === "still here" && after.second === false, JSON.stringify(after));

await browser.close();
ok("the page stayed quiet", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((p) => `  ${p}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
