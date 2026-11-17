// Uploads: a file pasted, dropped or picked goes to the server, and the
// markdown that references it replaces a placeholder the writer can watch.
//
// The wire format is one request per file and nothing clever about it:
//
//	POST <endpoint>                      (PUT with method: "PUT")
//	Authorization: Bearer <token>        (when a token is configured)
//	Content-Type: multipart/form-data    (file under `field`, plus `params`)
//	-> 200 {"url": "/path/the/server/chose"}
//	-> any other answer, or {"error": "..."} , is a failure the editor shows
//
// With `encoding: "raw"` the body is the bytes themselves, the Content-Type
// is the file's own, and the original name rides along in X-Filename
// (percent-encoded, since a header is not a place for arbitrary bytes). The
// server names the stored file - a ulid, a hash, whatever it likes - and the
// editor only ever learns the URL it answers with.
//
// A file on its way is a record here, not a character in the document. The
// markdown keeps the placeholder it always had, and the preview the writer
// watches - icon, name, bar, time left - is drawn in its place from the
// record. Progress changes the drawing and nothing else: the document is the
// writer's, and a request does not move their caret.

import { preview, render } from "./preview.js";
import { resolve } from "./util.js";

// What a stored file reads as in the document. An image is a picture; a
// recording, a capture or a paper is a link, which the editor draws as a
// player where the address names one a browser can play, and which reads as
// a plain link everywhere else.
function snippetFor(url, file) {
	if ((file.type || "").startsWith("image/")) {
		return `![](${url})`;
	}

	return `[${file.name || url}](${url})`;
}

export class Uploads {
	constructor(editor, options) {
		this.editor = editor;
		this.options = options;
		this.counter = 0;
		this.picker = null;
		this.receive = null;
		// Every file on its way or waiting to be tried again, by id, and the
		// line each one stands on. A line is the key: two uploads into one
		// document are two records, and the preview the surface paints is
		// found by the markdown the line holds.
		this.records = new Map();
		this.byLine = new Map();
		this.sequence = 0;
		this.dead = false;
	}

	// accepts answers whether a file arriving that way belongs here. The
	// surface owns the paste and the drop - it has to, the caret is its
	// business - and asks this before handing the files over.
	accepts(gesture) {
		return this.options[gesture] !== false;
	}

	files(list) {
		return Promise.all([...list].map((file) => this.handle(file)));
	}

	// open opens the file picker, the way a form would. The `upload` tool
	// runs this; a host can call it from a button of its own. `receive` is
	// where the chosen files go, and with none named they upload into the
	// document; the image panel names one to swap an address in place.
	open(receive) {
		this.receive = receive ?? ((files) => this.files(files));

		if (!this.picker) {
			this.picker = document.createElement("input");
			this.picker.type = "file";
			this.picker.hidden = true;
			this.picker.multiple = true;
			const accept = this.options.accept;
			if (Array.isArray(accept) && accept.length) {
				this.picker.accept = accept.map((type) => (type.endsWith("/") ? `${type}*` : type)).join(",");
			}
			this.picker.addEventListener("change", () => {
				const chosen = [...this.picker.files];
				this.picker.value = "";
				this.receive(chosen);
			});
			this.editor.root.appendChild(this.picker);
		}

		this.picker.click();
	}

	// refusal answers why a file cannot be uploaded, or null when it can.
	// `accept` is a list of mime prefixes ("image/") or exact types, or a
	// predicate; `allow` is the host's own gate and may answer a reason.
	async refusal(file) {
		const { accept = ["image/"], allow } = this.options;
		const texts = this.editor.texts;
		// A limit may be one number or a function of the file: a project that
		// takes an hour of audio still has no reason to take an hour of audio
		// as somebody's avatar.
		const limit = await resolve(this.options.maxBytes ?? 2 * 1024 * 1024, file);

		if (typeof accept === "function") {
			if (!accept(file)) {
				return texts.notAccepted;
			}
		} else if (Array.isArray(accept) && accept.length) {
			const type = file.type || "";
			const ok = accept.some((want) => (want.endsWith("/") ? type.startsWith(want) : type === want));
			if (!ok) {
				return texts.notAccepted;
			}
		}

		if (limit && file.size > limit) {
			return typeof texts.tooLarge === "function" ? texts.tooLarge(file, limit) : texts.tooLarge;
		}

		if (allow) {
			const verdict = await allow(file, this.editor);
			if (verdict === false) {
				return texts.notAccepted;
			}
			if (typeof verdict === "string") {
				return verdict;
			}
		}

		return null;
	}

