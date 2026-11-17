// Proofing: the panel over what a host reports about a document. The host
// here is a stub, since the editor knows nothing about spelling or style -
// it asks, lists the answer, and writes a replacement in where the writer
// presses one.

import { chromium } from "./lib.mjs";

const PORT = process.env.MDEDIT_PORT ?? "18899";
const URL = `http://127.0.0.1:${PORT}/edit?file=welcome.md`;

const problems = [];
const ok = (label, pass, detail = "") => {
	console.log(`${pass ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`);
	if (!pass) problems.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

const noise = [];
page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

// An editor of its own with a host that reads documents: every "repo" is a
// finding with a replacement, every "zzz" one without, and the call is
// counted so a second press can be told from a redraw.
await page.evaluate(async () => {
	const { MarkdownEditor, TOOLBAR_FULL } = await import("/assets/dist/mdedit.js");

	const field = document.createElement("textarea");
	field.id = "proofed";
	document.body.appendChild(field);

	window.reads = 0;
	window.held = null;
	window.proofEditor = new MarkdownEditor(field, {
		toolbar: [...TOOLBAR_FULL, "proof"],
		proof: (text) => {
			window.reads += 1;
			const findings = [];
			for (const [pattern, tool, rule, suggestions] of [
				[/\brepo\b/g, "prose", "Abbreviation", ["repository"]],
				[/\bzzz\b/g, "spelling", "", []],
			]) {
				for (const at of text.matchAll(pattern)) {
					findings.push({
						tool,
						rule,
						severity: "warning",
						message: `${at[0]} is a finding.`,
						match: at[0],
						start: at.index,
						end: at.index + at[0].length,
						suggestions,
					});
				}
			}
			findings.sort((a, b) => a.start - b.start);

			// A host that answers slowly: the panel has to say it is reading.
			if (window.held) {
				return new Promise((answer) => {
					window.held = () => answer({ findings });
				});
			}

			return Promise.resolve({ findings });
		},
	});
});

const set = (markdown) =>
	page.evaluate((text) => {
		window.proofEditor.value = text;
		window.proofEditor.focus();
	}, markdown);

const value = () => page.evaluate(() => window.proofEditor.value);
const rows = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".mdedit__proof-row")].map((row) => ({
			tool: row.dataset.tool,
			kind: row.querySelector(".mdedit__proof-kind")?.textContent,
			match: row.querySelector(".mdedit__proof-match")?.textContent,
			fixes: [...row.querySelectorAll(".mdedit__proof-fix")].map((fix) => fix.textContent),
		})),
	);
const bar = '[aria-controls="proofed-surface"]';
const openPanel = async () => {
	await page.click(`${bar} .mdedit__tool--proof`);
	await page.waitForSelector(".mdedit__proof-row");
};

// ── 1. what the panel lists ───────────────────────────────────────────────

await set("The repo holds zzz and one more repo.\n");
await openPanel();
const listed = await rows();
ok("proof: every finding the host reported, in document order", listed.length === 3, JSON.stringify(listed));
ok(
	"proof: each one named by its rule, or by its tool where it has none",
	listed.map((row) => row.kind).join(",") === "Abbreviation,spelling,Abbreviation",
	JSON.stringify(listed.map((row) => row.kind)),
);
ok(
	"proof: the tool that raised it rides on the row",
	listed.map((row) => row.tool).join(",") === "prose,spelling,prose",
	JSON.stringify(listed.map((row) => row.tool)),
);
ok(
	"proof: a replacement is a button, and a finding without one has none",
	listed[0].fixes.join() === "repository" && listed[1].fixes.length === 0,
	JSON.stringify(listed.map((row) => row.fixes)),
);

// ── 2. pressing a replacement writes it ───────────────────────────────────

await page.locator(".mdedit__proof-fix").first().click();
await page.waitForTimeout(150);
ok(
	"proof: the suggestion is written over the span it names",
	(await value()) === "The repository holds zzz and one more repo.\n",
	JSON.stringify(await value()),
);
const left = await rows();
ok("proof: and its row goes, leaving the rest", left.length === 2, JSON.stringify(left));
ok("proof: without asking the host again", (await page.evaluate(() => window.reads)) === 1);

