// The image panel: click or right-click an image and what it points at
// appears, with its caption, its address, where it sits on the page and a
// way to swap the file behind it.
//
// A browser puts the caret where the right button went down in a textarea,
// so in source mode the panel reads the caret to find which image the writer
// means. In render mode the picture itself carries the range of the marker it
// came from. The panel writes `![caption](address)` back as it is typed, like
// everything else here.
//
// Nothing about the address is checked or rewritten, beyond the alignment
// anchor the buttons put on the end of it. Any public URL is a valid image
// here: the document is the author's, and whatever publishes it decides what
// it will fetch.

import { ALIGNMENTS, alignImage, imageAlign, imageAt, imageMarkdown } from "./inline.js";
import { dismiss, place, roving, tool } from "./util.js";

export class ImagePanel {
	constructor(editor) {
		this.editor = editor;
		this.prefix = editor.prefix;
		this.element = null;
		this.image = null;
		// The source the open panel writes through: the document, or one cell
		// of a drawn table when the image stands in one.
		this.source = null;
	}

	get open() {
		return Boolean(this.element);
	}

	attach(signal) {
		// Two ways to the panel: the right button, and a plain click or tap
		// on the picture itself. A finger has no right button, and a click on
		// a picture opens the panel over it in every editor that has one.
		for (const name of ["contextmenu", "click"]) {
			this.editor.surface.addEventListener(
				name,
				(event) => {
					const found = this.find(event);
					if (!found) {
						return;
					}

					event.preventDefault();
					this.show(found.image, found.source, event);
				},
				{ signal },
			);
		}

		// A press anywhere else, or Escape, puts the panel away.
		dismiss({ open: () => this.open, element: () => this.element, close: () => this.close(), signal });
	}

	// find answers the image the right button went down on and the source its
	// marker lives in. A cell of a drawn table holds its own markdown, so an
	// image in one is found and written there; everywhere else the source is
	// the document.
	find(event) {
		const picture = event.target.closest?.(`.${this.prefix}__pic`);
		const cell = picture?.closest("th, td");

		if (cell && this.editor.surface.contains(cell)) {
			const source = this.editor.source.cellSource(cell);
			const image = source && imageAt(source.value, this.editor.source.offsetIn(cell, picture));
			return image ? { image, source } : null;
		}

		const image = imageAt(this.editor.value, this.caret(event, picture));
		return image ? { image, source: this.editor.source } : null;
	}

	// caret answers where in the markdown the right button went down. A
	// browser puts the caret where it lands in text, and a picture takes no
	// caret at all, so a picture answers for the marker it stands on.
	caret(event, picture) {
		if (!picture) {
			return this.editor.selection.start;
		}

		const parent = picture.parentNode;
		return this.editor.source.offsetOf(parent, [...parent.childNodes].indexOf(picture));
	}

	show(image, source, event) {
		this.close();
		this.image = { ...image };
		this.source = source;

		const name = (part) => `${this.prefix}__${part}`;

		this.element = document.createElement("div");
		this.element.className = name("image");
		this.element.setAttribute("role", "group");
		this.element.setAttribute("aria-label", this.editor.texts.imagePanel);

		this.figure = document.createElement("div");
		this.figure.className = name("image-shot");
		this.preview = document.createElement("img");
		this.preview.alt = "";
		this.preview.src = image.src;
		this.preview.addEventListener("error", () => {
			this.figure.dataset.state = "failed";
			this.figure.setAttribute("title", this.editor.texts.imageMissing);
		});
		this.figure.appendChild(this.preview);

		const caption = this.field(name("image-field"), this.editor.texts.imageCaption, image.alt, (value) => {
			this.image.alt = value;
			this.write();
		});
		this.address = this.field(name("image-field"), this.editor.texts.imageAddress, image.src, (value) => {
			this.image.src = value;
			this.write();
			this.repaint();
		});

		const done = tool({
			prefix: this.prefix,
			key: "image-done",
			title: this.editor.texts.done,
			label: this.editor.texts.done,
			hold: false,
			run: () => this.close(),
		});

		const actions = document.createElement("div");
		actions.className = `${this.prefix}__bar ${name("image-bar")}`;
		actions.setAttribute("role", "toolbar");
		actions.setAttribute("aria-label", this.editor.texts.imagePanel);
		for (const align of ALIGNMENTS) {
			actions.appendChild(this.alignButton(align));
		}
		if (this.editor.uploads) {
			actions.appendChild(this.replaceButton());
		}
		actions.appendChild(done);
		roving(actions);

		this.element.append(this.figure, caption.row, this.address.row, actions);
		this.editor.root.appendChild(this.element);
		place(this.element, this.editor.root, event);
		this.mark();

		caption.input.focus();
		caption.input.select();
	}