	// store uploads one file and answers the URL, touching no markdown: what
	// a panel needs when the marker it rewrites is already in the document.
	// A refused file and a failed request both throw.
	async store(file) {
		const refusal = await this.refusal(file);
		if (refusal) {
			const error = new Error(refusal);
			this.editor.emit("error", { phase: "upload", file, error });
			throw error;
		}

		this.editor.emit("upload", { file, state: "start" });
		try {
			const url = await this.send(file);
			this.editor.emit("upload", { file, state: "done", url });
			return url;
		} catch (err) {
			this.editor.emit("error", { phase: "upload", file, error: err });
			throw err;
		}
	}

	async handle(file) {
		const texts = this.editor.texts;
		if (this.dead) {
			return null;
		}

		const refusal = await this.refusal(file);
		if (this.dead) {
			return null;
		}

		const source = this.editor.source;
		const inCell = source.active !== source;
		// A refused file in a cell has no line of its own to stand on and no
		// preview to say why, so the gesture simply writes nothing.
		if (refusal && inCell) {
			this.editor.emit("error", { phase: "upload", file, error: new Error(refusal) });
			return null;
		}

		this.counter += 1;
		// The placeholder is the same shape as what replaces it, so the line
		// does not change kind under the writer when the upload answers.
		const image = (file.type || "").startsWith("image/");
		const placeholder = this.options.placeholder
			? this.options.placeholder(file, this.counter)
			: `${image ? "!" : ""}[${texts.uploading} ${this.counter}...]()`;

		// The line the placeholder lands on, as the document will read it: what
		// stood before the caret in that line stays in front of it, and a
		// placeholder with a word in front of it is drawn in the sentence.
		const { start } = this.editor.selection;
		const value = this.editor.value;
		const head = value.lastIndexOf("\n", start - 1) + 1;
		const line = value.slice(head, start) + placeholder;
		const inline = line.trim() !== placeholder.trim();

		const watched = !inCell && !placeholder.includes("\n");
		const record = watched
			? this.arm(file, line, inline, refusal ? "failed" : "start", refusal ?? "", placeholder)
			: null;

		this.editor.insert(`${placeholder}\n`);

		// A refusal never reaches the network: the placeholder stays where it
		// landed and the preview on it carries the reason and the way back.
		if (refusal) {
			this.editor.emit("error", { phase: "upload", file, id: record?.id, error: new Error(refusal) });
			return null;
		}

		this.editor.emit("upload", { file, id: record?.id, state: "start" });

		try {
			const url = await this.send(file, record);
			if (this.dead) {
				return null;
			}

			const snippet = this.options.snippet
				? this.options.snippet(url, file)
				: snippetFor(url, file);
			if (record) {
				record.state = "done";
				record.loaded = record.total;
			}
			this.resolve(record, snippet, placeholder);
			this.editor.emit("upload", { file, id: record?.id, state: "done", url });
			return url;
		} catch (err) {
			if (this.dead) {
				return null;
			}

			const reason = err.message || texts.uploadUnreachable;
			if (record) {
				this.failed(record, reason);
			} else {
				// No preview stands for this one, so the placeholder goes back
				// out and the document is as it was before the gesture.
				this.swap(`${placeholder}\n`, "");
				this.swap(placeholder, "");
			}
			this.editor.emit("error", { phase: "upload", file, id: record?.id, error: err });
			return null;
		}
	}

	// ── The records ───────────────────────────────────────────────────────

	// arm puts one file under watch, on the line it is about to be written
	// on. The surface paints the line during the insert, so the record has to
	// be here first.
	arm(file, line, inline, state, error, placeholder = line) {
		this.sequence += 1;
		const record = {
			id: this.sequence,
			file,
			name: file.name || "",
			line,
			placeholder,
			inline,
			state,
			error,
			loaded: 0,
			total: 0,
			started: 0,
			eta: null,
			element: null,
			segment: null,
			node: null,
			call: null,
			dead: false,
		};

		this.records.set(record.id, record);
		this.key(record, line);
		return record;
	}

