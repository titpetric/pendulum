// The images in docs/, taken again.
//
//	PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/usr/lib/chromium/chromium node tests/shots.mjs
//	node tests/shots.mjs editor render          # some of them, by name
//
// The scenes are the ones docs/development.md lists. The server is the demo
// server over a copy of demo/data with docs/example.md beside it, so a run
// writes nothing into the tree it photographs. Every shot clips the .mdedit
// element at 960 CSS pixels, which is what the committed images are.
//
// Each scene says what it needs the editor to be showing, and nothing about
// the bar: a bar that changes changes every image here, which is the point.

import { spawn } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "docs");

const port = await new Promise((answer) => {
	const probe = createServer();
	probe.listen(0, "127.0.0.1", () => {
		const { port: open } = probe.address();
		probe.close(() => answer(open));
	});
});

mkdirSync(join(root, ".test"), { recursive: true });
const temp = mkdtempSync(join(root, ".test", "shots-"));
cpSync(join(root, "demo", "data"), join(temp, "data"), { recursive: true });
copyFileSync(join(root, "docs", "example.md"), join(temp, "data", "example.md"));
const served = join(temp, "data").slice(root.length + 1);

const server = spawn("phpscript", [join(root, "mdedit.php"), served, `127.0.0.1:${port}`], {
	cwd: root,
	stdio: ["ignore", "pipe", "pipe"],
});
process.on("exit", () => server.kill("SIGKILL"));
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => process.exit(1));
}

for (let attempt = 0; attempt < 100; attempt += 1) {
	try {
		if ((await fetch(`http://127.0.0.1:${port}/edit?file=welcome.md`)).ok) break;
	} catch {
		// still coming up
	}
	await new Promise((resume) => setTimeout(resume, 100));
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });

const open = async (file) => {
	await page.goto(`http://127.0.0.1:${port}/edit?file=${file}`, { waitUntil: "networkidle" });
	await page.waitForSelector(".mdedit__surface");
};

const set = (markdown, caret = 0) =>
	page.evaluate(
		([text, at]) => {
			window.editor.value = text;
			window.editor.focus();
			window.editor.source.select(at);
		},
		[markdown, caret],
	);

const marks = (on) => page.evaluate((state) => window.editor.toggleMarks(state), on);

// An upload the server holds open, so a preview can be photographed mid-flight.
const stall = () =>
	page.route("**/upload", async () => {
		await new Promise(() => {});
	});

const refuse = (reason) =>
	page.route("**/upload", (route) =>
		route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: reason }) }),
	);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx8gAAAABJRU5ErkJggg==";

const send = (name, type, pad = 2048) =>
	page.evaluate(
		({ png, file, kind, size }) => {
			const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
			window.editor.upload(new File([bytes, new Uint8Array(size)], file, { type: kind }));
		},
		{ png: PNG, file: name, kind: type, size: pad },
	);

// shot clips the editor. A panel that stands outside the editor's own box is
// named as well, and the clip is the pair: an element screenshot of .mdedit
// alone cuts a panel off at the foot.
const shot = async (name, over = null) => {
	await page.waitForTimeout(250);
	if (!over) {
		await page.locator(".mdedit").screenshot({ path: join(out, `${name}.png`) });
		console.log(`docs/${name}.png`);
		return;
	}

	const clip = await page.evaluate((selector) => {
		const boxes = [document.querySelector(".mdedit"), document.querySelector(selector)]
			.filter(Boolean)
			.map((node) => node.getBoundingClientRect());
		const left = Math.min(...boxes.map((box) => box.left));
		const top = Math.min(...boxes.map((box) => box.top));
		return {
			x: Math.max(0, Math.floor(left)),
			y: Math.max(0, Math.floor(top)),
			width: Math.ceil(Math.max(...boxes.map((box) => box.right)) - left),
			height: Math.ceil(Math.max(...boxes.map((box) => box.bottom)) - top),
		};
	}, over);

	await page.screenshot({ path: join(out, `${name}.png`), clip });
	console.log(`docs/${name}.png`);
};

