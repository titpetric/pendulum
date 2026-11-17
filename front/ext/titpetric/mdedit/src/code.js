// Syntax colour for the inside of a fenced block, with no parser and no
// dependency: one pass of a regex over each line, and a bag of words per
// language.
//
// It reads one line at a time, so a string or a comment that spans lines
// ends at the line break. That is the trade for a highlighter that cannot
// wedge itself into a bad state while someone types the opening quote of a
// string.

import { escapeHTML } from "./escape.js";

// The words that mean the same thing in most languages. A fence with no
// language, or one nothing here knows, gets this bag alone.
const COMMON = {
	declare: [
		"func", "function", "fn", "def", "sub", "method", "class", "struct", "interface",
		"enum", "trait", "type", "var", "let", "const", "static", "final", "abstract",
		"public", "private", "protected", "extends", "implements", "package", "namespace",
		"module", "import", "include", "require", "use", "export", "from", "return",
	],
	keyword: [
		"if", "else", "elseif", "elif", "for", "foreach", "while", "do", "switch", "case",
		"default", "break", "continue", "goto", "try", "catch", "finally", "throw",
		"new", "delete", "in", "of", "as", "and", "or", "not", "yield", "await", "async",
	],
	type: [
		"int", "integer", "float", "double", "long", "short", "byte", "char", "rune",
		"string", "str", "bool", "boolean", "void", "any", "object", "array", "list",
		"map", "dict", "set", "error", "exception", "null", "nil", "none", "true",
		"false", "undefined", "this", "self",
	],
};

// What each language adds on top. Go and php are the two this is tuned for;
// the rest ride on COMMON.
const LANGUAGES = {
	go: {
		keyword: ["defer", "go", "select", "range", "fallthrough", "chan"],
		type: ["int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64",
			"float32", "float64", "complex64", "complex128", "uintptr", "any", "error"],
		builtin: ["append", "make", "len", "cap", "copy", "close", "delete", "panic",
			"recover", "print", "println", "new", "min", "max", "clear"],
	},
	php: {
		declare: ["readonly", "global", "instanceof", "clone", "fn", "match", "enum"],
		keyword: ["echo", "print", "endif", "endforeach", "endwhile", "declare", "yield"],
		type: ["Throwable", "Exception", "Error", "TypeError", "ValueError", "Closure",
			"Generator", "iterable", "callable", "mixed", "never", "stdClass", "parent"],
		builtin: ["isset", "unset", "empty", "count", "implode", "explode", "sprintf",
			"printf", "str_replace", "strlen", "substr", "trim", "in_array", "array_map",
			"array_filter", "array_merge", "json_encode", "json_decode", "preg_match",
			"preg_replace", "file_get_contents", "file_put_contents", "var_dump"],
	},
	bash: {
		declare: ["function", "local", "export", "readonly", "declare", "source", "alias"],
		keyword: ["then", "fi", "elif", "esac", "done", "until", "select", "time", "coproc"],
		builtin: ["echo", "printf", "read", "cd", "pwd", "test", "set", "unset", "shift",
			"exit", "trap", "wait", "exec", "eval", "let", "true", "false", "type",
			"kill", "sleep", "grep", "sed", "awk", "curl", "wget", "git", "make",
			"ls", "cp", "mv", "rm", "mkdir", "chmod", "chown", "sort", "head", "tail",
			"wc", "find", "xargs", "tee", "env", "sudo"],
	},
	python: {
		declare: ["def", "lambda", "global", "nonlocal", "pass", "assert", "del", "raise", "with"],
		keyword: ["elif", "except", "finally", "is", "not", "and", "or", "match", "case"],
		type: ["True", "False", "None", "bytes", "bytearray", "object", "complex"],
		builtin: ["print", "len", "range", "str", "int", "list", "dict", "tuple", "open",
			"enumerate", "zip", "map", "filter", "sum", "min", "max", "any", "all",
			"sorted", "isinstance", "super", "input", "format"],
	},
	js: {
		declare: ["async", "await", "yield"],
		keyword: ["instanceof", "typeof", "delete", "void"],
		type: ["NaN", "Infinity", "Symbol", "BigInt"],
		builtin: ["console", "JSON", "Math", "Object", "Array", "Promise", "Map", "Set",
			"document", "window", "require", "parseInt", "parseFloat", "String", "Number"],
	},
	ts: {
		declare: ["type", "namespace", "implements", "abstract", "readonly"],
		type: ["unknown", "never", "keyof"],
	},
	sql: {
		declare: ["select", "from", "where", "insert", "update", "delete", "create", "drop",
			"alter", "table", "index", "view", "join", "group", "order", "having", "limit",
			"offset", "union", "values", "into", "column"],
		keyword: ["and", "or", "not", "as", "on", "by", "distinct", "primary", "key",
			"foreign", "references", "default", "cascade", "begin", "commit", "rollback"],
		type: ["varchar", "text", "timestamp", "date", "boolean", "serial", "bigint", "decimal", "numeric"],
		builtin: ["count", "sum", "avg", "min", "max", "coalesce", "now"],
	},
};

