// mdedit: a markdown editing surface over a plain textarea.
//
//	import { MarkdownEditor } from "/assets/mdedit/dist/mdedit.js";
//
//	MarkdownEditor.mount("textarea[data-markdown]", {
//		uploads: { endpoint: "/api/upload", token: "..." },
//	});
//
// See README.md for the options, the upload protocol and the CSS variables.

export { MarkdownEditor, TEXTS } from "./editor.js";
export { Source } from "./source.js";
export { Surface } from "./surface.js";
export { tokenise, tokenLines } from "./highlight.js";
export { Uploads } from "./uploads.js";
export { UploadPanel } from "./queue.js";
export { ProofPanel } from "./proof.js";
export { iconFor, size } from "./preview.js";
export { highlight, escapeHTML } from "./highlight.js";
// The colourer a fenced block is painted with. A host that renders the
// document beside the editor paints it with this, so both halves of a split
// screen read one language the same way.
export { highlightCode } from "./code.js";
export { renderInline, alignImage, imageAlign, imageMarkdown } from "./inline.js";
export { defaultTools, TOOLBAR_FULL, TOOLBAR_INLINE } from "./tools.js";

export const version = "0.1.0";