	// key adds a record to the line it stands on, in document order.
	key(record, line) {
		const ids = this.byLine.get(line) ?? [];
		ids.push(record.id);
		this.byLine.set(line, ids);
	}

	unkey(record, line) {
		const ids = this.byLine.get(line);
		if (!ids) {
			return;
		}

		const at = ids.indexOf(record.id);
		if (at >= 0) {
			ids.splice(at, 1);
		}
		if (!ids.length) {
			this.byLine.delete(line);
		}
	}

	// at answers the record one id names, for a panel drawing the queue.
	at(id) {
		return this.records.get(id) ?? null;
	}

	list() {
		return [...this.records.values()].sort((one, other) => one.id - other.id);
	}

	// nodeFor answers the preview for one line the surface is painting, or
	// null. A record already bound to this very element is one the line is
	// painted again for - a keystroke elsewhere in it - and takes the same
	// record; otherwise the earliest record waiting for a line takes this one,
	// so two identical failures bind to two records in the order they stand.
	nodeFor(line, element) {
		const ids = this.byLine.get(line);
		if (!ids || this.dead) {
			return null;
		}

		let record = null;
		for (const id of ids) {
			const one = this.records.get(id);
			if (one && !one.dead && one.element === element) {
				record = one;
				break;
			}
		}
		if (!record) {
			for (const id of ids) {
				const one = this.records.get(id);
				if (one && !one.dead && one.element === null) {
					record = one;
					break;
				}
			}
		}
		if (!record) {
			return null;
		}

		record.element = element;
		record.segment = element;
		return preview(record, this.editor);
	}

	// draw puts a record's current state on the preview standing for it, and
	// touches nothing else. An upload can report its bytes a hundred times a
	// second; the document is not rewritten for any of them.
	draw(record) {
		if (record.node && record.node.isConnected) {
			render(record.node, record, this.editor);
		}
	}

	// release drops the element each record is bound to, before the surface
	// builds the document again. The lines are painted next, and every record
	// whose line is still there is claimed by the new element.
	release() {
		for (const record of this.records.values()) {
			record.element = null;
			record.segment = null;
			record.node = null;
		}
		// A record whose line the writer edited away, or whose line an undo
		// took back, has nothing to stand on any more. The microtask lets the
		// rebuild finish first.
		queueMicrotask(() => this.prune());
	}

	// prune drops the records no line holds any more: not one still on its
	// way - a request runs to the end whether or not its line survived -
	// and not one whose preview the surface has just claimed.
	prune() {
		if (this.dead) {
			return;
		}

		const lines = new Set(this.editor.value.split("\n"));
		for (const record of [...this.records.values()]) {
			if (record.element?.isConnected) {
				continue;
			}
			if (record.state === "start" || record.state === "progress") {
				continue;
			}
			if (!lines.has(record.line)) {
				this.unbind(record);
			}
		}
	}

	// unbind takes a record out of the registry. The preview, if the surface
	// is holding one, goes at the next paint of its line.
	unbind(record) {
		if (!record) {
			return;
		}

		this.records.delete(record.id);
		this.unkey(record, record.line);
		record.element = null;
		record.segment = null;
		record.node = null;
	}

	// retry opens the picker for one failed record: the writer chooses the
	// file again, and the line it failed on stays where it is while the new
	// attempt runs.
	retry(record) {
		if (!record || record.state !== "failed" || !this.records.has(record.id)) {
			return;
		}

		this.open((files) => {
			const file = files[0];
			if (file) {
				this.attempt(record, file);
			}
		});
	}