	field(className, label, value, onInput) {
		const row = document.createElement("label");
		row.className = className;

		const text = document.createElement("span");
		text.textContent = label;

		const input = document.createElement("input");
		input.type = "text";
		input.value = value;
		input.spellcheck = false;
		input.addEventListener("input", () => onInput(input.value));

		row.append(text, input);
		return { row, input };
	}

	// alignButton writes the alignment anchor onto the address, and pressing
	// the one already set takes it back off: an image with no anchor flows
	// with the text around it.
	alignButton(align) {
		const titles = {
			left: this.editor.texts.imageLeft,
			center: this.editor.texts.imageCenter,
			right: this.editor.texts.imageRight,
		};

		const button = tool({
			prefix: this.prefix,
			key: `align-${align}`,
			title: titles[align],
			icon: `icon-align-${align}`,
			hold: false,
			run: () => {
				const current = imageAlign(this.image.src);
				this.image.src = alignImage(this.image.src, current === align ? "" : align);
				this.address.input.value = this.image.src;
				this.write();
				this.repaint();
				this.mark();
			},
		});
		button.setAttribute("aria-pressed", "false");

		return button;
	}

	// mark shows which alignment the address carries.
	mark() {
		const current = imageAlign(this.image.src);
		for (const align of ALIGNMENTS) {
			this.element
				.querySelector(`.${this.prefix}__tool--align-${align}`)
				?.setAttribute("aria-pressed", String(align === current));
		}
	}

	// replaceButton uploads another file through the editor's own uploader
	// and swaps the address for the one the server answers with. The
	// alignment and the caption stay as they are: the picture changed, not
	// what the writer said about it. With no uploader configured there is
	// nothing to replace through, and the button is absent.
	replaceButton() {
		return tool({
			prefix: this.prefix,
			key: "image-replace",
			title: this.editor.texts.imageReplace,
			icon: "icon-image",
			hold: false,
			run: () => this.editor.uploads.open((files) => this.replace(files[0])),
		});
	}

	async replace(file) {
		if (!file) {
			return;
		}

		this.figure.dataset.state = "loading";
		try {
			const url = await this.editor.uploads.store(file);
			this.image.src = alignImage(url, imageAlign(this.image.src));
			this.address.input.value = this.image.src;
			this.write();
			this.repaint();
		} catch (err) {
			this.figure.dataset.state = "failed";
			this.figure.setAttribute("title", err.message);
		}
	}

	// repaint points the panel's own preview at the address the fields now
	// hold, so the alignment anchor shows where the picture will sit.
	repaint() {
		this.figure.removeAttribute("data-state");
		this.preview.src = this.image.src;
	}

	write() {
		const markdown = imageMarkdown(this.image);
		// Not at the caret: the writer is typing in a field of the panel's
		// own, and a caret placed in the surface takes the focus with it, so
		// the rest of a caption would land in the document.
		this.source.replace(this.image.start, this.image.end, markdown, false);
		this.image.end = this.image.start + markdown.length;
		this.editor.emit("change", { value: this.editor.value });
	}

	close() {
		if (!this.open) {
			return;
		}

		this.element.remove();
		this.element = null;
		this.image = null;
		this.source = null;
	}
}
