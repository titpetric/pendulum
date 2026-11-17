// Uploads: what a file looks like on its way in, what happens when it fails,
// the queue over ten of them at once, and what a resolved marker draws.
//
// The document is the markdown and nothing else. Every check here reads the
// markdown back as well as the drawing, because a preview that added a
// character would be a preview the server stored.

import { chromium } from "./lib.mjs";

const PORT = process.env.MDEDIT_PORT ?? "18899";
const URL = `http://127.0.0.1:${PORT}/edit?file=welcome.md`;

const problems = [];
const ok = (label, pass, detail = "") => {
	console.log(`${pass ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
	if (!pass) problems.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });

const noise = [];
page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

const set = (markdown, at = markdown.length) =>
	page.evaluate(
		([text, caret]) => {
			window.editor.value = text;
			window.editor.toggleMarks(true);
			window.editor.focus();
			window.editor.source.select(caret);
		},
		[markdown, at],
	);
const value = () => page.evaluate(() => window.editor.value);
const loosen = (text) => text.replace(/\d+/g, "n");

// paste puts one file on the surface the way a writer does.
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

// The demo server stores what it is given; this stands in for it so a check
// can hold a request open, refuse one, or let it through on cue.
let mode = "ok";
let failure = "the server refused this one";
let stored = 0;
let gates = [];
const hold = () => new Promise((resume) => gates.push(resume));
const release = () => {
	const waiting = gates;
	gates = [];
	for (const resume of waiting) {
		resume();
	}
};

const uploadRoute = async (route) => {
	try {
		if (mode === "hold") {
			await hold();
		}
		if (mode === "fail") {
			await route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({ error: failure }),
			});
			return;
		}

		stored += 1;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ url: `/uploads/stored-${stored}.png` }),
		});
	} catch {
		// The editor was destroyed and the request went with it.
	}
};
await page.route("**/upload", uploadRoute);

// ── 1. the two words a preview says ──────────────────────────────────────

const words = await page.evaluate(async () => {
	const api = await import("/assets/dist/mdedit.js");
	return [api.size(0), api.size(1536), api.size(400000), api.iconFor({ type: "audio/mpeg" }), api.iconFor({ type: "application/pdf" })];
});
ok("preview: a size reads the way a person says it", words[0] === "0 B" && words[1] === "1.5 kB" && words[2] === "391 kB", JSON.stringify(words.slice(0, 3)));
ok("preview: the icon names the kind of file", words[3] === "icon-audio" && words[4] === "icon-file", JSON.stringify(words.slice(3)));

// ── 2. a file on its way ─────────────────────────────────────────────────

mode = "hold";
await set("here\n\n");
await paste("late.png", "image/png", new Array(2049).join("x"));
await page.waitForTimeout(300);

const pending = await page.evaluate(() => {
	const line = document.querySelector(".mdedit__line[data-upload]");
	const badge = line?.querySelector(".mdedit__upload");
	return {
		line: line?.textContent,
		badge: badge?.textContent,
		state: badge?.dataset.state,
		name: badge?.querySelector(".mdedit__upload-name")?.dataset.name,
		size: badge?.querySelector(".mdedit__upload-size")?.dataset.size,
		bars: badge?.querySelectorAll(".mdedit__upload-bar").length,
		// The placeholder is a promise, and the preview is that promise being
		// kept: its markdown steps out of view while the file is on its way,
		// and stays in the line all the same.
		placeholder: (() => {
			const span = line?.querySelector(".mdedit-image[data-placeholder]");
			return span ? getComputedStyle(span).display : null;
		})(),
		// The frame turns while the bytes travel, and only then.
		frame: badge ? getComputedStyle(badge).animationName : null,
		count: document.querySelectorAll(".mdedit__upload").length,
		value: window.editor.value,
	};
});
ok(
	"preview: a file on its way draws in place of its placeholder",
	pending.count === 1 &&
		pending.state === "start" &&
		pending.bars === 1 &&
		pending.placeholder === "none" &&
		pending.frame === "mdedit-upload-angle",
	JSON.stringify(pending),
);
ok(
	"preview: and puts no character into the document",
	/^!?\[uploading \d+\.\.\.\]\(\)$/.test(pending.line ?? "") &&
		pending.badge === "" &&
		/^here\n\n!?\[uploading \d+\.\.\.\]\(\)\n$/.test(pending.value),
	JSON.stringify(pending),
);
ok(
	"preview: the name and the size ride in attributes",
	pending.name === "late.png" && pending.size === "2 kB",
	JSON.stringify({ name: pending.name, size: pending.size }),
);

// The time left is drawn from the rate the request has kept, and a mocked
// route reports no bytes, so the record is given one: the same span a real
// request paints.
const estimate = await page.evaluate(() => {
	const record = window.editor.uploads.list()[0];
	record.eta = 12;
	window.editor.uploads.draw(record);
	const badge = document.querySelector(".mdedit__upload");
	const eta = badge.querySelector(".mdedit__upload-eta");
	return {
		said: eta.dataset.eta,
		shown: getComputedStyle(eta).display !== "none",
		label: badge.getAttribute("aria-label"),
		text: badge.textContent,
	};
});
ok(
	"preview: the time left stands after the bar, and says itself once",
	estimate.said === "ETA 12s" &&
		estimate.shown &&
		estimate.label.includes("ETA 12s") &&
		estimate.text === "",
	JSON.stringify(estimate),
);
await page.evaluate(() => {
	const record = window.editor.uploads.list()[0];
	record.eta = null;
	window.editor.uploads.draw(record);
});
await page.locator(".mdedit").screenshot({ path: "/tmp/mdedit-upload.png" });

// The pilcrow hides the markup; a preview is not markup and stays.
await page.click(".mdedit__tool--marks");
await page.waitForTimeout(150);
const quiet = await page.evaluate(() => ({
	previews: document.querySelectorAll(".mdedit__upload").length,
	marks: [...document.querySelectorAll(".mdedit__line[data-upload] .mdedit-mark")].filter(
		(node) => getComputedStyle(node).display !== "none",
	).length,
	placeholder: (() => {
		const span = document.querySelector(".mdedit__line[data-upload] .mdedit-image[data-placeholder]");
		return span ? getComputedStyle(span).display : null;
	})(),
	value: window.editor.value,
}));
ok(
	"preview: it stays when the markers hide, and the placeholder does not come back",
	quiet.previews === 1 && quiet.marks === 0 && quiet.placeholder === "none" && quiet.value === pending.value,
	JSON.stringify(quiet),
);
await page.click(".mdedit__tool--marks");

mode = "ok";
release();
await page.waitForFunction(() => !document.querySelector(".mdedit__upload"), null, { timeout: 5000 });
const settled = await page.evaluate(() => ({
	value: window.editor.value,
	pictures: document.querySelectorAll(".mdedit__surface .mdedit__pic").length,
}));
ok(
	"preview: the stored address replaces the placeholder",
	/^here\n\n!\[\]\(\/uploads\/stored-\d+\.png\)\n$/.test(settled.value) && settled.pictures === 1,
	JSON.stringify(settled),
);

// ── 3. ten files at once ─────────────────────────────────────────────────

mode = "hold";
await set("");
await page.evaluate(() => {
	window.all = Promise.all(
		Array.from(
			{ length: 10 },
			(_, at) => new File([new Array(1025).join("x")], `g${at + 1}.png`, { type: "image/png" }),
		).map((file) => window.editor.upload(file)),
	);
});
await page.waitForTimeout(500);

const ten = await page.evaluate(() => ({
	previews: document.querySelectorAll(".mdedit__upload").length,
	lines: document.querySelectorAll(".mdedit__line[data-upload]").length,
	ids: new Set([...document.querySelectorAll(".mdedit__upload")].map((node) => node.dataset.upload)).size,
	names: [...document.querySelectorAll(".mdedit__upload-name")].map((node) => node.dataset.name),
	uploading: (window.editor.value.match(/uploading/g) ?? []).length,
}));
ok(
	"ten: every file has a line and a preview of its own",
	ten.previews === 10 && ten.lines === 10 && ten.ids === 10 && ten.uploading === 10,
	JSON.stringify(ten),
);
ok(
	"ten: and each preview names its own file",
	ten.names.length === 10 && new Set(ten.names).size === 10 && ten.names[0] === "g1.png",
	JSON.stringify(ten.names),
);

mode = "ok";
release();
await page.waitForFunction(() => document.querySelectorAll(".mdedit__upload").length === 0, null, { timeout: 8000 });
const arrived = await page.evaluate(() => ({
	pictures: document.querySelectorAll(".mdedit__surface .mdedit__pic").length,
	uploading: window.editor.value.includes("uploading"),
	markers: (window.editor.value.match(/!\[\]\(\/uploads\//g) ?? []).length,
}));
ok(
	"ten: all ten land as pictures, and none is left uploading",
	arrived.pictures === 10 && arrived.markers === 10 && !arrived.uploading,
	JSON.stringify(arrived),
);

// ── 4. the bar fills, and the document does not move ─────────────────────

// A mocked route puts no bytes on a socket, and bytes on a socket are what
// progress reports. Against the demo server itself, with a limit lifted.
await page.unroute("**/upload", uploadRoute);
await page.evaluate(() => {
	window.editor.uploads.options.accept = () => true;
	window.editor.uploads.options.maxBytes = 0;
	window.watch = [];
	window.editor.on("upload", (event) => {
		if (event.state !== "progress") {
			return;
		}
		const badge = document.querySelector(".mdedit__upload");
		window.watch.push({
			caret: window.editor.selection.start,
			value: window.editor.value,
			state: badge?.dataset.state,
			known: badge?.dataset.known,
			now: badge?.querySelector(".mdedit__upload-bar")?.getAttribute("aria-valuenow"),
			width: badge?.querySelector(".mdedit__upload-fill")?.style.width,
		});
	});
});
const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx8gAAAABJRU5ErkJggg==";
await set("first line\n\nsecond line\n");
await page.evaluate(
	([png, extra]) => {
		const head = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([head, new Uint8Array(extra)], "watch.png", { type: "image/png" }));
		document
			.querySelector(".mdedit__surface")
			.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
	},
	[PNG, 4000000],
);
await page.waitForFunction(() => window.watch.length > 0, null, { timeout: 20000 });
const watch = await page.evaluate(() => window.watch);
ok(
	"progress: the bar fills while the request runs",
	watch.some(
		(event) =>
			event.known === "true" &&
			Number(event.now) >= 0 &&
			Number(event.now) <= 100 &&
			event.width !== "" &&
			event.state === "progress",
	),
	JSON.stringify(watch[0]),
);
ok(
	"progress: and neither the document nor the caret moves for it",
	watch.every((event) => event.caret === watch[0].caret && event.value === watch[0].value),
	JSON.stringify({ caret: watch[0].caret, last: watch[watch.length - 1].caret }),
);
await page.waitForFunction(() => !document.querySelector(".mdedit__upload"), null, { timeout: 30000 });
ok("progress: then it lands, and the drawing goes", (await value()).includes("watch.png") || (await value()).includes("![]("), loosen(await value()));

await page.route("**/upload", uploadRoute);

// ── 5. a request that fails ──────────────────────────────────────────────

mode = "fail";
failure = "the server refused this one";
await set("here\n");
await paste("photo.png", "image/png");
await page.waitForTimeout(500);

const failed = await page.evaluate(() => {
	const badge = document.querySelector(".mdedit__upload");
	return {
		value: window.editor.value,
		state: badge?.dataset.state,
		error: badge?.querySelector(".mdedit__upload-error")?.dataset.error,
		retry: Boolean(badge?.querySelector(".mdedit__tool--upload-retry")),
		uploading: window.editor.value.includes("uploading"),
	};
});
ok(
	"failure: the document keeps the placeholder, and no reason is written into it",
	/^here\n!\[uploading \d+\.\.\.\]\(\)\n$/.test(failed.value) && !failed.value.includes(">") && failed.uploading,
	JSON.stringify(failed.value),
);
ok(
	"failure: the preview alone says why, with one way back",
	failed.state === "failed" && failed.error === "the server refused this one" && failed.retry,
	JSON.stringify(failed),
);
await page.locator(".mdedit").screenshot({ path: "/tmp/mdedit-upload-failed.png" });

// ── 6. two failures that read the same ───────────────────────────────────

await set("here\n");
await page.evaluate(async () => {
	await window.editor.upload(new File(["one"], "one.png", { type: "image/png" }));
	window.editor.source.select(window.editor.value.length);
	await window.editor.upload(new File(["two"], "two.png", { type: "image/png" }));
});
await page.waitForTimeout(400);

const twice = await page.evaluate(() => ({
	value: window.editor.value,
	badges: document.querySelectorAll(".mdedit__upload").length,
	ids: [...document.querySelectorAll(".mdedit__upload")].map((node) => node.dataset.upload),
}));
const placeholders = twice.value.split("\n").filter((line) => /^!\[uploading \d+\.\.\.\]\(\)$/.test(line));
ok(
	"twice: two failures are two records, each on its own placeholder",
	placeholders.length === 2 && twice.badges === 2 && new Set(twice.ids).size === 2,
	JSON.stringify(twice),
);

// A retry answers for the line it stands on, and for no other.
mode = "ok";
await page.locator(".mdedit__upload[data-state=failed] .mdedit__tool--upload-retry").first().click();
await page.setInputFiles(".mdedit input[type=file]", "docs/table.png");
await page.waitForTimeout(600);
const retried = await page.evaluate(() => ({
	value: window.editor.value,
	badges: document.querySelectorAll(".mdedit__upload").length,
}));
ok(
	"twice: a retry resolves the line it was pressed on",
	retried.value.split("\n").filter((line) => /^!\[uploading \d+\.\.\.\]\(\)$/.test(line)).length === 1 &&
		/!\[\]\(\/uploads\/stored-\d+\.png\)/.test(retried.value) &&
		retried.badges === 1,
	JSON.stringify(retried),
);

mode = "ok";
await page.locator(".mdedit__upload[data-state=failed] .mdedit__tool--upload-retry").first().click();
await page.setInputFiles(".mdedit input[type=file]", "docs/render.png");
await page.waitForTimeout(600);
const both = await page.evaluate(() => ({
	value: window.editor.value,
	badges: document.querySelectorAll(".mdedit__upload").length,
	pictures: document.querySelectorAll(".mdedit__surface .mdedit__pic").length,
}));
ok(
	"twice: and the second can follow the first",
	!both.value.includes("uploading") && both.badges === 0 && both.pictures === 2,
	JSON.stringify(both),
);

// ── 7. a retry that fails too ────────────────────────────────────────────

mode = "fail";
failure = "refused";
await set("");
await paste("again.png", "image/png");
await page.waitForTimeout(400);
mode = "fail";
failure = "still refusing";
const beforeAgain = await value();
await page.locator(".mdedit__upload[data-state=failed] .mdedit__tool--upload-retry").first().click();
await page.setInputFiles(".mdedit input[type=file]", "docs/table.png");
await page.waitForTimeout(500);

const again = await page.evaluate(() => ({
	value: window.editor.value,
	state: document.querySelector(".mdedit__upload")?.dataset.state,
	error: document.querySelector(".mdedit__upload-error")?.dataset.error,
}));
ok(
	"retry: a second failure leaves the document as it was and says why on the preview",
	again.value === beforeAgain && again.state === "failed" && again.error === "still refusing",
	JSON.stringify({ again, beforeAgain }),
);

// ── 8. a file the editor will not take ───────────────────────────────────

await page.evaluate(() => {
	window.editor.uploads.options.accept = ["image/"];
});
await set("here\n");
await page.evaluate(() => window.editor.upload(new File(["words"], "notes.txt", { type: "text/plain" })));
await page.waitForTimeout(300);
const refused = await page.evaluate(() => ({
	value: window.editor.value,
	state: document.querySelector(".mdedit__upload")?.dataset.state,
	error: document.querySelector(".mdedit__upload-error")?.dataset.error,
}));
ok(
	"refusal: the document keeps the placeholder and writes no reason",
	/^here\n!?\[uploading \d+\.\.\.\]\(\)\n$/.test(refused.value),
	JSON.stringify(refused.value),
);
ok(
	"refusal: and the preview on it says why",
	refused.state === "failed" && refused.error === "This server stores png, jpeg, gif, webp and svg.",
	JSON.stringify(refused),
);
await page.evaluate(() => {
	window.editor.uploads.options.accept = () => true;
});

// ── 9. a writer who edits the placeholder away ───────────────────────────

mode = "hold";
await set("watch\n");
await paste("gone.png", "image/png");
await page.waitForTimeout(300);
await page.evaluate(() => {
	window.editor.value = "the writer's text\n";
});
await page.waitForTimeout(150);
mode = "ok";
release();
await page.waitForTimeout(500);
const rewritten = await page.evaluate(() => ({
	value: window.editor.value,
	badges: document.querySelectorAll(".mdedit__upload").length,
}));
ok(
	"flight: an answer for a line the writer edited away writes nothing",
	rewritten.value === "the writer's text\n" && rewritten.badges === 0,
	JSON.stringify(rewritten),
);

// ── 10. a rebuild reattaches the preview ─────────────────────────────────

mode = "hold";
await set("again\n");
await paste("kept.png", "image/png");
await page.waitForTimeout(300);
const before = await page.evaluate(() => document.querySelector(".mdedit__upload")?.dataset.upload);
await page.evaluate(() => {
	window.editor.value = window.editor.value;
});
await page.waitForTimeout(200);
const after = await page.evaluate(() => document.querySelector(".mdedit__upload")?.dataset.upload);
ok("rebuild: the same record is drawn on the line again", before !== undefined && before === after, JSON.stringify({ before, after }));

mode = "ok";
release();
await page.waitForFunction(() => !document.querySelector(".mdedit__upload"), null, { timeout: 5000 });
const finished = await page.evaluate(() => ({
	value: window.editor.value,
	badges: document.querySelectorAll(".mdedit__upload").length,
}));
ok(
	"rebuild: and when it lands the line is plain markdown",
	finished.badges === 0 && finished.value.startsWith("again\n![]("),
	JSON.stringify(finished),
);

// ── 11. the queue over ten files ─────────────────────────────────────────

mode = "hold";
await set("queue\n");
await page.click(".mdedit__tool--upload");
await page.waitForSelector(".mdedit__queue");
await page.click(".mdedit__tool--queue-choose");
await page.setInputFiles(".mdedit input[type=file]", ["docs/table.png", "docs/render.png"]);
await page.waitForTimeout(500);

const queue = await page.evaluate(() => ({
	open: Boolean(document.querySelector(".mdedit__queue")),
	rows: document.querySelectorAll(".mdedit__queue-row").length,
	names: [...document.querySelectorAll(".mdedit__queue-name")].map((node) => node.textContent),
	sizes: [...document.querySelectorAll(".mdedit__queue-size")].map((node) => node.textContent),
	states: [...document.querySelectorAll(".mdedit__queue-row")].map((node) => node.dataset.state),
	bars: document.querySelectorAll(".mdedit__queue-bar").length,
	empty: document.querySelector(".mdedit__queue-empty")?.hidden,
}));
ok(
	"queue: the tool opens a panel of what is on its way",
	queue.open && queue.rows === 2 && queue.bars === 2 && queue.empty === true,
	JSON.stringify(queue),
);
ok(
	"queue: every row names its file and weighs it",
	queue.names.includes("table.png") && queue.names.includes("render.png") && queue.sizes.every((size) => /^\d+(\.\d)? (B|kB|MB)$/.test(size)),
	JSON.stringify(queue),
);
await page.locator(".mdedit__queue").screenshot({ path: "/tmp/mdedit-upload-queue.png" });

mode = "ok";
release();
await page.waitForFunction(
	() => document.querySelectorAll(".mdedit__queue-row[data-state=done]").length === 2,
	null,
	{ timeout: 6000 },
);
const queued = await page.evaluate(() => ({
	states: [...document.querySelectorAll(".mdedit__queue-state")].map((node) => node.textContent),
	actions: [...document.querySelectorAll(".mdedit__queue-action")].filter((node) => !node.hidden).length,
	value: window.editor.value,
}));
ok(
	"queue: a landed file says so and offers to be put away",
	queued.states.every((text) => text === "Uploaded") && queued.actions === 2,
	JSON.stringify(queued),
);
ok("queue: the document holds the markers it wrote", (queued.value.match(/!\[\]\(\/uploads\//g) ?? []).length >= 2, JSON.stringify(queued.value));

await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok("queue: Escape closes it", await page.evaluate(() => !document.querySelector(".mdedit__queue")));

// ── 12. what a resolved marker draws ─────────────────────────────────────

const DOC = [
	"# Resolved",
	"",
	"![shot](/assets/docs/table.png)",
	"",
	"[Episode](/assets/ep3.mp3)",
	"",
	"[Capture](/assets/clip.mp4)",
	"",
	"[the paper](/assets/docs/notes.pdf)",
	"",
	"inline ![logo](/assets/docs/mdedit-logo.png) here",
	"",
].join("\n");
await set(DOC);
await page.waitForTimeout(400);

const drawn = await page.evaluate(() => ({
	pictures: document.querySelectorAll(".mdedit__surface .mdedit__pic").length,
	players: [...document.querySelectorAll(".mdedit__surface .mdedit__media")].map((node) => node.tagName),
	bars: [...document.querySelectorAll(".mdedit__embed-bar")].map((bar) => bar.querySelector(".mdedit__embed-kind")?.dataset.kind),
	chip: (() => {
		const node = document.querySelector(".mdedit__file");
		return node && { name: node.querySelector(".mdedit__file-name")?.dataset.name, ext: node.querySelector(".mdedit__file-ext")?.dataset.ext };
	})(),
	inline: (() => {
		const line = [...document.querySelectorAll(".mdedit__line")].find((node) => node.textContent.includes("inline ![logo]"));
		return getComputedStyle(line.querySelector(".mdedit__pic")).display;
	})(),
	value: window.editor.value,
}));
ok(
	"resolved: a picture, a recording, a capture and a paper each draw their own",
	drawn.pictures === 2 && drawn.players.join(",") === "AUDIO,VIDEO" && drawn.chip?.name === "the paper" && drawn.chip?.ext === "PDF",
	JSON.stringify(drawn),
);
ok(
	"resolved: each block names its kind in the bar",
	drawn.bars.length === 4 && drawn.bars.join(",") === "Image,Audio,Video,File",
	JSON.stringify(drawn.bars),
);
ok("resolved: an inline picture stays in its sentence", drawn.inline === "inline" && drawn.pictures === 2, JSON.stringify(drawn.inline));

// The source view of one line: the markdown it is, for that line alone.
await page.evaluate(() => {
	const line = [...document.querySelectorAll(".mdedit__line[data-embed]")].find((node) => node.textContent.includes("notes.pdf"));
	line.querySelector(".mdedit__tool--embed-source").click();
});
await page.waitForTimeout(200);
const sourced = await page.evaluate(() => {
	const line = [...document.querySelectorAll(".mdedit__line[data-embed]")].find((node) => node.textContent.includes("notes.pdf"));
	const chip = line.querySelector(".mdedit__file");
	const mark = line.querySelector(".mdedit-mark");
	return {
		on: line.hasAttribute("data-source"),
		chip: getComputedStyle(chip).display,
		mark: getComputedStyle(mark).display,
		pressed: line.querySelector(".mdedit__tool--embed-source").getAttribute("aria-pressed"),
		value: window.editor.value,
	};
});
ok(
	"source: one line reads as its markdown and the rest keep their previews",
	sourced.on && sourced.chip === "none" && sourced.mark !== "none" && sourced.pressed === "true" && sourced.value === DOC,
	JSON.stringify(sourced),
);

await page.evaluate(() => window.editor.toggleMarks(false));
await page.waitForTimeout(150);
const quietSource = await page.evaluate(() => {
	const line = [...document.querySelectorAll(".mdedit__line[data-embed]")].find((node) => node.textContent.includes("notes.pdf"));
	return {
		mark: getComputedStyle(line.querySelector(".mdedit-mark")).display,
		other: [...document.querySelectorAll(".mdedit__line[data-embed]")].filter(
			(node) => node !== line && [...node.querySelectorAll(".mdedit-mark")].some((mark) => getComputedStyle(mark).display !== "none"),
		).length,
	};
});
ok("source: with the markup hidden, that line alone shows it", quietSource.mark !== "none" && quietSource.other === 0, JSON.stringify(quietSource));
await page.evaluate(() => window.editor.toggleMarks(true));

// Back to the preview.
await page.evaluate(() => {
	const line = [...document.querySelectorAll(".mdedit__line[data-embed]")].find((node) => node.textContent.includes("notes.pdf"));
	line.querySelector(".mdedit__tool--embed-source").click();
});
await page.waitForTimeout(200);
ok(
	"source: and back again",
	await page.evaluate(() => getComputedStyle(document.querySelector(".mdedit__file")).display !== "none"),
);

// Delete takes the line and its newline, and nothing else.
await page.evaluate(() => {
	const line = [...document.querySelectorAll(".mdedit__line[data-embed]")].find((node) => node.textContent.includes("ep3.mp3"));
	line.querySelector(".mdedit__tool--embed-delete").click();
});
await page.waitForTimeout(200);
const deleted = await page.evaluate(() => ({
	value: window.editor.value,
	players: document.querySelectorAll(".mdedit__surface .mdedit__media").length,
}));
ok(
	"delete: the line goes and the rest of the document stays",
	!deleted.value.includes("ep3.mp3") &&
		deleted.value.includes("clip.mp4") &&
		deleted.value.includes("notes.pdf") &&
		deleted.players === 1,
	JSON.stringify(deleted),
);

// ── 13. an editor destroyed with a request on its way ────────────────────

mode = "hold";
await set("destroy\n");
await paste("last.png", "image/png");
await page.waitForTimeout(300);
await page.evaluate(() => window.editor.destroy());
mode = "ok";
release();
await page.waitForTimeout(600);
const destroyed = await page.evaluate(() => ({
	editor: Boolean(document.querySelector(".mdedit")),
	field: document.querySelector("textarea[data-markdown]")?.hidden,
}));
ok("destroy: the editor goes and the field comes back", !destroyed.editor && destroyed.field === false, JSON.stringify(destroyed));

await browser.close();
ok("the page raised nothing", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((one) => `  ${one}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
