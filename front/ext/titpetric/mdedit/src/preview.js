// What an upload looks like while it is on its way: the file's icon, its
// name, a bar that fills as the bytes leave the browser and the time it has
// left, on one line; and, when the request fails, the reason and one small
// button that opens the picker again.
//
// The preview stands inside a line of the surface, so it carries no text of
// its own. Every word it says - the name, the size, the reason - rides in a
// data attribute and the stylesheet writes it back as generated content, the
// way a heading's level label does. A text node in here would be a text node
// in the document the form posts and a character the caret has to count.
//
// Only spans: a line holding a div or a p is a line the browser restructured,
// and the surface answers that by building the whole document again.

import { tool } from "./util.js";

// size reads a byte count the way a person does: one number and one unit,
// with a decimal only where it says something.
export function size(bytes) {
	const value = Number(bytes) || 0;
	if (value < 1024) {
		return `${Math.round(value)} B`;
	}

	const units = ["kB", "MB", "GB", "TB"];
	let amount = value;
	let at = -1;
	do {
		amount /= 1024;
		at += 1;
	} while (amount >= 1024 && at < units.length - 1);

	const rounded = amount < 10 ? Math.round(amount * 10) / 10 : Math.round(amount);
	return `${rounded} ${units[at]}`;
}

// iconFor names the mark the stylesheet draws beside the file: what kind of
// file this is, in the one glyph that says it.
export function iconFor(file) {
	const type = file?.type || "";
	if (type.startsWith("image/")) {
		return "icon-image";
	}
	if (type.startsWith("audio/")) {
		return "icon-audio";
	}
	if (type.startsWith("video/")) {
		return "icon-video";
	}

	return "icon-file";
}

// eta reads the seconds a request has left the way a person says them: one
// number and one unit, and the minutes only once they are worth saying.
function eta(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) {
		return "";
	}

	if (seconds < 60) {
		return `${Math.max(1, Math.round(seconds))}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds % 60);
	return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

const part = (className) => {
	const element = document.createElement("span");
	element.className = className;

	return element;
};

// preview builds the node for one upload record. It reads the record, so a
// record already past its start - a failure the writer can see - draws as
// that from the first paint.
export function preview(record, editor) {
	const prefix = editor.prefix;
	const texts = editor.texts;

	const node = part(`${prefix}__upload`);
	node.dataset.upload = String(record.id);
	node.dataset.state = record.state;
	node.dataset.inline = String(Boolean(record.inline));
	node.contentEditable = "false";
	node.setAttribute("role", "group");

	const icon = part(`${prefix}__upload-icon icon ${iconFor(record.file)}`);
	icon.setAttribute("aria-hidden", "true");

	const text = part(`${prefix}__upload-text`);
	const name = part(`${prefix}__upload-name`);
	name.dataset.name = record.name || "";
	const weight = part(`${prefix}__upload-size`);
	weight.dataset.size = size(record.file?.size ?? 0);

	const bar = part(`${prefix}__upload-bar`);
	bar.setAttribute("role", "progressbar");
	bar.setAttribute("aria-valuemin", "0");
	bar.setAttribute("aria-valuemax", "100");
	const fill = part(`${prefix}__upload-fill`);
	bar.appendChild(fill);

	const estimate = part(`${prefix}__upload-eta`);
	estimate.setAttribute("aria-hidden", "true");

	const error = part(`${prefix}__upload-error`);
	error.dataset.error = record.error || "";

	const retry = tool({
		prefix,
		key: "upload-retry",
		icon: "icon-upload",
		title: texts.uploadRetry,
		run: (event) => {
			event?.stopPropagation();
			editor.uploads?.retry(record);
		},
	});

	text.append(name, weight);
	node.append(icon, text, bar, estimate, error, retry);
	// The record keeps the preview it is drawn on, so progress reaches this
	// node and no other: the line it stands in is painted again for a
	// keystroke elsewhere, and that paint builds a new preview.
	record.node = node;
	render(node, record, editor);

	return node;
}

// render puts one record's state on its preview: the bar's fill, the reason
// it failed, and the one sentence a reader who cannot see the chip hears.
// Progress arrives here and nowhere else - no markdown is written and no
// caret moves - so an upload can run for a minute under a writer who has
// moved on.
export function render(node, record, editor) {
	const prefix = editor.prefix;
	const texts = editor.texts;
	const bits = size(record.file?.size ?? 0);

	node.dataset.state = record.state;
	node.dataset.inline = String(Boolean(record.inline));

	const name = node.querySelector(`.${prefix}__upload-name`);
	if (name) {
		name.dataset.name = record.name || "";
	}

	const weight = node.querySelector(`.${prefix}__upload-size`);
	if (weight) {
		weight.dataset.size = bits;
	}

	const bar = node.querySelector(`.${prefix}__upload-bar`);
	const fill = node.querySelector(`.${prefix}__upload-fill`);
	const ratio = record.total > 0 ? Math.min(Math.max(record.loaded / record.total, 0), 1) : 0;

	if (record.total > 0) {
		node.dataset.known = "true";
		bar?.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
	} else {
		node.dataset.known = "false";
		bar?.removeAttribute("aria-valuenow");
	}
	if (fill) {
		fill.style.width = record.total > 0 ? `${Math.round(ratio * 100)}%` : "";
	}

	const error = node.querySelector(`.${prefix}__upload-error`);
	if (error) {
		error.dataset.error = record.error || "";
	}

	// The estimate is the bytes left over the rate the request has kept so
	// far. A request that has not counted its bytes has no rate, and the
	// line says nothing rather than guessing.
	const left = record.state === "start" || record.state === "progress" ? eta(record.eta) : "";
	const estimate = node.querySelector(`.${prefix}__upload-eta`);
	if (estimate) {
		estimate.dataset.eta = left ? `${texts.uploadEta} ${left}` : "";
	}

	const said =
		record.state === "failed"
			? `${record.name}, ${bits}, ${texts.uploadFailed}: ${record.error || texts.uploadUnreachable}`
			: record.state === "done"
				? `${record.name}, ${bits}, ${texts.uploadDone}`
				: `${record.name}, ${bits}, ${texts.uploading} ${Math.round(ratio * 100)}%${left ? `, ${texts.uploadEta} ${left}` : ""}`;
	node.setAttribute("aria-label", said);

	// The retry button says which file it would try again, for anyone
	// reading the chip rather than looking at it.
	const retry = node.querySelector(`.${prefix}__tool--upload-retry`);
	if (retry) {
		retry.title = texts.uploadRetry;
		retry.setAttribute("aria-label", `${texts.uploadRetry}: ${record.name}`);
	}
}