// The findings after it moved with the document: pressing the second
// replacement has to land on the second "repo" and not past it.
await page.locator(".mdedit__proof-fix").first().click();
await page.waitForTimeout(150);
ok(
	"proof: a finding after the change still names its own words",
	(await value()) === "The repository holds zzz and one more repository.\n",
	JSON.stringify(await value()),
);

// ── 3. leaving one, and showing one ───────────────────────────────────────

const before = await value();
await page.locator(".mdedit__proof-ignore").first().click();
await page.waitForTimeout(100);
ok(
	"proof: leaving a finding drops the row and writes nothing",
	(await rows()).length === 0 && (await value()) === before,
	JSON.stringify(await value()),
);

await page.keyboard.press("Escape");
await set("The repo again.\n");
await openPanel();
await page.locator(".mdedit__proof-show").first().click();
await page.waitForTimeout(100);
const selected = await page.evaluate(() => window.proofEditor.selection);
ok(
	"proof: the arrow selects the words in the document",
	selected.start === 4 && selected.text === "repo",
	JSON.stringify(selected),
);

// ── 4. a clean document, and a host that refuses ──────────────────────────

await page.keyboard.press("Escape");
await set("Nothing here to find.\n");
await page.click(`${bar} .mdedit__tool--proof`);
await page.waitForSelector(".mdedit__proof-note");
ok(
	"proof: a clean document says so",
	(await page.textContent(".mdedit__proof-note")).includes("Nothing"),
	await page.textContent(".mdedit__proof-note"),
);

await page.keyboard.press("Escape");
await page.evaluate(() => {
	window.proofEditor.options.proof = () => Promise.reject(new Error("the reader is down"));
});
await page.click(`${bar} .mdedit__tool--proof`);
await page.waitForSelector(".mdedit__proof-note");
ok(
	"proof: a host that refuses says so instead of drawing nothing",
	(await page.textContent(".mdedit__proof-note")).includes("down"),
	await page.textContent(".mdedit__proof-note"),
);

// ── 4b. the line a finding stands in ──────────────────────────────────────

await page.keyboard.press("Escape");
await page.evaluate(() => {
	window.proofEditor.options.proof = (text) => {
		const findings = [];
		for (const at of text.matchAll(/\brepo\b/g)) {
			findings.push({
				tool: "prose",
				rule: "Abbreviation",
				message: "repo is a finding.",
				match: at[0],
				start: at.index,
				end: at.index + 4,
				suggestions: ["repository"],
			});
		}
		return Promise.resolve({ findings });
	};
});

await set("One two three four five. Six seven eight nine the repo ten eleven twelve thirteen. End.\n");
await openPanel();
const snippet = () => page.textContent(".mdedit__proof-snippet");
const short = await snippet();
ok(
	"proof: a row opens on the words around the finding, cut at both ends",
	short.includes("repo") && short.startsWith("...") && short.endsWith("...") && !short.includes("Six seven"),
	JSON.stringify(short),
);

await page.locator(".mdedit__proof-snippet").click();
await page.waitForTimeout(100);
const whole = await snippet();
ok(
	"proof: pressing it opens the sentence the finding stands in",
	whole.includes("Six seven eight nine") && whole.includes("thirteen."),
	JSON.stringify(whole),
);
ok(
	"proof: and no sentence beside it",
	!whole.includes("One two three") && !whole.includes("End."),
	JSON.stringify(whole),
);

await page.locator(".mdedit__proof-snippet").click();
await page.waitForTimeout(100);
ok("proof: pressing again puts it back", (await snippet()) === short, JSON.stringify(await snippet()));

// The arrow beside the row is the other press: it jumps to the document.
await page.locator(".mdedit__proof-show").click();
await page.waitForTimeout(100);
const at = await page.evaluate(() => window.proofEditor.selection);
ok("proof: the arrow selects the words where they stand", at.text === "repo", JSON.stringify(at));

