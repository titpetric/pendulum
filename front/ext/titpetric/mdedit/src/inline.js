// Inline markdown to HTML: what fits inside one cell or one caption.
//
// The grid renders a cell with this, so a table reads as a table and not as
// a column of pipes, the image panel renders its caption the same way, and
// render.js runs it over the inside of every block. A table cell holds a
// phrase, so the block constructs are render.js's half of the mapping and
// not this one's.
//
// Nothing is stripped. A link to any address is a link: the editor is for
// an author writing their own document, and the server that takes the
// document decides what it will serve.

import { escapeHTML } from "./escape.js";

// The sentinel a code span rides through the emphasis patterns behind, and
// the pattern that finds it again.
//
// It is built here, since the character cannot stand in a source file: a NUL
// byte makes the whole file binary to git, which then reports it as data and
// prints no diff of it. Markdown carries no NUL either, so nothing in a
// document collides with the placeholder.
const HOLD = String.fromCharCode(0);
const HELD = new RegExp(`${HOLD}(\\d+)${HOLD}`, "g");

export function renderInline(markdown) {
	const parts = [];

	// Code spans come out first and ride through as placeholders, so the
	// emphasis patterns never read the characters inside them.
	let text = escapeHTML(markdown).replace(/(`+)([^`]+?)\1/g, (match, ticks, body) => {
		parts.push(`<code>${body}</code>`);
		return `${HOLD}${parts.length - 1}${HOLD}`;
	});

	text = text
		.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, alt, src, title) =>
			`<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ""}>`)
		.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, label, href, title) =>
			`<a href="${href}"${title ? ` title="${title}"` : ""}>${label}</a>`)
		.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
		.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
		.replace(/(^|[\s(])([*_])(?=\S)([^*_\n]*?\S)\2(?=[\s.,;:!?)]|$)/g, "$1<em>$3</em>");

	return text.replace(HELD, (match, index) => parts[Number(index)]);
}

// A link to a file a browser can play is drawn as a player: an episode, a
// recording, a screen capture. The address says so and nothing else does -
// a markdown link carries no type - so the extension is the contract, and
// it holds for a file on the server and for a public URL alike.
//
// Publishing one of these documents means reading the same list: the editor
// draws the player the reader will get.
const MEDIA = {
	audio: ["mp3", "m4a", "aac", "oga", "ogg", "opus", "wav", "flac", "weba"],
	video: ["mp4", "m4v", "webm", "ogv", "mov"],
};

// mediaKind answers "audio", "video", or an empty string for an address
// that names neither.
export function mediaKind(href) {
	const path = String(href ?? "").split(/[?#]/)[0];
	const dot = path.lastIndexOf(".");
	if (dot < 0) {
		return "";
	}

	const extension = path.slice(dot + 1).toLowerCase();
	for (const [kind, list] of Object.entries(MEDIA)) {
		if (list.includes(extension)) {
			return kind;
		}
	}

	return "";
}

// images answers every image in a source, with the range each one covers.
// The image panel reads this to find the one under the caret.
export function images(source) {
	const found = [];
	const pattern = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)/g;

	for (const match of source.matchAll(pattern)) {
		found.push({
			start: match.index,
			end: match.index + match[0].length,
			alt: match[1],
			src: match[2],
			title: match[3] ?? "",
		});
	}

	return found;
}

// imageAt answers the image the caret sits in, or null.
export function imageAt(source, caret) {
	return images(source).find((image) => caret >= image.start && caret <= image.end) ?? null;
}

// imageMarkdown writes one back.
export function imageMarkdown({ alt, src, title }) {
	const caption = title ? ` "${title}"` : "";
	return `![${alt}](${src}${caption})`;
}

// Where an image sits in the text it stands in rides in its address as an
// anchor - `![alt](photo.png#left)` - so the document stays markdown and no
// raw HTML has to be allowed through for a picture to float. The stylesheet
// keys on the same anchor with `img[src*="#left"]`.
export const ALIGNMENTS = ["left", "center", "right"];

const ANCHOR = /#(left|center|right)$/;

// imageAlign answers the alignment one address carries, or an empty string.
export function imageAlign(src) {
	return src.match(ANCHOR)?.[1] ?? "";
}

// alignImage writes an alignment onto an address, and an empty one takes the
// anchor back off.
export function alignImage(src, align) {
	const bare = src.replace(ANCHOR, "");
	return align ? `${bare}#${align}` : bare;
}
