// The browser suites, over a demo server of their own.
//
//	atkins test                  # every suite
//	node tests/run.mjs keys      # one of them, by name
//
// The server is the demo server on a port nothing holds, serving a copy of
// demo/data so a suite that uploads leaves nothing behind in the tree. Every
// suite is a process of its own: one that fails does not stop the next, and
// the exit status is the count of suites that failed.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// The suites, in the order a reader would want them: what the surface is,
// then what it does, then what breaks it.
const SUITES = [
	["surface", "the document, the bar, the widgets, the form", []],
	["editing", "undo, paste, the grid, the image panel, uploads", []],
	["keys", "Tab, Shift-Tab, Escape, and where the focus goes", []],
	["headings", "the level label, the keys that move it, the chooser", []],
	["cards", "the block a host draws for a marker of its own", []],
	["tables", "Tab and Backspace through a table, and the menu over it", []],
	["frontmatter", "the YAML head, its fields, source view and rich rows", []],
	["media", "players, linked files, per-file limits, progress", []],
	["uploads", "the preview on its way, the queue, the resolved marker", []],
	["links", "the table over a document's links, empty addresses and pictures", []],
	["proof", "what a host reports about a document, and writing a suggestion in", []],
	["stress", "a long document, failed uploads, two editors", []],
	["touch", "a phone: taps, the wrapped bar, a released float", []],
	["fuzz", "random keystrokes against the invariants", ["12", "30"]],
	["model", "the same keys against a model of the document", ["10", "30"]],
];

const asked = process.argv.slice(2);
const running = asked.length ? SUITES.filter(([name]) => asked.includes(name)) : SUITES;
if (!running.length) {
	console.error(`no such suite: ${asked.join(", ")}\nthere is: ${SUITES.map(([name]) => name).join(", ")}`);
	process.exit(2);
}

const port = await new Promise((answer) => {
	const probe = createServer();
	probe.listen(0, "127.0.0.1", () => {
		const { port: open } = probe.address();
		probe.close(() => answer(open));
	});
});

// A copy of the demo folder, so an upload lands in the copy and not in the
// tree. phpscript roots its filesystem where it starts, so the copy sits
// under this repository and the path it is served by is a relative one.
mkdirSync(join(root, ".test"), { recursive: true });
const temp = mkdtempSync(join(root, ".test", "run-"));
cpSync(join(root, "demo", "data"), join(temp, "data"), { recursive: true });
const served = join(temp, "data").slice(root.length + 1);

const server = spawn("phpscript", [join(root, "mdedit.php"), served, `127.0.0.1:${port}`], {
	cwd: root,
	stdio: ["ignore", "pipe", "pipe"],
});
// However this ends, the server goes with it: one left behind would hold
// the pipes of whatever ran the tests, and the run would seem to hang.
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

const failed = [];
for (const [name, says, args] of running) {
	console.log(`\n── ${name}: ${says} ──────────────────────────────────`);
	const run = spawnSync(process.execPath, [join(here, `${name}.mjs`), ...args], {
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, MDEDIT_PORT: String(port) },
	});
	if (run.status !== 0) {
		failed.push(name);
	}
}

server.kill("SIGTERM");
rmSync(temp, { recursive: true, force: true });

console.log(
	failed.length === 0
		? `\n${running.length} suites, all passing`
		: `\n${failed.length} of ${running.length} suites failing: ${failed.join(", ")}`,
);
process.exit(failed.length === 0 ? 0 : 1);