// A finding below the fold is scrolled to, and one already in view is not.
await page.keyboard.press("Escape");
await set("top\n" + "a line of nothing\n".repeat(80) + "the repo at the foot\n");
await page.evaluate(() => window.scrollTo(0, 0));
await openPanel();
// A smooth scroll takes as long as it takes; the test waits for the page
// to stop rather than for a number of milliseconds.
const settle = async () => {
	let last = -1;
	for (let i = 0; i < 40; i += 1) {
		const now = await page.evaluate(() => window.scrollY);
		if (now === last) {
			return now;
		}
		last = now;
		await page.waitForTimeout(50);
	}

	return last;
};

const scrolledFrom = await page.evaluate(() => window.scrollY);
await page.locator(".mdedit__proof-show").first().click();
const scrolledTo = await settle();
ok(
	"proof: the arrow scrolls a finding below the fold into view",
	scrolledTo > scrolledFrom,
	JSON.stringify({ scrolledFrom, scrolledTo }),
);

// Pressing it again moves no further: a browser putting a focused
// selection back on screen shifts a line at most, and nothing here adds to
// it. A second press that jumped again would be the panel fighting itself.
const settled = await settle();
await page.locator(".mdedit__proof-show").first().click();
const now = await settle();
ok(
	"proof: and one already in view stays where it is, to within a line",
	Math.abs(now - settled) < 40,
	JSON.stringify({ settled, now }),
);

// ── 5. keeping a word ─────────────────────────────────────────────────────

await page.keyboard.press("Escape");
await page.evaluate(() => {
	window.kept = [];
	window.proofEditor.options.proof = (text) => {
		const findings = [];
		for (const at of text.matchAll(/\brepo\b/g)) {
			findings.push({
				tool: "prose",
				rule: "Abbreviation",
				message: "repo is a finding.",
				match: at[0],
				start: at.index,
				end: at.index + 4,
				suggestions: ["repository"],
			});
		}
		return Promise.resolve({ findings });
	};
	window.proofEditor.options.allow = (finding) => {
		window.kept.push(`${finding.tool}/${finding.rule}/${finding.match}`);
		return Promise.resolve();
	};
});

await set("One repo and a second repo.\n");
await openPanel();
const keeps = await page.locator(".mdedit__proof-keep").count();
ok("proof: a host that remembers draws a keep on every row", keeps === 2, String(keeps));

const held = await value();
await page.locator(".mdedit__proof-keep").first().click();
await page.waitForTimeout(150);
ok(
	"proof: keeping one hands it to the host",
	(await page.evaluate(() => window.kept)).join() === "prose/Abbreviation/repo",
	JSON.stringify(await page.evaluate(() => window.kept)),
);
ok(
	"proof: and every row about the same words goes, the document untouched",
	(await rows()).length === 0 && (await value()) === held,
	JSON.stringify(await rows()),
);

// A host that refuses leaves the list where it was and says so.
await page.keyboard.press("Escape");
await page.evaluate(() => {
	window.proofEditor.options.allow = () => Promise.reject(new Error("not stored"));
});
await set("One repo here.\n");
await openPanel();
await page.locator(".mdedit__proof-keep").first().click();
await page.waitForTimeout(150);
ok(
	"proof: a refusal keeps the row and says so on the button",
	(await rows()).length === 1 && (await page.textContent(".mdedit__proof-keep")) === "not stored",
	await page.textContent(".mdedit__proof-keep"),
);

// ── 6. writing the sentence ───────────────────────────────────────────────

// A finding with no suggestion leaves nothing to press: a proper noun, or a
// rule that names a problem and no fix. The pencil opens the sentence the
// finding stands in as a field, and Save writes it back over the span it
// came from - without the `##` of a heading or the `-` of an item, which are
// what the line is and not what the writer is rewriting.

await page.keyboard.press("Escape");
await page.evaluate(() => {
	// Section 5's host remembers what a writer keeps; this one does not, so
	// a row is a sentence to write or a word to replace and nothing else.
	window.proofEditor.options.allow = null;
	window.reads = 0;
	window.proofEditor.options.proof = (text) => {
		window.reads += 1;
		const findings = [];
		for (const [pattern, tool, rule, suggestions] of [
			[/\brepo\b/g, "prose", "Abbreviation", ["repository"]],
			[/\bzzz\b/g, "spelling", "", []],
		]) {
			for (const at of text.matchAll(pattern)) {
				findings.push({
					tool,
					rule,
					severity: "warning",
					message: `${at[0]} is a finding.`,
					match: at[0],
					start: at.index,
					end: at.index + at[0].length,
					suggestions,
				});
			}
		}
		findings.sort((a, b) => a.start - b.start);

		return Promise.resolve({ findings });
	};
});

