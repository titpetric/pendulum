// The code colourer and the renderers all write HTML around the writer's own
// characters, so each passes every character through here first.
export function escapeHTML(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
