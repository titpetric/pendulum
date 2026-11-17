// The front matter block: the YAML map that opens a document.
//
// A document that starts with `---` and closes the block with `---` or `...`
// is drawn as fields. The block is the source of truth: an untouched line is
// written back exactly, and an edited cell rewrites only its own line.
//
// The table shows root scalars and one level of a root object. Lists, flow
// collections, block scalars and deeper objects are read-only rows that say
// they are edited in the source view. A block that cannot be read as fields
// is left as markdown.

const OPEN = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
const BLANK = /^[ \t]*$/;
const COMMENT = /^[ \t]*#/;
const NUMBER = /^[-+]?(?:\.[0-9]+|[0-9][0-9_]*(?:\.[0-9_]*)?)(?:[eE][-+]?[0-9]+)?$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt ][0-9:.+-]+)?$/;
const RESERVED = /^(?:~|null|true|false|yes|no|on|off)$/i;
const LEAD = /^(?:[,[\]{}#&*!|>'"%@`]|-(?:\s|$)|\?(?:\s|$)|:(?:\s|$))/;

const identity = (text) => [...Array(text.length).keys()].concat(text.length);

// indentOf answers the leading whitespace of a line, or null for a tab.
function indentOf(line) {
	const found = line.match(/^[ \t]*/)[0];
	return found.includes("\t") ? null : found;
}

// splitKey answers the key and the value of one `key: value` line, or null.
function splitKey(text) {
	let quote = null;
	let escaped = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (quote === '"' && char === "\\" && !escaped) {
				escaped = true;
				continue;
			}
			if (char === quote && !escaped) {
				quote = null;
			}
			escaped = false;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === ":" && (index + 1 === text.length || text[index + 1] === " " || text[index + 1] === "\t")) {
			const keyRaw = text.slice(0, index).trim();
			if (keyRaw === "") {
				return null;
			}
			return { keyRaw, valueRaw: text.slice(index + 1).trim(), colon: index };
		}
	}

	return null;
}

// decodeDouble reads the characters between double quotes, with their source offsets.
function decodeDouble(raw) {
	let text = "";
	const map = [];

	for (let index = 0; index < raw.length; index += 1) {
		const char = raw[index];
		if (char !== "\\" || index + 1 >= raw.length) {
			text += char;
			map.push(index);
			continue;
		}

		const next = raw[index + 1];
		const simple = {
			"\\": "\\",
			'"': '"',
			"/": "/",
			n: "\n",
			r: "\r",
			t: "\t",
			b: "\b",
			f: "\f",
			"0": "\0",
			" ": " ",
		};
		if (simple[next] !== undefined) {
			text += simple[next];
			map.push(index);
			index += 1;
			continue;
		}
		if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(index + 2, index + 6))) {
			text += String.fromCharCode(parseInt(raw.slice(index + 2, index + 6), 16));
			map.push(index);
			index += 5;
			continue;
		}

		text += char;
		map.push(index);
	}

	map.push(raw.length);

	return { text, map };
}

// decodeSingle reads the characters between single quotes, where '' is one.
function decodeSingle(raw) {
	let text = "";
	const map = [];

	for (let index = 0; index < raw.length; index += 1) {
		if (raw[index] === "'" && raw[index + 1] === "'") {
			text += "'";
			map.push(index);
			index += 1;
			continue;
		}
		text += raw[index];
		map.push(index);
	}

	map.push(raw.length);

	return { text, map };
}

// scalarOf answers the text a raw scalar stands for, with its source offsets.
function scalarOf(raw) {
	const text = raw.trim();
	if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
		return { ...decodeDouble(text.slice(1, -1)), kind: "double", inner: text.slice(1, -1) };
	}
	if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
		return { ...decodeSingle(text.slice(1, -1)), kind: "single", inner: text.slice(1, -1) };
	}

	return { text, map: identity(text), kind: "plain", inner: text };
}