const written =
	"## The repo heading\n- a repo in a list\nThe repo holds zzz and one more repo. A later repo sits here.\n";
const field = () =>
	page.evaluate(() => {
		const node = document.querySelector(".mdedit__proof-field");
		return node
			? {
					value: node.value,
					focused: node === document.activeElement,
					save: document.querySelector(".mdedit__proof-save")?.disabled ?? null,
				}
			: null;
	});
const pencil = (at) => page.locator(".mdedit__proof-edit").nth(at);
const standing = () =>
	page.evaluate(() => ({
		value: window.proofEditor.value,
		field: Boolean(document.querySelector(".mdedit__proof-field")),
		panel: Boolean(document.querySelector(".mdedit__proof")),
		rows: document.querySelectorAll(".mdedit__proof-row").length,
	}));

await set(written);
await openPanel();
const spread = await rows();
ok(
	"proof: a row for every finding, across a heading, an item and a sentence",
	spread.length === 6,
	JSON.stringify(spread.map((row) => row.match)),
);

await pencil(0).click();
await page.waitForSelector(".mdedit__proof-field");
const heading = await field();
ok(
	"proof: the pencil opens the sentence as the document holds it, the heading's hashes left out of it",
	heading.value === "The repo heading" && heading.focused && heading.save === true,
	JSON.stringify(heading),
);

await page.keyboard.press("Escape");
await page.waitForTimeout(100);
const escaped = await standing();
ok(
	"proof: Escape in the field closes the field and leaves the panel standing",
	!escaped.field && escaped.panel && escaped.rows === 6 && escaped.value === written,
	JSON.stringify(escaped),
);

await pencil(1).click();
await page.waitForSelector(".mdedit__proof-field");
const item = await field();
ok(
	"proof: and an item without the bullet that makes it one",
	item.value === "a repo in a list",
	JSON.stringify(item),
);

await page.locator(".mdedit__proof-field").fill("a repository in a list");
await page.waitForTimeout(50);
await page.click(".mdedit__proof-cancel");
await page.waitForTimeout(100);
const cancelled = await standing();
ok(
	"proof: Cancel leaves the document and the list alone",
	cancelled.value === written && cancelled.rows === 6 && !cancelled.field,
	JSON.stringify(cancelled),
);

// The sentence the third finding stands in, rewritten: one word taken out
// and another put in its place. The row goes, the finding whose word went
// with it goes, and the one whose word survived keeps its own place.
await pencil(2).click();
await page.waitForSelector(".mdedit__proof-field");
const sentence = await field();
ok(
	"proof: a sentence opens with no ellipsis, no leading space and nothing of the line beside it",
	sentence.value === "The repo holds zzz and one more repo." && sentence.save === true,
	JSON.stringify(sentence),
);

await page.locator(".mdedit__proof-field").fill("The repo holds plenty and one more repo.");
await page.waitForTimeout(50);
const typed = await field();
ok("proof: Save has nothing to write until the sentence changes", typed.save === false, JSON.stringify(typed));

await page.click(".mdedit__proof-save");
await page.waitForTimeout(150);
const saved = await value();
ok(
	"proof: Save writes the field over the span, and over nothing else",
	saved ===
		"## The repo heading\n- a repo in a list\nThe repo holds plenty and one more repo. A later repo sits here.\n",
	JSON.stringify(saved),
);

const rest = await rows();
ok(
	"proof: the row goes, and so does a finding whose words the rewrite took away",
	rest.length === 4 && !rest.some((row) => row.match === "zzz"),
	JSON.stringify(rest.map((row) => row.match)),
);