const SCENES = {
	// The README's pair: one document, the markers shown and then hidden.
	editor: async () => {
		await open("example.md");
		await marks(true);
		await shot("editor");
	},
	render: async () => {
		await open("example.md");
		await marks(false);
		await shot("render");
	},
	// The fields at the head of a document, drawn as a table.
	frontmatter: async () => {
		await open("welcome.md");
		await set(
			"---\ntitle: Salt, fat, and the water\ndate: 2026-10-25\ntags: cooking, notes\n---\n\n" +
				"## What the water does\n\nSalt seasons the pasta itself while it hydrates.\n",
			0,
		);
		await marks(false);
		await shot("frontmatter");
	},
	// A table drawn in place, and the menu over one of its cells.
	table: async () => {
		await open("welcome.md");
		await set("| Tool | What it writes |\n| --- | --- |\n| B | `**bold**` |\n| H | cycles `##` |\n", 0);
		await marks(false);
		await shot("table");
	},
	menu: async () => {
		await open("welcome.md");
		await set("| Tool | What it writes |\n| --- | --- |\n| B | `**bold**` |\n| H | cycles `##` |\n", 0);
		await marks(false);
		await page.locator(".mdedit__widget--table td").first().click({ button: "right" });
		await shot("menu", ".mdedit__menu");
	},
	// The image panel over a picture the document already holds.
	image: async () => {
		await open("welcome.md");
		await set("![the logo](/assets/docs/mdedit-logo.png)\n", 0);
		await marks(false);
		await page.locator(".mdedit__pic").first().click({ button: "right" });
		await shot("image");
	},
	// The level chooser on a heading.
	heading: async () => {
		await open("welcome.md");
		await set("## What the water does\n\nSalt seasons the pasta itself.\n", 0);
		await marks(false);
		await page.locator(".mdedit__level").first().click();
		await shot("heading", ".mdedit__levels");
	},
	// The table over every link in a document.
	links: async () => {
		await open("welcome.md");
		// The document is long enough for the panel to stand inside the
		// editor's own box: a short one puts it over the bar and off the foot.
		await set(
			"## Where this points\n\n[GitHub]()\n\n[Docs](https://example.com/docs)\n\n" +
				"[Write](mailto:someone@example.com)\n\n[Top](#links)\n\n" +
				"[![the logo](/assets/docs/mdedit-logo.png)](/home)\n\nEvery one of them is a row above.\n",
			0,
		);
		await marks(true);
		await page.locator(".mdedit__tool--link").click();
		await page.waitForSelector(".mdedit__links");
		await shot("links", ".mdedit__links");
	},
	// One file in flight, and one the server refused. A held route reports
	// no bytes, so the record is given the ratio and the time a real request
	// would have painted by now.
	upload: async () => {
		await open("welcome.md");
		await set("## The layout\n\nThe picture for the article:\n", 46);
		await marks(true);
		await stall();
		await send("the-table.png", "image/png", 400 * 1024);
		await page.waitForSelector(".mdedit__upload");
		await page.evaluate(() => {
			const record = window.editor.uploads.list()[0];
			record.ratio = 0.6;
			record.eta = 12;
			window.editor.uploads.draw(record);
		});
		await shot("upload");
	},
	"upload-failed": async () => {
		await open("welcome.md");
		await set("", 0);
		await refuse("the server refused this one");
		await send("diagram.png", "image/png");
		await page.waitForSelector('.mdedit__upload[data-state="failed"]');
		await shot("upload-failed");
	},
	// The queue over three files at once.
	"upload-queue": async () => {
		await open("welcome.md");
		await set("", 0);
		await refuse("the server refused this one");
		await send("refused.png", "image/png");
		await page.waitForSelector('.mdedit__upload[data-state="failed"]');
		await page.unroute("**/upload");
		await stall();
		await send("diagram.png", "image/png", 400 * 1024);
		await send("notes.png", "image/png", 200 * 1024);
		await page.locator(".mdedit__tool--upload").click();
		await page.waitForSelector(".mdedit__queue");
		await shot("upload-queue", ".mdedit__queue");
	},
};

const asked = process.argv.slice(2);
const names = asked.length ? asked.filter((name) => SCENES[name]) : Object.keys(SCENES);
if (asked.length && names.length !== asked.length) {
	console.error(`no such scene: ${asked.filter((name) => !SCENES[name]).join(", ")}`);
	console.error(`there is: ${Object.keys(SCENES).join(", ")}`);
	process.exit(2);
}

for (const name of names) {
	try {
		await SCENES[name]();
	} catch (err) {
		console.error(`${name}: ${err.message}`);
	}
	await page.unroute("**/upload").catch(() => {});
}

await browser.close();
server.kill("SIGTERM");
rmSync(temp, { recursive: true, force: true });