// scalarKind answers whether a raw value is empty, quoted, plain or rich.
function scalarKind(raw) {
	const text = raw.trim();
	if (text === "") {
		return "empty";
	}
	if (text[0] === '"' || text[0] === "'") {
		return text.length >= 2 && text[text.length - 1] === text[0] ? "quoted" : "rich";
	}
	if (LEAD.test(text) || /[ \t]#/.test(text)) {
		return "rich";
	}

	return "plain";
}

function keyText(raw) {
	return scalarOf(raw).text;
}

// parseBody reads the lines between the delimiters into entries and rows.
function parseBody(body) {
	const entries = [];
	const rows = [];
	let index = 0;

	while (index < body.length) {
		const raw = body[index];
		if (BLANK.test(raw) || COMMENT.test(raw)) {
			index += 1;
			continue;
		}

		const indent = indentOf(raw);
		if (indent !== "") {
			return null;
		}

		const head = splitKey(raw);
		if (!head) {
			return null;
		}
		const key = keyText(head.keyRaw);
		if (key === "") {
			return null;
		}

		let next = index + 1;
		while (next < body.length && (BLANK.test(body[next]) || COMMENT.test(body[next]))) {
			next += 1;
		}

		const nextRaw = body[next];
		const nested =
			next < body.length &&
			!BLANK.test(nextRaw) &&
			!COMMENT.test(nextRaw) &&
			indentOf(nextRaw) !== "";

		const inline = head.valueRaw;
		const inlineRich = inline !== "" && scalarKind(inline) === "rich";

		if (!nested) {
			if (inlineRich) {
				entries.push({ kind: "rich", line: index, indent: "", key, keyRaw: head.keyRaw });
				rows.push({ kind: "rich", line: index, key, keyRaw: head.keyRaw, editableKey: false, editableValue: false });
			} else {
				const scalar = scalarOf(inline);
				entries.push({ kind: "scalar", line: index, indent: "", key, keyRaw: head.keyRaw });
				rows.push({
					kind: "scalar",
					line: index,
					key,
					keyRaw: head.keyRaw,
					value: scalar.text,
					valueRaw: inline,
					editableKey: true,
					editableValue: true,
				});
			}
			index += 1;
			continue;
		}

		let end = next;
		while (end < body.length) {
			const line = body[end];
			if (!BLANK.test(line) && !COMMENT.test(line) && indentOf(line) === "") {
				break;
			}
			end += 1;
		}

		const block = body.slice(next, end);
		if (inline !== "" || !expandable(block)) {
			entries.push({ kind: "rich", line: index, indent: "", key, keyRaw: head.keyRaw });
			rows.push({ kind: "rich", line: index, key, keyRaw: head.keyRaw, editableKey: false, editableValue: false });
			index = end;
			continue;
		}

		const children = parseChildren(block, next, key);
		if (!children) {
			entries.push({ kind: "rich", line: index, indent: "", key, keyRaw: head.keyRaw });
			rows.push({ kind: "rich", line: index, key, keyRaw: head.keyRaw, editableKey: false, editableValue: false });
		} else {
			entries.push({ kind: "object", line: index, indent: "", key, keyRaw: head.keyRaw, children });
			rows.push({ kind: "group", key });
			for (const child of children) {
				rows.push(child);
			}
		}

		index = end;
	}

	return entries.length ? { entries, rows } : null;
}

// expandable answers whether a block under a root key is a map of fields.
function expandable(block) {
	const first = block.find((line) => !BLANK.test(line) && !COMMENT.test(line));
	if (!first) {
		return false;
	}
	const indent = indentOf(first);
	if (indent === null) {
		return false;
	}

	return !/^-(\s|$)/.test(first.slice(indent.length));
}

