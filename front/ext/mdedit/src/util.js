// roving makes one bar a single stop in the tab order, the way a toolbar
// behaves: Tab reaches the bar, the arrows move along it, Home and End take
// its ends, and the next Tab leaves for the document. Without it a keyboard
// arriving at the editor walks every button on the bar before it reaches the
// text, and a bar wrapped to three rows on a phone is three rows of stops.
export function roving(bar, signal) {
	const buttons = () => [...bar.querySelectorAll("button")];

	const hold = (button) => {
		for (const other of buttons()) {
			other.tabIndex = other === button ? 0 : -1;
		}
	};

	hold(buttons()[0]);

	bar.addEventListener(
		"keydown",
		(event) => {
			const list = buttons();
			const at = list.indexOf(document.activeElement);
			if (at < 0) {
				return;
			}

			const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
			const to = step ? at + step : { Home: 0, End: list.length - 1 }[event.key];
			if (to === undefined) {
				return;
			}

			event.preventDefault();
			const button = list[(to + list.length) % list.length];
			hold(button);
			button.focus();
		},
		{ signal },
	);

	// A button reached by a click or by script becomes the stop the next Tab
	// comes back to.
	bar.addEventListener(
		"focusin",
		(event) => {
			if (event.target.tagName === "BUTTON") {
				hold(event.target);
			}
		},
		{ signal },
	);
}

// tool builds one button of the kind this component puts on a bar: an icon
// where the caller names a class the stylesheet draws, the word where it
// does not, and the name on the title and the aria-label either way, so an
// icon is never the only thing that says what a button does.
//
// `word` asks for both at once, for the few tools whose mark alone reads as
// a guess. Every tool declares a `label`, since that is what stands on a bar
// a host drew no icons for, so drawing the label beside every icon that has
// one spells the bar twice: B B, I I, H H.
//
// `hold` keeps the caret where it is. A button taking focus would lose the
// selection the tools act on, so every bar over the document holds; a panel
// with fields of its own does not, since the writer is typing in the panel.
export function tool({ prefix, key, title, icon, label, word, run, hold = true }) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = `${prefix}__tool ${prefix}__tool--${key}`;
	button.title = title;
	button.setAttribute("aria-label", title);

	if (icon) {
		const mark = document.createElement("span");
		mark.className = `icon ${icon}`;
		mark.setAttribute("aria-hidden", "true");
		button.appendChild(mark);
	}

	if (label && !icon) {
		// A word on a bar of marks, and wider than any of them: the modifier
		// is the stylesheet's hook for setting it as one.
		button.classList.add(`${prefix}__tool--label`);
		button.textContent = label;
	} else if (label && word) {
		// A word beside a mark: the mark says what kind of thing this is, the
		// word says what it does.
		const span = document.createElement("span");
		span.className = `${prefix}__tool-label`;
		span.textContent = label;
		button.appendChild(span);
	}

	if (hold) {
		button.addEventListener("mousedown", (event) => event.preventDefault());
	}
	if (run) {
		button.addEventListener("click", run);
	}

	return button;
}

// place pins a panel under the pointer and inside the editor's own box, so
// neither a narrow column nor a gesture near an edge can push it off the
// screen.
//
// The window bounds it as well as the box does. A document of any length
// makes the editor taller than the screen, and a menu opened on the last row
// a reader can see would otherwise stand below the fold with half its items
// out of reach.
export function place(element, root, event) {
	const box = root.getBoundingClientRect();
	const gap = 6;
	const fit = (want, size) => Math.min(Math.max(want, 0), Math.max(size, 0));
	const inWindow = (want, size, most) => Math.max(gap, Math.min(want, most - size - gap));

	const left = inWindow(event.clientX, element.offsetWidth, window.innerWidth);
	const top = inWindow(event.clientY + gap, element.offsetHeight, window.innerHeight);

	element.style.left = `${fit(left - box.left, box.width - element.offsetWidth)}px`;
	element.style.top = `${fit(top - box.top, box.height - element.offsetHeight)}px`;
}

