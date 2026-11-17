// Fuzzing for mdedit: a seeded random keystroke sequence over a corpus of
// documents, with the invariants checked after every single key.
//
//	MDEDIT_PORT=18897 node /tmp/mdedit-fuzz.mjs [rounds] [keys]
//
// A failure prints the seed, the document it started from and the keys it
// took to get there, which is enough to replay it by hand.

import { chromium } from "./lib.mjs";

const PORT = process.env.MDEDIT_PORT ?? "18899";
const URL = `http://127.0.0.1:${PORT}/edit?file=welcome.md`;
const ROUNDS = Number(process.argv[2] ?? 40);
const KEYS = Number(process.argv[3] ?? 60);

// A seeded generator, so a round that fails replays from its seed alone.
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
	"# Heading\n\nA paragraph.\n",
	"- one\n- two\n\t- nested\n",
	"| a | b |\n| --- | --- |\n| 1 | 2 |\n",
	"```go\nfunc main() {}\n```\n",
	"> quoted\n> more\n",
	"![a picture](/assets/docs/table.png)\n\ntext after\n",
	"A **bold** and _thin_ and ~~gone~~ and `code` run.\n",
	"\ttabbed\n    spaced\n",
	"line\n\n\n\nafter three blanks\n",
	"| a | b |\n| --- | --- |\n| 1 | 2 |\n\n# after\n\n| c |\n| --- |\n| 3 |\n",
	"![](/assets/docs/render.png#left)\n\nwrapping text beside it.\n",
	"émoji 🎉 and ümlauts\n",
	"#### four\n##### five\n###### six\n",
	"1. one\n2. two\n10. ten\n",
	"---\n\nafter a rule\n",
	"a | pipe in prose\n",
	"```\nno language\n```\n",
	"text with trailing spaces   \nand a tab\there\n",
];

const KEYSET = [
	{ key: "Enter", weight: 8 },
	{ key: "Backspace", weight: 8 },
	{ key: "Delete", weight: 4 },
	{ key: "ArrowUp", weight: 4 },
	{ key: "ArrowDown", weight: 4 },
	{ key: "ArrowLeft", weight: 4 },
	{ key: "ArrowRight", weight: 4 },
	{ key: "Home", weight: 2 },
	{ key: "End", weight: 2 },
	{ key: "Tab", weight: 3 },
	{ key: "Shift+Tab", weight: 2 },
	{ key: "Shift+ArrowRight", weight: 4 },
	{ key: "Shift+ArrowDown", weight: 3 },
	{ key: "Shift+ArrowUp", weight: 2 },
	{ key: "Control+a", weight: 1 },
	{ key: "Control+Home", weight: 1 },
	{ key: "Control+End", weight: 1 },
];

const TEXT = ["a", "x", " ", "#", "*", "|", "-", "`", ">", "\t", "_", "~", "!", "[", "]", "(", ")", "é", "1", "."];
const TOOLS = ["bold", "italic", "strike", "heading", "link", "code", "fence", "quote", "list", "table", "marks"];

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const weighted = (rng, list) => {
	const total = list.reduce((sum, entry) => sum + entry.weight, 0);
	let at = rng() * total;
	for (const entry of list) {
		at -= entry.weight;
		if (at <= 0) return entry.key;
	}
	return list[0].key;
};

const browser = await chromium.launch({ executablePath: "/usr/lib/chromium/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (message) => {
	if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

// The invariants, read in one trip: the field the form posts carries what the
// editor holds, the caret is inside the document, and loading the value back
// answers the same text.
const audit = () =>
	page.evaluate(() => {
		const editor = window.editor;
		const value = editor.value;
		const field = document.querySelector("textarea[data-markdown]");
		const selection = editor.selection;
		const surface = document.querySelector(".mdedit__surface");
		return {
			value,
			field: field.value,
			start: selection.start,
			end: selection.end,
			length: value.length,
			lines: surface.children.length,
			nested: surface.querySelectorAll(".mdedit__line .mdedit__line").length,
			stray: surface.querySelectorAll("div > br:only-child").length,
			orphan: [...surface.children].filter(
				(node) => !node.classList.contains("mdedit__line") && !node.classList.contains("mdedit__widget"),
			).length,
		};
	});

const failures = [];
let checks = 0;

const complain = (round, seed, start, log, label, detail) => {
	failures.push({ round, seed, start, keys: log.join(" "), label, detail });
	console.log(`FAIL round ${round} seed ${seed} :: ${label}`);
	console.log(`  document: ${JSON.stringify(start)}`);
	console.log(`  keys: ${log.join(" ")}`);
	console.log(`  detail: ${JSON.stringify(detail)}`);
};

for (let round = 0; round < ROUNDS; round += 1) {
	const seed = 1000 + round * 7919;
	const rng = random(seed);
	const start = CORPUS[round % CORPUS.length];
	const log = [];

	await page.evaluate(
		(text) => {
			window.editor.value = text;
			window.editor.toggleMarks(true);
			window.editor.focus();
			window.editor.source.select(0);
		},
		start,
	);
	errors.length = 0;

	for (let step = 0; step < KEYS; step += 1) {
		const roll = rng();
		let what = "";
		if (roll < 0.45) {
			const character = pick(rng, TEXT);
			what = `type(${JSON.stringify(character)})`;
			await page.keyboard.type(character);
		} else if (roll < 0.9) {
			what = weighted(rng, KEYSET);
			await page.keyboard.press(what);
		} else {
			const tool = pick(rng, TOOLS);
			what = `tool(${tool})`;
			await page.evaluate((key) => window.editor.run(key), tool);
		}
		log.push(what);

		const state = await audit();
		checks += 1;

		if (state.value !== state.field) {
			complain(round, seed, start, log, "the textarea drifted from the document", {
				value: state.value,
				field: state.field,
			});
			break;
		}
		if (state.start < 0 || state.end > state.length || state.start > state.end) {
			complain(round, seed, start, log, "the caret left the document", state);
			break;
		}
		if (state.nested > 0) {
			complain(round, seed, start, log, "a line nested inside another line", state);
			break;
		}
		if (state.orphan > 0) {
			complain(round, seed, start, log, "the surface holds something that is neither a line nor a widget", state);
			break;
		}
		if (errors.length > 0) {
			complain(round, seed, start, log, "the page raised an error", errors.slice(0, 3));
			break;
		}
	}

	// Loading what the editor holds has to answer the same document: the
	// tokeniser and the reader agreeing is what keeps a save lossless.
	const stable = await page.evaluate(() => {
		const before = window.editor.value;
		window.editor.source.load(before);
		const after = window.editor.value;
		return { before, after, same: before === after };
	});
	checks += 1;
	if (!stable.same) {
		complain(round, seed, start, log, "a reload of the document changed it", stable);
	}

	process.stdout.write(`round ${round} (seed ${seed}) over ${JSON.stringify(start.slice(0, 24))}: ${failures.length === 0 ? "clean" : `${failures.length} failing`}\n`);
}

await browser.close();

console.log(`\n${checks} invariant checks over ${ROUNDS} rounds`);
if (failures.length === 0) {
	console.log("NO FAILURES");
} else {
	console.log(`${failures.length} FAILURES`);
	for (const failure of failures) {
		console.log(`  round ${failure.round}: ${failure.label}`);
	}
	process.exitCode = 1;
}
