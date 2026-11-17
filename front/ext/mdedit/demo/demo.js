// The demo page: one editor over one file, saving through the demo server and
// uploading to it. This is the whole of the wiring a project needs - the
// component is configured once and the rest is the host's own business.

import { MarkdownEditor, TOOLBAR_FULL } from "../dist/mdedit.js";

const config = JSON.parse(document.getElementById("config").textContent);
const form = document.getElementById("editor");
const field = document.getElementById("body");
const status = document.getElementById("status");

const editor = new MarkdownEditor(field, {
	// "upload" is the file picker, registered because uploads are configured;
	// paste and drop work with or without it on the bar.
	toolbar: [...TOOLBAR_FULL, "upload"],
	uploads: {
		endpoint: config.upload,
		token: config.token,
		field: "file",
		accept: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"],
		maxBytes: 8 * 1024 * 1024,
	},
	texts: {
		tooLarge: "That image is over 8 MB; make it smaller and paste again.",
		notAccepted: "This server stores png, jpeg, gif, webp and svg.",
	},
});

// The demo keeps the editor where a console can reach it. A project has no
// reason to.
window.editor = editor;

let saved = editor.value;

function say(text) {
	status.textContent = text;
}

const dirty = () => (editor.value === saved ? "" : "unsaved");

editor.on("change", () => say(dirty()));
// The pilcrow shows or hides the markup. The demo names the view it stands
// in, so the toggle reads outside the bar too.
editor.on("marks", ({ marks }) => say(marks ? dirty() : "markup hidden"));
editor.on("upload", ({ state, file }) => {
	say(state === "start" ? `uploading ${file.name || "image"}...` : "uploaded");
});
editor.on("error", ({ error }) => say(error.message));

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	say("saving...");

	const body = new FormData();
	body.append("file", config.file);
	body.append("body", editor.value);

	try {
		const response = await fetch(config.save, { method: "POST", body });
		const answer = await response.json();
		if (answer.error) {
			throw new Error(answer.error);
		}
		saved = editor.value;
		say(`saved ${answer.bytes} bytes`);
	} catch (err) {
		say(`could not save: ${err.message}`);
	}
});

// The browser's own save gesture, since the toolbar has no Save of its own.
document.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key === "s") {
		event.preventDefault();
		form.requestSubmit();
	}
});
