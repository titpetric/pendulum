// The browser check: everything the editor screen has to do, driven through
// chromium against a real server.
//
//	node tests/browser.mjs
//
// It builds the binary, writes a folder of its own to edit, serves it, and
// drives the page: the listing, a file opened, typing, both ways of saving,
// the dirty marker, the pilcrow, the preview pane, the scroll sync, a pasted
// image and the panel over it. Every step prints a line; the first failure
// stops the run with a non-zero status.
//
// Two environment variables point at what the machine has:
//
//	PLAYWRIGHT=/path/to/playwright/index.mjs   the module, when it is not installed here
//	CHROMIUM=/usr/lib/chromium/chromium        the browser, when playwright ships none

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT ?? (await freePort()));
const origin = `http://127.0.0.1:${port}`;

// freePort answers a port nothing holds: the machine picks it, and the server
// takes it a moment later.
function freePort() {
	return new Promise((answer) => {
		const probe = createServer();
		probe.listen(0, "127.0.0.1", () => {
			const { port: open } = probe.address();
			probe.close(() => answer(open));
		});
	});
}

const POST = `---
title: Writing in the browser
date: 2026-10-24
tags: editor, markdown
---

Pendulum edits the files in a folder and commits every save.

## What a save does

1. writes the file
2. \`git add\` and \`git commit\`, where the folder is a repository
3. says so in the bar at the top

> Nothing is uploaded anywhere. The folder is the database.

| Flag    | What it does         |
| ------- | -------------------- |
| \`-addr\` | address to listen on |

\`\`\`sh
pendulum -ext jpg,png ~/blog/content
\`\`\`

${Array.from({ length: 24 }, (_, line) => `Paragraph ${line + 1}: enough of the document to scroll both panes.`).join("\n\n")}
`;

// A 2x2 red PNG, which is enough for the uploader and for a picture that
// draws.
const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z4AAT" +
	"AxIYJgJAwDOOgHxvEUqEgAAAABJRU5ErkJggg==";

const steps = [];
let failures = 0;

function ok(name) {
	steps.push(name);
	console.log(`ok   ${name}`);
}

function fail(name, detail) {
	failures += 1;
	console.log(`FAIL ${name}: ${detail}`);
	throw new Error(`${name}: ${detail}`);
}

function is(name, got, want) {
	if (got === want) {
		ok(name);
		return;
	}

	fail(name, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function yes(name, condition, detail = "no") {
	if (condition) {
		ok(name);
		return;
	}

	fail(name, detail);
}

// ── The server ────────────────────────────────────────────────────────────

// The binary sits beside the folder being edited, not in it: what the
// listing shows is the document and nothing else.
const temp = mkdtempSync(join(tmpdir(), "pendulum-check-"));
const folder = join(temp, "contents");
mkdirSync(join(folder, "posts"), { recursive: true });
writeFileSync(join(folder, "posts", "post.md"), POST);

const binary = join(temp, "pendulum");
execFileSync("go", ["build", "-o", binary, "./cmd/pendulum"], { cwd: root, stdio: "inherit" });

// The server logs every request on stdout; only what it says on the way out
// is worth the check's output.
const server = spawn(binary, ["-addr", `127.0.0.1:${port}`, folder], { stdio: ["ignore", "pipe", "inherit"] });
let said = "";
server.stdout.on("data", (chunk) => {
	said = String(chunk);
});
server.on("exit", (code) => code && console.error(`the server stopped: ${code}: ${said.trim()}`));

async function waiting() {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			const response = await fetch(`${origin}/api/list/`);
			if (response.ok) {
				return;
			}
		} catch {
			// The server is still coming up.
		}
		await new Promise((resume) => setTimeout(resume, 100));
	}

	throw new Error("the server never answered");
}

// ── The checks ────────────────────────────────────────────────────────────

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");