await page.locator(".mdedit__proof-show").nth(2).click();
await page.waitForTimeout(100);
const kept2 = await page.evaluate(() => window.proofEditor.selection);
ok(
	"proof: a finding the rewrite left standing still selects its own words",
	kept2.text === "repo" && kept2.start === saved.indexOf("more repo") + 5,
	JSON.stringify({ kept: kept2, want: saved.indexOf("more repo") + 5 }),
);

await page.locator(".mdedit__proof-fix").nth(3).click();
await page.waitForTimeout(150);
ok(
	"proof: a finding in a later sentence still names its own words",
	(await value()) ===
		"## The repo heading\n- a repo in a list\nThe repo holds plenty and one more repo. A later repository sits here.\n",
	JSON.stringify(await value()),
);

// A redraw while the field stands open - another row left, a word kept -
// draws the list again around it: the draft belongs to a finding that is
// still in the list, so neither the words nor the caret in them move.
await pencil(2).click();
await page.waitForSelector(".mdedit__proof-field");
await page.locator(".mdedit__proof-field").fill("The repo holds plenty and one more repository.");
await page.waitForTimeout(50);
await page.locator(".mdedit__proof-ignore").first().click();
await page.waitForTimeout(100);
const through = await page.evaluate(() => {
	const node = document.querySelector(".mdedit__proof-field");
	return {
		rows: document.querySelectorAll(".mdedit__proof-row").length,
		draft: node?.value ?? null,
		caret: node?.selectionStart ?? null,
		held: node === document.activeElement,
	};
});
ok(
	"proof: leaving another row keeps the draft, the caret in it and the focus on it",
	through.rows === 2 &&
		through.draft === "The repo holds plenty and one more repository." &&
		through.caret === through.draft.length &&
		through.held,
	JSON.stringify(through),
);

// A tool on the bar writes at the caret in the document, and the caret the
// writer is using stands in the field. The press is the field's.
//
// Both shapes of press are read: one that reaches run() with no pointer,
// which is a keyboard shortcut or a host's own menu, and a real press on the
// button. The bar is not a dismissal for a panel holding a draft, so the
// second reaches run() as well instead of putting the panel away and then
// writing into the line the caret was left on.
const under = await value();
const pressed = async (how) => {
	await how();
	await page.waitForTimeout(150);

	return page.evaluate(() => ({
		value: window.proofEditor.value,
		draft: document.querySelector(".mdedit__proof-field")?.value ?? null,
		focused: document.activeElement?.className ?? "",
		open: Boolean(document.querySelector(".mdedit__proof")),
	}));
};
const drafted = "The repo holds plenty and one more repository.";
const kept = (state) =>
	state.value === under && state.draft === drafted && state.focused.includes("proof-field") && state.open;

const scripted = await pressed(() =>
	page.evaluate((at) => document.querySelector(`${at} .mdedit__tool--bold`).click(), bar),
);
ok(
	"proof: a press on the bar with the field open writes nothing and keeps the draft",
	kept(scripted),
	JSON.stringify(scripted),
);

const pointed = await pressed(() => page.click(`${bar} .mdedit__tool--bold`));
ok(
	"proof: and a pointer on the bar is the same press, not a dismissal",
	kept(pointed),
	JSON.stringify(pointed),
);

ok(
	"proof: and the host was asked once for the whole of it",
	(await page.evaluate(() => window.reads)) === 1,
	String(await page.evaluate(() => window.reads)),
);

// A table row is one line of pipes, and the cell is the unit the surface
// edits: a field holding the row is a row the writer takes apart.
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await set("| Tool | What it writes |\n| --- | --- |\n| B | a repo in bold |\n");
await openPanel();
await page.locator(".mdedit__proof-edit").first().click();
await page.waitForSelector(".mdedit__proof-field");
const cell = await field();
ok(
	"proof: a finding in a table row opens the cell it stands in, not the row",
	cell.value === "a repo in bold",
	JSON.stringify(cell),
);
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");

ok("proof: the page raised nothing", noise.length === 0, noise.join(" | "));

await browser.close();

console.log(problems.length === 0 ? "\nALL PASS" : `\nFAILED: ${problems.length}\n${problems.join("\n")}`);
process.exit(problems.length === 0 ? 0 : 1);