// The languages the fence menu offers, in the order it lists them. A fence
// keeps any word a writer types; these are the ones with a bag of their own
// or a shape the colourer reads well.
export const FENCE_LANGUAGES = ["bash", "css", "go", "html", "js", "json", "php", "python", "sql", "ts", "yaml"];

// The aliases a fence is written with.
const ALIASES = {
	golang: "go",
	php5: "php",
	php8: "php",
	shell: "bash",
	sh: "bash",
	zsh: "bash",
	console: "bash",
	yml: "yaml",
	javascript: "js",
	mjs: "js",
	node: "js",
	typescript: "ts",
	py: "python",
	python3: "python",
	plain: "text",
	plaintext: "text",
	txt: "text",
};

// canonical answers the name a written alias stands for.
export function canonical(language) {
	return ALIASES[language] ?? language;
}

const bags = new Map();

// words answers the lookup table for one language: a word to the class it
// paints in.
function words(language) {
	const name = canonical(language);
	if (bags.has(name)) {
		return bags.get(name);
	}

	const bag = new Map();
	const add = (list, kind) => {
		for (const word of list ?? []) {
			bag.set(word, kind);
		}
	};

	add(COMMON.declare, "declare");
	add(COMMON.keyword, "keyword");
	add(COMMON.type, "type");

	const extra = LANGUAGES[name];
	if (extra) {
		add(extra.declare, "declare");
		add(extra.keyword, "keyword");
		add(extra.type, "type");
		add(extra.builtin, "builtin");
	}

	bags.set(name, bag);
	return bag;
}

// One alternation, read left to right: a comment to the end of the line, a
// quoted string, a number, a name that is about to be called, a php or shell
// variable, a bare name, a bracket, an operator.
const TOKEN = new RegExp(
	[
		"(?<comment>//[^\\n]*|#[^\\n]*|/\\*[^\\n]*?\\*/|--[^\\n]*)",
		"(?<string>\"(?:\\\\.|[^\"\\\\])*\"?|'(?:\\\\.|[^'\\\\])*'?|`[^`]*`?)",
		"(?<number>\\b0[xXbBoO][0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?\\b)",
		"(?<call>[A-Za-z_][\\w]*)(?=\\s*\\()",
		"(?<variable>\\$[A-Za-z_]\\w*|@[A-Za-z_]\\w*)",
		"(?<name>[A-Za-z_][\\w]*)",
		"(?<bracket>[{}()\\[\\]])",
		"(?<operator>[=+\\-*/%<>!&|^~?:;,.])",
	].join("|"),
	"g",
);