let browser;
try {
	await waiting();

	browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

	const noise = [];
	page.on("pageerror", (error) => noise.push(String(error)));
	page.on("console", (message) => message.type() === "error" && noise.push(message.text()));

	// The listing.
	await page.goto(`${origin}/posts/`, { waitUntil: "networkidle" });
	is("the listing names the file", await page.textContent(".entry[data-type='file'] .name"), "post.md");

	// Opening a file.
	await page.click(".entry[data-type='file']");
	await page.waitForSelector(".mdedit__surface");
	await page.waitForFunction(() => document.querySelector("#source")?.value.length > 0);
	is("the document opens whole", await page.inputValue("#source"), POST);
	yes("the textarea stays in the page, hidden", await page.isHidden("#source"));

	// The editing surface fills its column, with the toolbar above it.
	const shape = await page.evaluate(() => {
		const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
		const pane = box(".pane--source");
		const bar = box(".mdedit__bar");
		const surface = box(".mdedit__surface");

		const element = document.querySelector(".mdedit__surface");

		return {
			width: Math.round(surface.width),
			room: Math.round(pane.width) - 32,
			bottom: Math.round(pane.bottom - surface.bottom),
			under: Math.round(surface.top - bar.bottom),
			overflow: getComputedStyle(element).overflowY,
			taller: element.scrollHeight > Math.round(surface.height),
		};
	});
	is("the surface fills the column", shape.width, shape.room);
	yes("the surface reaches the foot of the pane", Math.abs(shape.bottom) <= 17, `${shape.bottom}px short`);
	yes("the surface sits under the bar", Math.abs(shape.under) <= 1, `${shape.under}px off`);
	is("the surface scrolls itself", shape.overflow, "auto");
	yes("the document is taller than the pane", shape.taller, "nothing to scroll");

	// The preview pane: the server's render, with pendulum's own conventions
	// in it. The front matter block reads as a table there and nowhere else.
	await page.waitForSelector(".preview table");
	yes(
		"the preview renders the front matter as a table",
		(await page.textContent(".preview table")).includes("Writing in the browser"),
	);

	// Typing.
	await page.click(".mdedit__surface .mdedit-para");
	await page.keyboard.press("End");
	await page.keyboard.type(" Typed.");
	await page.waitForFunction(() => document.querySelector("#source").value.includes(" Typed."));
	ok("typing reaches the document");
	is("the dirty marker shows", await page.textContent(".status"), "unsaved");

	// Ctrl-S.
	await page.keyboard.press("Control+s");
	await page.waitForFunction(() => document.querySelector(".status").dataset.state === "saved");
	is("ctrl-s clears the dirty marker", await page.textContent(".status"), "saved");
	yes(
		"ctrl-s writes the file",
		readFileSync(join(folder, "posts", "post.md"), "utf8").includes(" Typed."),
	);

	// The Save button.
	await page.keyboard.type(" Again.");
	await page.waitForFunction(() => document.querySelector(".status").textContent === "unsaved");
	await page.click("[data-save]");
	await page.waitForFunction(() => document.querySelector(".status").dataset.state === "saved");
	yes(
		"the save button writes the file",
		readFileSync(join(folder, "posts", "post.md"), "utf8").includes(" Again."),
	);

	// The pilcrow.
	const marked = () => page.evaluate(() => document.querySelector(".mdedit").classList.contains("mdedit--marks"));
	yes("the markers open shown", await marked());
	await page.click(".mdedit__tool--marks");
	yes("the pilcrow hides the markers", !(await marked()));
	await page.click(".mdedit__tool--marks");
	yes("the pilcrow shows them again", await marked());

	// The scroll sync: the surface scrolls itself, the preview scrolls in
	// its pane, and a scroll in one moves the other by the same percentage.
	await page.evaluate(() => {
		const surface = document.querySelector(".mdedit__surface");
		surface.scrollTop = (surface.scrollHeight - surface.clientHeight) * 0.6;
	});
	await page.waitForTimeout(200);
	const synced = await page.evaluate(() => document.querySelector(".preview").parentElement.scrollTop);
	yes("the preview follows the surface", synced > 0, "the preview stayed at the top");

	// A pasted image: the server stores it under assets/, the markdown takes
	// a relative link, and the surface draws the picture that link answers.
	await page.click(".mdedit__surface .mdedit-para");
	await page.keyboard.press("End");
	await page.evaluate((data) => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		const transfer = new DataTransfer();
		transfer.items.add(new File([bytes], "shot.png", { type: "image/png" }));
		document.querySelector(".mdedit__surface").dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
		);
	}, PNG);
	await page.waitForFunction(() => /!\[\]\(assets\/pendulum_[0-9A-Z]+\.png\)/.test(document.querySelector("#source").value));
	ok("a pasted image lands in the markdown");

	const stored = readdirSync(join(folder, "posts", "assets"));
	yes("the file is stored beside the document", stored.some((name) => name.endsWith(".png")), stored.join(", "));
	yes("its metadata is stored with it", stored.some((name) => name.endsWith(".json")), stored.join(", "));

	await page.waitForSelector(".mdedit__pic");
	yes(
		"the surface draws the picture",
		await page.evaluate(() => {
			const picture = document.querySelector(".mdedit__pic");
			return picture.complete && picture.naturalWidth > 0;
		}),
		"the relative address answered no image",
	);

	// The image panel: a right click over the picture opens it on the
	// caption and the address the markdown carries.
	await page.click(".mdedit__pic", { button: "right" });
	await page.waitForSelector(".mdedit__image");
	const fields = page.locator(".mdedit__image-field input");
	is("the image panel opens on a right click", await fields.count(), 2);
	yes(
		"the panel holds the address the markdown carries",
		(await fields.nth(1).inputValue()).startsWith("assets/pendulum_"),
		await fields.nth(1).inputValue(),
	);

	// The caption goes in whole: a write-back puts the caret in the document,
	// so a second keystroke in the field lands there instead.
	await fields.nth(0).fill("A caption");
	await page.waitForFunction(() => document.querySelector("#source").value.includes("![A caption]("));
	ok("the caption writes back into the markdown");
	await page.keyboard.press("Escape");

	// Closing with unsaved work asks first.
	page.on("dialog", (dialog) => dialog.accept());
	await page.click("[data-close]");
	await page.waitForSelector(".files");
	ok("close returns to the listing");

	yes("the page logged nothing", noise.length === 0, noise.join(" | "));

	console.log(`\n${steps.length} checks, 0 failures`);
} catch (error) {
	console.error(`\n${steps.length} checks, ${Math.max(failures, 1)} failed: ${error.message}`);
	process.exitCode = 1;
} finally {
	await browser?.close();
	server.kill("SIGTERM");
	rmSync(temp, { recursive: true, force: true });
}
