// Media: a link to a file a browser can play, drawn as a player; a file that
// is neither picture nor media, linked by name; and what the uploader does
// with each of them.

import { chromium } from "./lib.mjs";

const PORT = process.env.MDEDIT_PORT ?? "18899";
const URL = `http://127.0.0.1:${PORT}/edit?file=welcome.md`;

const problems = [];
const ok = (label, pass, detail = "") => {
	console.log(`${pass ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
	if (!pass) problems.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

// The addresses in these fixtures answer nothing by design. A player
// fetching one is the browser doing its job, so a failed fetch counts as
// quiet here. A thrown error does not.
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
const players = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".mdedit__surface .mdedit__media")].map((node) => ({
			tag: node.tagName,
			src: node.getAttribute("src"),
			label: node.getAttribute("aria-label"),
			controls: node.controls,
			preload: node.preload,
			display: getComputedStyle(node).display,
		})),
	);

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx8gAAAABJRU5ErkJggg==";

// paste puts one file on the surface, the way a writer does.
const paste = (name, type, body = "bytes") =>
	page.evaluate(
		([file, mime, content]) => {
			const data = new DataTransfer();
			data.items.add(new File([content], file, { type: mime }));
			document
				.querySelector(".mdedit__surface")
				.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
		},
		[name, type, body],
	);

// pastePNG puts a real picture there, padded to whatever size a check needs.
const pastePNG = (name, pad = 0) =>
	page.evaluate(
		([png, file, extra]) => {
			const head = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
			const parts = extra ? [head, new Uint8Array(extra)] : [head];
			const data = new DataTransfer();
			data.items.add(new File(parts, file, { type: "image/png" }));
			document
				.querySelector(".mdedit__surface")
				.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
		},
		[PNG, name, pad],
	);

// ── 1. what draws a player and what does not ──────────────────────────────

const DOC = `# Media

[Episode 3](/assets/ep3.mp3)

[A capture](https://example.com/clip.mp4)

[the paper](assets/notes.pdf)

prose with [a link](https://example.com) in it.
`;

await set(DOC);
await page.waitForTimeout(300);
const drawn = await players();
ok("media: an mp3 link draws an audio player", drawn[0]?.tag === "AUDIO" && drawn[0]?.src === "/assets/ep3.mp3", JSON.stringify(drawn[0]));
ok("media: an mp4 link draws a video player, a public address included", drawn[1]?.tag === "VIDEO", JSON.stringify(drawn[1]));
ok("media: a file that is neither draws nothing", drawn.length === 2, JSON.stringify(drawn.map((one) => one.src)));
ok(
	"media: the player carries controls and fetches no more than its length",
	drawn.every((one) => one.controls && one.preload === "metadata"),
	JSON.stringify(drawn.map((one) => one.preload)),
);
ok("media: the label on the marker names the player", drawn[0]?.label === "Episode 3", JSON.stringify(drawn[0]?.label));
ok("media: the document is the markdown that went in", (await value()) === DOC, JSON.stringify((await value()).slice(0, 40)));

// An address with a query or an anchor on it still names its kind.
await set("[one](/a/track.mp3?v=2)\n\n[two](/a/clip.webm#t=30)\n\n[three](/a/page.html?x=.mp3)\n");
await page.waitForTimeout(250);
const dressed = await players();
ok(
	"media: a query or an anchor on the address does not hide the kind",
	dressed.length === 2 && dressed[0].tag === "AUDIO" && dressed[1].tag === "VIDEO",
	JSON.stringify(dressed.map((one) => one.tag)),
);

// ── 2. where a player sits ────────────────────────────────────────────────

await set("[Episode 3](/assets/ep3.mp3)\n\nlisten to [Episode 4](/assets/ep4.mp3) while you read\n");
await page.waitForTimeout(250);
const placed = await players();
ok("media: a marker alone on its line draws a block", placed[0]?.display === "block", JSON.stringify(placed[0]?.display));
ok("media: one inside a sentence stays in the sentence", placed[1]?.display === "inline", JSON.stringify(placed[1]?.display));

// The markers hidden: the player stands where the marker stood.
await page.evaluate(() => window.editor.toggleMarks(false));
await page.waitForTimeout(250);
const hidden = await page.evaluate(() => ({
	players: document.querySelectorAll(".mdedit__surface .mdedit__media").length,
	marks: [...document.querySelectorAll(".mdedit__surface .mdedit-mark")].filter(
		(node) => getComputedStyle(node).display !== "none",
	).length,
	text: document.querySelector(".mdedit__surface").innerText.includes("ep3.mp3"),
}));
ok(
	"media: with the markers hidden the player stays and the address goes",
	hidden.players === 2 && hidden.marks === 0 && !hidden.text,
	JSON.stringify(hidden),
);
await page.evaluate(() => window.editor.toggleMarks(true));

// ── 3. what the uploader writes ───────────────────────────────────────────

// The demo server stores pictures alone, so this stretch fakes what comes
// back. Under test is the markdown the editor writes.
await page.route("**/upload", (route) => {
	route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "/uploads/stored.bin" }) });
});
await page.evaluate(() => {
	window.editor.uploads.options.accept = () => true;
});

await set("");
await paste("ep3.mp3", "audio/mpeg");
await page.waitForTimeout(500);
ok("uploads: a recording lands as a link, not as an image marker", /^\[ep3\.mp3\]\(\/uploads\/[^)]+\)/.test(await value()), JSON.stringify(await value()));

await set("");
await paste("notes.pdf", "application/pdf");
await page.waitForTimeout(500);
ok("uploads: a paper lands as a link named after the file", /^\[notes\.pdf\]\(\/uploads\/[^)]+\)/.test(await value()), JSON.stringify(await value()));

await set("");
await pastePNG("shot.png");
await page.waitForTimeout(500);
ok("uploads: a picture is still a picture", /^!\[\]\(\/uploads\/[^)]+\)/.test(await value()), JSON.stringify(await value()));

// The placeholder is the shape of what replaces it, so the line does not
// change kind under the writer when the upload answers.
await page.unroute("**/upload");
await page.route("**/upload", async (route) => {
	await new Promise((wait) => setTimeout(wait, 400));
	route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "/uploads/late.mp3" }) });
});
await set("");
await paste("late.mp3", "audio/mpeg");
await page.waitForTimeout(150);
const waiting = await value();
ok("uploads: a recording waits behind a link-shaped placeholder", /^\[uploading \d+\.\.\.\]\(\)/.test(waiting), JSON.stringify(waiting));
await page.waitForTimeout(800);
ok(
	"uploads: which the stored address replaces, drawing its player",
	/^\[late\.mp3\]\(\/uploads\/late\.mp3\)/.test(await value()) && (await players()).length === 1,
	JSON.stringify(await value()),
);

// ── 4. a limit per file ───────────────────────────────────────────────────

await page.evaluate(() => {
	// A picture is held to one size and a recording to another, the way a
	// project with an hour of audio and a page of pictures has to be.
	window.editor.uploads.options.maxBytes = (file) => (file.type.startsWith("image/") ? 1024 : 8 * 1024 * 1024);
	window.editor.texts.tooLarge = (file, limit) => `${file.name} is over ${Math.round(limit / 1024)} kB.`;
});

await set("");
await pastePNG("big.png", 4096);
await page.waitForTimeout(400);
const big = await page.evaluate(() => ({
	value: window.editor.value,
	state: document.querySelector(".mdedit__upload")?.dataset.state,
	error: document.querySelector(".mdedit__upload-error")?.dataset.error,
}));
ok(
	"limits: a picture past the picture limit is refused by name and size on its preview",
	/^!?\[uploading \d+\.\.\.\]\(\)\n$/.test(big.value) && big.state === "failed" &&
		/big\.png is over 1 kB\./.test(big.error ?? ""),
	JSON.stringify(big),
);

await set("");
await paste("long.mp3", "audio/mpeg", new Array(5000).join("x"));
await page.waitForTimeout(800);
ok("limits: a recording of the same size uploads", /\[long\.mp3\]\(/.test(await value()), JSON.stringify(await value()));

// ── 5. progress, for a file worth watching ────────────────────────────────

// Against the demo server itself: a mocked route puts no bytes on a socket,
// and bytes on a socket are the whole of what this reports.
await page.unroute("**/upload");
await page.evaluate(() => {
	window.editor.uploads.options.maxBytes = 0;
	window.editor.uploads.options.accept = ["image/"];
	window.seen = [];
	window.editor.on("upload", (event) => {
		window.seen.push({ state: event.state, ratio: event.ratio ?? null, name: event.file?.name });
	});
});
await set("");
await pastePNG("watch.png", 400000);
await page.waitForTimeout(2500);
const seen = await page.evaluate(() => window.seen);
ok(
	"progress: an upload reports its start, its bytes and its end",
	seen[0]?.state === "start" &&
		seen.some((event) => event.state === "progress" && event.ratio > 0) &&
		seen[seen.length - 1]?.state === "done",
	JSON.stringify(seen.map((event) => `${event.state}${event.ratio ? `:${event.ratio.toFixed(2)}` : ""}`)),
);
ok("progress: every event names the file it is about", seen.every((event) => event.name === "watch.png"), JSON.stringify(seen[0]));

await browser.close();
ok("the page raised nothing", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((one) => `  ${one}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