// dismiss closes a panel on the two gestures that mean "not this": a press
// anywhere outside it, and Escape. `open` answers whether there is anything
// to close, since a panel is built and dropped as it is used.
//
// `keep` names one region a press does not mean "not this" in. The editor's
// own bar is that region for a panel holding a draft: its buttons hold the
// caret rather than taking it, so the press reaches the tool and the tool
// decides what to do about the draft. Closing first would drop the words the
// writer is typing and then run the tool against the caret they left in the
// document, which is a line nobody is looking at.
export function dismiss({ open, element, close, signal, keep }) {
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (!open() || element().contains(event.target) || keep?.()?.contains(event.target)) {
				return;
			}

			close();
		},
		{ signal },
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (open() && event.key === "Escape") {
				event.preventDefault();
				close();
			}
		},
		{ signal },
	);
}

// resolve reads an option that may be a value or a function answering one,
// awaiting it either way: `params: {csrf}` and `params: async () => ({csrf})`
// are both valid, and the second is how a host runs work (minting a token,
// creating a draft row) on the way to the request.
export async function resolve(option, ...args) {
	return typeof option === "function" ? await option(...args) : option;
}

// nearBox answers the box a selection with none of its own stands in.
//
// A caret on an element names the child it stands before, not the element:
// the caret beside a drawn table is a position on the surface, and measuring
// the surface would answer with the whole document and scroll to the top of
// it. The child beside the caret is what has a box, and the line it stands in
// is what a reader is looking for.
function nearBox(selection) {
	const node = selection.anchorNode;
	if (!node) {
		return null;
	}

	const beside =
		node.nodeType === Node.ELEMENT_NODE
			? (node.childNodes[selection.anchorOffset] ?? node.lastChild ?? node)
			: node;

	// A text node draws no box of its own to ask for; a range over it does.
	if (beside.nodeType === Node.TEXT_NODE) {
		const over = document.createRange();
		over.selectNodeContents(beside);
		const box = over.getBoundingClientRect();
		if (box.height || box.width) {
			return box;
		}
	}

	const element = beside.nodeType === Node.ELEMENT_NODE ? beside : beside.parentElement;
	// A line of the surface carries two classes, so the one that names it is
	// in the middle of the attribute and not at the end of it.
	return (element?.closest("[class*='__line']") ?? element)?.getBoundingClientRect() ?? null;
}

// scrollTo brings a selection into view with the least movement that does
// it. A writer sent to a word three screens down has lost their place; one
// left where it already stands has been moved for nothing.
//
// The margin keeps the words off the edge of the window, where a browser's
// own chrome and a panel standing over the document both sit. A selection
// inside the margin is already in view and nothing moves.
export function scrollTo(selection, margin = 96) {
	if (!selection || selection.rangeCount === 0) {
		return;
	}

	let box = selection.getRangeAt(0).getBoundingClientRect();
	// A collapsed range, or one over a marker the toggle has hidden, has no
	// box of its own; the line it stands in has one.
	if (box.height === 0 && box.width === 0) {
		box = nearBox(selection) ?? box;
	}
	if (box.height === 0 && box.top === 0) {
		return;
	}

	const top = margin;
	const bottom = window.innerHeight - margin;
	let by = 0;
	if (box.top < top) {
		by = box.top - top;
	} else if (box.bottom > bottom) {
		by = Math.min(box.bottom - bottom, box.top - top);
	}

	// A line near the foot of the document cannot reach the margin: the
	// page runs out first and the browser clamps. Pressing again would
	// shuffle it a few pixels every time, so anything within a line of
	// where it should be counts as there.
	if (Math.abs(by) < 32) {
		return;
	}

	const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
	window.scrollBy({ top: by, behavior: still ? "auto" : "smooth" });
}