	// attempt runs a failed record again with the file the writer chose. The
	// placeholder it stands on stays where it is throughout: a second failure
	// leaves it there with the new reason on the preview, and success replaces
	// it with the marker.
	async attempt(record, file) {
		const texts = this.editor.texts;
		if (!this.records.has(record.id) || record.state !== "failed") {
			return null;
		}

		record.file = file;
		record.name = file.name || record.name;
		record.state = "start";
		record.error = "";
		record.loaded = 0;
		record.total = 0;
		record.started = 0;
		record.eta = null;
		this.draw(record);
		this.editor.emit("upload", { file, id: record.id, state: "start" });

		const refusal = await this.refusal(file);
		if (this.dead) {
			return null;
		}
		if (refusal) {
			this.failed(record, refusal);
			this.editor.emit("error", { phase: "upload", file, id: record.id, error: new Error(refusal) });
			return null;
		}

		try {
			const url = await this.send(file, record);
			if (this.dead) {
				return null;
			}

			const snippet = this.options.snippet
				? this.options.snippet(url, file)
				: snippetFor(url, file);
			record.state = "done";
			record.loaded = record.total;
			this.resolve(record, snippet);
			this.editor.emit("upload", { file, id: record.id, state: "done", url });
			return url;
		} catch (err) {
			if (this.dead) {
				return null;
			}

			const reason = err.message || texts.uploadUnreachable;
			this.failed(record, reason);
			this.editor.emit("error", { phase: "upload", file, id: record.id, error: err });
			return null;
		}
	}

	// failed marks a record failed and redraws its preview, and writes
	// nothing: the document is the writer's, and a request that answered with
	// nothing usable has no sentence to add to it. The placeholder stays where
	// it landed - the line is still the file's to fill - so the reason and the
	// way back live on the preview alone.
	failed(record, reason) {
		if (this.dead || !this.records.has(record.id)) {
			return;
		}

		record.error = reason;
		record.state = "failed";
		this.draw(record);
	}

	// anchor answers where the placeholder a record stands for is written,
	// and what surrounds it on that line, or null when the markdown there is
	// no longer the line the record was painted for. A retry never exchanges
	// a different line that happens to read the same.
	//
	// The placeholder alone is what a request replaces: a line that reads
	// `see ![](this)` keeps its `see ` when the answer lands, and a failure
	// writes nothing at all, so the writer's words stand at every moment.
	anchor(record) {
		const segment = record?.segment;
		if (!segment || !this.editor.surface.contains(segment)) {
			return null;
		}

		const lineStart = this.editor.source.startOf(segment);
		const text = this.editor.value.slice(lineStart, lineStart + record.line.length);
		if (text !== record.line) {
			return null;
		}

		const placeholder = record.placeholder ?? record.line;
		const at = text.indexOf(placeholder);
		if (at < 0) {
			return { lineStart, at: lineStart, placeholder: record.line, before: "", after: "" };
		}

		return {
			lineStart,
			at: lineStart + at,
			placeholder,
			before: text.slice(0, at),
			after: text.slice(at + placeholder.length),
		};
	}

	// write replaces a line and keeps the caret where the writer has moved
	// on to: by the time an upload answers, its line can be several lines
	// behind them.
	write(at, length, replacement) {
		const { start, end } = this.editor.selection;
		const shift = replacement.length - length;
		const move = (position) => (position <= at ? position : position + shift);
		this.editor.source.replace(at, at + length, replacement, move(start), move(end));
	}

	// ── The request ───────────────────────────────────────────────────────

	// send does the request and answers the URL the server stored the file
	// under. A record, when there is one, takes the progress as it comes.
	async send(file, record = null) {
		const options = this.options;
		const endpoint = await resolve(options.endpoint, file);
		if (!endpoint) {
			throw new Error(this.editor.texts.uploadUnconfigured);
		}

		const headers = { ...((await resolve(options.headers, file)) ?? {}) };
		const token = await resolve(options.token, file);
		if (token) {
			const header = options.tokenHeader ?? "Authorization";
			const scheme = options.tokenScheme ?? "Bearer";
			headers[header] = scheme ? `${scheme} ${token}` : token;
		}

		let body;
		if (options.encoding === "raw") {
			body = file;
			headers["Content-Type"] = file.type || "application/octet-stream";
			if (file.name && options.filenameHeader !== false) {
				headers[options.filenameHeader ?? "X-Filename"] = encodeURIComponent(file.name);
			}
		} else {
			body = new FormData();
			body.append(options.field ?? "file", file, file.name || "upload");
			for (const [name, value] of Object.entries((await resolve(options.params, file)) ?? {})) {
				body.append(name, value);
			}
		}

		const answer = await this.request({ endpoint, body, headers, options, file, record });
		const url = options.url ? options.url(answer.body, answer) : answer.body.url;
		if (typeof url !== "string" || url === "") {
			throw new Error(answer.body.error || `${answer.status} ${answer.statusText}`.trim());
		}

		return url;
	}

