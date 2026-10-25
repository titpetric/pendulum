// The screenshot the README leads with: the editor over a document that
// carries what the preview knows how to draw.
//
//	PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/usr/lib/chromium/chromium node tests/shot.mjs
//
// It writes images/pendulum.png and images/pendulum-search.png, serving a
// folder it writes itself, so the shot is reproducible and carries nobody's
// own notes.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright").catch(() => {
	console.error("playwright is not installed here; point PLAYWRIGHT at the module and CHROMIUM at the browser");
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

const POST = `---
title: Salt, fat, and the water
date: 2026-10-25
tags: cooking, notes
---

Pasta water takes more salt than anyone writes down. The number below is the
one that works, and the rest of this is why.

## What the water does

Salt seasons the pasta itself while it hydrates, and nothing after the pot
can put that back. A finished sauce sits on the outside.

| Water | Salt | Reads as     |
| ----- | ---: | ------------ |
| 4 l   | 40 g | the standard |
| 4 l   | 28 g | under        |
| 4 l   | 55 g | a brine      |

> Salt the water until it tastes of the sea, then stop short of that.

\`\`\`go
func brine(litres float64) float64 {
	return litres * 10 // grams, and the pot forgives a little either way
}
\`\`\`

- weigh the water the first time
- taste the pasta, not the water
- keep a cup of it back for the sauce

[The pot, on the boil](assets/pot.mp3)
`;

const temp = mkdtempSync(join(tmpdir(), "pendulum-shot-"));
const folder = join(temp, "contents");
mkdirSync(join(folder, "posts", "assets"), { recursive: true });
writeFileSync(join(folder, "posts", "salt-water.md"), POST);
writeFileSync(join(folder, "posts", "guanciale.md"), "# Guanciale\n\nRender it slowly; the fat is the sauce.\n");
writeFileSync(join(folder, "posts", "weeknight-pasta.md"), "# Weeknight pasta\n\nTwelve dinners, four sauces.\n");
writeFileSync(join(folder, "README.md"), "# Kitchen notes\n\nWhat the folder holds.\n");
mkdirSync(join(folder, "drafts"), { recursive: true });

const binary = join(temp, "pendulum");
execFileSync("go", ["build", "-o", binary, "./cmd/pendulum"], { cwd: root, stdio: "inherit" });
const server = spawn(binary, ["-addr", `127.0.0.1:${port}`, "-autosave", "2m", folder], {
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
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2 });

// The editor, both panes, with the caret out of the way.
await page.goto(`${origin}/edit/posts/salt-water.md`, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");
await page.evaluate(() => {
	localStorage.removeItem("pendulum.preview");
	localStorage.removeItem("pendulum.split");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".preview h2");
await page.waitForTimeout(600);
await page.screenshot({ path: join(root, "images", "pendulum.png") });

// The listing, mid-search: the folder as it reads to someone looking for a
// line they remember writing.
await page.goto(`${origin}/posts/`, { waitUntil: "networkidle" });
await page.waitForSelector(".files");
await page.locator("[data-find]").fill("salt");
await page.waitForTimeout(800);
await page.screenshot({ path: join(root, "images", "pendulum-search.png") });

await browser.close();
server.kill("SIGTERM");
rmSync(temp, { recursive: true, force: true });
console.log("wrote images/pendulum.png and images/pendulum-search.png");
