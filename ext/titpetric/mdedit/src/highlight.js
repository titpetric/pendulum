// The markdown tokeniser: one line of source, read into the runs the editing
// surface draws it with.
//
// Every token carries the writer's own characters, so the runs concatenated
// are the line itself, character for character. That is the whole contract
// here: the surface holds the markdown, the form posts what the surface
// holds, and a token can only decide how a run looks.
//
// A marker run - the hashes of a heading, the stars of a bold phrase, the
// pipes of a row - is a token of its own, so one class on the surface hides
// every marker at once and leaves the text they mark styled where it stands.

import { highlightCode } from "./code.js";
import { escapeHTML } from "./escape.js";
import { mediaKind } from "./inline.js";

export { escapeHTML };

// The line that opens or closes a fenced block: its indent, its ticks and
// whatever the opener names the language with. The surface reads this one
// too, to write the fence that closes a block left open.
export const FENCE = /^(\s*)(```|~~~)(.*)$/;
const HEADING = /^(#{1,6}\s+)(.*)$/;
const QUOTE = /^(\s*>\s?)(.*)$/;
// A list item: what marks it, and what it says. The surface reads this one
// too, to carry the marker onto the line Enter opens.
export const ITEM = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const ROW = /^\s*\|/;
// A dash is what makes a row the alignment row. A row of empty cells holds
// none, so it reads as the row it is.
const ALIGN = /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/;

// The inline constructs. At every position the one that matches earliest
// wins the run, so a link inside a bold phrase and a star inside a code span
// both land where the writer meant them.
const INLINE = [
	{
		name: "code",
		pattern: /(`+)([^`]+?)\1/g,
		read: ([, ticks, body]) => [{ mark: ticks }, { text: body }, { mark: ticks }],
	},
	{
		// An image is all marker. With the markers hidden the picture stands
		// in their place, and it carries the alt text itself.
		//
		// With no address there is no picture to stand there, so the caption
		// stays on the page as the text it is: an image whose address is yet
		// to come - the placeholder an upload leaves behind - has to say so
		// in both views, and a broken picture says nothing.
		name: "image",
		pattern: /(!\[)([^\]\n]*)(\]\(([^)\n]*?)(?:\s+"[^"]*")?\))/g,
		read: ([, open, alt, close, src]) =>
			src === ""
				? [{ mark: open }, { text: alt }, { mark: close }]
				: [{ mark: open }, { mark: alt }, { mark: close }, { picture: { src, alt } }],
	},
	{
		// A link to a file a browser can play draws the player, the way an
		// image marker draws the picture: the marker is all marker, and with
		// it hidden the player stands in its place.
		name: "link",
		pattern: /(\[)([^\]\n]*)(\]\(([^)\n]*?)(?:\s+"[^"]*")?\))/g,
		read: ([, open, label, close, href]) => {
			const kind = mediaKind(href);
			return kind
				? [{ mark: open }, { mark: label }, { mark: close }, { media: { src: href, kind, label } }]
				: [{ mark: open }, ...inlineTokens(label), { mark: close }];
		},
	},
	{
		name: "strong",
		pattern: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g,
		read: ([, marker, body]) => [{ mark: marker }, ...inlineTokens(body), { mark: marker }],
	},
	{
		name: "strike",
		pattern: /(~~)(?=\S)([\s\S]*?\S)\1/g,
		read: ([, marker, body]) => [{ mark: marker }, ...inlineTokens(body), { mark: marker }],
	},
	{
		name: "em",
		pattern: /(?<![*_\w])([*_])(?=\S)([^*_\n]*?\S)\1(?![*_\w])/g,
		read: ([, marker, body]) => [{ mark: marker }, ...inlineTokens(body), { mark: marker }],
	},
];

// inlineTokens scans one run of text for the inline constructs. What no rule
// claims comes through as the characters it is.
export function inlineTokens(text) {
	const out = [];
	let at = 0;

	while (at < text.length) {
		let first = null;
		for (const rule of INLINE) {
			// The search runs over the whole line from `at`, so a pattern
			// that looks at the character before its match still sees it.
			rule.pattern.lastIndex = at;
			const found = rule.pattern.exec(text);
			if (found && (first === null || found.index < first.found.index)) {
				first = { rule, found };
			}
		}

		if (first === null) {
			out.push({ text: text.slice(at) });
			break;
		}

		if (first.found.index > at) {
			out.push({ text: text.slice(at, first.found.index) });
		}
		out.push({ name: first.rule.name, children: first.rule.read(first.found) });
		at = first.found.index + first.found[0].length;
	}

	return out;
}

// cells splits a table row into its pipes and what stands between them.
function rowTokens(line, rule) {
	const out = [];

	// A \| in a cell is the character, not the next cell: the pipes that
	// separate are the ones nothing escaped.
	for (const part of line.split(/((?<!\\)\|)/)) {
		if (part === "") {
			continue;
		}
		if (part === "|") {
			out.push({ mark: "|" });
			continue;
		}
		out.push(...(rule ? [{ mark: part }] : inlineTokens(part)));
	}

	return out;
}

// tokenise reads one line in the context the lines above it left: null
// outside a fenced block, and the language the fence named inside one. The
// answer carries the context the line below it is read in.
export function tokenise(line, context = null) {
	const fence = line.match(FENCE);
	if (fence) {
		const [, lead, ticks, rest] = fence;
		const children = lead === "" ? [] : [{ text: lead }];
		children.push({ mark: ticks + rest });

		return {
			name: "fence",
			children,
			// The word on an opening fence picks the keywords the lines below
			// it colour against; the next fence closes the block. Anything
			// after the word is the fence's own business.
			context: context === null ? (rest.trim().split(/\s+/)[0] ?? "").toLowerCase() : null,
		};
	}

	if (context !== null) {
		return { name: "codeline", children: [{ code: line, language: context }], context };
	}

	const heading = line.match(HEADING);
	if (heading) {
		return {
			name: `h${heading[1].trim().length}`,
			children: [{ mark: heading[1] }, ...inlineTokens(heading[2])],
			context,
		};
	}

	const quote = line.match(QUOTE);
	if (quote) {
		return { name: "quote", children: [{ mark: quote[1] }, ...inlineTokens(quote[2])], context };
	}

	if (ROW.test(line)) {
		const rule = ALIGN.test(line);
		return { name: rule ? "align" : "row", children: rowTokens(line, rule), context };
	}

	if (RULE.test(line)) {
		return { name: "rule", children: [{ mark: line }], context };
	}

	const item = line.match(ITEM);
	if (item) {
		// A number is the one marker that carries meaning of its own, so it
		// stays on the page when the rest are hidden; a bullet is drawn back
		// by the stylesheet.
		const ordered = /\d/.test(item[1]);
		return {
			name: ordered ? "ordered" : "list",
			children: [{ mark: item[1], name: ordered ? "number" : undefined }, ...inlineTokens(item[2])],
			context,
		};
	}

	return { name: "para", children: inlineTokens(line), context };
}

// tokenLines reads a whole source, carrying the fence context from each line
// to the next.
export function tokenLines(source) {
	const out = [];
	let context = null;

	for (const line of source.split("\n")) {
		const token = tokenise(line, context);
		out.push(token);
		context = token.context;
	}

	return out;
}

// markup writes one line's tokens as a string of HTML. The surface builds
// nodes from the same tokens; this is for a host colouring markdown on a
// page it only reads.
function markup(tokens, prefix) {
	let out = "";

	for (const token of tokens ?? []) {
		if (token.text !== undefined) {
			out += escapeHTML(token.text);
		} else if (token.mark !== undefined) {
			const classes = `${prefix}-mark${token.name ? ` ${prefix}-${token.name}` : ""}`;
			out += `<span class="${classes}">${escapeHTML(token.mark)}</span>`;
		} else if (token.picture !== undefined) {
			out += `<img class="${prefix}__pic" src="${escapeHTML(token.picture.src).replace(/"/g, "&quot;")}" alt="">`;
		} else if (token.code !== undefined) {
			out += highlightCode(token.code, prefix, token.language);
		} else {
			out += `<span class="${prefix}-${token.name}">${markup(token.children, prefix)}</span>`;
		}
	}

	return out;
}

// highlight answers the HTML for one markdown source, one line per element.
export function highlight(source, prefix = "mdedit") {
	return tokenLines(source)
		.map((token) => `<div class="${prefix}__line ${prefix}-${token.name}">${markup(token.children, prefix) || "<br>"}</div>`)
		.join("");
}
