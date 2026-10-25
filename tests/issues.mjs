// What the issues name, driven in a browser: a folder made, an entry
// renamed and removed (#6), a search over the folder (#7), the preview
// folded and resized (#8), and a document that saves itself (#9).
//
//	PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/usr/lib/chromium/chromium node tests/issues.mjs

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// The browser comes first, before anything is built or started: a machine
// without it should hear so in one line.
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright").catch(() => {
	console.error(
		"playwright is not installed here. Point PLAYWRIGHT at the module and CHROMIUM at the browser:\n" +
			"  PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/usr/lib/chromium/chromium node tests/issues.mjs",
	);
	process.exit(1);
});
const port = await new Promise((answer) => {
	const probe = createServer();
	probe.listen(0, "127.0.0.1", () => {
		const { port: open } = probe.address();
		probe.close(() => answer(open));
	});
});
const origin = `http://127.0.0.1:${port}`;

const problems = [];
const ok = (label, pass, detail = "") => {
	console.log(`${pass ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
	if (!pass) problems.push(label);
};

const temp = mkdtempSync(join(tmpdir(), "pendulum-issues-"));
const folder = join(temp, "contents");
mkdirSync(join(folder, "posts"), { recursive: true });
writeFileSync(join(folder, "posts", "salt.md"), "# On salt\n\nSalt the water generously.\n");
writeFileSync(join(folder, "posts", "pasta.md"), "# Pasta\n\nThe water takes salt.\n");
writeFileSync(join(folder, "README.md"), "# The folder\n\nNotes.\n");

const binary = join(temp, "pendulum");
execFileSync("go", ["build", "-o", binary, "./cmd/pendulum"], { cwd: root, stdio: "inherit" });
// Two seconds of idle is enough to watch; the flag is what the issue asked
// for, in the units a writer would set.
const server = spawn(binary, ["-addr", `127.0.0.1:${port}`, "-autosave", "2s", folder], {
	stdio: ["ignore", "pipe", "pipe"],
});
process.on("exit", () => server.kill("SIGKILL"));

for (let attempt = 0; attempt < 100; attempt += 1) {
	try {
		if ((await fetch(`${origin}/api/list/`)).ok) break;
	} catch {
		// still coming up
	}
	await new Promise((resume) => setTimeout(resume, 100));
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// One check below provokes a refusal, and the browser reports every 400 it
// is answered with. A thrown error is what this watches for.
const noise = [];
page.on("pageerror", (error) => noise.push(String(error)));
page.on("console", (message) => {
	if (message.type() === "error" && !/status of 400/.test(message.text())) {
		noise.push(message.text());
	}
});

// Every prompt and confirm the listing asks, answered from the test.
const answerWith = (value) =>
	page.evaluate((reply) => {
		window.prompt = () => reply;
		window.confirm = () => true;
	}, value);

// ── #6 create a directory, rename and delete ──────────────────────────────

await page.goto(`${origin}/`, { waitUntil: "networkidle" });
await page.waitForSelector(".files");

ok("listing: the bar carries a folder button and a search box", (await page.locator("[data-folder]").count()) === 1 && (await page.locator("[data-find]").count()) === 1);

await answerWith("drafts");
await page.locator("[data-folder]").click();
await page.waitForTimeout(400);
const made = await page.evaluate(() => [...document.querySelectorAll(".entry .name")].map((n) => n.textContent));
ok("#6: a new folder appears in the listing", made.includes("drafts/"), JSON.stringify(made));
ok("#6: and on disk", readdirSync(join(folder)).includes("drafts"), JSON.stringify(readdirSync(folder)));

// A rename through the row's own action.
await page.goto(`${origin}/posts/`, { waitUntil: "networkidle" });
await page.waitForSelector(".files");
await answerWith("sea-salt.md");
await page.locator('.entry[data-name="salt.md"] [data-act="rename"]').click();
await page.waitForTimeout(400);
ok("#6: a renamed file carries its new name", readdirSync(join(folder, "posts")).includes("sea-salt.md"), JSON.stringify(readdirSync(join(folder, "posts"))));

// A delete, with the confirmation answered.
await answerWith("");
await page.locator('.entry[data-name="pasta.md"] [data-act="delete"]').click();
await page.waitForTimeout(400);
ok("#6: a deleted file is gone", !readdirSync(join(folder, "posts")).includes("pasta.md"), JSON.stringify(readdirSync(join(folder, "posts"))));

// A folder with something in it stays, and says why.
await page.goto(`${origin}/`, { waitUntil: "networkidle" });
await page.waitForSelector(".files");
await answerWith("");
await page.locator('.entry[data-name="posts"] [data-act="delete"]').click();
await page.waitForTimeout(400);
const refused = await page.evaluate(() => document.querySelector(".error")?.textContent ?? "");
ok("#6: a folder with a file in it stays, and says why", /something in it/.test(refused) && readdirSync(folder).includes("posts"), JSON.stringify(refused));

// ── #7 search over every file ─────────────────────────────────────────────

await page.locator("[data-find]").fill("salt");
await page.waitForTimeout(900);
const hits = await page.evaluate(() => ({
	rows: [...document.querySelectorAll(".hit")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
	summary: document.querySelector(".found")?.textContent ?? "",
	marked: [...document.querySelectorAll(".hit mark")].map((n) => n.textContent),
}));
ok("#7: a search answers the lines that carry the phrase", hits.rows.length >= 2, JSON.stringify(hits.rows));
ok("#7: each row names its file and line", /sea-salt\.md:\d/.test(hits.rows.join(" ")), JSON.stringify(hits.rows[0]));
ok("#7: the phrase is marked inside the line", hits.marked.every((one) => one.toLowerCase() === "salt"), JSON.stringify(hits.marked));
ok("#7: and the count says how much it read", /lines in \d+ files?/.test(hits.summary), JSON.stringify(hits.summary));

// A result opens the file it names.
await page.locator(".hit").first().click();
await page.waitForSelector(".mdedit__surface");
ok("#7: a result opens its file", page.url().includes("/edit/"), page.url());

// Emptying the box brings the folder back.
await page.goBack();
await page.waitForSelector(".files");
await page.locator("[data-find]").fill("salt");
await page.waitForTimeout(800);
await page.locator("[data-find]").fill("");
await page.waitForTimeout(600);
ok("#7: an empty box shows the folder again", (await page.locator(".entry").count()) > 0, String(await page.locator(".entry").count()));

// ── #8 fold and resize the preview ────────────────────────────────────────

await page.goto(`${origin}/edit/posts/sea-salt.md`, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");
await page.waitForTimeout(400);

const both = await page.evaluate(() => ({
	preview: document.querySelector(".pane--preview")?.getBoundingClientRect().width ?? 0,
	source: document.querySelector(".pane--source").getBoundingClientRect().width,
	pressed: document.querySelector("button[data-preview]").getAttribute("aria-pressed"),
}));
ok("#8: both panes show to begin with", both.preview > 100 && both.source > 100 && both.pressed === "true", JSON.stringify(both));

await page.locator("button[data-preview]").click();
await page.waitForTimeout(300);
const folded = await page.evaluate(() => ({
	preview: document.querySelector(".pane--preview")?.offsetParent === null,
	source: Math.round(document.querySelector(".pane--source").getBoundingClientRect().width),
	window: window.innerWidth,
	pressed: document.querySelector("button[data-preview]").getAttribute("aria-pressed"),
}));
ok("#8: folding the preview leaves the width to the writing", folded.preview && folded.source > folded.window - 10, JSON.stringify(folded));
ok("#8: and the button says which way it is", folded.pressed === "false");

// It is still folded on the next document.
await page.goto(`${origin}/edit/README.md`, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");
await page.waitForTimeout(400);
ok("#8: the choice holds for the next file", (await page.evaluate(() => document.querySelector(".editor").dataset.panes)) === "source");

await page.locator("button[data-preview]").click();
await page.waitForTimeout(300);

// Drag the handle: the preview takes more of the row.
const before = await page.evaluate(() => Math.round(document.querySelector(".pane--preview").getBoundingClientRect().width));
const handle = await page.locator(".split").boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
await page.mouse.down();
await page.mouse.move(handle.x - 240, handle.y + 200, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.evaluate(() => Math.round(document.querySelector(".pane--preview").getBoundingClientRect().width));
ok("#8: the handle moves the split", after > before + 150, JSON.stringify({ before, after }));

await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");
await page.waitForTimeout(400);
const kept = await page.evaluate(() => Math.round(document.querySelector(".pane--preview").getBoundingClientRect().width));
ok("#8: and the page remembers where it stands", Math.abs(kept - after) < 30, JSON.stringify({ after, kept }));

// ── #9 a document that saves itself ───────────────────────────────────────

await page.goto(`${origin}/edit/posts/sea-salt.md`, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");
await page.waitForTimeout(400);

await page.locator(".mdedit__surface").click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\nLeft alone to save itself.");
await page.waitForTimeout(300);
const dirty = await page.evaluate(() => document.querySelector(".status").textContent);
ok("#9: an edited document says it is unsaved", dirty === "unsaved", JSON.stringify(dirty));

await page.waitForTimeout(3500);
const settled = await page.evaluate(() => document.querySelector(".status").textContent);
const stored = readFileSync(join(folder, "posts", "sea-salt.md"), "utf8");
ok("#9: and saves itself after the wait the flag names", /saved by itself/.test(settled), JSON.stringify(settled));
ok("#9: what it saved carries every character typed", stored.includes("Left alone to save itself."), JSON.stringify(stored.slice(-40)));

// With the flag absent nothing saves by itself: the settings say so.
const settings = await page.evaluate(async () => (await fetch("/api/settings")).json());
ok("#9: the page reads the wait from the server", settings.autosave_seconds === 2, JSON.stringify(settings));

await browser.close();
server.kill("SIGTERM");
rmSync(temp, { recursive: true, force: true });

ok("the page raised nothing", noise.length === 0, noise.slice(0, 3).join(" / "));
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING:\n${problems.map((one) => `  ${one}`).join("\n")}`);
if (problems.length) process.exitCode = 1;
