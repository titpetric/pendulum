// Code mode: every line is source of one language, drawn in one face and
// coloured by the highlighter a fence uses. There is no markdown here, so a
// heading stays the characters it is and a pipe row stays a row of text.

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
page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

await page.evaluate(async () => {
	const { MarkdownEditor } = await import("/assets/dist/mdedit.js");
	window.editor.destroy();
	window.editor = new MarkdownEditor(document.querySelector("textarea[data-markdown]"), {
		code: true,
		language: "yaml",
	});
});
await page.waitForSelector(".mdedit--code");

const set = (text) => page.evaluate((value) => {
	window.editor.value = value;
	window.editor.focus();
	window.editor.source.select(0);
}, text);
const value = () => page.evaluate(() => window.editor.value);
const shape = () => page.evaluate(() => {
	const root = document.querySelector(".mdedit");
	const surface = root.querySelector(".mdedit__surface");
	const lines = [...surface.children];

	return {
		code: root.classList.contains("mdedit--code"),
		marks: root.classList.contains("mdedit--marks"),
		bar: root.querySelectorAll(".mdedit__bar").length,
		pilcrow: root.querySelectorAll(".mdedit__tool--marks").length,
		mono: /mono/i.test(getComputedStyle(surface).fontFamily),
		lines: lines.length,
		codeLines: lines.filter((line) => line.classList.contains("mdedit-codeline")).length,
		headings: root.querySelectorAll(".mdedit-h1, .mdedit-h2").length,
		rows: root.querySelectorAll(".mdedit-row, .mdedit-align").length,
		widgets: root.querySelectorAll(".mdedit__widget").length,
		levels: root.querySelectorAll(".mdedit__level").length,
		langs: root.querySelectorAll(".mdedit__lang").length,
		comments: root.querySelectorAll(".mdedit-c-comment").length,
		numbers: root.querySelectorAll(".mdedit-c-number").length,
		strings: root.querySelectorAll(".mdedit-c-string").length,
	};
});

// ── 1. the shell ──────────────────────────────────────────────────────────

const shell = await shape();
ok("code mode: the root carries the code class", shell.code);
ok("code mode: there is no bar and no pilcrow", shell.bar === 0 && shell.pilcrow === 0, JSON.stringify(shell));
ok("code mode: the surface uses a monospaced face", shell.mono);
ok("code mode: the markers class stays off", !shell.marks);

// ── 2. every line is code ─────────────────────────────────────────────────

const YAML = "# deploy\nname: pendulum\nport: 8080\ntags:\n  - release\n  - \"cdn.si\"\n";
await set(YAML);
const coloured = await shape();
ok("code mode: every line is a code line", coloured.lines === YAML.split("\n").length && coloured.codeLines === coloured.lines, JSON.stringify(coloured));
ok("code mode: comments, numbers and strings carry their colours", coloured.comments > 0 && coloured.numbers > 0 && coloured.strings > 0, JSON.stringify(coloured));
ok("code mode: the document reads back whole", (await value()) === YAML);
ok("code mode: the hidden textarea carries the same value", (await page.inputValue("textarea[data-markdown]")) === YAML);

// ── 3. markdown stays text ────────────────────────────────────────────────

const MARKDOWN = "# Heading\n\n| a | b |\n| - | - |\n\n---\ntitle: x\n---\n";
await set(MARKDOWN);
const textual = await shape();
ok("code mode: a heading draws no heading", textual.headings === 0 && textual.levels === 0, JSON.stringify(textual));
ok("code mode: a pipe row draws no table", textual.rows === 0 && textual.widgets === 0, JSON.stringify(textual));
ok("code mode: a fence draws no language label", textual.langs === 0);
ok("code mode: the markdown reads back as typed", (await value()) === MARKDOWN);

// ── 4. the keys write source, not markdown ────────────────────────────────

await set("one: 1");
await page.evaluate(() => {
	window.editor.focus();
	window.editor.source.select(window.editor.value.length);
});
await page.keyboard.press("Enter");
await page.keyboard.type("two: 2");
ok("code mode: Enter opens a line", (await value()) === "one: 1\ntwo: 2", JSON.stringify(await value()));

await set("a");
await page.evaluate(() => {
	window.editor.focus();
	window.editor.source.select(window.editor.value.length);
});
await page.keyboard.press("Shift+Enter");
await page.keyboard.type("b");
ok("code mode: Shift-Enter is one newline, no hard-break spaces", (await value()) === "a\nb", JSON.stringify(await value()));

await set("name: pendulum");
await page.evaluate(() => window.editor.source.select(0, 4));
await page.keyboard.press("Control+b");
ok("code mode: Ctrl+B writes no bold markers", (await value()) === "name: pendulum", JSON.stringify(await value()));

// ── 5. an empty document still holds the caret ────────────────────────────

await set("");
const empty = await shape();
ok("code mode: an empty document is one line with a break", empty.lines === 1 && (await value()) === "");

// ── 6. the language is named, or detected from the file ───────────────────

const detected = await page.evaluate(async () => {
	const { detectLanguage } = await import("/assets/dist/mdedit.js");

	return {
		php: detectLanguage("<?php\nforeach ($items as $item) {\n  echo $item;\n}\n"),
		yaml: detectLanguage("name: pendulum\non:\n  push:\n"),
		json: detectLanguage('{"name": "pendulum", "port": 8080}'),
		go: detectLanguage("package main\n\nfunc main() {\n\tdefer done()\n}\n"),
		plain: detectLanguage("just some words\n"),
	};
});
ok("detection: foreach and echo read as php", detected.php === "php", detected.php);
ok("detection: an indented key reads as yaml", detected.yaml === "yaml", detected.yaml);
ok("detection: a quoted key in braces reads as json", detected.json === "json", detected.json);
ok("detection: package and func read as go", detected.go === "go", detected.go);
ok("detection: words no language names stay uncoloured", detected.plain === "", detected.plain);

await page.evaluate(async () => {
	const { MarkdownEditor } = await import("/assets/dist/mdedit.js");
	const field = document.querySelector("textarea[data-markdown]");
	window.editor.destroy();
	field.value = "<?php\nforeach ($items as $item) {\n  echo $item;\n}\n";
	window.editor = new MarkdownEditor(field, { code: true });
});
const picked = await page.evaluate(() => ({
	language: window.editor.language,
	keywords: document.querySelectorAll(".mdedit-c-keyword").length,
}));
ok("code mode: a file with no language takes the detected one", picked.language === "php" && picked.keywords >= 2, JSON.stringify(picked));

ok("code mode: the run logged nothing", noise.length === 0, noise.join(" | "));

await browser.close();
process.exit(problems.length === 0 ? 0 : 1);
