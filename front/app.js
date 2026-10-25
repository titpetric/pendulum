// Pendulum's frontend: a file listing and an editor, routed off the URL.
//
// The editing surface is mdedit (vendor/mdedit); what is here is the chrome
// around it, the calls to the API, and the preview pane that renders through
// the server.

import { MarkdownEditor, TOOLBAR_FULL, highlightCode } from "/vendor/mdedit/mdedit.min.js";

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
	mkdir: (folder) => call(`/api/mkdir${folder}`, { method: "POST" }),
	rename: (from, to) => call(`/api/rename${from}`, { method: "POST", body: form({ to }) }),
	remove: (entry) => call(`/api/delete${entry}`, { method: "POST" }),
	search: (query) => call(`/api/search?q=${encodeURIComponent(query)}`),
	settings: () => call("/api/settings"),
};

// The flags behind the editor's behaviour. The page reads them once, and a
// failure leaves the defaults, where every save is the writer's own.
let settings = { autosave_seconds: 0, extensions: [] };
api.settings()
	.then((answer) => {
		settings = answer;
	})
	.catch(() => {});

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
	app.innerHTML = bar(folder, `
		<input class="find" type="search" placeholder="Search the folder" aria-label="Search every file" data-find>
		<button data-folder>New folder</button>
		<button data-new data-primary>New file</button>`);
	rebase("/");

	const body = document.createElement("div");
	body.className = "listing";
	app.appendChild(body);

	const draw = async () => {
		let answer;
		try {
			answer = await api.list(folder);
		} catch (err) {
			body.innerHTML = fail(err.message);
			return;
		}

		const up = folder === "/" ? "" :
			`<div class="entry" data-type="dir">
				<a class="mark" href="${escape(parent(folder))}" data-link>&larr;</a>
				<a class="name" href="${escape(parent(folder))}" data-link>..</a></div>`;

		if (!answer.files.length) {
			body.innerHTML = `<div class="files">${up}<p class="empty">This folder is empty.</p></div>`;
			return;
		}

		body.innerHTML = `<div class="files">${up}${answer.files.map(entry).join("")}</div>`;
	};

	app.querySelector("[data-new]").addEventListener("click", () => {
		const name = prompt("New file:", "notes.md");
		if (name) {
			go(`/edit${folder.replace(/\/$/, "")}/${name}`);
		}
	});

	app.querySelector("[data-folder]").addEventListener("click", async () => {
		const name = prompt("New folder:", "notes");
		if (!name) {
			return;
		}
		try {
			await api.mkdir(`${folder.replace(/\/$/, "")}/${name}`);
			await draw();
		} catch (err) {
			body.innerHTML = fail(err.message) + body.innerHTML;
		}
	});

	// A search reads every file under the folder, so it waits for the typing
	// to stop before it asks.
	const find = app.querySelector("[data-find]");
	let typing = null;
	find.addEventListener("input", () => {
		clearTimeout(typing);
		typing = setTimeout(() => {
			const query = find.value.trim();
			if (query === "") {
				draw();
				return;
			}
			results(body, query);
		}, 250);
	});

	// An action on a row. The name is a link, so these are buttons beside it
	// and the click on the name stays what it is.
	body.addEventListener("click", async (event) => {
		const button = event.target.closest("button[data-act]");
		if (!button) {
			return;
		}

		const row = button.closest(".entry");
		const target = row.dataset.path;
		const name = row.dataset.name;

		try {
			if (button.dataset.act === "rename") {
				const to = prompt("Rename to:", name);
				if (!to || to === name) {
					return;
				}
				await api.rename(target, `${parent(target)}${to}`);
			} else {
				const what = row.dataset.type === "dir" ? `the folder ${name}` : name;
				if (!confirm(`Delete ${what}?`)) {
					return;
				}
				await api.remove(target);
			}
			await draw();
		} catch (err) {
			body.innerHTML = fail(err.message) + body.innerHTML;
		}
	});

	await draw();
}

// results shows what a search found: the line, the file it is in, and a way
// into that file.
async function results(body, query) {
	body.innerHTML = `<div class="files"><p class="empty">Reading the folder...</p></div>`;

	let answer;
	try {
		answer = await api.search(query);
	} catch (err) {
		body.innerHTML = fail(err.message);
		return;
	}

	if (!answer.hits.length) {
		body.innerHTML = `<div class="files"><p class="empty">Nothing in ${answer.searched} files carries ${escape(query)}.</p></div>`;
		return;
	}

	const rows = answer.hits.map((hit) => `<a class="hit" href="/edit${escape(hit.path)}" data-link>
		<span class="hit__where">${escape(hit.name)}<span class="hit__line">:${hit.line}</span></span>
		<span class="hit__text">${highlight(hit.text, query)}</span>
	</a>`).join("");

	const capped = answer.capped ? ", the first of them" : "";
	body.innerHTML = `<div class="files">
		<p class="found">${count(answer.hits.length, "line")} in ${count(answer.files, "file")}${capped}</p>${rows}</div>`;
}

// count writes a number and the thing it counts, in the number's own form.
function count(many, thing) {
	return `${many} ${thing}${many === 1 ? "" : "s"}`;
}

// highlight shows the phrase inside the line it stands on.
function highlight(text, query) {
	const at = text.toLowerCase().indexOf(query.toLowerCase());
	if (at < 0) {
		return escape(text);
	}

	return escape(text.slice(0, at)) +
		`<mark>${escape(text.slice(at, at + query.length))}</mark>` +
		escape(text.slice(at + query.length));
}