// parseChildren reads one level of an object; anything deeper is rich.
function parseChildren(block, lineOffset, parent) {
	let childIndent = null;
	const children = [];
	let current = null;

	for (let index = 0; index < block.length; index += 1) {
		const raw = block[index];
		if (BLANK.test(raw) || COMMENT.test(raw)) {
			continue;
		}

		const indent = indentOf(raw);
		if (indent === null || (childIndent !== null && indent.length < childIndent.length)) {
			return null;
		}
		if (childIndent === null) {
			childIndent = indent;
		}

		if (indent.length === childIndent.length) {
			const text = raw.slice(indent.length);
			if (/^-(\s|$)/.test(text)) {
				return null;
			}
			const head = splitKey(text);
			if (!head) {
				return null;
			}
			current = {
				key: keyText(head.keyRaw),
				keyRaw: head.keyRaw,
				valueRaw: head.valueRaw,
				line: lineOffset + index,
				indent,
				parent,
				deep: false,
			};
			if (current.key === "") {
				return null;
			}
			children.push(current);
			continue;
		}

		if (!current) {
			return null;
		}
		current.deep = true;
	}

	for (const child of children) {
		const kind = child.deep || (child.valueRaw !== "" && scalarKind(child.valueRaw) === "rich") ? "rich" : "scalar";
		child.kind = kind;
		child.editableKey = false;
		child.editableValue = kind === "scalar";
		if (kind === "scalar") {
			child.value = scalarOf(child.valueRaw).text;
		}
	}

	return children;
}

// lineStarts answers where every line of the block begins.
function lineStarts(lines) {
	const starts = [];
	let at = 0;
	for (const line of lines) {
		starts.push(at);
		at += line.length + 1;
	}

	return starts;
}

// spansOf fills in where a row's key and value stand in the block.
function spansOf(row, lines, starts) {
	const raw = lines[row.line];
	const indent = row.indent ?? "";
	const stripped = raw.slice(indent.length);
	const head = splitKey(stripped);
	if (!head) {
		return;
	}

	const keyAt = indent.length + stripped.indexOf(head.keyRaw);
	const key = scalarOf(head.keyRaw);
	const keyInner = key.kind === "plain" ? keyAt : keyAt + 1;
	row.keySpan = {
		start: starts[row.line] + keyInner,
		raw: key.inner,
		text: key.text,
		map: key.map,
	};

	if (row.kind !== "scalar" && row.kind !== "child") {
		return;
	}

	if (head.valueRaw !== "") {
		let valueAt = indent.length + head.colon + 1;
		while (stripped[valueAt - indent.length] === " " || stripped[valueAt - indent.length] === "\t") {
			valueAt += 1;
		}
		const value = scalarOf(head.valueRaw);
		const inner = value.kind === "plain" ? valueAt : valueAt + 1;
		row.valueSpan = {
			start: starts[row.line] + inner,
			raw: value.inner,
			text: value.text,
			map: value.map,
		};
	} else {
		row.valueSpan = {
			start: starts[row.line] + raw.length,
			raw: "",
			text: "",
			map: [0],
		};
	}
}

function model(lines) {
	const body = lines.slice(1, -1);
	const parsed = parseBody(body);
	if (!parsed) {
		return null;
	}

	const starts = lineStarts(lines);
	let data = 0;
	for (const row of parsed.rows) {
		if (row.kind === "group") {
			row.row = null;
			continue;
		}
		row.row = data;
		data += 1;
		if (row.line !== undefined) {
			row.line += 1;
			row.raw = lines[row.line];
			spansOf(row, lines, starts);
		}
	}

	return {
		opener: lines[0],
		closer: lines[lines.length - 1],
		closerLine: lines.length - 1,
		lines,
		entries: parsed.entries,
		rows: parsed.rows,
		data: parsed.rows.filter((row) => row.kind !== "group"),
	};
}

