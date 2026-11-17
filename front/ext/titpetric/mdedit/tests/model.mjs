// A reference model for mdedit: the same keys, run against a plain string in
// this process, and the surface has to agree character for character.
//
//	MDEDIT_PORT=18897 node /tmp/mdedit-model.mjs [rounds] [keys]
//
// The keys modelled are the ones whose answer is not a question of layout:
// typing, Enter, Backspace, Delete, Left, Right, Home, End. Arrow up and down
// move by visual line, which the model cannot know, so they stay out. The
// corpus stays clear of tables and pictures for the same reason: a widget
// holds no caret, so stepping over one is not a character move.

import { chromium } from "./lib.mjs";

const PORT = process.env.MDEDIT_PORT ?? "18899";
const URL = `http://127.0.0.1:${PORT}/edit?file=welcome.md`;
const ROUNDS = Number(process.argv[2] ?? 24);
const KEYS = Number(process.argv[3] ?? 50);

function random(seed) {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 4294967296;
	};
}

const CORPUS = [
	"",
	"one",
	"one\ntwo\nthree\n",
	"# Heading\n\nA paragraph.\n",
	"- one\n- two\n\t- nested\n",
	"```go\nfunc main() {}\n```\n",
	"> quoted\n> more\n",
	"A **bold** and _thin_ and ~~gone~~ and `code` run.\n",
	"\ttabbed\n    spaced\n",
	"line\n\n\n\nafter three blanks\n",
	"#### four\n##### five\n",
	"1. one\n2. two\n",
	"---\n\nafter a rule\n",
	"a | pipe in prose\n",
	"text with trailing spaces   \nand a tab\there\n",
	"[a link](http://example.com)\n",
];

const TEXT = ["a", "x", " ", "#", "*", "|", "-", "`", ">", "_", "~", "!", "[", "]", "(", ")", "1", ".", "\t"];

// The model: the document as a string and a collapsed caret or a selection.
class Model {
	constructor(value) {
		this.value = value;
		this.start = 0;
		this.end = 0;
	}

	type(text) {
		this.value = this.value.slice(0, this.start) + text + this.value.slice(this.end);
		this.start += text.length;
		this.end = this.start;
	}

	backspace() {
		if (this.start !== this.end) {
			this.value = this.value.slice(0, this.start) + this.value.slice(this.end);
			this.end = this.start;
			return;
		}
		if (this.start === 0) return;
		this.value = this.value.slice(0, this.start - 1) + this.value.slice(this.start);
		this.start -= 1;
		this.end = this.start;
	}

	forwardDelete() {
		if (this.start !== this.end) {
			this.value = this.value.slice(0, this.start) + this.value.slice(this.end);
			this.end = this.start;
			return;
		}
		if (this.start >= this.value.length) return;
		this.value = this.value.slice(0, this.start) + this.value.slice(this.start + 1);
	}

	left() {
		if (this.start === this.end) {
			this.start = Math.max(0, this.start - 1);
		}
		this.end = this.start;
	}

	right() {
		this.start = this.end;
		if (this.start === this.end) {
			this.start = Math.min(this.value.length, this.start + 1);
		}
		this.end = this.start;
	}

	home() {
		this.start = this.value.lastIndexOf("\n", this.start - 1) + 1;
		this.end = this.start;
	}

	end_() {
		const at = this.value.indexOf("\n", this.start);
		this.start = at < 0 ? this.value.length : at;
		this.end = this.start;
	}
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const browser = await chromium.launch({ executablePath: "/usr/lib/chromium/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

// A document with no wrapping, so Home and End answer the logical line: the
// surface is wide and the corpus lines are short.
await page.evaluate(() => {
	document.querySelector(".mdedit").style.maxWidth = "none";
	document.querySelector(".mdedit__surface").style.whiteSpace = "pre-wrap";
});

const failures = [];
let checks = 0;

for (let round = 0; round < ROUNDS; round += 1) {
	const seed = 2000 + round * 6151;
	const rng = random(seed);
	const start = CORPUS[round % CORPUS.length];
	const model = new Model(start);
	const log = [];
	let broken = false;

	await page.evaluate((text) => {
		window.editor.value = text;
		window.editor.toggleMarks(true);
		window.editor.focus();
		window.editor.source.select(0);
	}, start);

	for (let step = 0; step < KEYS && !broken; step += 1) {
		const roll = rng();
		let what = "";

		if (roll < 0.4) {
			const character = pick(rng, TEXT);
			what = `type ${JSON.stringify(character)}`;
			model.type(character);
			await page.keyboard.type(character);
		} else {
			const key = pick(rng, ["Enter", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End"]);
			what = key;
			if (key === "Enter") model.type("\n");
			if (key === "Backspace") model.backspace();
			if (key === "Delete") model.forwardDelete();
			if (key === "ArrowLeft") model.left();
			if (key === "ArrowRight") model.right();
			if (key === "Home") model.home();
			if (key === "End") model.end_();
			await page.keyboard.press(key);
		}
		log.push(what);

		const state = await page.evaluate(() => ({
			value: window.editor.value,
			start: window.editor.selection.start,
		}));
		checks += 2;

		if (state.value !== model.value) {
			failures.push({ round, seed, start, keys: log.join(" | "), what: "document" });
			console.log(`FAIL round ${round} seed ${seed} :: the document is not what the keys spell`);
			console.log(`  from: ${JSON.stringify(start)}`);
			console.log(`  keys: ${log.join(" | ")}`);
			console.log(`  want: ${JSON.stringify(model.value)}`);
			console.log(`  got:  ${JSON.stringify(state.value)}`);
			broken = true;
			break;
		}
		if (state.start !== model.start) {
			failures.push({ round, seed, start, keys: log.join(" | "), what: "caret" });
			console.log(`FAIL round ${round} seed ${seed} :: the caret is not where the keys put it`);
			console.log(`  from: ${JSON.stringify(start)}`);
			console.log(`  keys: ${log.join(" | ")}`);
			console.log(`  document: ${JSON.stringify(state.value)}`);
			console.log(`  want caret ${model.start}, got ${state.start}`);
			broken = true;
			break;
		}
	}

	console.log(`round ${round} (seed ${seed}) over ${JSON.stringify(start.slice(0, 22))}: ${broken ? "FAILED" : "agrees"}`);
}

await browser.close();

console.log(`\n${checks} comparisons against the model over ${ROUNDS} rounds`);
console.log(failures.length === 0 ? "MODEL AGREES" : `${failures.length} DISAGREEMENTS`);
if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(" / ")}`);
if (failures.length) process.exitCode = 1;