function entry(file) {
	const target = file.type === "dir" ? file.path : `/edit${file.path}`;
	const mark = file.type === "dir" ? "&#9655;" : "&#183;";

	return `<div class="entry" data-type="${file.type}" data-path="${escape(file.path)}" data-name="${escape(file.name)}">
		<a class="mark" href="${escape(target)}" data-link>${mark}</a>
		<a class="name" href="${escape(target)}" data-link>${escape(file.name)}${file.type === "dir" ? "/" : ""}</a>
		<span class="when">${escape(when(file.last_modified))}</span>
		<span class="row-actions">
			<button data-act="rename" data-quiet>Rename</button>
			<button data-act="delete" data-quiet>Delete</button>
		</span>
	</div>`;
}

function parent(folder) {
	const trimmed = folder.replace(/\/$/, "");
	return trimmed.slice(0, trimmed.lastIndexOf("/") + 1) || "/";
}

// ── The editor ────────────────────────────────────────────────────────────

async function editing(file) {
	app.innerHTML = bar(file, `
		<span class="status" role="status"></span>
		<button data-preview aria-pressed="true">Preview</button>
		<button data-save data-primary>Save</button>
		<button data-close>Close</button>`);

	const screen = document.createElement("div");
	screen.className = "editor";
	screen.innerHTML = `
		<div class="pane pane--source"><textarea id="source"></textarea></div>
		<div class="split" role="separator" aria-orientation="vertical" aria-label="Resize the preview" tabindex="0"></div>
		<div class="pane pane--preview"><article class="preview"></article></div>`;
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
		// The pane beside the surface holds the server's render, and the
		// pilcrow switches the marker characters on the surface itself.
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
	let idle = null;

	function say(message, state = "") {
		status.textContent = message;
		status.dataset.state = state;
	}

	async function render() {
		try {
			const answer = await api.preview(editor.value, file);
			article.innerHTML = answer.html;
			colour(article);
		} catch (err) {
			article.innerHTML = fail(err.message);
		}
	}

	async function save(what = "saved") {
		clearTimeout(idle);
		say("saving...");
		try {
			const answer = await api.store(file, editor.value);
			saved = editor.value;
			say(answer.log ? `${what}, committed` : what, "saved");
		} catch (err) {
			say(err.message, "error");
		}
	}

	// A document left alone saves itself where -autosave names a wait. Every
	// save commits, so the wait is a flag and never a constant, and without
	// the flag nothing happens at all.
	function waitThenSave() {
		clearTimeout(idle);
		if (!settings.autosave_seconds) {
			return;
		}
		idle = setTimeout(() => {
			if (editor.value !== saved) {
				save("saved by itself");
			}
		}, settings.autosave_seconds * 1000);
	}

	editor.on("change", () => {
		say(editor.value === saved ? "" : "unsaved");
		clearTimeout(timer);
		timer = setTimeout(render, 250);
		waitThenSave();
	});
	editor.on("upload", ({ state, file: upload }) => {
		say(state === "start" ? `uploading ${upload.name || "file"}...` : "uploaded");
	});
	editor.on("error", ({ error }) => say(error.message, "error"));

	app.querySelector("[data-save]").addEventListener("click", () => save());

	// The preview pane folds away, and the split between the two moves. Both
	// are remembered, so the width a writer sets is the width they get back.
	const splitter = screen.querySelector(".split");
	const button = app.querySelector("[data-preview]");

	function lay(showing, share) {
		screen.dataset.panes = showing ? "both" : "source";
		button.setAttribute("aria-pressed", String(showing));
		screen.style.setProperty("--split", `${share}fr`);
		localStorage.setItem("pendulum.preview", showing ? "on" : "off");
		localStorage.setItem("pendulum.split", String(share));
	}

	let share = Number(localStorage.getItem("pendulum.split"));
	if (!Number.isFinite(share) || share <= 0) {
		share = 1;
	}
	lay(localStorage.getItem("pendulum.preview") !== "off", share);

	button.addEventListener("click", () => lay(screen.dataset.panes === "source", share));

	const drag = (clientX) => {
		const box = screen.getBoundingClientRect();
		const left = Math.min(Math.max(clientX - box.left, 180), box.width - 180);
		share = (box.width - left) / left;
		lay(true, share);
	};

	splitter.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		splitter.setPointerCapture(event.pointerId);
		const move = (moving) => drag(moving.clientX);
		const stop = () => {
			splitter.removeEventListener("pointermove", move);
			splitter.removeEventListener("pointerup", stop);
		};
		splitter.addEventListener("pointermove", move);
		splitter.addEventListener("pointerup", stop);
	});

	// The keyboard moves it too, in steps a reader can follow.
	splitter.addEventListener("keydown", (event) => {
		const step = { ArrowLeft: 1.1, ArrowRight: 1 / 1.1 }[event.key];
		if (!step) {
			return;
		}
		event.preventDefault();
		share = Math.min(Math.max(share * step, 0.2), 5);
		lay(true, share);
	});
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

	// A tab closed or a window hidden with something unsaved: the writer may
	// never come back to this page, so the timer's work happens now.
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden" && settings.autosave_seconds && editor.value !== saved) {
			save("saved by itself");
		}
	});

	window.addEventListener("beforeunload", (event) => {
		if (editor.value !== saved) {
			event.preventDefault();
		}
	});

	render();
}

// colour paints the preview's fenced blocks with the colourer the surface
// uses, so one language reads the same on both sides of the screen. The
// server renders the markdown and says which language a block carries; the
// classes land where the editor's own stylesheet already paints them.
function colour(where) {
	for (const block of where.querySelectorAll("pre > code")) {
		const language = (block.className.match(/language-(\S+)/) || [])[1] || "";
		block.innerHTML = block.textContent
			.split("\n")
			.map((line) => highlightCode(line, "mdedit", language))
			.join("\n");
	}
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
