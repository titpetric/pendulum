// Pendulum's frontend: a file listing and an editor, routed off the URL.
//
// The editing surface is mdedit (vendor/mdedit); what is here is the chrome
// around it, the calls to the API, and the preview pane that renders through
// the server.

import { MarkdownEditor, TOOLBAR_FULL } from "/vendor/mdedit/mdedit.min.js";

const app = document.getElementById("app");

const LOGO = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2"
	stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<path d="M16 4v24"/><path d="M6 28h20"/><path d="M6 10h20"/>
	<circle cx="16" cy="7" r="2" fill="currentColor" stroke="none"/>
	<path d="M6 10 2 19h8z"/><path d="M26 10l-4 9h8z"/></svg>`;

// ── The API ───────────────────────────────────────────────────────────────

async function call(url, options = {}) {
	const response = await fetch(url, options);
	const answer = await response.json().catch(() => ({ error: response.statusText }));
	if (answer.error) {
		throw new Error(answer.error);
	}

	return answer;
}

const api = {
	list: (folder) => call(`/api/list${folder}`),
	read: (file) => call(`/api/read${file}`),
	store: (file, contents) =>
		call(`/api/store${file}`, { method: "POST", body: form({ contents }) }),
	preview: (body, path) =>
		call("/api/preview", { method: "POST", body: form({ body, path }) }),
};

function form(fields) {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		body.append(name, value);
	}

	return body;
}

// ── Chrome ────────────────────────────────────────────────────────────────

function escape(text) {
	return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function bar(path, actions) {
	return `<header class="bar">
		<a class="brand" href="/" data-link>${LOGO} Pendulum</a>
		<span class="crumbs">${escape(path)}</span>
		<span class="actions">${actions}</span>
	</header>`;
}

function fail(message) {
	return `<div class="error">${escape(message)}</div>`;
}

function when(stamp) {
	const date = new Date(stamp);
	return Number.isNaN(date.valueOf()) ? "" : date.toLocaleString();
}

// rebase points the page's relative links at one folder. Every URL the app
// itself uses starts with a slash, so the base reaches the document alone:
// the images it draws, in the surface and in the preview.
function rebase(folder) {
	document.querySelector("base").href = folder;
}

// ── The listing ───────────────────────────────────────────────────────────

async function listing(folder) {
	app.innerHTML = bar(folder, `<button data-new>New file</button>`);
	rebase("/");

	const body = document.createElement("div");
	body.className = "listing";
	app.appendChild(body);

	app.querySelector("[data-new]").addEventListener("click", () => {
		const name = prompt("New file:", "notes.md");
		if (name) {
			go(`/edit${folder.replace(/\/$/, "")}/${name}`);
		}
	});

	let answer;
	try {
		answer = await api.list(folder);
	} catch (err) {
		body.innerHTML = fail(err.message);
		return;
	}

	if (!answer.files.length) {
		body.innerHTML = `<div class="files"><p class="empty">This folder is empty.</p></div>`;
		return;
	}

	const up = folder === "/" ? "" :
		`<a class="entry" data-type="dir" href="${escape(parent(folder))}" data-link>
			<span class="mark">&larr;</span><span class="name">..</span></a>`;

	body.innerHTML = `<div class="files">${up}${answer.files.map(entry).join("")}</div>`;
}

function entry(file) {
	const target = file.type === "dir" ? file.path : `/edit${file.path}`;
	const mark = file.type === "dir" ? "&#9655;" : "&#183;";

	return `<a class="entry" data-type="${file.type}" href="${escape(target)}" data-link>
		<span class="mark">${mark}</span>
		<span class="name">${escape(file.name)}${file.type === "dir" ? "/" : ""}</span>
		<span class="when">${escape(when(file.last_modified))}</span>
	</a>`;
}

function parent(folder) {
	const trimmed = folder.replace(/\/$/, "");
	return trimmed.slice(0, trimmed.lastIndexOf("/") + 1) || "/";
}

// ── The editor ────────────────────────────────────────────────────────────

async function editing(file) {
	app.innerHTML = bar(file, `
		<span class="status" role="status"></span>
		<button data-save data-primary>Save</button>
		<button data-close>Close</button>`);

	const screen = document.createElement("div");
	screen.className = "editor";
	screen.innerHTML = `
		<div class="pane pane--source"><textarea id="source"></textarea></div>
		<div class="pane"><article class="preview"></article></div>`;
	app.appendChild(screen);

	// The surface draws the pictures the document points at, and a relative
	// address in it has to answer the same file the published page answers.
	// The base is the document's own folder under /contents, the path the
	// server rewrites a preview image to.
	rebase(`/contents${file.replace(/\.[^./]*$/, "")}/`);

	const status = app.querySelector(".status");
	const article = screen.querySelector(".preview");
	const source = screen.querySelector("#source");

	let document_ = { contents: "" };
	try {
		document_ = await api.read(file);
	} catch (err) {
		article.innerHTML = fail(err.message);
	}

	source.value = document_.contents;

	const editor = new MarkdownEditor(source, {
		// No Preview button, and no `preview` for the editor to call: the
		// pane beside it is always on and holds the server's render. The
		// pilcrow switches the marker characters on the surface.
		toolbar: [...TOOLBAR_FULL, "upload"],
		uploads: {
			endpoint: "/api/upload",
			field: "file",
			// The server stores beside the document, so the request
			// carries which document the paste landed in.
			params: () => ({ path: file }),
			accept: ["image/"],
			maxBytes: 16 * 1024 * 1024,
		},
	});

	let saved = editor.value;
	let timer = null;

	function say(message, state = "") {
		status.textContent = message;
		status.dataset.state = state;
	}

	async function render() {
		try {
			const answer = await api.preview(editor.value, file);
			article.innerHTML = answer.html;
		} catch (err) {
			article.innerHTML = fail(err.message);
		}
	}

	async function save() {
		say("saving...");
		try {
			const answer = await api.store(file, editor.value);
			saved = editor.value;
			say(answer.log ? "saved, committed" : "saved", "saved");
		} catch (err) {
			say(err.message, "error");
		}
	}

	editor.on("change", () => {
		say(editor.value === saved ? "" : "unsaved");
		clearTimeout(timer);
		timer = setTimeout(render, 250);
	});
	editor.on("upload", ({ state, file: upload }) => {
		say(state === "start" ? `uploading ${upload.name || "file"}...` : "uploaded");
	});
	editor.on("error", ({ error }) => say(error.message, "error"));

	app.querySelector("[data-save]").addEventListener("click", save);
	app.querySelector("[data-close]").addEventListener("click", () => {
		if (editor.value === saved || confirm("Discard the unsaved changes?")) {
			go(parent(file));
		}
	});

	// Scroll the two panes together, by percentage: the surface and the
	// rendered document are different heights, so an offset in lines would
	// drift apart immediately. The surface scrolls itself; the preview
	// scrolls in its pane.
	const pane = article.parentElement;
	link(editor.surface, pane);
	link(pane, editor.surface);

	window.addEventListener("keydown", (event) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "s") {
			event.preventDefault();
			save();
		}
	});

	window.addEventListener("beforeunload", (event) => {
		if (editor.value !== saved) {
			event.preventDefault();
		}
	});

	render();
}

function link(from, to) {
	let quiet = false;

	from.addEventListener("scroll", () => {
		if (quiet) {
			quiet = false;
			return;
		}
		quiet = true;

		const reach = from.scrollHeight - from.clientHeight;
		const offset = reach > 0 ? from.scrollTop / reach : 0;
		to.scrollTop = (to.scrollHeight - to.clientHeight) * offset;
	});
}

// ── Routing ───────────────────────────────────────────────────────────────

function go(path) {
	history.pushState(null, "", path);
	route();
}

function route() {
	const path = decodeURIComponent(location.pathname);

	if (path.startsWith("/edit/")) {
		editing(path.slice("/edit".length));
		return;
	}

	listing(path.endsWith("/") ? path : path + "/");
}

document.addEventListener("click", (event) => {
	const link = event.target.closest("a[data-link]");
	if (link && !event.metaKey && !event.ctrlKey) {
		event.preventDefault();
		go(link.getAttribute("href"));
	}
});

window.addEventListener("popstate", route);

route();
