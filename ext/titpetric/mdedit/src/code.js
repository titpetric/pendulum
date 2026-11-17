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
};

// The aliases a fence is written with.
const ALIASES = {
	golang: "go",
	php5: "php",
	php8: "php",
};

const bags = new Map();

// words answers the lookup table for one language: a word to the class it
// paints in.
function words(language) {
	const name = ALIASES[language] ?? language;
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
// opening fence.
export function highlightCode(line, prefix, language) {
	const bag = words(language);
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