// parse reads a front matter block, or answers null when the text is not one.
export function parse(markdown) {
	const lines = String(markdown).split("\n");
	if (!OPEN.test(lines[0] ?? "")) {
		return null;
	}

	let close = -1;
	for (let index = 1; index < lines.length; index += 1) {
		if (CLOSE.test(lines[index])) {
			close = index;
			break;
		}
	}
	if (close < 1) {
		return null;
	}

	return model(lines.slice(0, close + 1));
}

// detect reads the block at the head of a surface, or answers null.
export function detect(lines) {
	if (!OPEN.test(lines[0] ?? "")) {
		return null;
	}

	let close = -1;
	for (let index = 1; index < lines.length; index += 1) {
		if (CLOSE.test(lines[index])) {
			close = index;
			break;
		}
	}
	if (close < 1) {
		return null;
	}

	return model(lines.slice(0, close + 1));
}

// complete reads text that must be one whole block, or answers null.
export function complete(text) {
	const found = parse(text);
	if (!found) {
		return null;
	}

	const rest = String(text).split("\n").slice(found.closerLine + 1);
	return rest.every((line) => BLANK.test(line)) ? found : null;
}

// encode writes one string as a YAML scalar, quoted where it must be.
export function encode(value) {
	const text = String(value);
	if (text === "") {
		return '""';
	}
	if (plain(text)) {
		return text;
	}

	return `"${escape(text)}"`;
}

// encodeKey writes one key, quoted where it must be.
export function encodeKey(key) {
	const text = String(key);
	if (text !== "" && plain(text)) {
		return text;
	}

	return `"${escape(text)}"`;
}

function plain(text) {
	if (/^\s|\s$/.test(text) || /[\n\r\t\x00-\x1f\x7f]/.test(text)) {
		return false;
	}
	if (LEAD.test(text) || /: | #/.test(text)) {
		return false;
	}
	if (RESERVED.test(text) || NUMBER.test(text) || DATE.test(text)) {
		return false;
	}

	return true;
}

function escape(text) {
	return text.replace(/[\\"\n\r\t\b\f\x00-\x1f\x7f]/g, (char) => {
		const named = {
			"\\": "\\\\",
			'"': '\\"',
			"\n": "\\n",
			"\r": "\\r",
			"\t": "\\t",
			"\b": "\\b",
			"\f": "\\f",
		};
		return named[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
	});
}

// rowLine writes one row back as a line, keeping what did not change.
export function rowLine(row, key, value) {
	if (key === row.key && value === row.value) {
		return row.raw;
	}

	const keyPart = key === row.key ? row.keyRaw : encodeKey(key);
	const valuePart = value === row.value ? row.valueRaw : encode(value);

	return `${row.indent ?? ""}${keyPart}: ${valuePart}`;
}

// at answers which cell of a block one offset into it names, or null.
export function at(markdown, offset) {
	const found = parse(markdown);
	if (!found) {
		return null;
	}

	for (const row of found.data) {
		const cells = [
			[0, row.editableKey ? row.keySpan : null],
			[1, row.editableValue ? row.valueSpan : null],
		];
		for (const [column, span] of cells) {
			if (!span) {
				continue;
			}
			const end = span.start + span.raw.length;
			if (offset < span.start || offset > end) {
				continue;
			}
			const relative = offset - span.start;
			let inside = 0;
			while (inside < span.text.length && span.map[inside + 1] <= relative) {
				inside += 1;
			}
			return { row: row.row, column, at: Math.min(inside, span.text.length) };
		}
	}

	return null;
}

// offsetAt is the way back: where in the block one position in a cell stands.
export function offsetAt(markdown, row, column, position) {
	const found = parse(markdown);
	const entry = found && found.data.find((candidate) => candidate.row === row);
	if (!entry) {
		return null;
	}

	const span = column === 0 ? (entry.editableKey ? entry.keySpan : null) : entry.editableValue ? entry.valueSpan : null;
	if (!span) {
		return null;
	}

	const inside = Math.max(0, Math.min(position, span.text.length));
	return span.start + span.map[inside];
}