// highlightCode answers the HTML for one line inside a fenced block.
// `prefix` is the editor's CSS prefix and `language` is the word on the
// opening fence. A fence that names no language, or names text, gets its
// characters back uncoloured: colour is an answer to a question about the
// language, and there is no question.
export function highlightCode(line, prefix, language) {
	const name = canonical(language);
	if (name === "" || name === "text") {
		return escapeHTML(line);
	}

	const bag = words(name);
	const tok = (name, body) => `<span class="${prefix}-c-${name}">${body}</span>`;

	let out = "";
	let last = 0;

	for (const match of line.matchAll(TOKEN)) {
		const { comment, string, number, call, variable, name, bracket, operator } = match.groups;
		out += escapeHTML(line.slice(last, match.index));
		last = match.index + match[0].length;
		const safe = escapeHTML(match[0]);

		if (comment !== undefined) {
			out += tok("comment", safe);
		} else if (string !== undefined) {
			out += tok("string", safe);
		} else if (number !== undefined) {
			out += tok("number", safe);
		} else if (call !== undefined) {
			// A name with a bracket after it reads as a call, except where
			// the language spells the word itself: `if (x)` is no function.
			const kind = bag.get(call);
			out += tok(kind === "declare" || kind === "keyword" ? kind : (kind ?? "call"), safe);
		} else if (variable !== undefined) {
			out += tok("variable", safe);
		} else if (name !== undefined) {
			const kind = bag.get(name);
			out += kind ? tok(kind, safe) : safe;
		} else if (bracket !== undefined) {
			out += tok("bracket", safe);
		} else if (operator !== undefined) {
			out += tok("operator", safe);
		}
	}

	return out + escapeHTML(line.slice(last));
}

// The words that name one language and no other. A word every language
// spells - `if`, `return` - decides nothing here, so the lists hold the ones
// that do: `foreach` is php, `defer` go, `elif` python or bash.
const SIGNATURES = {
	bash: ["#!/bin/", "export ", "local ", "then", " fi", "done", "esac", "echo "],
	css: ["@media", "margin", "padding", "display:", "font-size", "border:", "background"],
	go: ["package ", "func ", "defer ", " chan ", "range ", "goroutine", " nil", "struct {"],
	html: ["<!doctype", "<html", "<div", "<span", "</"],
	js: ["function ", "const ", " let ", "console.", "require(", "=>", "document.", "window."],
	php: ["<?php", "foreach", "echo ", "public ", "private ", "protected ", "namespace ", "instanceof", "->"],
	python: ["def ", "elif", "import ", "None", "True", "False", "print(", "self."],
	sql: ["select ", "from ", "where ", "join ", "insert ", "update ", "create table", "group by", "order by"],
	ts: ["interface ", "implements ", "enum ", "readonly ", "type "],
};

// count answers how many times one signature stands in a lower case text.
function count(text, word) {
	const left = /^[a-z]/i.test(word) ? "\\b" : "";
	const right = /[a-z0-9]$/i.test(word) ? "\\b" : "";
	const pattern = new RegExp(`${left}${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${right}`, "g");

	return (text.match(pattern) ?? []).length;
}

// detectLanguage answers the language a source is written in, or "" where no
// signature stands in it. Each language scores its own signatures; the one
// with the most wins, and a shape json or yaml reads by settles a tie.
export function detectLanguage(source) {
	const text = String(source ?? "").toLowerCase();
	let best = "";
	let top = 0;

	for (const [language, words] of Object.entries(SIGNATURES)) {
		const score = words.reduce((total, word) => total + count(text, word), 0);
		if (score > top) {
			top = score;
			best = language;
		}
	}

	if (top > 0) {
		return best;
	}

	const trimmed = text.trim();
	if (/^[{\[]/.test(trimmed) && /"[^"]+"\s*:/.test(trimmed)) {
		return "json";
	}
	if (/^[\w.-]+\s*:/m.test(trimmed)) {
		return "yaml";
	}

	return "";
}