	// request sends one upload and answers what came back.
	//
	// XMLHttpRequest, not fetch: fetch reports nothing about a request body
	// on its way out, and a file worth a progress bar is what this takes.
	// Every byte the browser hands to the socket raises an `upload` event
	// with `state: "progress"`, so a host draws a bar knowing nothing about
	// the transport.
	request({ endpoint, body, headers, options, file, record }) {
		return new Promise((answer, fail) => {
			const call = new XMLHttpRequest();
			call.open(options.method ?? "POST", endpoint, true);
			call.withCredentials = (options.credentials ?? "same-origin") === "include";
			for (const [name, value] of Object.entries(headers)) {
				call.setRequestHeader(name, value);
			}
			if (record) {
				record.call = call;
			}

			call.upload.addEventListener("progress", (event) => {
				if (!event.lengthComputable || (record && record.dead)) {
					return;
				}

				const ratio = event.total ? event.loaded / event.total : 0;
				if (record) {
					const now = performance.now();
					if (!record.started) {
						record.started = now;
					}
					// The estimate is the bytes left over the rate this
					// request has kept since it began. The first fraction of a
					// second says nothing a person can use, so it says nothing.
					const elapsed = (now - record.started) / 1000;
					if (elapsed >= 0.4 && event.loaded > 0) {
						const rate = event.loaded / elapsed;
						record.eta = Math.max(0, Math.round((event.total - event.loaded) / rate));
					}

					record.state = "progress";
					record.loaded = event.loaded;
					record.total = event.total;
					this.draw(record);
				}

				this.editor.emit("upload", {
					file,
					id: record?.id,
					state: "progress",
					loaded: event.loaded,
					total: event.total,
					ratio,
				});
			});

			call.addEventListener("load", () => {
				let parsed = {};
				try {
					parsed = JSON.parse(call.responseText);
				} catch {
					// A server that answers something other than JSON says
					// what it says through its status.
				}
				answer({ body: parsed ?? {}, status: call.status, statusText: call.statusText });
			});
			call.addEventListener("error", () => fail(new Error(this.editor.texts.uploadUnreachable)));
			call.addEventListener("abort", () => fail(new Error(this.editor.texts.uploadUnreachable)));

			call.send(body);
		});
	}

	// swap exchanges a line for the markdown that references the stored file,
	// found by its text. A record answering for the line is the better way
	// in; this is the one that still works when the line has moved or the
	// placeholder was the host's own.
	swap(needle, replacement) {
		const at = this.editor.value.indexOf(needle);
		if (at < 0) {
			return false;
		}

		this.write(at, needle.length, replacement);
		return true;
	}

	// resolve exchanges the placeholder an upload stood behind for the marker
	// that references the stored file. The offset is read while the record
	// still answers for its element, and the record goes before the write,
	// so the resolved line paints as plain markdown.
	resolve(record, replacement, placeholder = null) {
		const found = record ? this.anchor(record) : null;
		if (record) {
			this.unbind(record);
		}

		if (!found) {
			const needle = placeholder ?? record?.line;
			return needle ? this.swap(needle, replacement) : false;
		}

		this.write(found.at, found.placeholder.length, replacement);
		return true;
	}

	// destroy stops the editor's uploads: requests on their way are aborted
	// and no answer is written into a document that is no longer there.
	destroy() {
		this.dead = true;
		for (const record of this.records.values()) {
			record.dead = true;
			try {
				record.call?.abort();
			} catch {
				// A request that already answered has nothing to abort.
			}
		}

		this.records.clear();
		this.byLine.clear();
		this.picker?.remove();
		this.picker = null;
		this.receive = null;
	}
}
