// src/util.js
function roving(bar, signal) {
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
      const at3 = list.indexOf(document.activeElement);
      if (at3 < 0) {
        return;
      }
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      const to = step ? at3 + step : { Home: 0, End: list.length - 1 }[event.key];
      if (to === void 0) {
        return;
      }
      event.preventDefault();
      const button = list[(to + list.length) % list.length];
      hold(button);
      button.focus();
    },
    { signal }
  );
  bar.addEventListener(
    "focusin",
    (event) => {
      if (event.target.tagName === "BUTTON") {
        hold(event.target);
      }
    },
    { signal }
  );
}
function tool({ prefix, key, title, icon, label, word, run, hold = true }) {
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
    button.classList.add(`${prefix}__tool--label`);
    button.textContent = label;
  } else if (label && word) {
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
function place(element, root, event) {
  const box = root.getBoundingClientRect();
  const gap = 6;
  const fit = (want, size3) => Math.min(Math.max(want, 0), Math.max(size3, 0));
  const inWindow = (want, size3, most) => Math.max(gap, Math.min(want, most - size3 - gap));
  const left = inWindow(event.clientX, element.offsetWidth, window.innerWidth);
  const top = inWindow(event.clientY + gap, element.offsetHeight, window.innerHeight);
  element.style.left = `${fit(left - box.left, box.width - element.offsetWidth)}px`;
  element.style.top = `${fit(top - box.top, box.height - element.offsetHeight)}px`;
}
function dismiss({ open, element, close, signal, keep }) {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!open() || element().contains(event.target) || keep?.()?.contains(event.target)) {
        return;
      }
      close();
    },
    { signal }
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (open() && event.key === "Escape") {
        event.preventDefault();
        close();
      }
    },
    { signal }
  );
}
async function resolve(option, ...args) {
  return typeof option === "function" ? await option(...args) : option;
}
function nearBox(selection) {
  const node = selection.anchorNode;
  if (!node) {
    return null;
  }
  const beside = node.nodeType === Node.ELEMENT_NODE ? node.childNodes[selection.anchorOffset] ?? node.lastChild ?? node : node;
  if (beside.nodeType === Node.TEXT_NODE) {
    const over = document.createRange();
    over.selectNodeContents(beside);
    const box = over.getBoundingClientRect();
    if (box.height || box.width) {
      return box;
    }
  }
  const element = beside.nodeType === Node.ELEMENT_NODE ? beside : beside.parentElement;
  return (element?.closest("[class*='__line']") ?? element)?.getBoundingClientRect() ?? null;
}
function scrollTo(selection, margin = 96) {
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  let box = selection.getRangeAt(0).getBoundingClientRect();
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
  if (Math.abs(by) < 32) {
    return;
  }
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  window.scrollBy({ top: by, behavior: still ? "auto" : "smooth" });
}

// src/heading.js
var PREFIX = /^(#{1,6})([ \t]+)/;
var LEVELS = 6;
function levelOf(line) {
  return line.match(PREFIX)?.[1].length ?? 0;
}
var prefixOf = (level) => level > 0 ? `${"#".repeat(level)} ` : "";
var LevelMenu = class {
  constructor(editor) {
    this.editor = editor;
    this.prefix = editor.prefix;
    this.element = null;
    this.line = null;
  }
  get open() {
    return Boolean(this.element);
  }
  attach(signal) {
    this.editor.surface.addEventListener(
      "click",
      (event) => {
        const label = event.target.closest?.(`.${this.prefix}__level`);
        if (!label || !this.editor.surface.contains(label)) {
          return;
        }
        event.preventDefault();
        this.show(label.parentElement, event);
      },
      { signal }
    );
    dismiss({ open: () => this.open, element: () => this.element, close: () => this.close(), signal });
  }
  // show opens the levels over the line the label belongs to. Each one is
  // drawn at the size it writes, so the choice reads as what it does.
  show(line, event) {
    this.close();
    this.line = line;
    const texts = this.editor.texts;
    const current = this.editor.source.levelAt(line);
    this.element = document.createElement("div");
    this.element.className = `${this.prefix}__menu ${this.prefix}__levels`;
    this.element.setAttribute("role", "menu");
    this.element.setAttribute("aria-label", texts.headingLevel);
    for (let level = 1; level <= LEVELS; level += 1) {
      this.element.appendChild(this.item(level, `${texts.heading} ${level}`, current === level));
    }
    this.element.appendChild(this.item(0, texts.headingText, current === 0));
    this.editor.root.appendChild(this.element);
    place(this.element, this.editor.root, event);
    this.element.querySelector("button")?.focus();
  }
  item(level, label, checked) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${this.prefix}__menu-item ${this.prefix}__level-item`;
    button.dataset.level = String(level);
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(checked));
    const mark = document.createElement("span");
    mark.className = `${this.prefix}__level-mark`;
    mark.textContent = level > 0 ? `H${level}` : "\xB6";
    mark.setAttribute("aria-hidden", "true");
    const text2 = document.createElement("span");
    text2.textContent = label;
    button.append(mark, text2);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const line = this.line;
      this.close();
      this.editor.source.setLevel(line, level);
      this.editor.focus();
    });
    return button;
  }
  close() {
    if (!this.open) {
      return;
    }
    this.element.remove();
    this.element = null;
    this.line = null;
  }
};

// src/escape.js
function escapeHTML(text2) {
  return text2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// src/inline.js
var HOLD = String.fromCharCode(0);
var HELD = new RegExp(`${HOLD}(\\d+)${HOLD}`, "g");
function renderInline(markdown) {
  const parts = [];
  let text2 = escapeHTML(markdown).replace(/(`+)([^`]+?)\1/g, (match, ticks, body) => {
    parts.push(`<code>${body}</code>`);
    return `${HOLD}${parts.length - 1}${HOLD}`;
  });
  text2 = text2.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, alt, src, title) => `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ""}>`).replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, label, href, title) => `<a href="${href}"${title ? ` title="${title}"` : ""}>${label}</a>`).replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>").replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>").replace(/(^|[\s(])([*_])(?=\S)([^*_\n]*?\S)\2(?=[\s.,;:!?)]|$)/g, "$1<em>$3</em>");
  return text2.replace(HELD, (match, index) => parts[Number(index)]);
}
var MEDIA = {
  audio: ["mp3", "m4a", "aac", "oga", "ogg", "opus", "wav", "flac", "weba"],
  video: ["mp4", "m4v", "webm", "ogv", "mov"]
};
function mediaKind(href) {
  const path = String(href ?? "").split(/[?#]/)[0];
  const dot = path.lastIndexOf(".");
  if (dot < 0) {
    return "";
  }
  const extension = path.slice(dot + 1).toLowerCase();
  for (const [kind, list] of Object.entries(MEDIA)) {
    if (list.includes(extension)) {
      return kind;
    }
  }
  return "";
}
function images(source) {
  const found = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)/g;
  for (const match of source.matchAll(pattern)) {
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      alt: match[1],
      src: match[2],
      title: match[3] ?? ""
    });
  }
  return found;
}
function imageAt(source, caret) {
  return images(source).find((image) => caret >= image.start && caret <= image.end) ?? null;
}
function imageMarkdown({ alt, src, title }) {
  const caption = title ? ` "${title}"` : "";
  return `![${alt}](${src}${caption})`;
}
var ALIGNMENTS = ["left", "center", "right"];
var ANCHOR = /#(left|center|right)$/;
function imageAlign(src) {
  return src.match(ANCHOR)?.[1] ?? "";
}
function alignImage(src, align) {
  const bare = src.replace(ANCHOR, "");
  return align ? `${bare}#${align}` : bare;
}

// src/images.js
var ImagePanel = class {
  constructor(editor) {
    this.editor = editor;
    this.prefix = editor.prefix;
    this.element = null;
    this.image = null;
    this.source = null;
  }
  get open() {
    return Boolean(this.element);
  }
  attach(signal) {
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
        { signal }
      );
    }
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
      const image2 = source && imageAt(source.value, this.editor.source.offsetIn(cell, picture));
      return image2 ? { image: image2, source } : null;
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
    const name = (part2) => `${this.prefix}__${part2}`;
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
      run: () => this.close()
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
    const text2 = document.createElement("span");
    text2.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.spellcheck = false;
    input.addEventListener("input", () => onInput(input.value));
    row.append(text2, input);
    return { row, input };
  }
  // alignButton writes the alignment anchor onto the address, and pressing
  // the one already set takes it back off: an image with no anchor flows
  // with the text around it.
  alignButton(align) {
    const titles = {
      left: this.editor.texts.imageLeft,
      center: this.editor.texts.imageCenter,
      right: this.editor.texts.imageRight
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
      }
    });
    button.setAttribute("aria-pressed", "false");
    return button;
  }
  // mark shows which alignment the address carries.
  mark() {
    const current = imageAlign(this.image.src);
    for (const align of ALIGNMENTS) {
      this.element.querySelector(`.${this.prefix}__tool--align-${align}`)?.setAttribute("aria-pressed", String(align === current));
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
      run: () => this.editor.uploads.open((files) => this.replace(files[0]))
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
};

// src/links.js
function codeRanges(source) {
  const ranges = [];
  let at3 = 0;
  while (at3 < source.length) {
    const char = source[at3];
    if (char !== "`" && char !== "~") {
      at3 += 1;
      continue;
    }
    const lineStart = source.lastIndexOf("\n", at3 - 1) + 1;
    const before = source.slice(lineStart, at3);
    const fence = /^[ \t]{0,3}$/.test(before) && (char === "`" || char === "~") && source.startsWith(char.repeat(3), at3);
    if (fence) {
      const open = source.indexOf("\n", at3);
      if (open < 0) {
        ranges.push([at3, source.length]);
        break;
      }
      const closer = new RegExp(`^[ \\t]{0,3}${char}{3,}[ \\t]*$`, "gm");
      closer.lastIndex = open + 1;
      const found = closer.exec(source);
      const end = found ? found.index + found[0].length : source.length;
      ranges.push([at3, end]);
      at3 = end;
      continue;
    }
    if (char === "`") {
      let ticks = 1;
      while (source[at3 + ticks] === "`") {
        ticks += 1;
      }
      const close = source.indexOf("`".repeat(ticks), at3 + ticks);
      if (close >= 0) {
        ranges.push([at3, close + ticks]);
        at3 = close + ticks;
        continue;
      }
    }
    at3 += 1;
  }
  return ranges;
}
var inCode = (ranges, at3) => ranges.some(([start, end]) => at3 >= start && at3 < end);
function closeBracket(source, open) {
  let depth = 0;
  for (let at3 = open; at3 < source.length; at3 += 1) {
    const char = source[at3];
    if (char === "\\") {
      at3 += 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return at3;
      }
    }
  }
  return -1;
}
function closeParen(source, open) {
  let depth = 0;
  for (let at3 = open; at3 < source.length; at3 += 1) {
    const char = source[at3];
    if (char === "\\") {
      at3 += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return at3;
      }
    }
  }
  return -1;
}
function splitAddress(body) {
  const match = body.match(/^(\S*?)(?:\s+"([^"]*)")?$/);
  if (!match) {
    return null;
  }
  return { url: match[1], urlOffset: 0, title: match[2] ?? "" };
}
function imageIn(label, start) {
  const match = label.match(/!\[([^\]]*)\]\(([^)\s]*)(?:\s+"([^"]*)")?\)/);
  if (!match) {
    return null;
  }
  const at3 = start + match.index;
  const srcStart = at3 + match[0].indexOf("](") + 2;
  return {
    start: at3,
    end: at3 + match[0].length,
    alt: match[1],
    altStart: at3 + 2,
    altEnd: at3 + 2 + match[1].length,
    src: match[2],
    srcStart,
    srcEnd: srcStart + match[2].length,
    title: match[3] ?? ""
  };
}
function links(source) {
  const found = [];
  const code = codeRanges(source);
  let at3 = 0;
  while (at3 < source.length) {
    const open = source.indexOf("[", at3);
    if (open < 0) {
      break;
    }
    at3 = open + 1;
    if (source[open - 1] === "!" || source[open - 1] === "\\" || inCode(code, open)) {
      continue;
    }
    const close = closeBracket(source, open);
    if (close < 0 || source[close + 1] !== "(") {
      continue;
    }
    const paren = closeParen(source, close + 1);
    if (paren < 0) {
      continue;
    }
    const label = source.slice(open + 1, close);
    const body = source.slice(close + 2, paren);
    const parsed = splitAddress(body);
    if (!parsed) {
      continue;
    }
    const urlStart = close + 2 + parsed.urlOffset;
    found.push({
      start: open,
      end: paren + 1,
      label,
      labelStart: open + 1,
      labelEnd: close,
      url: parsed.url,
      urlStart,
      urlEnd: urlStart + parsed.url.length,
      title: parsed.title,
      image: imageIn(label, open + 1),
      text: label.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim()
    });
    at3 = paren + 1;
  }
  return found;
}
var LinkPanel = class {
  constructor(editor) {
    this.editor = editor;
    this.prefix = editor.prefix;
    this.element = null;
    this.found = [];
    this.rows = [];
    this.saveButton = null;
    this.revert = null;
    dismiss({
      open: () => this.open,
      element: () => this.element,
      close: () => this.close(),
      signal: editor.aborter.signal
    });
  }
  get open() {
    return Boolean(this.element);
  }
  toggle(event) {
    if (this.open) {
      this.close();
      return;
    }
    this.show(event);
  }
  // The options a caller opens the panel with:
  //
  //   at      a source offset; the row for the link standing there takes
  //           the focus, which is how a link just written out of a
  //           selection gets its address typed without hunting for a row
  //   only    draw that row and no other: the writer asked for one link,
  //           not for the table over the document
  //   revert  the document to put back if the panel is dismissed, for a
  //           caller that wrote the link before opening this
  show(event, { at: at3 = null, only = false, revert = null } = {}) {
    this.close();
    this.revert = revert;
    this.found = links(this.editor.value);
    if (only && at3 !== null) {
      this.found = this.found.filter((link) => link.start === at3);
    }
    this.rows = [];
    const name = (part2) => `${this.prefix}__${part2}`;
    const texts = this.editor.texts;
    this.element = document.createElement("div");
    this.element.className = name("links");
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", texts.linkPanel);
    this.element.dataset.images = String(this.found.some((link) => link.image));
    const head = document.createElement("div");
    head.className = name("links-head");
    const title = document.createElement("span");
    title.className = name("links-title");
    title.textContent = texts.linkPanel;
    const count = document.createElement("span");
    count.className = name("links-count");
    count.textContent = String(this.found.length);
    head.append(title, count);
    const list = document.createElement("div");
    list.className = name("links-list");
    list.setAttribute("role", "table");
    const header = document.createElement("div");
    header.className = name("links-row");
    header.dataset.head = "true";
    header.setAttribute("role", "row");
    for (const [part2, label] of [
      ["order", texts.linkOrder],
      ["text", texts.linkText],
      ["address", texts.linkAddress],
      ["image", texts.linkImage]
    ]) {
      const cell = document.createElement("span");
      cell.className = `${name(`links-${part2}`)} ${name(`links-cell--${part2}`)}`;
      cell.dataset.head = "true";
      cell.setAttribute("role", "columnheader");
      cell.textContent = label;
      header.appendChild(cell);
    }
    list.appendChild(header);
    this.found.forEach((link, at4) => {
      list.appendChild(this.row(link, at4 + 1));
    });
    if (!this.found.length) {
      const empty = document.createElement("p");
      empty.className = name("links-empty");
      empty.textContent = texts.linkNone;
      list.appendChild(empty);
    }
    const foot = document.createElement("div");
    foot.className = name("links-foot");
    const cancel = tool({
      prefix: this.prefix,
      key: "links-cancel",
      title: texts.cancel,
      label: texts.cancel,
      run: () => this.close()
    });
    const save = tool({
      prefix: this.prefix,
      key: "links-save",
      title: texts.save,
      label: texts.save,
      run: () => this.save()
    });
    save.classList.add(name("links-save"));
    save.disabled = true;
    this.saveButton = save;
    foot.append(cancel, save);
    this.element.append(head, list, foot);
    this.editor.root.appendChild(this.element);
    const box = this.editor.bar?.getBoundingClientRect();
    place(this.element, this.editor.root, event ?? { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 });
    const asked = at3 === null ? null : this.rows.find((row) => row.link.start === at3);
    (asked ?? this.rows.find((row) => !row.link.url))?.address.focus();
  }
  // row draws one link: the number it holds, its text, its address, and -
  // for a picture linking somewhere - the picture and the address it comes
  // from. Both addresses are drafts until Save.
  row(link, order) {
    const name = (part2) => `${this.prefix}__${part2}`;
    const texts = this.editor.texts;
    const element = document.createElement("div");
    element.className = name("links-row");
    element.setAttribute("role", "row");
    const at3 = document.createElement("span");
    at3.className = `${name("links-order")} ${name("links-cell--order")}`;
    at3.textContent = String(order);
    const text2 = document.createElement("span");
    text2.className = `${name("links-text")} ${name("links-cell--text")}`;
    text2.textContent = link.text || link.image?.alt || (link.image ? texts.linkPicture : "");
    text2.title = text2.textContent;
    const address = document.createElement("input");
    address.type = "text";
    address.className = `${name("links-input")} ${name("links-cell--address")}`;
    address.value = link.url;
    address.spellcheck = false;
    address.setAttribute("aria-label", texts.linkAddress);
    if (!link.url) {
      address.placeholder = texts.linkEmpty;
    }
    const image = document.createElement("span");
    image.className = `${name("links-image")} ${name("links-cell--image")}`;
    let src = null;
    if (link.image) {
      const shot = document.createElement("img");
      shot.className = name("links-shot");
      shot.alt = "";
      shot.src = link.image.src;
      shot.title = texts.linkView;
      shot.addEventListener("click", () => this.view(link.image.src));
      shot.addEventListener("error", () => {
        shot.hidden = true;
      });
      src = document.createElement("input");
      src.type = "text";
      src.className = name("links-input");
      src.value = link.image.src;
      src.spellcheck = false;
      src.setAttribute("aria-label", texts.linkImageAddress);
      image.append(shot, src);
    }
    element.append(at3, text2, address, image);
    const held = {
      element,
      link,
      address,
      image,
      urlDraft: link.url,
      srcDraft: link.image?.src ?? "",
      dirty: false
    };
    address.addEventListener("input", () => this.draft(held, "url", address.value));
    if (src) {
      src.addEventListener("input", () => this.draft(held, "src", src.value));
    }
    this.rows.push(held);
    this.paint(held);
    return element;
  }
  // paint marks a row with the two things its drawing says: whether its
  // address draft is still empty, and whether it holds a change Save has
  // yet to write. The panel is outside the surface, so it may hold text of
  // its own.
  paint(held) {
    held.element.dataset.empty = String(!held.urlDraft);
    held.element.dataset.dirty = String(held.dirty);
  }
  // draft takes what the writer typed into a row and compares it with the
  // link it stands for. Nothing reaches the document here: Save is the one
  // press that writes.
  draft(held, part2, value) {
    if (part2 === "src") {
      held.srcDraft = value;
    } else {
      held.urlDraft = value;
    }
    held.dirty = held.urlDraft !== held.link.url || Boolean(held.link.image) && held.srcDraft !== held.link.image.src;
    this.paint(held);
    this.mark();
  }
  // mark puts Save on or off with the table's drafts.
  mark() {
    if (this.saveButton) {
      this.saveButton.disabled = !this.rows.some((held) => held.dirty);
    }
  }
  // save writes every changed address back into the document, in document
  // order, and puts the panel away. A row that holds no change writes
  // nothing, so a save touches only what the writer edited.
  save() {
    for (const held of this.rows) {
      if (held.urlDraft !== held.link.url) {
        this.write(held.link, "url", held.urlDraft);
      }
      if (held.link.image && held.srcDraft !== held.link.image.src) {
        this.write(held.link, "src", held.srcDraft);
      }
      held.urlDraft = held.link.url;
      held.srcDraft = held.link.image?.src ?? "";
      held.dirty = false;
      this.paint(held);
    }
    this.mark();
    this.revert = null;
    this.close();
  }
  view(address) {
    if (!address) {
      return;
    }
    window.open(address, "_blank", "noopener");
  }
  // write replaces one address of one link - the link's own, or the address
  // of the picture inside it - and leaves the rest of the markdown exactly
  // as the writer wrote it. Every link after it moves by the length of the
  // change, and its row keeps pointing at its own link because the record
  // moves with the document.
  write(link, part2, value) {
    const from = part2 === "src" ? link.image.srcStart : link.urlStart;
    const to = part2 === "src" ? link.image.srcEnd : link.urlEnd;
    const start = link.start;
    const markdown = this.editor.value.slice(start, link.end);
    const rewrite = markdown.slice(0, from - start) + value + markdown.slice(to - start);
    const delta = rewrite.length - markdown.length;
    this.editor.source.replace(start, link.end, rewrite, false);
    for (const other of this.found) {
      if (other !== link && other.start > start) {
        move(other, delta);
      }
    }
    const [fresh] = links(rewrite);
    if (fresh) {
      Object.assign(link, fresh);
      move(link, start);
      link.text = fresh.text;
    } else {
      link.end = start + rewrite.length;
      if (part2 === "src" && link.image) {
        link.image.src = value;
        link.image.srcEnd = link.image.srcStart + value.length;
      } else {
        link.url = value;
        link.urlEnd = link.urlStart + value.length;
      }
    }
    this.editor.emit("change", { value: this.editor.value });
  }
  close() {
    if (!this.open) {
      return;
    }
    if (this.revert !== null) {
      const back = this.revert;
      this.revert = null;
      this.editor.value = back;
    }
    this.element.remove();
    this.element = null;
    this.found = [];
    this.rows = [];
    this.saveButton = null;
  }
};
function move(link, delta) {
  for (const key of ["start", "end", "labelStart", "labelEnd", "urlStart", "urlEnd"]) {
    link[key] += delta;
  }
  if (link.image) {
    for (const key of ["start", "end", "altStart", "altEnd", "srcStart", "srcEnd"]) {
      link.image[key] += delta;
    }
  }
}

// src/proof.js
var FLATTEN = /\s*\n\s*/g;
var ProofPanel = class {
  constructor(editor) {
    this.editor = editor;
    this.prefix = editor.prefix;
    this.element = null;
    this.findings = [];
    this.reading = false;
    this.editing = null;
    this.draft = null;
    this.origin = null;
    this.caret = null;
    dismiss({
      open: () => this.open,
      element: () => this.element,
      close: () => this.close(),
      // A press on the bar is not a dismissal: `run()` refuses it
      // while a draft stands, and it could not refuse it if the panel
      // had already gone and taken the focus with it.
      keep: () => editor.bar,
      signal: editor.aborter.signal
    });
  }
  get open() {
    return Boolean(this.element);
  }
  async toggle(event) {
    if (this.open) {
      this.close();
      return;
    }
    await this.read(event);
  }
  // read asks the host about the document as it stands and draws the
  // answer. A second press while one is in flight does nothing: the
  // request is the slow part and two of them answer the same thing.
  async read(event) {
    if (this.reading) {
      return;
    }
    this.reading = true;
    this.show(event, null);
    try {
      const answer = await this.editor.options.proof(this.editor.value);
      this.findings = Array.isArray(answer) ? answer : answer?.findings ?? [];
      this.show(event, this.findings);
    } catch (err) {
      this.show(event, [], err?.message || this.editor.texts.proofFailed);
    } finally {
      this.reading = false;
    }
  }
  show(event, findings, failure = "") {
    const texts = this.editor.texts;
    const name = (part2) => `${this.prefix}__${part2}`;
    const at3 = this.element?.getBoundingClientRect();
    const scrolled = this.element?.querySelector(`.${name("proof-list")}`)?.scrollTop ?? 0;
    if (!Array.isArray(findings) || !findings.includes(this.editing)) {
      this.forget();
    }
    this.element?.remove();
    this.element = document.createElement("div");
    this.element.className = name("proof");
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", texts.proofPanel);
    const head = document.createElement("div");
    head.className = name("proof-head");
    const title = document.createElement("span");
    title.className = name("proof-title");
    title.textContent = texts.proofPanel;
    const count = document.createElement("span");
    count.className = name("proof-count");
    head.append(title, count);
    const list = document.createElement("div");
    list.className = name("proof-list");
    if (findings === null) {
      count.textContent = texts.proofReading;
      list.append(this.note(texts.proofReading));
    } else if (failure) {
      count.textContent = "";
      list.append(this.note(failure));
    } else if (findings.length === 0) {
      count.textContent = "0";
      list.append(this.note(texts.proofClean));
    } else {
      count.textContent = String(findings.length);
      for (const finding of findings) {
        list.append(this.row(finding));
      }
    }
    const foot = document.createElement("div");
    foot.className = name("proof-foot");
    const again = tool({
      prefix: this.prefix,
      key: "proof-again",
      title: texts.proofAgain,
      label: texts.proofAgain,
      hold: false,
      run: (click) => this.read(click)
    });
    again.classList.add(name("proof-again"));
    const done = tool({
      prefix: this.prefix,
      key: "proof-done",
      title: texts.done,
      label: texts.done,
      hold: false,
      run: () => this.close()
    });
    done.classList.add(name("proof-done"));
    foot.append(again, done);
    this.element.append(head, list, foot);
    this.editor.root.appendChild(this.element);
    list.scrollTop = scrolled;
    const field = this.element.querySelector(`.${name("proof-field")}`);
    if (field) {
      this.grow(field);
    }
    const box = this.editor.bar?.getBoundingClientRect();
    place(this.element, this.editor.root, at3 ? { clientX: at3.left, clientY: at3.top } : event ?? { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 });
    if (field) {
      field.focus({ preventScroll: true });
      const [from, to] = this.caret ?? [field.value.length, field.value.length];
      field.setSelectionRange(from, to);
    }
  }
  // grow keeps the field as tall as what is written in it: a sentence
  // wraps, and a field that scrolls hides the half of it the writer is not
  // looking at. The stylesheet caps it.
  grow(field) {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }
  // forget drops the draft. A panel that is gone holds nothing, and neither
  // does one whose draft belongs to a finding no longer in the list.
  forget() {
    this.editing = this.draft = this.origin = this.caret = null;
  }
  note(text2) {
    const line = document.createElement("p");
    line.className = `${this.prefix}__proof-note`;
    line.textContent = text2;
    return line;
  }
  // context cuts what stands around a finding out of the document, so the
  // row reads without looking at the page behind the panel.
  //
  // The sentence the finding is in is the unit worth reading: a few words
  // either side can stop mid-clause and say less than nothing. A row
  // opens on a short form and the whole sentence is one press away, since
  // a panel of twenty full sentences is a wall.
  //
  // Both cuts stop at the line the finding stands on. Two paragraphs run
  // together say less than one line of the right one.
  //
  // The span comes first and the strings are cut out of it, so the words a
  // row shows and the characters a field over it holds are the same ones.
  context(finding, words2 = 4) {
    const text2 = this.editor.value;
    if (text2.slice(finding.start, finding.end) !== finding.match) {
      return null;
    }
    const lineStart = text2.lastIndexOf("\n", finding.start - 1) + 1;
    let lineEnd = text2.indexOf("\n", finding.end);
    if (lineEnd < 0) {
      lineEnd = text2.length;
    }
    const head = text2.slice(lineStart, finding.start);
    const tail = text2.slice(finding.end, lineEnd);
    const opens = [...head.matchAll(/[.!?](?=\s)/g)];
    const closes = tail.match(/^[\s\S]*?[.!?](?=\s|$)/);
    const sentence = {
      start: opens.length ? lineStart + opens[opens.length - 1].index + 1 : lineStart,
      end: closes ? finding.end + closes[0].length : lineEnd
    };
    while (sentence.start < finding.start && /\s/.test(text2[sentence.start])) {
      sentence.start += 1;
    }
    while (sentence.end > finding.end && /\s/.test(text2[sentence.end - 1])) {
      sentence.end -= 1;
    }
    const line = text2.slice(lineStart, lineEnd);
    const marker = line.match(/^[>\s]*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/)[0].length;
    sentence.start = Math.max(sentence.start, Math.min(lineStart + marker, finding.start));
    if (/^\s*\|/.test(line)) {
      let from = finding.start;
      while (from > lineStart && !(text2[from - 1] === "|" && text2[from - 2] !== "\\")) {
        from -= 1;
      }
      let to = finding.end;
      while (to < lineEnd && !(text2[to] === "|" && text2[to - 1] !== "\\")) {
        to += 1;
      }
      while (from < finding.start && /\s/.test(text2[from])) {
        from += 1;
      }
      while (to > finding.end && /\s/.test(text2[to - 1])) {
        to -= 1;
      }
      sentence.start = from;
      sentence.end = to;
    }
    const sentenceLead = text2.slice(sentence.start, finding.start);
    const sentenceRest = text2.slice(finding.end, sentence.end);
    const shortLead = head.split(/\s+/).filter(Boolean).slice(-words2).join(" ");
    const shortRest = tail.split(/\s+/).filter(Boolean).slice(0, words2).join(" ");
    const cut = (text3, taken, trailing) => {
      const elided = taken.trim().length < text3.trim().length;
      if (!elided) {
        return taken;
      }
      return trailing ? taken.replace(/\s*$/, "") + " ..." : "... " + taken.replace(/^\s*/, "");
    };
    return {
      sentence,
      lead: cut(head, shortLead === head.trim() ? head : " " + shortLead + " ", false),
      rest: cut(tail, shortRest === tail.trim() ? tail : " " + shortRest, true),
      fullLead: cut(head, sentenceLead, false),
      fullRest: cut(tail, sentenceRest, true),
      // Whether the short form left anything out. A finding already
      // standing in its whole sentence has nothing to open.
      more: sentenceLead.trim() !== shortLead.trim() || sentenceRest.trim() !== shortRest.trim()
    };
  }
  // row draws one finding: what raised it, the words it is about in the
  // line they stand in, what it says, and a button per suggestion. The row
  // holding the draft draws a field where the words would be.
  row(finding) {
    const name = (part2) => `${this.prefix}__${part2}`;
    const texts = this.editor.texts;
    const element = document.createElement("div");
    element.className = name("proof-row");
    element.dataset.tool = finding.tool ?? "";
    element.dataset.severity = finding.severity ?? "";
    const writing = this.editing === finding;
    element.dataset.editing = String(writing);
    const kind = document.createElement("span");
    kind.className = name("proof-kind");
    kind.textContent = finding.rule || finding.tool || "";
    const body = document.createElement("div");
    body.className = name("proof-body");
    const match = document.createElement("button");
    match.type = "button";
    match.className = name("proof-snippet");
    const marked = document.createElement("mark");
    marked.className = name("proof-match");
    marked.textContent = finding.match ?? "";
    const around = this.context(finding);
    if (around) {
      const lead = document.createElement("span");
      const rest = document.createElement("span");
      const draw = (whole) => {
        lead.textContent = whole ? around.fullLead : around.lead;
        rest.textContent = whole ? around.fullRest : around.rest;
        match.dataset.whole = String(whole);
      };
      draw(false);
      match.append(lead, marked, rest);
      if (around.more) {
        match.title = this.editor.texts.proofWhole;
        match.addEventListener("click", () => draw(match.dataset.whole !== "true"));
      } else {
        match.disabled = true;
      }
    } else {
      match.append(marked);
      match.disabled = true;
    }
    const message = document.createElement("span");
    message.className = name("proof-message");
    message.textContent = finding.message ?? "";
    const fixes = document.createElement("span");
    fixes.className = name("proof-fixes");
    for (const suggestion of finding.suggestions ?? []) {
      const fix = document.createElement("button");
      fix.type = "button";
      fix.className = name("proof-fix");
      fix.textContent = suggestion;
      fix.disabled = Boolean(this.editing);
      fix.addEventListener("click", () => this.apply(finding, suggestion));
      fixes.append(fix);
    }
    const actions = document.createElement("span");
    actions.className = name("proof-actions");
    const show = document.createElement("button");
    show.type = "button";
    show.className = `${name("proof-show")} ${this.prefix}__tool`;
    show.title = texts.proofShow;
    show.setAttribute("aria-label", texts.proofShow);
    show.textContent = "\u21B3";
    show.addEventListener("click", () => this.reveal(finding));
    actions.append(show);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = `${name("proof-edit")} ${this.prefix}__tool`;
    edit.title = texts.proofEdit;
    edit.setAttribute("aria-label", texts.proofEdit);
    edit.setAttribute("aria-expanded", String(writing));
    edit.textContent = "\u270E";
    edit.disabled = !around || this.editor.value.slice(around.sentence.start, around.sentence.end).includes("\n");
    edit.addEventListener("click", () => this.rewrite(finding));
    actions.append(edit);
    if (this.editor.options.allow) {
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = name("proof-keep");
      keep.textContent = this.editor.texts.proofKeep;
      keep.title = this.editor.texts.proofKeepTitle;
      keep.addEventListener("click", () => this.keep(finding, keep));
      actions.append(keep);
    }
    const ignore = document.createElement("button");
    ignore.type = "button";
    ignore.className = `${name("proof-ignore")} ${this.prefix}__tool`;
    ignore.title = this.editor.texts.proofIgnore;
    ignore.setAttribute("aria-label", this.editor.texts.proofIgnore);
    ignore.textContent = "\xD7";
    ignore.addEventListener("click", () => this.ignore(finding));
    actions.append(ignore);
    body.append(writing ? this.field(finding) : match, message, fixes);
    if (writing) {
      body.append(this.presses(finding));
    }
    element.append(kind, body, actions);
    return element;
  }
  // field draws the sentence as something to type in. It is seeded from the
  // draft and never from a sentence read out of the document again: a
  // redraw while it stands open - another row's × or keep - would
  // otherwise throw away what the writer has typed.
  //
  // Newlines are forbidden rather than offered. The span is one line of
  // markdown by construction, so a break in it ends a list item, takes a
  // table row apart, or becomes a soft break renderers disagree about. A
  // cell answers a pasted newline the same way, with the space it stands
  // for. It is a textarea for the wrapping and the growing, not for a
  // second line: Enter saves, shifted or not.
  field(finding) {
    const field = document.createElement("textarea");
    field.className = `${this.prefix}__proof-field`;
    field.rows = 1;
    field.spellcheck = false;
    field.value = this.draft ?? "";
    field.setAttribute("aria-label", this.editor.texts.proofEdit);
    field.addEventListener("input", () => this.type(field));
    field.addEventListener("paste", (event) => {
      event.preventDefault();
      const text2 = (event.clipboardData?.getData("text/plain") ?? "").replace(FLATTEN, " ");
      field.setRangeText(text2, field.selectionStart, field.selectionEnd, "end");
      this.type(field);
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (this.draft !== this.origin) {
          this.save(finding);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.cancel(finding);
      }
    });
    return field;
  }
  // presses draws the two ways a draft ends.
  presses(finding) {
    const texts = this.editor.texts;
    const row = document.createElement("div");
    row.className = `${this.prefix}__proof-draft`;
    const save = document.createElement("button");
    save.type = "button";
    save.className = `${this.prefix}__proof-save`;
    save.textContent = texts.save;
    save.disabled = this.draft === this.origin;
    save.addEventListener("click", () => this.save(finding));
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = `${this.prefix}__proof-cancel`;
    cancel.textContent = texts.cancel;
    cancel.addEventListener("click", () => this.cancel(finding));
    row.append(save, cancel);
    return row;
  }
  // type takes what the writer typed: the draft and the caret are both
  // remembered as they go, so a redraw puts the field back the way they
  // left it.
  type(field) {
    const flat = field.value.replace(FLATTEN, " ");
    if (flat !== field.value) {
      const at3 = Math.max(0, Math.min(field.selectionStart - (field.value.length - flat.length), flat.length));
      field.value = flat;
      field.setSelectionRange(at3, at3);
    }
    this.draft = field.value;
    this.caret = [field.selectionStart, field.selectionEnd];
    this.grow(field);
    const save = this.element?.querySelector(`.${this.prefix}__proof-save`);
    if (save) {
      save.disabled = this.draft === this.origin;
    }
  }
  // rewrite opens the sentence a finding stands in as a field. A second
  // press puts the row back: nothing was written, so there is nothing to
  // put back in the document.
  rewrite(finding) {
    if (this.editing === finding) {
      this.cancel(finding);
      return;
    }
    const around = this.context(finding);
    if (!around) {
      this.read();
      return;
    }
    this.editing = finding;
    this.origin = this.editor.value.slice(around.sentence.start, around.sentence.end);
    this.draft = this.origin;
    this.caret = null;
    this.show(null, this.findings);
  }
  // cancel drops the draft and draws the row again, with the focus back on
  // the button it was opened from.
  cancel(finding) {
    this.forget();
    this.show(null, this.findings);
    this.rowAt(finding)?.querySelector(`.${this.prefix}__proof-edit`)?.focus();
  }
  // rowAt answers the drawn row one finding stands on. The rows are drawn
  // from the list in order, so where a finding stands in the list is which
  // row it is.
  rowAt(finding) {
    const at3 = this.findings.indexOf(finding);
    return at3 < 0 ? null : this.element?.querySelectorAll(`.${this.prefix}__proof-row`)[at3] ?? null;
  }
  // reveal puts the caret on the span the finding names, so the writer
  // reads it where it stands. A span that no longer holds the words is one
  // the document has moved under, the way context() and apply() read it:
  // jumping there would send the writer somewhere the report never meant.
  reveal(finding) {
    if (this.editor.value.slice(finding.start, finding.end) !== finding.match) {
      this.read();
      return;
    }
    this.editor.source.select(finding.start, finding.end);
    this.editor.focus({ preventScroll: true });
    scrollTo(document.getSelection());
  }
  // apply writes the suggestion over the span and takes the row away. The
  // findings after it move by the length of the change: the host read the
  // document one state ago, and nothing here asks it again.
  apply(finding, suggestion) {
    const before = this.editor.value;
    if (before.slice(finding.start, finding.end) !== finding.match) {
      this.read();
      return;
    }
    this.editor.source.replace(finding.start, finding.end, suggestion, finding.start + suggestion.length);
    const delta = suggestion.length - (finding.end - finding.start);
    this.findings = this.findings.filter((one) => one !== finding);
    for (const one of this.findings) {
      if (one.start >= finding.end) {
        move2(one, one.start + delta, one.end + delta);
      }
    }
    this.show(null, this.findings);
  }
  // save writes the field over the span it was opened on, drops the row and
  // re-anchors the rest of the list, the way applying a suggestion does.
  save(finding) {
    const around = this.context(finding);
    const value = this.editor.value;
    if (!around || value.slice(around.sentence.start, around.sentence.end) !== this.origin) {
      this.read();
      return;
    }
    const { start, end } = around.sentence;
    const origin = this.origin;
    const text2 = this.draft;
    const at3 = this.findings.indexOf(finding);
    this.editor.source.replace(start, end, text2, start + text2.length);
    this.findings = this.findings.filter((one) => one !== finding);
    this.anchor(start, end, origin, text2);
    this.forget();
    this.show(null, this.findings);
    const next = this.element?.querySelectorAll(`.${this.prefix}__proof-row`)[at3];
    const land = next?.querySelector(`.${this.prefix}__proof-edit`);
    (land ?? this.element?.querySelector(`.${this.prefix}__proof-done`))?.focus();
  }
  // anchor moves the rest of the list onto the sentence the writer wrote.
  // The host read the document one state ago and nothing here asks it
  // again, so every finding is placed by hand: one before the span stands
  // still, one after it shifts by the length of the change, and one inside
  // it is looked up by its own words.
  //
  // A finding running across one end of the span goes: half of what it was
  // about was rewritten, and there is no honest place to put the rest.
  anchor(start, end, origin, text2) {
    const delta = text2.length - origin.length;
    const kept = [];
    for (const one of this.findings) {
      if (one.end <= start) {
        kept.push(one);
      } else if (one.start >= end) {
        move2(one, one.start + delta, one.end + delta);
        kept.push(one);
      } else if (one.start >= start && one.end <= end) {
        const found = this.relocate(one, start, origin, text2);
        if (found !== null) {
          move2(one, start + found, start + found + (one.match ?? "").length);
          kept.push(one);
        }
      }
    }
    this.findings = kept;
  }
  // relocate answers where in the sentence the writer wrote one finding's
  // words now stand, counted from the start of the span, or null where they
  // are gone from it.
  //
  // The words alone do not say which of them the row was about: "The repo
  // holds one more repo." is two findings over the same four letters, and
  // dropping both because the sentence was edited would take away a row the
  // writer never touched. So the count carries it. The same number of
  // occurrences means the same one as before; a different number means the
  // one nearest where this finding stood, since something was added or
  // taken away and the order is all that is left to go on.
  relocate(one, start, origin, text2) {
    const match = one.match ?? "";
    if (match === "") {
      return null;
    }
    const places = (where) => {
      const out = [];
      for (let found = where.indexOf(match); found >= 0; found = where.indexOf(match, found + 1)) {
        out.push(found);
      }
      return out;
    };
    const was = places(origin);
    const now = places(text2);
    if (now.length === 0) {
      return null;
    }
    const want = one.start - start;
    const ordinal = was.indexOf(want);
    if (now.length === was.length && ordinal >= 0) {
      return now[ordinal];
    }
    return now.reduce((best, found) => Math.abs(found - want) < Math.abs(best - want) ? found : best, now[0]);
  }
  // ignore drops one finding from the list and remembers nothing: the
  // writer has read it and moved on, and the next document starts over.
  ignore(finding) {
    this.findings = this.findings.filter((one) => one !== finding);
    this.show(null, this.findings);
  }
  // keep hands the finding to the host to remember, and drops every row
  // about the same words: a name the writer keeps is kept wherever it
  // stands, not once per place it stands in.
  //
  // The rows go when the host has taken it. A host that refuses leaves
  // the list alone and says so on the row, since a word the writer thinks
  // they kept and did not would be reported again with no explanation.
  async keep(finding, button) {
    button.disabled = true;
    try {
      await this.editor.options.allow(finding);
    } catch (err) {
      button.disabled = false;
      button.textContent = err?.message || this.editor.texts.proofFailed;
      return;
    }
    const same = (one) => one.tool === finding.tool && one.rule === finding.rule && (one.match ?? "").toLowerCase() === (finding.match ?? "").toLowerCase();
    this.findings = this.findings.filter((one) => !same(one));
    this.show(null, this.findings);
  }
  close() {
    if (!this.open) {
      return;
    }
    this.element.remove();
    this.element = null;
    this.forget();
  }
};
function move2(finding, start, end) {
  finding.start = start;
  finding.end = end;
}

// src/source.js
var Source = class {
  constructor(field) {
    this.field = field;
  }
  // ── What a surface answers ────────────────────────────────────────────
  get value() {
    return this.field.value;
  }
  set value(text2) {
    this.replace(0, this.field.value.length, text2);
  }
  get selection() {
    const { selectionStart: start, selectionEnd: end } = this.field;
    return { start, end, text: this.field.value.slice(start, end) };
  }
  select(from, to = from) {
    this.field.selectionStart = from;
    this.field.selectionEnd = to;
  }
  focus(options) {
    this.field.focus(options);
  }
  // active answers the source the next move acts on. A plain source is the
  // only one it has; the editing surface answers a table cell here when the
  // caret stands in one.
  get active() {
    return this;
  }
  // replace writes `text` over a range. `selectFrom` and `selectTo` name
  // where the caret lands; a `selectFrom` of false leaves the selection
  // alone, for an edit made from a panel of its own, where the caret the
  // writer is using is in one of that panel's fields and moving it would
  // take the focus away mid-word.
  replace(start, end, text2, selectFrom, selectTo) {
    this.field.setRangeText(text2, start, end, selectFrom === false ? "preserve" : "end");
    if (selectFrom !== void 0 && selectFrom !== false) {
      this.select(selectFrom, selectTo ?? selectFrom);
    }
    this.field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  // ── The moves ─────────────────────────────────────────────────────────
  // insert puts `text` where the selection is. `cursor` is an offset into
  // `text` to land on and `length` selects that many characters from it, so
  // a tool can leave the writer on the part only they can fill in.
  insert(text2, cursor = text2.length, length = 0) {
    const { start, end } = this.selection;
    this.replace(start, end, text2, start + cursor, start + cursor + length);
  }
  // insertBlock is insert() for a block construct: it adds the newline the
  // block needs to own its line, and counts `cursor` from the first
  // character of the block.
  insertBlock(text2, cursor = text2.length, length = 0) {
    const { start, end } = this.selection;
    const lead = start === 0 || this.value[start - 1] === "\n" ? "" : "\n";
    const at3 = start + lead.length + cursor;
    this.replace(start, end, lead + text2, at3, at3 + length);
  }
  // wrap puts markers around the selection, or drops a placeholder and
  // selects it when nothing is selected. Running it again on an
  // already-wrapped selection takes the markers back off.
  // wrap puts a marker around the selection, or takes it back off: the
  // writer pressing the same key twice means the second press undoes the
  // first, the way every editor behaves.
  //
  // The markers are either side of the selection or inside it, since
  // wrapping leaves the words selected and the markers outside them. Both
  // are read, so a word decorated by one press is bare after the next
  // whichever way the selection fell.
  wrap(marker, placeholder = "") {
    const { start, end, text: text2 } = this.selection;
    const width = marker.length;
    const value = this.value;
    if (text2.length >= width * 2 && text2.slice(0, width) === marker && text2.slice(-width) === marker) {
      const bare = text2.slice(width, -width);
      this.replace(start, end, bare, start, start + bare.length);
      return;
    }
    if (text2 !== "" && start >= width && value.slice(start - width, start) === marker && value.slice(end, end + width) === marker) {
      this.replace(start - width, end + width, text2, start - width, start - width + text2.length);
      return;
    }
    const body = text2 || placeholder;
    this.insert(marker + body + marker, width, body.length);
  }
  // lines answers the range the selection touches, grown out to whole lines.
  lines() {
    const value = this.value;
    const { start: from, end: to } = this.selection;
    const start = value.lastIndexOf("\n", from - 1) + 1;
    let end = value.indexOf("\n", to);
    if (end < 0) {
      end = value.length;
    }
    return { start, end, text: value.slice(start, end) };
  }
  // line answers the one line the caret sits on, ignoring the rest of a
  // selection: what a per-line tool like the heading cycle acts on.
  line() {
    const value = this.value;
    const from = this.selection.start;
    const start = value.lastIndexOf("\n", from - 1) + 1;
    let end = value.indexOf("\n", from);
    if (end < 0) {
      end = value.length;
    }
    return { start, end, text: value.slice(start, end) };
  }
  // indent puts a tab in front of every line the selection touches, and
  // outdent takes one level of indentation back off. A level is a tab or
  // the spaces someone else's editor left in its place.
  indent(marker = "	") {
    const { start, end, text: text2 } = this.lines();
    const next = text2.split("\n").map((line) => marker + line).join("\n");
    this.replace(start, end, next, start, start + next.length);
  }
  outdent() {
    const { start, end, text: text2 } = this.lines();
    const next = text2.split("\n").map((line) => line.replace(/^(\t| {1,4})/, "")).join("\n");
    this.replace(start, end, next, start, start + next.length);
  }
  // prefixLines puts a line marker on every line the selection touches, and
  // takes it off again when every line already carries it.
  prefixLines(marker) {
    const { start, end, text: text2 } = this.lines();
    const pattern = new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    const lines = text2.split("\n");
    const carried = lines.every((line) => pattern.test(line));
    const next = lines.map((line) => carried ? line.replace(pattern, "") : marker + line).join("\n");
    this.replace(start, end, next, start, start + next.length);
  }
};

// src/tools.js
var TABLE = [
  "| Column | Column | Column |",
  "| --- | --- | --- |",
  "|  |  |  |",
  "|  |  |  |"
].join("\n");
function cycleHeading(editor) {
  const source = editor.source.active;
  const { start, end, text: text2 } = source.line();
  const current = text2.match(/^(#{1,6})\s/);
  let next;
  if (!current) {
    next = `## ${text2}`;
  } else if (current[1].length < 3) {
    next = `#${text2}`;
  } else {
    next = text2.replace(/^#{1,6}\s/, "");
  }
  source.replace(start, end, next, start + next.length);
}
function insertLink(editor, event) {
  if (!editor.selection.text && editor.linkPanel) {
    editor.linkPanel.toggle(event);
    return;
  }
  const text2 = editor.selection.text || "text";
  if (!editor.linkPanel) {
    editor.insert(`[${text2}](url)`, text2.length + 3, 3);
    return;
  }
  const before = editor.value;
  const start = editor.selection.start;
  editor.insert(`[${text2}]()`, text2.length + 3, 0);
  editor.linkPanel.show(event, { at: start, only: true, revert: before });
}
function insertFence(editor) {
  const body = editor.selection.text || "code";
  editor.insertBlock("```\n" + body + "\n```\n", 3, 0);
}
function defaultTools() {
  return {
    bold: { label: "B", icon: "icon-text-bold", title: "Bold", run: (editor) => editor.wrap("**", "bold") },
    italic: { label: "I", icon: "icon-text-italic", title: "Italic", run: (editor) => editor.wrap("_", "italic") },
    strike: { label: "S", icon: "icon-text-strikethrough", title: "Strikethrough", run: (editor) => editor.wrap("~~", "struck") },
    heading: { label: "H", icon: "icon-text-heading", title: "Heading", run: cycleHeading },
    link: { label: "[ ]", icon: "icon-link", title: "Link", run: insertLink },
    code: { label: "<>", icon: "icon-code", title: "Inline code", run: (editor) => editor.wrap("`", "code") },
    fence: { label: "{ }", icon: "icon-code-block", title: "Code block", run: insertFence },
    quote: { label: '"', icon: "icon-quote", title: "Quote", run: (editor) => editor.prefixLines("> ") },
    list: { label: "\u2261", icon: "icon-list", title: "Bullet list", run: (editor) => editor.prefixLines("- ") },
    // The pilcrow shows or hides the marker characters. The editor puts
    // this button on the bar itself; the key stays here so a project
    // that lists its own toolbar still finds it.
    marks: {
      label: "\xB6",
      icon: "icon-paragraph",
      title: "Show the markup",
      run: (editor) => editor.toggleMarks?.()
    },
    // One button for both: inside a table it opens the grid, and
    // anywhere else it writes a new table. A table needs to start its
    // own line and needs a blank line after it, or the next paragraph
    // joins the last row; the caret lands on the first column heading.
    table: {
      label: "Table",
      // A grid mark reads as a table or as the grid editor; the word
      // settles it.
      word: true,
      icon: "icon-table",
      title: "Table",
      run: (editor) => {
        if (!editor.editTable?.()) {
          editor.insertBlock(`${TABLE}

`, 2, 6);
        }
      }
    }
  };
}
var TOOLBAR_FULL = [
  "bold",
  "italic",
  "strike",
  "heading",
  "link",
  "code",
  "fence",
  "quote",
  "list",
  "table"
];
var TOOLBAR_INLINE = ["bold", "italic", "strike", "link", "code"];

// src/table.js
var ALIGNMENTS2 = ["left", "center", "right"];
var RULE = /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/;
var PIPE = /(?<!\\)\|/;
var LAST = /(?<!\\)\|\s*$/;
function cells(row) {
  const trimmed = row.trim().replace(/^\|/, "").replace(LAST, "");
  return trimmed.split(PIPE).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}
function parse(markdown) {
  const lines = markdown.split("\n").filter((line) => line.trim() !== "");
  const rows = [];
  let alignments = [];
  let ruled = false;
  for (const line of lines) {
    if (!ruled && RULE.test(line) && rows.length === 1) {
      ruled = true;
      alignments = cells(line).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        if (left && right) {
          return "center";
        }
        return right ? "right" : "left";
      });
      continue;
    }
    rows.push(cells(line));
  }
  const width = Math.max(1, ...rows.map((row) => row.length), alignments.length);
  for (const row of rows) {
    while (row.length < width) {
      row.push("");
    }
  }
  while (alignments.length < width) {
    alignments.push("left");
  }
  if (rows.length === 0) {
    rows.push(Array(width).fill(""));
  }
  return { rows, alignments };
}
function format({ rows, alignments }) {
  const written2 = (rows.length ? rows : [[]]).map(
    (row) => alignments.map((_, column) => (row[column] ?? "").replace(/\|/g, "\\|"))
  );
  const widths = alignments.map(
    (_, column) => Math.max(3, ...written2.map((row) => row[column].length))
  );
  const pad = (text2, column) => text2 + " ".repeat(Math.max(0, widths[column] - text2.length));
  const rule = alignments.map((alignment, column) => {
    const dashes = "-".repeat(Math.max(3, widths[column]));
    if (alignment === "center") {
      return `:${dashes.slice(2)}:`;
    }
    if (alignment === "right") {
      return `${dashes.slice(1)}:`;
    }
    return dashes;
  });
  const line = (values) => `| ${values.map((value, column) => pad(value, column)).join(" | ")} |`;
  const out = [line(written2[0])];
  out.push(`| ${rule.join(" | ")} |`);
  for (const row of written2.slice(1)) {
    out.push(line(row));
  }
  return out.join("\n");
}
function find(value, caret) {
  const lines = value.split("\n");
  let offset = 0;
  let index = 0;
  for (; index < lines.length; index += 1) {
    const next = offset + lines[index].length + 1;
    if (caret < next) {
      break;
    }
    offset = next;
  }
  const row = (at3) => at3 >= 0 && at3 < lines.length && /^\s*\|/.test(lines[at3]);
  if (!row(index)) {
    return null;
  }
  let first = index;
  while (row(first - 1)) {
    first -= 1;
  }
  let last = index;
  while (row(last + 1)) {
    last += 1;
  }
  const start = lines.slice(0, first).reduce((total, line) => total + line.length + 1, 0);
  const end = lines.slice(0, last + 1).reduce((total, line) => total + line.length + 1, 0) - 1;
  return { start, end, markdown: value.slice(start, end) };
}
function grid(markdown) {
  const found = [];
  let offset = 0;
  let row = 0;
  let ruled = false;
  for (const line of markdown.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (line.trim() === "") {
      continue;
    }
    if (!ruled && RULE.test(line) && row === 1) {
      ruled = true;
      continue;
    }
    let body = line.trim();
    let base = start + (line.length - line.trimStart().length);
    if (body.startsWith("|")) {
      body = body.slice(1);
      base += 1;
    }
    body = body.replace(LAST, "");
    let walked = 0;
    body.split(PIPE).forEach((part2, column) => {
      const pad = part2.length - part2.trimStart().length;
      found.push({ row, column, start: base + walked + pad, markdown: part2.trim() });
      walked += part2.length + 1;
    });
    row += 1;
  }
  return found;
}
var drawn = (text2) => text2.replace(/\\\|/g, "|");
function at(markdown, offset) {
  for (const cell of grid(markdown)) {
    if (offset < cell.start || offset > cell.start + cell.markdown.length) {
      continue;
    }
    const before = drawn(markdown.slice(cell.start, offset)).length;
    return { row: cell.row, column: cell.column, at: Math.min(before, drawn(cell.markdown).length) };
  }
  return null;
}
function offsetAt(markdown, row, column, at3) {
  const cell = grid(markdown).find((found) => found.row === row && found.column === column);
  if (!cell) {
    return null;
  }
  let index = 0;
  for (let counted = 0; counted < at3 && index < cell.markdown.length; counted += 1) {
    index += cell.markdown.startsWith("\\|", index) ? 2 : 1;
  }
  return cell.start + index;
}
function cellEditor(field) {
  const source = new Source(field);
  return {
    source,
    get selection() {
      return source.selection;
    },
    focus: () => source.focus(),
    wrap: (marker, placeholder) => source.wrap(marker, placeholder),
    insert: (text2, cursor, length) => source.insert(text2, cursor, length),
    insertBlock: (text2, cursor, length) => source.insertBlock(text2, cursor, length),
    prefixLines: (marker) => source.prefixLines(marker)
  };
}
var TableGrid = class {
  constructor(editor) {
    this.editor = editor;
    this.prefix = editor.prefix;
    this.tools = defaultTools();
    this.element = null;
    this.range = null;
    this.focused = null;
    this.stage = null;
  }
  get open() {
    return Boolean(this.element);
  }
  // toggle opens the grid over the table the caret sits in, and closes it
  // again. It answers whether it found a table to edit.
  toggle() {
    if (this.open) {
      this.close();
      return true;
    }
    const found = find(this.editor.value, this.editor.selection.start);
    if (!found) {
      return false;
    }
    return this.openAt(found);
  }
  // openAt opens the grid over one known range: what the rendered view
  // holds when a table is clicked there, where no caret says which table
  // the writer means.
  openAt({ start, end }) {
    if (this.open) {
      this.close();
    }
    this.range = { start, end };
    this.table = parse(this.editor.value.slice(start, end));
    this.focused = null;
    this.build();
    return true;
  }
  close() {
    if (!this.open) {
      return;
    }
    this.element.remove();
    this.element = null;
    this.stage.hidden = false;
    this.editor.refresh();
    this.editor.source.select(this.range.start);
    this.editor.focus();
    this.editor.emit("table", { open: false });
  }
  // ── The panel ─────────────────────────────────────────────────────────
  build() {
    const name = (part2) => `${this.prefix}__${part2}`;
    this.element = document.createElement("div");
    this.element.className = name("grid");
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", this.editor.texts.tableGrid);
    this.element.appendChild(this.buildBar());
    this.body = document.createElement("div");
    this.body.className = name("grid-body");
    this.element.appendChild(this.body);
    this.stage = this.editor.stage;
    this.stage.hidden = true;
    this.stage.parentNode.insertBefore(this.element, this.stage.nextSibling);
    this.paint();
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });
    this.editor.emit("table", { open: true });
  }
  buildBar() {
    const name = (part2) => `${this.prefix}__${part2}`;
    const bar = document.createElement("div");
    bar.className = `${name("bar")} ${name("grid-bar")}`;
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", this.editor.texts.formatting);
    for (const key of TOOLBAR_INLINE) {
      const tool2 = this.tools[key];
      bar.appendChild(
        this.button(key, tool2.label, tool2.title, tool2.icon, () => {
          if (this.focused) {
            tool2.run(cellEditor(this.focused));
            this.write();
            this.focused.focus();
          }
        })
      );
    }
    bar.appendChild(this.divider());
    const actions = [
      ["row-add", this.editor.texts.rowAdd, "icon-row-add", () => this.addRow()],
      ["row-remove", this.editor.texts.rowRemove, "icon-row-remove", () => this.removeRow()],
      ["column-add", this.editor.texts.columnAdd, "icon-column-add", () => this.addColumn()],
      ["column-remove", this.editor.texts.columnRemove, "icon-column-remove", () => this.removeColumn()],
      ["align", this.editor.texts.align, "icon-align", () => this.cycleAlignment()]
    ];
    for (const [key, title, icon, run] of actions) {
      bar.appendChild(this.button(key, title, title, icon, run));
    }
    const done = this.button(
      "grid-done",
      this.editor.texts.done,
      this.editor.texts.done,
      null,
      () => this.close()
    );
    done.classList.add(`${this.prefix}__tool--grid-done`);
    bar.appendChild(done);
    roving(bar);
    return bar;
  }
  button(key, label, title, icon, run) {
    return tool({ prefix: this.prefix, key, label, title, icon, run });
  }
  divider() {
    const line = document.createElement("span");
    line.className = `${this.prefix}__grid-divider`;
    line.setAttribute("aria-hidden", "true");
    return line;
  }
  // paint draws the grid from the parsed table. The first row is the
  // header, as markdown reads it.
  paint() {
    const held = this.focused ? { row: Number(this.focused.dataset.row), column: Number(this.focused.dataset.column) } : null;
    const table2 = document.createElement("table");
    table2.className = `${this.prefix}__grid-table`;
    this.table.rows.forEach((row, rowIndex) => {
      const line = document.createElement("tr");
      row.forEach((value, column) => {
        const cell = document.createElement(rowIndex === 0 ? "th" : "td");
        cell.dataset.align = this.table.alignments[column];
        const view = document.createElement("div");
        view.className = `${this.prefix}__cell-view`;
        view.innerHTML = renderInline(value);
        const field2 = document.createElement("textarea");
        field2.className = `${this.prefix}__cell-edit`;
        field2.rows = 1;
        field2.value = value;
        field2.spellcheck = rowIndex !== 0;
        field2.dataset.row = String(rowIndex);
        field2.dataset.column = String(column);
        field2.setAttribute("aria-label", `${this.editor.texts.cell} ${rowIndex + 1}, ${column + 1}`);
        const show = (editing) => {
          view.hidden = editing;
          field2.hidden = !editing;
          if (editing) {
            this.grow(field2);
          }
        };
        view.addEventListener("mousedown", (event) => {
          event.preventDefault();
          show(true);
          field2.focus();
          field2.setSelectionRange(field2.value.length, field2.value.length);
        });
        field2.addEventListener("focus", () => {
          this.focused = field2;
          for (const node of this.element.querySelectorAll("[data-focused]")) {
            node.removeAttribute("data-focused");
          }
          cell.setAttribute("data-focused", "");
        });
        field2.addEventListener("blur", () => {
          view.innerHTML = renderInline(field2.value);
          show(false);
          cell.removeAttribute("data-focused");
        });
        field2.addEventListener("input", () => {
          this.table.rows[rowIndex][column] = field2.value;
          this.grow(field2);
          this.write();
        });
        show(false);
        cell.append(view, field2);
        line.appendChild(cell);
      });
      table2.appendChild(line);
    });
    this.body.replaceChildren(table2);
    const field = (held && this.fieldAt(held.row, held.column)) ?? this.body.querySelector("textarea");
    if (field) {
      field.hidden = false;
      field.previousElementSibling.hidden = true;
      this.grow(field);
      field.focus();
    }
  }
  // fieldAt answers the cell field at a row and a column, clamped to the
  // grid as it now stands: a removed row or column leaves the writer on
  // the nearest cell.
  fieldAt(row, column) {
    const at3 = Math.min(Math.max(row, 0), this.table.rows.length - 1);
    const by = Math.min(Math.max(column, 0), this.table.alignments.length - 1);
    return this.body.querySelector(`textarea[data-row="${at3}"][data-column="${by}"]`);
  }
  // grow keeps a cell as tall as the text in it: a cell holds markdown,
  // and markdown runs on.
  grow(field) {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }
  // write puts the table back in the document and remembers the range it
  // now occupies.
  write() {
    const markdown = format(this.table);
    this.editor.source.replace(this.range.start, this.range.end, markdown, false);
    this.range.end = this.range.start + markdown.length;
    this.editor.emit("change", { value: this.editor.value });
  }
  // ── Rows, columns, alignment ──────────────────────────────────────────
  position() {
    const row = Number(this.focused?.dataset.row ?? this.table.rows.length - 1);
    const column = Number(this.focused?.dataset.column ?? this.table.alignments.length - 1);
    return { row, column };
  }
  addRow() {
    const { row } = this.position();
    this.table.rows.splice(row + 1, 0, Array(this.table.alignments.length).fill(""));
    this.write();
    this.paint();
  }
  removeRow() {
    const { row } = this.position();
    if (this.table.rows.length < 2 || row === 0) {
      return;
    }
    this.table.rows.splice(row, 1);
    this.write();
    this.paint();
  }
  addColumn() {
    const { column } = this.position();
    this.table.alignments.splice(column + 1, 0, "left");
    for (const row of this.table.rows) {
      row.splice(column + 1, 0, "");
    }
    this.write();
    this.paint();
  }
  removeColumn() {
    const { column } = this.position();
    if (this.table.alignments.length < 2) {
      return;
    }
    this.table.alignments.splice(column, 1);
    for (const row of this.table.rows) {
      row.splice(column, 1);
    }
    this.write();
    this.paint();
  }
  cycleAlignment() {
    const { column } = this.position();
    const next = (ALIGNMENTS2.indexOf(this.table.alignments[column]) + 1) % ALIGNMENTS2.length;
    this.table.alignments[column] = ALIGNMENTS2[next];
    this.write();
    this.paint();
  }
};

// src/menu.js
var PRESS = 450;
var WANDER = 10;
var TableMenu = class {
  constructor(editor) {
    this.editor = editor;
    this.prefix = editor.prefix;
    this.element = null;
    this.widget = null;
    this.at = null;
    this.timer = null;
  }
  get open() {
    return Boolean(this.element);
  }
  attach(signal) {
    const surface = this.editor.surface;
    for (const name of ["contextmenu", "dblclick"]) {
      surface.addEventListener(
        name,
        (event) => {
          const found = this.find(event);
          if (!found) {
            return;
          }
          event.preventDefault();
          this.show(found, event);
        },
        { signal }
      );
    }
    surface.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType !== "touch") {
          return;
        }
        const found = this.find(event);
        if (!found) {
          return;
        }
        this.at = { x: event.clientX, y: event.clientY };
        this.timer = setTimeout(() => {
          this.timer = null;
          this.show(found, { clientX: this.at.x, clientY: this.at.y });
        }, PRESS);
      },
      { signal }
    );
    const drop = (event) => {
      if (this.timer === null) {
        return;
      }
      if (event.type === "pointermove" && Math.abs(event.clientX - this.at.x) < WANDER && Math.abs(event.clientY - this.at.y) < WANDER) {
        return;
      }
      clearTimeout(this.timer);
      this.timer = null;
    };
    for (const name of ["pointerup", "pointercancel", "pointermove", "scroll"]) {
      surface.addEventListener(name, drop, { signal, passive: true });
    }
    dismiss({ open: () => this.open, element: () => this.element, close: () => this.close(), signal });
  }
  // find answers the cell the gesture landed on, with the table it belongs
  // to and where in it the cell stands.
  find(event) {
    if (event.target.closest?.(`.${this.prefix}__pic`)) {
      return null;
    }
    const cell = event.target.closest?.("th, td");
    const widget = cell?.closest(`.${this.prefix}__widget--table`);
    if (!widget || !this.editor.surface.contains(widget)) {
      return null;
    }
    return {
      widget,
      cell,
      row: Number(cell.dataset.row ?? 0),
      column: Number(cell.dataset.column ?? 0)
    };
  }
  // ── The menu ──────────────────────────────────────────────────────────
  show(found, event) {
    this.close();
    this.widget = found.widget;
    this.where = found;
    const texts = this.editor.texts;
    const table2 = parse(found.widget.dataset.block);
    const rows = table2.rows.length;
    const columns = table2.alignments.length;
    this.element = document.createElement("div");
    this.element.className = `${this.prefix}__menu`;
    this.element.setAttribute("role", "menu");
    this.element.setAttribute("aria-label", texts.tableMenu);
    this.element.append(
      this.group([
        this.item("row-add-above", texts.rowAbove, "icon-row-add", () => this.addRow(found.row)),
        this.item("row-add-below", texts.rowBelow, "icon-row-add", () => this.addRow(found.row + 1)),
        this.item("row-remove", texts.rowRemove, "icon-row-remove", () => this.removeRow(found.row), {
          enabled: found.row > 0 && rows > 1
        })
      ]),
      this.group([
        this.item("column-add-left", texts.columnLeft, "icon-column-add", () => this.addColumn(found.column)),
        this.item(
          "column-add-right",
          texts.columnRight,
          "icon-column-add",
          () => this.addColumn(found.column + 1)
        ),
        this.item("column-remove", texts.columnRemove, "icon-column-remove", () => this.removeColumn(found.column), {
          enabled: columns > 1
        })
      ]),
      this.group(
        ["left", "center", "right"].map(
          (align) => this.item(
            `align-${align}`,
            texts[`align${align[0].toUpperCase()}${align.slice(1)}`],
            `icon-align-${align}`,
            () => this.align(found.column, align),
            { checked: table2.alignments[found.column] === align }
          )
        )
      )
    );
    this.editor.root.appendChild(this.element);
    place(this.element, this.editor.root, event);
    this.element.querySelector("button:not([disabled])")?.focus();
  }
  group(items) {
    const group = document.createElement("div");
    group.className = `${this.prefix}__menu-group`;
    group.setAttribute("role", "group");
    group.append(...items);
    return group;
  }
  item(key, label, icon, run, { enabled = true, checked = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${this.prefix}__menu-item ${this.prefix}__menu-item--${key}`;
    button.setAttribute("role", checked === false ? "menuitem" : "menuitemradio");
    if (checked !== false) {
      button.setAttribute("aria-checked", String(checked));
    }
    button.disabled = !enabled;
    const mark = document.createElement("span");
    mark.className = `icon ${icon}`;
    mark.setAttribute("aria-hidden", "true");
    const text2 = document.createElement("span");
    text2.textContent = label;
    button.append(mark, text2);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      run();
      this.close();
    });
    return button;
  }
  close() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.open) {
      return;
    }
    this.element.remove();
    this.element = null;
    this.widget = null;
    this.where = null;
  }
  // ── The edits ─────────────────────────────────────────────────────────
  // edit rewrites the block this menu stands over, and leaves the writer
  // in the cell the edit means them to be in.
  edit(change, land) {
    const widget = this.widget;
    const table2 = parse(widget.dataset.block);
    change(table2);
    this.editor.source.rewrite(widget, format(table2), land(table2));
    this.editor.emit("change", { value: this.editor.value });
  }
  addRow(at3) {
    this.edit(
      (table2) => table2.rows.splice(Math.max(at3, 1), 0, Array(table2.alignments.length).fill("")),
      () => ({ row: Math.max(at3, 1), column: 0 })
    );
  }
  removeRow(at3) {
    this.edit(
      (table2) => {
        if (at3 > 0 && table2.rows.length > 1) {
          table2.rows.splice(at3, 1);
        }
      },
      (table2) => ({ row: Math.min(at3, table2.rows.length - 1), column: this.where?.column ?? 0 })
    );
  }
  addColumn(at3) {
    this.edit(
      (table2) => {
        table2.alignments.splice(at3, 0, "left");
        for (const row of table2.rows) {
          row.splice(at3, 0, "");
        }
      },
      () => ({ row: 0, column: at3 })
    );
  }
  removeColumn(at3) {
    this.edit(
      (table2) => {
        if (table2.alignments.length > 1) {
          table2.alignments.splice(at3, 1);
          for (const row of table2.rows) {
            row.splice(at3, 1);
          }
        }
      },
      (table2) => ({ row: this.where?.row ?? 0, column: Math.min(at3, table2.alignments.length - 1) })
    );
  }
  align(at3, alignment) {
    this.edit(
      (table2) => {
        table2.alignments[at3] = alignment;
      },
      () => ({ row: this.where?.row ?? 0, column: at3 })
    );
  }
};

// src/preview.js
function size(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  const units = ["kB", "MB", "GB", "TB"];
  let amount = value;
  let at3 = -1;
  do {
    amount /= 1024;
    at3 += 1;
  } while (amount >= 1024 && at3 < units.length - 1);
  const rounded = amount < 10 ? Math.round(amount * 10) / 10 : Math.round(amount);
  return `${rounded} ${units[at3]}`;
}
function iconFor(file) {
  const type = file?.type || "";
  if (type.startsWith("image/")) {
    return "icon-image";
  }
  if (type.startsWith("audio/")) {
    return "icon-audio";
  }
  if (type.startsWith("video/")) {
    return "icon-video";
  }
  return "icon-file";
}
function eta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}
var part = (className) => {
  const element = document.createElement("span");
  element.className = className;
  return element;
};
function preview(record, editor) {
  const prefix = editor.prefix;
  const texts = editor.texts;
  const node = part(`${prefix}__upload`);
  node.dataset.upload = String(record.id);
  node.dataset.state = record.state;
  node.dataset.inline = String(Boolean(record.inline));
  node.contentEditable = "false";
  node.setAttribute("role", "group");
  const icon = part(`${prefix}__upload-icon icon ${iconFor(record.file)}`);
  icon.setAttribute("aria-hidden", "true");
  const text2 = part(`${prefix}__upload-text`);
  const name = part(`${prefix}__upload-name`);
  name.dataset.name = record.name || "";
  const weight = part(`${prefix}__upload-size`);
  weight.dataset.size = size(record.file?.size ?? 0);
  const bar = part(`${prefix}__upload-bar`);
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = part(`${prefix}__upload-fill`);
  bar.appendChild(fill);
  const estimate = part(`${prefix}__upload-eta`);
  estimate.setAttribute("aria-hidden", "true");
  const error = part(`${prefix}__upload-error`);
  error.dataset.error = record.error || "";
  const retry = tool({
    prefix,
    key: "upload-retry",
    icon: "icon-upload",
    title: texts.uploadRetry,
    run: (event) => {
      event?.stopPropagation();
      editor.uploads?.retry(record);
    }
  });
  text2.append(name, weight);
  node.append(icon, text2, bar, estimate, error, retry);
  record.node = node;
  render(node, record, editor);
  return node;
}
function render(node, record, editor) {
  const prefix = editor.prefix;
  const texts = editor.texts;
  const bits = size(record.file?.size ?? 0);
  node.dataset.state = record.state;
  node.dataset.inline = String(Boolean(record.inline));
  const name = node.querySelector(`.${prefix}__upload-name`);
  if (name) {
    name.dataset.name = record.name || "";
  }
  const weight = node.querySelector(`.${prefix}__upload-size`);
  if (weight) {
    weight.dataset.size = bits;
  }
  const bar = node.querySelector(`.${prefix}__upload-bar`);
  const fill = node.querySelector(`.${prefix}__upload-fill`);
  const ratio = record.total > 0 ? Math.min(Math.max(record.loaded / record.total, 0), 1) : 0;
  if (record.total > 0) {
    node.dataset.known = "true";
    bar?.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  } else {
    node.dataset.known = "false";
    bar?.removeAttribute("aria-valuenow");
  }
  if (fill) {
    fill.style.width = record.total > 0 ? `${Math.round(ratio * 100)}%` : "";
  }
  const error = node.querySelector(`.${prefix}__upload-error`);
  if (error) {
    error.dataset.error = record.error || "";
  }
  const left = record.state === "start" || record.state === "progress" ? eta(record.eta) : "";
  const estimate = node.querySelector(`.${prefix}__upload-eta`);
  if (estimate) {
    estimate.dataset.eta = left ? `${texts.uploadEta} ${left}` : "";
  }
  const said = record.state === "failed" ? `${record.name}, ${bits}, ${texts.uploadFailed}: ${record.error || texts.uploadUnreachable}` : record.state === "done" ? `${record.name}, ${bits}, ${texts.uploadDone}` : `${record.name}, ${bits}, ${texts.uploading} ${Math.round(ratio * 100)}%${left ? `, ${texts.uploadEta} ${left}` : ""}`;
  node.setAttribute("aria-label", said);
  const retry = node.querySelector(`.${prefix}__tool--upload-retry`);
  if (retry) {
    retry.title = texts.uploadRetry;
    retry.setAttribute("aria-label", `${texts.uploadRetry}: ${record.name}`);
  }
}

// src/queue.js
var UploadPanel = class {
  constructor(editor) {
    this.editor = editor;
    this.prefix = editor.prefix;
    this.element = null;
    this.rows = /* @__PURE__ */ new Map();
    editor.on("upload", (event) => this.note(event));
    editor.on("error", (event) => {
      if (event.phase === "upload") {
        this.fail(event);
      }
    });
    dismiss({
      open: () => this.open,
      element: () => this.element,
      close: () => this.close(),
      signal: editor.aborter.signal
    });
  }
  get open() {
    return Boolean(this.element);
  }
  // toggle opens the queue under the tool that asked for it, and presses it
  // away again.
  toggle(event) {
    if (this.open) {
      this.close();
      return;
    }
    this.show(event);
  }
  show(event) {
    this.build();
    for (const record of this.editor.uploads?.list() ?? []) {
      this.row(record);
    }
    this.editor.root.appendChild(this.element);
    const box = this.editor.bar?.getBoundingClientRect();
    const at3 = event && Number.isFinite(event.clientX) ? { clientX: event.clientX, clientY: event.clientY } : { clientX: box?.left ?? 0, clientY: box?.bottom ?? 0 };
    place(this.element, this.editor.root, at3);
  }
  build() {
    if (this.element) {
      return;
    }
    const texts = this.editor.texts;
    const name = (part2) => `${this.prefix}__${part2}`;
    this.element = document.createElement("div");
    this.element.className = name("queue");
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", texts.uploadQueue);
    const head = document.createElement("div");
    head.className = name("queue-head");
    const title = document.createElement("span");
    title.className = name("queue-title");
    title.textContent = texts.uploadQueue;
    const done = tool({
      prefix: this.prefix,
      key: "queue-done",
      label: texts.done,
      title: texts.done,
      hold: false,
      run: () => this.close()
    });
    head.append(title, done);
    this.list = document.createElement("div");
    this.list.className = name("queue-list");
    this.list.setAttribute("role", "list");
    this.empty = document.createElement("p");
    this.empty.className = name("queue-empty");
    this.empty.textContent = texts.uploadEmpty;
    const foot = document.createElement("div");
    foot.className = name("queue-foot");
    const choose = tool({
      prefix: this.prefix,
      key: "queue-choose",
      icon: "icon-upload",
      label: texts.uploadChoose,
      // The one action in the panel's foot, and a mark alone would not
      // say which files it means.
      word: true,
      title: texts.uploadChoose,
      hold: false,
      run: () => this.editor.uploads?.open()
    });
    choose.dataset.primary = "true";
    foot.appendChild(choose);
    this.element.append(head, this.empty, this.list, foot);
    this.element.addEventListener("click", (event) => event.stopPropagation());
  }
  // row answers the row for one record, building it the first time a file
  // is seen.
  row(record) {
    const held = this.rows.get(record.id);
    if (held) {
      this.paint(held, record);
      return held;
    }
    const name = (part2) => `${this.prefix}__${part2}`;
    const element = document.createElement("div");
    element.className = name("queue-row");
    element.dataset.id = String(record.id);
    element.setAttribute("role", "listitem");
    const icon = document.createElement("span");
    icon.className = `icon ${iconFor(record.file)} ${name("queue-icon")}`;
    icon.setAttribute("aria-hidden", "true");
    const text2 = document.createElement("span");
    text2.className = name("queue-text");
    const title = document.createElement("span");
    title.className = name("queue-name");
    title.textContent = record.name;
    const weight = document.createElement("span");
    weight.className = name("queue-size");
    weight.textContent = size(record.file?.size ?? 0);
    text2.append(title, weight);
    const bar = document.createElement("span");
    bar.className = name("queue-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("span");
    fill.className = name("queue-fill");
    bar.appendChild(fill);
    const state = document.createElement("span");
    state.className = name("queue-state");
    const action = document.createElement("button");
    action.type = "button";
    action.className = `${name("queue-action")} ${name("tool")}`;
    element.append(icon, text2, bar, state, action);
    this.list.appendChild(element);
    const held_ = { element, title, weight, bar, fill, state, action, record };
    this.rows.set(record.id, held_);
    this.paint(held_, record);
    return held_;
  }
  // paint puts one file's state on its row: the bar, the word, and the one
  // button the state has - try again when it failed, put it away when it
  // landed.
  paint(row, record) {
    const texts = this.editor.texts;
    const ratio = record.total > 0 ? Math.min(Math.max(record.loaded / record.total, 0), 1) : 0;
    row.record = record;
    row.element.dataset.state = record.state;
    row.title.textContent = record.name;
    row.weight.textContent = size(record.file?.size ?? 0);
    if (record.state === "done") {
      row.element.dataset.known = "true";
      row.bar.setAttribute("aria-valuenow", "100");
      row.fill.style.width = "100%";
    } else if (record.total > 0) {
      row.element.dataset.known = "true";
      row.bar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
      row.fill.style.width = `${Math.round(ratio * 100)}%`;
    } else {
      row.element.dataset.known = "false";
      row.bar.removeAttribute("aria-valuenow");
      row.fill.style.width = "";
    }
    row.state.dataset.state = record.state;
    if (record.state === "failed") {
      row.state.textContent = record.error || texts.uploadFailed;
    } else if (record.state === "done") {
      row.state.textContent = texts.uploadDone;
    } else {
      row.state.textContent = record.total > 0 ? `${texts.uploading} ${Math.round(ratio * 100)}%` : texts.uploading;
    }
    row.action.hidden = record.state === "start" || record.state === "progress";
    row.action.textContent = record.state === "failed" ? texts.uploadRetry : texts.uploadForget;
    row.action.title = row.action.textContent;
    row.action.setAttribute("aria-label", `${row.action.textContent}: ${record.name}`);
    row.action.onclick = () => {
      row.action.onclick = null;
      if (record.state === "failed") {
        this.editor.uploads?.retry(record);
        return;
      }
      this.forget(record.id);
    };
    this.empty.hidden = this.rows.size > 0;
  }
  forget(id) {
    const held = this.rows.get(id);
    if (!held) {
      return;
    }
    held.element.remove();
    this.rows.delete(id);
    this.empty.hidden = this.rows.size > 0;
  }
  // note follows one upload event. A row appears with the first event and
  // moves through the states after it.
  note(event) {
    if (event.id === void 0 || event.id === null || !this.element) {
      return;
    }
    const record = this.editor.uploads?.at(event.id) ?? this.rows.get(event.id)?.record;
    if (!record) {
      return;
    }
    if (!this.rows.has(event.id)) {
      record.name = event.file?.name || record.name;
      record.file = event.file ?? record.file;
    }
    this.row(record);
  }
  // fail marks the row of a request that answered with nothing usable. The
  // record itself is already in that state - it failed before the event
  // was raised.
  fail(event) {
    if (event.id === void 0 || event.id === null || !this.element) {
      return;
    }
    const held = this.rows.get(event.id);
    if (!held) {
      return;
    }
    held.record = this.editor.uploads?.at(event.id) ?? held.record;
    held.record.error = event.error?.message || held.record.error;
    held.record.state = "failed";
    this.paint(held, held.record);
  }
  close() {
    if (!this.open) {
      return;
    }
    this.element.remove();
    this.element = null;
    this.list = null;
    this.empty = null;
    this.rows.clear();
  }
};

// src/code.js
var COMMON = {
  declare: [
    "func",
    "function",
    "fn",
    "def",
    "sub",
    "method",
    "class",
    "struct",
    "interface",
    "enum",
    "trait",
    "type",
    "var",
    "let",
    "const",
    "static",
    "final",
    "abstract",
    "public",
    "private",
    "protected",
    "extends",
    "implements",
    "package",
    "namespace",
    "module",
    "import",
    "include",
    "require",
    "use",
    "export",
    "from",
    "return"
  ],
  keyword: [
    "if",
    "else",
    "elseif",
    "elif",
    "for",
    "foreach",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "goto",
    "try",
    "catch",
    "finally",
    "throw",
    "new",
    "delete",
    "in",
    "of",
    "as",
    "and",
    "or",
    "not",
    "yield",
    "await",
    "async"
  ],
  type: [
    "int",
    "integer",
    "float",
    "double",
    "long",
    "short",
    "byte",
    "char",
    "rune",
    "string",
    "str",
    "bool",
    "boolean",
    "void",
    "any",
    "object",
    "array",
    "list",
    "map",
    "dict",
    "set",
    "error",
    "exception",
    "null",
    "nil",
    "none",
    "true",
    "false",
    "undefined",
    "this",
    "self"
  ]
};
var LANGUAGES = {
  go: {
    keyword: ["defer", "go", "select", "range", "fallthrough", "chan"],
    type: [
      "int8",
      "int16",
      "int32",
      "int64",
      "uint",
      "uint8",
      "uint16",
      "uint32",
      "uint64",
      "float32",
      "float64",
      "complex64",
      "complex128",
      "uintptr",
      "any",
      "error"
    ],
    builtin: [
      "append",
      "make",
      "len",
      "cap",
      "copy",
      "close",
      "delete",
      "panic",
      "recover",
      "print",
      "println",
      "new",
      "min",
      "max",
      "clear"
    ]
  },
  php: {
    declare: ["readonly", "global", "instanceof", "clone", "fn", "match", "enum"],
    keyword: ["echo", "print", "endif", "endforeach", "endwhile", "declare", "yield"],
    type: [
      "Throwable",
      "Exception",
      "Error",
      "TypeError",
      "ValueError",
      "Closure",
      "Generator",
      "iterable",
      "callable",
      "mixed",
      "never",
      "stdClass",
      "parent"
    ],
    builtin: [
      "isset",
      "unset",
      "empty",
      "count",
      "implode",
      "explode",
      "sprintf",
      "printf",
      "str_replace",
      "strlen",
      "substr",
      "trim",
      "in_array",
      "array_map",
      "array_filter",
      "array_merge",
      "json_encode",
      "json_decode",
      "preg_match",
      "preg_replace",
      "file_get_contents",
      "file_put_contents",
      "var_dump"
    ]
  }
};
var ALIASES = {
  golang: "go",
  php5: "php",
  php8: "php"
};
var bags = /* @__PURE__ */ new Map();
function words(language) {
  const name = ALIASES[language] ?? language;
  if (bags.has(name)) {
    return bags.get(name);
  }
  const bag = /* @__PURE__ */ new Map();
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
var TOKEN = new RegExp(
  [
    "(?<comment>//[^\\n]*|#[^\\n]*|/\\*[^\\n]*?\\*/|--[^\\n]*)",
    "(?<string>\"(?:\\\\.|[^\"\\\\])*\"?|'(?:\\\\.|[^'\\\\])*'?|`[^`]*`?)",
    "(?<number>\\b0[xXbBoO][0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?\\b)",
    "(?<call>[A-Za-z_][\\w]*)(?=\\s*\\()",
    "(?<variable>\\$[A-Za-z_]\\w*|@[A-Za-z_]\\w*)",
    "(?<name>[A-Za-z_][\\w]*)",
    "(?<bracket>[{}()\\[\\]])",
    "(?<operator>[=+\\-*/%<>!&|^~?:;,.])"
  ].join("|"),
  "g"
);
function highlightCode(line, prefix, language) {
  const bag = words(language);
  const tok = (name, body) => `<span class="${prefix}-c-${name}">${body}</span>`;
  let out = "";
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    const { comment, string, number, call, variable, name, bracket, operator } = match.groups;
    out += escapeHTML(line.slice(last, match.index));
    last = match.index + match[0].length;
    const safe = escapeHTML(match[0]);
    if (comment !== void 0) {
      out += tok("comment", safe);
    } else if (string !== void 0) {
      out += tok("string", safe);
    } else if (number !== void 0) {
      out += tok("number", safe);
    } else if (call !== void 0) {
      const kind = bag.get(call);
      out += tok(kind === "declare" || kind === "keyword" ? kind : kind ?? "call", safe);
    } else if (variable !== void 0) {
      out += tok("variable", safe);
    } else if (name !== void 0) {
      const kind = bag.get(name);
      out += kind ? tok(kind, safe) : safe;
    } else if (bracket !== void 0) {
      out += tok("bracket", safe);
    } else if (operator !== void 0) {
      out += tok("operator", safe);
    }
  }
  return out + escapeHTML(line.slice(last));
}

// src/highlight.js
var FENCE = /^(\s*)(```|~~~)(.*)$/;
var HEADING = /^(#{1,6}\s+)(.*)$/;
var QUOTE = /^(\s*>\s?)(.*)$/;
var ITEM = /^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/;
var RULE2 = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
var ROW = /^\s*\|/;
var ALIGN = /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/;
var INLINE = [
  {
    name: "code",
    pattern: /(`+)([^`]+?)\1/g,
    read: ([, ticks, body]) => [{ mark: ticks }, { text: body }, { mark: ticks }]
  },
  {
    // An image is all marker. With the markers hidden the picture stands
    // in their place, and it carries the alt text itself.
    //
    // With no address there is no picture to stand there, so the caption
    // stays on the page as the text it is: an image whose address is yet
    // to come - the placeholder an upload leaves behind - has to say so
    // in both views, and a broken picture says nothing.
    name: "image",
    pattern: /(!\[)([^\]\n]*)(\]\(([^)\n]*?)(?:\s+"[^"]*")?\))/g,
    read: ([, open, alt, close, src]) => src === "" ? [{ mark: open }, { text: alt }, { mark: close }] : [{ mark: open }, { mark: alt }, { mark: close }, { picture: { src, alt } }]
  },
  {
    // A link to a file a browser can play draws the player, the way an
    // image marker draws the picture: the marker is all marker, and with
    // it hidden the player stands in its place.
    name: "link",
    pattern: /(\[)([^\]\n]*)(\]\(([^)\n]*?)(?:\s+"[^"]*")?\))/g,
    read: ([, open, label, close, href]) => {
      const kind = mediaKind(href);
      return kind ? [{ mark: open }, { mark: label }, { mark: close }, { media: { src: href, kind, label } }] : [{ mark: open }, ...inlineTokens(label), { mark: close }];
    }
  },
  {
    name: "strong",
    pattern: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g,
    read: ([, marker, body]) => [{ mark: marker }, ...inlineTokens(body), { mark: marker }]
  },
  {
    name: "strike",
    pattern: /(~~)(?=\S)([\s\S]*?\S)\1/g,
    read: ([, marker, body]) => [{ mark: marker }, ...inlineTokens(body), { mark: marker }]
  },
  {
    name: "em",
    pattern: /(?<![*_\w])([*_])(?=\S)([^*_\n]*?\S)\1(?![*_\w])/g,
    read: ([, marker, body]) => [{ mark: marker }, ...inlineTokens(body), { mark: marker }]
  }
];
function inlineTokens(text2) {
  const out = [];
  let at3 = 0;
  while (at3 < text2.length) {
    let first = null;
    for (const rule of INLINE) {
      rule.pattern.lastIndex = at3;
      const found = rule.pattern.exec(text2);
      if (found && (first === null || found.index < first.found.index)) {
        first = { rule, found };
      }
    }
    if (first === null) {
      out.push({ text: text2.slice(at3) });
      break;
    }
    if (first.found.index > at3) {
      out.push({ text: text2.slice(at3, first.found.index) });
    }
    out.push({ name: first.rule.name, children: first.rule.read(first.found) });
    at3 = first.found.index + first.found[0].length;
  }
  return out;
}
function rowTokens(line, rule) {
  const out = [];
  for (const part2 of line.split(/((?<!\\)\|)/)) {
    if (part2 === "") {
      continue;
    }
    if (part2 === "|") {
      out.push({ mark: "|" });
      continue;
    }
    out.push(...rule ? [{ mark: part2 }] : inlineTokens(part2));
  }
  return out;
}
function tokenise(line, context = null) {
  const fence = line.match(FENCE);
  if (fence) {
    const [, lead, ticks, rest] = fence;
    const children = lead === "" ? [] : [{ text: lead }];
    children.push({ mark: ticks + rest });
    return {
      name: "fence",
      children,
      // The word on an opening fence picks the keywords the lines below
      // it colour against; the next fence closes the block.
      context: context === null ? rest.trim().toLowerCase() : null
    };
  }
  if (context !== null) {
    return { name: "codeline", children: [{ code: line, language: context }], context };
  }
  const heading = line.match(HEADING);
  if (heading) {
    return {
      name: `h${heading[1].trim().length}`,
      children: [{ mark: heading[1] }, ...inlineTokens(heading[2])],
      context
    };
  }
  const quote = line.match(QUOTE);
  if (quote) {
    return { name: "quote", children: [{ mark: quote[1] }, ...inlineTokens(quote[2])], context };
  }
  if (ROW.test(line)) {
    const rule = ALIGN.test(line);
    return { name: rule ? "align" : "row", children: rowTokens(line, rule), context };
  }
  if (RULE2.test(line)) {
    return { name: "rule", children: [{ mark: line }], context };
  }
  const item = line.match(ITEM);
  if (item) {
    const ordered = /\d/.test(item[1]);
    return {
      name: ordered ? "ordered" : "list",
      children: [{ mark: item[1], name: ordered ? "number" : void 0 }, ...inlineTokens(item[2])],
      context
    };
  }
  return { name: "para", children: inlineTokens(line), context };
}
function tokenLines(source) {
  const out = [];
  let context = null;
  for (const line of source.split("\n")) {
    const token = tokenise(line, context);
    out.push(token);
    context = token.context;
  }
  return out;
}
function markup(tokens, prefix) {
  let out = "";
  for (const token of tokens ?? []) {
    if (token.text !== void 0) {
      out += escapeHTML(token.text);
    } else if (token.mark !== void 0) {
      const classes = `${prefix}-mark${token.name ? ` ${prefix}-${token.name}` : ""}`;
      out += `<span class="${classes}">${escapeHTML(token.mark)}</span>`;
    } else if (token.picture !== void 0) {
      out += `<img class="${prefix}__pic" src="${escapeHTML(token.picture.src).replace(/"/g, "&quot;")}" alt="">`;
    } else if (token.code !== void 0) {
      out += highlightCode(token.code, prefix, token.language);
    } else {
      out += `<span class="${prefix}-${token.name}">${markup(token.children, prefix)}</span>`;
    }
  }
  return out;
}
function highlight(source, prefix = "mdedit") {
  return tokenLines(source).map((token) => `<div class="${prefix}__line ${prefix}-${token.name}">${markup(token.children, prefix) || "<br>"}</div>`).join("");
}

// src/frontmatter.js
var OPEN = /^---[ \t]*$/;
var CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
var BLANK = /^[ \t]*$/;
var COMMENT = /^[ \t]*#/;
var NUMBER = /^[-+]?(?:\.[0-9]+|[0-9][0-9_]*(?:\.[0-9_]*)?)(?:[eE][-+]?[0-9]+)?$/;
var DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt ][0-9:.+-]+)?$/;
var RESERVED = /^(?:~|null|true|false|yes|no|on|off)$/i;
var LEAD = /^(?:[,[\]{}#&*!|>'"%@`]|-(?:\s|$)|\?(?:\s|$)|:(?:\s|$))/;
var identity = (text2) => [...Array(text2.length).keys()].concat(text2.length);
function indentOf(line) {
  const found = line.match(/^[ \t]*/)[0];
  return found.includes("	") ? null : found;
}
function splitKey(text2) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text2.length; index += 1) {
    const char = text2[index];
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
    if (char === ":" && (index + 1 === text2.length || text2[index + 1] === " " || text2[index + 1] === "	")) {
      const keyRaw = text2.slice(0, index).trim();
      if (keyRaw === "") {
        return null;
      }
      return { keyRaw, valueRaw: text2.slice(index + 1).trim(), colon: index };
    }
  }
  return null;
}
function decodeDouble(raw) {
  let text2 = "";
  const map = [];
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\" || index + 1 >= raw.length) {
      text2 += char;
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
      t: "	",
      b: "\b",
      f: "\f",
      "0": "\0",
      " ": " "
    };
    if (simple[next] !== void 0) {
      text2 += simple[next];
      map.push(index);
      index += 1;
      continue;
    }
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(index + 2, index + 6))) {
      text2 += String.fromCharCode(parseInt(raw.slice(index + 2, index + 6), 16));
      map.push(index);
      index += 5;
      continue;
    }
    text2 += char;
    map.push(index);
  }
  map.push(raw.length);
  return { text: text2, map };
}
function decodeSingle(raw) {
  let text2 = "";
  const map = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "'" && raw[index + 1] === "'") {
      text2 += "'";
      map.push(index);
      index += 1;
      continue;
    }
    text2 += raw[index];
    map.push(index);
  }
  map.push(raw.length);
  return { text: text2, map };
}
function scalarOf(raw) {
  const text2 = raw.trim();
  if (text2.length >= 2 && text2[0] === '"' && text2[text2.length - 1] === '"') {
    return { ...decodeDouble(text2.slice(1, -1)), kind: "double", inner: text2.slice(1, -1) };
  }
  if (text2.length >= 2 && text2[0] === "'" && text2[text2.length - 1] === "'") {
    return { ...decodeSingle(text2.slice(1, -1)), kind: "single", inner: text2.slice(1, -1) };
  }
  return { text: text2, map: identity(text2), kind: "plain", inner: text2 };
}
function scalarKind(raw) {
  const text2 = raw.trim();
  if (text2 === "") {
    return "empty";
  }
  if (text2[0] === '"' || text2[0] === "'") {
    return text2.length >= 2 && text2[text2.length - 1] === text2[0] ? "quoted" : "rich";
  }
  if (LEAD.test(text2) || /[ \t]#/.test(text2)) {
    return "rich";
  }
  return "plain";
}
function keyText(raw) {
  return scalarOf(raw).text;
}
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
    const nested = next < body.length && !BLANK.test(nextRaw) && !COMMENT.test(nextRaw) && indentOf(nextRaw) !== "";
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
          editableValue: true
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
    if (indent === null || childIndent !== null && indent.length < childIndent.length) {
      return null;
    }
    if (childIndent === null) {
      childIndent = indent;
    }
    if (indent.length === childIndent.length) {
      const text2 = raw.slice(indent.length);
      if (/^-(\s|$)/.test(text2)) {
        return null;
      }
      const head = splitKey(text2);
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
        deep: false
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
    const kind = child.deep || child.valueRaw !== "" && scalarKind(child.valueRaw) === "rich" ? "rich" : "scalar";
    child.kind = kind;
    child.editableKey = false;
    child.editableValue = kind === "scalar";
    if (kind === "scalar") {
      child.value = scalarOf(child.valueRaw).text;
    }
  }
  return children;
}
function lineStarts(lines) {
  const starts = [];
  let at3 = 0;
  for (const line of lines) {
    starts.push(at3);
    at3 += line.length + 1;
  }
  return starts;
}
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
    map: key.map
  };
  if (row.kind !== "scalar" && row.kind !== "child") {
    return;
  }
  if (head.valueRaw !== "") {
    let valueAt = indent.length + head.colon + 1;
    while (stripped[valueAt - indent.length] === " " || stripped[valueAt - indent.length] === "	") {
      valueAt += 1;
    }
    const value = scalarOf(head.valueRaw);
    const inner = value.kind === "plain" ? valueAt : valueAt + 1;
    row.valueSpan = {
      start: starts[row.line] + inner,
      raw: value.inner,
      text: value.text,
      map: value.map
    };
  } else {
    row.valueSpan = {
      start: starts[row.line] + raw.length,
      raw: "",
      text: "",
      map: [0]
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
    if (row.line !== void 0) {
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
    data: parsed.rows.filter((row) => row.kind !== "group")
  };
}
function parse2(markdown) {
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
function detect(lines) {
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
function complete(text2) {
  const found = parse2(text2);
  if (!found) {
    return null;
  }
  const rest = String(text2).split("\n").slice(found.closerLine + 1);
  return rest.every((line) => BLANK.test(line)) ? found : null;
}
function encode(value) {
  const text2 = String(value);
  if (text2 === "") {
    return '""';
  }
  if (plain(text2)) {
    return text2;
  }
  return `"${escape(text2)}"`;
}
function encodeKey(key) {
  const text2 = String(key);
  if (text2 !== "" && plain(text2)) {
    return text2;
  }
  return `"${escape(text2)}"`;
}
function plain(text2) {
  if (/^\s|\s$/.test(text2) || /[\n\r\t\x00-\x1f\x7f]/.test(text2)) {
    return false;
  }
  if (LEAD.test(text2) || /: | #/.test(text2)) {
    return false;
  }
  if (RESERVED.test(text2) || NUMBER.test(text2) || DATE.test(text2)) {
    return false;
  }
  return true;
}
function escape(text2) {
  return text2.replace(/[\\"\n\r\t\b\f\x00-\x1f\x7f]/g, (char) => {
    const named = {
      "\\": "\\\\",
      '"': '\\"',
      "\n": "\\n",
      "\r": "\\r",
      "	": "\\t",
      "\b": "\\b",
      "\f": "\\f"
    };
    return named[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}
function rowLine(row, key, value) {
  if (key === row.key && value === row.value) {
    return row.raw;
  }
  const keyPart = key === row.key ? row.keyRaw : encodeKey(key);
  const valuePart = value === row.value ? row.valueRaw : encode(value);
  return `${row.indent ?? ""}${keyPart}: ${valuePart}`;
}
function at2(markdown, offset) {
  const found = parse2(markdown);
  if (!found) {
    return null;
  }
  for (const row of found.data) {
    const cells2 = [
      [0, row.editableKey ? row.keySpan : null],
      [1, row.editableValue ? row.valueSpan : null]
    ];
    for (const [column, span] of cells2) {
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
function offsetAt2(markdown, row, column, position) {
  const found = parse2(markdown);
  const entry = found && found.data.find((candidate) => candidate.row === row);
  if (!entry) {
    return null;
  }
  const span = column === 0 ? entry.editableKey ? entry.keySpan : null : entry.editableValue ? entry.valueSpan : null;
  if (!span) {
    return null;
  }
  const inside = Math.max(0, Math.min(position, span.text.length));
  return span.start + span.map[inside];
}

// src/widgets.js
var MINIMUM = 2;
var isRow = (segment, prefix) => segment.classList.contains(`${prefix}-row`) || segment.classList.contains(`${prefix}-align`);
var isWidget = (segment) => segment.dataset?.block !== void 0;
var isFrontmatter = (segment) => segment.dataset?.kind === "frontmatter";
function runs(segments, prefix) {
  const found = [];
  let current = [];
  const drawable = (run) => {
    if (run.length < MINIMUM) {
      return false;
    }
    const drawn2 = run.filter(isWidget).length;
    if (drawn2 === run.length) {
      return false;
    }
    return drawn2 > 0 || run[1].classList.contains(`${prefix}-align`);
  };
  for (const segment of segments) {
    if (isFrontmatter(segment)) {
      if (drawable(current)) {
        found.push(current);
      }
      current = [];
      continue;
    }
    if (isRow(segment, prefix) || isWidget(segment)) {
      current.push(segment);
      continue;
    }
    if (drawable(current)) {
      found.push(current);
    }
    current = [];
  }
  if (drawable(current)) {
    found.push(current);
  }
  return found;
}
function table(surface, markdown) {
  const prefix = surface.prefix;
  const widget = document.createElement("div");
  widget.className = `${prefix}__widget ${prefix}__widget--table`;
  widget.contentEditable = "false";
  widget.dataset.block = markdown;
  widget.dataset.kind = "table";
  const { rows, alignments } = parse(markdown);
  const grid2 = document.createElement("table");
  grid2.className = `${prefix}__widget-table`;
  rows.forEach((row, index) => {
    const line = document.createElement("tr");
    row.forEach((value, column) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      cell.contentEditable = "true";
      cell.dataset.align = alignments[column] ?? "left";
      cell.dataset.row = String(index);
      cell.dataset.column = String(column);
      cell.setAttribute("aria-label", `${surface.editor.texts.cell} ${index + 1}, ${column + 1}`);
      cell.replaceChildren(...surface.cell(value));
      line.appendChild(cell);
    });
    grid2.appendChild(line);
  });
  const bar = document.createElement("div");
  bar.className = `${prefix}__widget-bar`;
  const name = document.createElement("span");
  name.className = `${prefix}__widget-name`;
  name.textContent = surface.editor.texts.tableGrid;
  bar.appendChild(name);
  const texts = surface.editor.texts;
  bar.append(
    tool({ prefix, key: "source", title: texts.source, icon: "icon-code", run: () => surface.undecorate(widget) }),
    tool({ prefix, key: "grid", title: texts.tableGrid, icon: "icon-table", run: () => surface.editor.editTable() })
  );
  widget.append(bar, grid2);
  return widget;
}
function frontmatter(surface, markdown) {
  const prefix = surface.prefix;
  const texts = surface.editor.texts;
  const model2 = parse2(markdown) ?? { rows: [] };
  const widget = document.createElement("div");
  widget.className = `${prefix}__widget ${prefix}__widget--frontmatter`;
  widget.contentEditable = "false";
  widget.dataset.block = markdown;
  widget.dataset.kind = "frontmatter";
  const grid2 = document.createElement("table");
  grid2.className = `${prefix}__widget-table ${prefix}__frontmatter-table`;
  const head = document.createElement("thead");
  const headLine = document.createElement("tr");
  headLine.dataset.head = "";
  for (const label of [texts.frontmatterName, texts.frontmatterValue]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headLine.appendChild(cell);
  }
  head.appendChild(headLine);
  const body = document.createElement("tbody");
  for (const row of model2.rows) {
    if (row.kind === "group") {
      const line2 = document.createElement("tr");
      line2.className = `${prefix}__frontmatter-group`;
      const cell = document.createElement("th");
      cell.colSpan = 2;
      cell.textContent = row.key;
      line2.appendChild(cell);
      body.appendChild(line2);
      continue;
    }
    const line = document.createElement("tr");
    line.dataset.row = String(row.row);
    line.dataset.line = String(row.line);
    if (row.kind === "child") {
      line.className = `${prefix}__frontmatter-child`;
    }
    if (row.kind === "rich") {
      line.className = `${prefix}__frontmatter-rich-row`;
    }
    const key = document.createElement("td");
    key.className = `${prefix}__frontmatter-key`;
    key.contentEditable = String(Boolean(row.editableKey));
    key.dataset.row = String(row.row);
    key.dataset.column = "0";
    key.dataset.line = String(row.line);
    key.setAttribute("aria-label", `${texts.frontmatter} ${row.row + 1}`);
    key.replaceChildren(...surface.plain(row.key));
    const value = document.createElement("td");
    value.className = `${prefix}__frontmatter-value`;
    value.contentEditable = String(Boolean(row.editableValue));
    value.dataset.row = String(row.row);
    value.dataset.column = "1";
    value.dataset.line = String(row.line);
    if (row.kind === "rich") {
      value.className = `${prefix}__frontmatter-value ${prefix}__frontmatter-rich`;
      value.textContent = texts.frontmatterRich;
    } else {
      value.replaceChildren(...surface.plain(row.value));
    }
    line.append(key, value);
    body.appendChild(line);
  }
  grid2.append(head, body);
  const bar = document.createElement("div");
  bar.className = `${prefix}__widget-bar`;
  const name = document.createElement("span");
  name.className = `${prefix}__widget-name`;
  name.textContent = texts.frontmatter;
  bar.appendChild(name);
  bar.append(
    tool({
      prefix,
      key: "row-add",
      title: texts.frontmatterRowAdd,
      icon: "icon-row-add",
      run: () => surface.frontmatterAddRow(widget)
    }),
    tool({
      prefix,
      key: "source",
      title: texts.source,
      icon: "icon-code",
      run: (event) => surface.toggleFrontmatterSource(widget, event.currentTarget)
    })
  );
  widget.append(bar, grid2);
  return widget;
}
function written(widget) {
  return widget.dataset.kind === "frontmatter" ? frontmatterWritten(widget) : tableWritten(widget);
}
function tableWritten(widget) {
  const { alignments } = parse(widget.dataset.block);
  const rows = [...widget.querySelectorAll("tr")].map(
    (line) => [...line.children].map((cell) => cell.textContent.replace(/\s+/g, " ").trim())
  );
  return format({ rows, alignments });
}
function frontmatterWritten(widget) {
  const model2 = parse2(widget.dataset.block);
  if (!model2) {
    return widget.dataset.block;
  }
  const lines = [...model2.lines];
  let changed = false;
  for (const line of widget.querySelectorAll("tbody tr[data-row]")) {
    const key = line.querySelector('[data-column="0"]');
    const value = line.querySelector('[data-column="1"]');
    const row = model2.data.find((candidate) => candidate.row === Number(line.dataset.row));
    if (!key || !value || !row || !row.editableValue) {
      continue;
    }
    const next = rowLine(row, text(key), text(value));
    if (next !== lines[row.line]) {
      lines[row.line] = next;
      changed = true;
    }
  }
  let added = 0;
  for (const line of widget.querySelectorAll('tbody tr[data-new="true"]')) {
    const key = line.querySelector('[data-column="0"]');
    const value = line.querySelector('[data-column="1"]');
    if (!key || !value || text(key) === "") {
      continue;
    }
    const at3 = lines.findIndex((entry, index) => index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(entry));
    if (at3 < 0) {
      continue;
    }
    lines.splice(at3, 0, `${encodeKey(text(key))}: ${encode(text(value))}`);
    line.dataset.line = String(at3);
    line.dataset.row = String(model2.data.length + added);
    for (const cell of line.children) {
      cell.dataset.line = line.dataset.line;
      cell.dataset.row = line.dataset.row;
    }
    line.removeAttribute("data-new");
    added += 1;
    changed = true;
  }
  return changed ? lines.join("\n") : widget.dataset.block;
}
var NBSP = new RegExp(String.fromCharCode(160), "g");
var text = (cell) => cell.textContent.replace(NBSP, " ");

// src/surface.js
var ELEMENT = 1;
var TEXT = 3;
var COALESCE = 700;
var BLOCKS = /* @__PURE__ */ new Set(["DIV", "P", "LI", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TR"]);
var size2 = (node) => node.nodeType === TEXT ? node.length : node.textContent.length;
var SPACE = /\u00a0/g;
var leaves = (tokens) => (tokens ?? []).flatMap((token) => token.children ? leaves(token.children) : [token]);
var RETURNS = /\r\n?/g;
var ALONE = /^\s*\[([^\]\n]*)\]\(([^)\n]*?)(?:\s+"[^"]*")?\)\s*$/;
var FILE_TYPES = /* @__PURE__ */ new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "pages",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "tsv",
  "numbers",
  "ppt",
  "pptx",
  "odp",
  "key",
  "txt",
  "md",
  "json",
  "xml",
  "yaml",
  "yml",
  "ics",
  "epub",
  "mobi",
  "zip",
  "gz",
  "tgz",
  "tar",
  "7z",
  "rar"
]);
function extensionOf(href) {
  const path = String(href).split(/[?#]/)[0];
  const found = path.match(/\.([a-z0-9]{1,8})$/i);
  return found ? found[1].toLowerCase() : "";
}
function fileLink(line) {
  const found = line.match(ALONE);
  if (!found) {
    return null;
  }
  const [, label, href] = found;
  const ext = extensionOf(href);
  if (!FILE_TYPES.has(ext) || mediaKind(href)) {
    return null;
  }
  return { href, label: label || href, ext };
}
var embedKind = (parts) => {
  if (parts.some((part2) => part2.picture !== void 0)) {
    return "Image";
  }
  const media = parts.find((part2) => part2.media !== void 0);
  if (media) {
    return media.media.kind === "audio" ? "Audio" : "Video";
  }
  return parts.some((part2) => part2.file !== void 0) ? "File" : "";
};
var read = (segment) => segment.dataset.block ?? segment.textContent.replace(SPACE, " ");
function within(root, container, offset) {
  let total = 0;
  if (container.nodeType === TEXT) {
    total = offset;
  } else {
    for (let at3 = 0; at3 < offset && at3 < container.childNodes.length; at3 += 1) {
      total += size2(container.childNodes[at3]);
    }
  }
  for (let at3 = container; at3 && at3 !== root; at3 = at3.parentNode) {
    for (let sibling = at3.previousSibling; sibling; sibling = sibling.previousSibling) {
      total += size2(sibling);
    }
  }
  return total;
}
function locate(root, offset) {
  let total = 0;
  let last = null;
  for (const node of textNodes(root)) {
    if (offset <= total + node.length) {
      return { node, offset: offset - total };
    }
    total += node.length;
    last = node;
  }
  return last ? { node: last, offset: last.length } : { node: root, offset: 0 };
}
var cellOf = (node) => (node.nodeType === TEXT ? node.parentElement : node)?.closest('[contenteditable="true"][data-row][data-column]') ?? null;
function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  while (walker.nextNode()) {
    out.push(walker.currentNode);
  }
  return out;
}
var History = class {
  constructor(limit = 200) {
    this.limit = limit;
    this.done = [];
    this.undone = [];
  }
  commit(snapshot) {
    const last = this.done[this.done.length - 1];
    if (last && last.value === snapshot.value) {
      return;
    }
    this.done.push(snapshot);
    if (this.done.length > this.limit) {
      this.done.shift();
    }
    this.undone.length = 0;
  }
  undo(now) {
    const snapshot = this.done.pop();
    if (!snapshot) {
      return null;
    }
    this.undone.push(now);
    return snapshot;
  }
  redo(now) {
    const snapshot = this.undone.pop();
    if (!snapshot) {
      return null;
    }
    this.done.push(now);
    return snapshot;
  }
  forget() {
    this.done.length = 0;
    this.undone.length = 0;
  }
};
var Cell = class extends Source {
  constructor(surface, widget, cell) {
    super(null);
    this.surface = surface;
    this.widget = widget;
    this.cell = cell;
  }
  get value() {
    return this.cell.textContent.replace(SPACE, " ");
  }
  set value(text2) {
    this.replace(0, this.value.length, text2);
  }
  get selection() {
    const range = this.surface.live();
    if (!range || !this.cell.contains(range.startContainer)) {
      const end2 = this.value.length;
      return { start: end2, end: end2, text: "" };
    }
    const start = within(this.cell, range.startContainer, range.startOffset);
    const end = this.cell.contains(range.endContainer) ? within(this.cell, range.endContainer, range.endOffset) : start;
    return { start, end, text: this.value.slice(start, end) };
  }
  select(from, to = from) {
    const start = this.surface.visible(locate(this.cell, from), this.cell);
    const end = to === from ? start : this.surface.visible(locate(this.cell, to), this.cell);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.surface.mark = range.cloneRange();
  }
  focus(options) {
    this.cell.focus(options);
  }
  // replace writes the cell again and the block with it. A cell is one line
  // of one row. A newline in the arriving text becomes a space. Pasting
  // many lines fills the cell and leaves the row whole.
  replace(start, end, text2, selectFrom, selectTo) {
    this.surface.commit();
    this.surface.history.commit({
      value: this.surface.value,
      caret: this.surface.startOf(this.widget)
    });
    const value = this.value;
    const insert = text2.replace(/\s*\n\s*/g, " ");
    const next = value.slice(0, start) + insert + value.slice(end);
    const nodes = this.widget.dataset.kind === "frontmatter" ? this.surface.plain(next) : this.surface.cell(next);
    this.cell.replaceChildren(...nodes);
    this.widget.dataset.block = written(this.widget);
    if (selectFrom !== false) {
      const to = Math.min(selectFrom ?? start + insert.length, next.length);
      this.select(to, Math.min(selectTo ?? to, next.length));
    }
    this.surface.announce();
  }
};
var Surface = class extends Source {
  constructor(editor, element, field) {
    super(field);
    this.editor = editor;
    this.element = element;
    this.prefix = editor.prefix;
    this.history = new History();
    this.pending = null;
    this.stamp = 0;
    this.composing = false;
    this.mark = null;
    this.cards = editor.options?.cards?.pattern && editor.options.cards.render ? editor.options.cards : null;
    this.sources = /* @__PURE__ */ new Set();
  }
  // ── What the editor edits ─────────────────────────────────────────────
  get value() {
    return [...this.element.children].map(read).join("\n");
  }
  set value(text2) {
    this.forget();
    this.load(text2);
    this.announce();
  }
  // forget drops what the editor remembers of the document it holds. Ctrl-Z
  // cannot take back a host loading another document, and an undo across a
  // load would restore a document the writer never typed.
  forget() {
    this.pending = null;
    this.history.forget();
  }
  get selection() {
    const range = this.live();
    if (!range) {
      return { start: 0, end: 0, text: "" };
    }
    const widget = this.segmentOf(range.startContainer);
    if (widget && isWidget(widget) && widget === this.segmentOf(range.endContainer) && cellOf(range.startContainer) !== cellOf(range.endContainer)) {
      const block = this.startOf(widget);
      return { start: block, end: block, text: "" };
    }
    const start = this.offsetOf(range.startContainer, range.startOffset);
    const end = this.offsetOf(range.endContainer, range.endOffset);
    return { start, end, text: this.value.slice(start, end) };
  }
  select(from, to = from) {
    const start = this.positionAt(from);
    const end = to === from ? start : this.positionAt(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.mark = range.cloneRange();
  }
  // `preventScroll` keeps the page at its scroll position. A caller that places the
  // caret scrolls to it itself; a browser that scrolls first lands somewhere
  // else and fights the caller.
  //
  // The focus goes to whichever editing host the caret already stands in. A
  // cell of a drawn table is a host of its own, and focusing the surface
  // over one moves the caret out of the cell to the head of the document: a
  // panel that put the caret on a word in a table would land it at the top
  // of the file.
  focus(options) {
    const range = this.live();
    const cell = range && cellOf(range.startContainer);
    (cell ?? this.element).focus(options);
    if (!this.live()) {
      this.select(0);
    }
  }
  // replace is the one way the document changes from outside the keyboard.
  // The edit rebuilds only the lines it touches. The lines above stay put and
  // the lines below shift.
  replace(start, end, text2, selectFrom, selectTo) {
    this.commit();
    const before = this.value;
    this.history.commit({ value: before, caret: start });
    const after = before.slice(0, start) + text2 + before.slice(end);
    const segments = [...this.element.children];
    const bounds = [];
    let at3 = 0;
    for (const segment of segments) {
      const length = read(segment).length;
      bounds.push([at3, at3 + length]);
      at3 += length + 1;
    }
    const find2 = (offset) => {
      const index = bounds.findIndex(([, to]) => offset <= to);
      return index < 0 ? segments.length - 1 : index;
    };
    const first = find2(start);
    const last = find2(end);
    const tail = before.length - bounds[last][1];
    const middle = after.slice(bounds[first][0], after.length - tail);
    const built = [];
    let carry = this.contextOf(segments[first]);
    for (const line of middle.split("\n")) {
      const element = document.createElement("div");
      carry = this.paint(element, line, carry);
      built.push(element);
    }
    segments[first].replaceWith(...built);
    for (let index = first + 1; index <= last; index += 1) {
      segments[index].remove();
    }
    this.carry(built[built.length - 1], carry);
    if (selectFrom !== false) {
      const to = selectFrom ?? start + text2.length;
      this.select(to, selectTo ?? to);
    }
    this.decorate();
    this.announce();
  }
  // ── Drawing ───────────────────────────────────────────────────────────
  // load builds the whole surface. It runs when the host sets the document
  // and when a browser has restructured the surface past repair, never
  // while the writer types into it.
  load(source) {
    this.editor.uploads?.release();
    const out = [];
    let context = null;
    for (const line of String(source).replace(RETURNS, "\n").split("\n")) {
      const element = document.createElement("div");
      context = this.paint(element, line, context);
      out.push(element);
    }
    this.element.replaceChildren(...out);
    this.decorate();
    this.markOpenFence();
  }
  // decorate draws the blocks that read better drawn than spelled out. The
  // run the caret stands in stays markdown: the typing stays as typed, and
  // the run draws once the writer moves on. The bar on a widget is the way
  // back into its markdown.
  decorate() {
    if (this.drawing || this.composing || this.frontmatterSource(document.activeElement)) {
      return;
    }
    this.drawing = true;
    try {
      this.decorateFrontmatter();
      const caret = this.live();
      const held = caret ? caret.commonAncestorContainer : null;
      for (const run of runs([...this.element.children], this.prefix)) {
        if (held && run.some((segment) => segment.contains(held))) {
          continue;
        }
        const widget = table(this, run.map(read).join("\n"));
        run[0].replaceWith(widget);
        for (const segment of run.slice(1)) {
          segment.remove();
        }
      }
    } finally {
      this.drawing = false;
    }
  }
  // decorateFrontmatter draws the fields at the head of the document.
  decorateFrontmatter() {
    const segments = [...this.element.children];
    if (!segments.length || isWidget(segments[0])) {
      return;
    }
    const model2 = detect(segments.map(read));
    if (!model2) {
      return;
    }
    const run = segments.slice(0, model2.closerLine + 1);
    if (run.some((segment) => isWidget(segment))) {
      return;
    }
    const caret = this.live();
    if (caret && run.some((segment) => segment.contains(caret.commonAncestorContainer))) {
      return;
    }
    const widget = frontmatter(this, run.map(read).join("\n"));
    run[0].replaceWith(widget);
    for (const segment of run.slice(1)) {
      segment.remove();
    }
  }
  // undecorate puts one widget back as the markdown lines it stands for,
  // with the caret in them. It draws itself again when the caret leaves.
  undecorate(widget) {
    const built = [];
    let carry = this.contextOf(widget);
    for (const line of read(widget).split("\n")) {
      const element = document.createElement("div");
      carry = this.paint(element, line, carry);
      built.push(element);
    }
    widget.replaceWith(...built);
    this.element.focus();
    this.place(built[0], 0);
  }
  // paint tokenises one line, draws it, and answers the context for the
  // line below.
  paint(element, line, context) {
    const token = tokenise(line, context);
    const key = context === null ? this.cardKey(line) : null;
    if (key !== null) {
      token.name = "card";
      token.children = [{ mark: line }];
    }
    const file = context === null ? fileLink(line) : null;
    if (file) {
      token.name = "file";
      token.children = [{ mark: line }, { file }];
    }
    element.className = `${this.prefix}__line ${this.prefix}-${token.name}`;
    if (context === null) {
      delete element.dataset.in;
    } else {
      element.dataset.in = context;
    }
    const indent = line.match(/^[\t ]*/)[0];
    const depth = indent.includes("	") ? indent.split("	").length - 1 : Math.floor(indent.length / 2);
    element.style.setProperty("--depth", String(depth));
    element.replaceChildren(...this.nodes(token.children));
    const level = /^h[1-6]$/.test(token.name) ? levelOf(line) : 0;
    if (level > 0) {
      element.dataset.level = String(level);
      element.appendChild(this.label(level));
    } else {
      delete element.dataset.level;
    }
    element.toggleAttribute("data-card", key !== null);
    if (key !== null) {
      element.appendChild(this.card(key));
    }
    const upload = context === null ? this.editor.uploads?.nodeFor(line, element) : null;
    element.toggleAttribute("data-upload", Boolean(upload));
    if (upload) {
      element.appendChild(upload);
      const record = this.editor.uploads?.at(Number(upload.dataset.upload));
      if (record) {
        for (const span of element.querySelectorAll("span")) {
          if (span.textContent === record.placeholder) {
            span.dataset.placeholder = "true";
          }
        }
      }
    }
    const marked = (token.children ?? []).every((part2) => part2.mark !== void 0);
    element.toggleAttribute("data-marks-only", marked && token.children.length > 0);
    element.toggleAttribute("data-blank", line.trim() === "");
    const parts = leaves(token.children);
    const embeds = parts.filter(
      (part2) => part2.picture !== void 0 || part2.media !== void 0 || part2.file !== void 0
    );
    const embed = embeds.length > 0 && parts.every((part2) => embeds.includes(part2) || part2.mark !== void 0);
    element.toggleAttribute("data-embed", embed);
    if (embed && context === null) {
      element.appendChild(this.embedBar(element, embedKind(embeds)));
    }
    element.toggleAttribute("data-source", this.sources.has(line));
    if (element.textContent === "") {
      element.replaceChildren(document.createElement("br"));
    }
    return token.context;
  }
  nodes(tokens) {
    const out = [];
    for (const token of tokens ?? []) {
      if (token.text !== void 0) {
        out.push(document.createTextNode(token.text));
        continue;
      }
      if (token.mark !== void 0) {
        const classes = `${this.prefix}-mark${token.name ? ` ${this.prefix}-${token.name}` : ""}`;
        out.push(this.span(classes, token.mark));
        continue;
      }
      if (token.code !== void 0) {
        const holder = document.createElement("span");
        holder.innerHTML = highlightCode(token.code, this.prefix, token.language);
        out.push(holder);
        continue;
      }
      if (token.picture !== void 0) {
        out.push(this.picture(token.picture));
        continue;
      }
      if (token.media !== void 0) {
        out.push(this.player(token.media));
        continue;
      }
      if (token.file !== void 0) {
        out.push(this.fileChip(token.file));
        continue;
      }
      const element = document.createElement("span");
      element.className = `${this.prefix}-${token.name}`;
      element.append(...this.nodes(token.children));
      out.push(element);
    }
    return out;
  }
  span(className, text2) {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text2;
    return element;
  }
  // picture draws what an image marker points at, beside the marker. It
  // carries no text, so the markdown the surface answers is the marker
  // alone and the caret counts the same characters either way.
  picture({ src, alt }) {
    const image = document.createElement("img");
    image.className = `${this.prefix}__pic`;
    image.alt = alt;
    image.src = src;
    image.contentEditable = "false";
    image.draggable = false;
    image.addEventListener("error", () => {
      image.dataset.state = "failed";
    });
    return image;
  }
  // player draws what a link to a playable file points at. A player loads
  // its length and no more until it is played: a document may carry an hour
  // of audio, and opening it to edit a sentence costs one short request.
  player({ src, kind, label }) {
    const media = document.createElement(kind);
    media.className = `${this.prefix}__media`;
    media.controls = true;
    media.preload = "metadata";
    media.src = src;
    media.contentEditable = "false";
    media.draggable = false;
    media.setAttribute("aria-label", label || src);
    media.addEventListener("error", () => {
      media.dataset.state = "failed";
    });
    return media;
  }
  // fileChip draws a link to a paper, an archive or a document as the file
  // it names. Like the picture and the player it carries no text: the label
  // and the extension ride in attributes and the stylesheet writes them.
  fileChip({ href, label, ext }) {
    const chip = document.createElement("span");
    chip.className = `${this.prefix}__file`;
    chip.dataset.label = label;
    chip.dataset.ext = ext;
    chip.dataset.href = href;
    chip.contentEditable = "false";
    const icon = document.createElement("span");
    icon.className = `icon icon-file`;
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = `${this.prefix}__file-name`;
    name.dataset.name = label;
    const kind = document.createElement("span");
    kind.className = `${this.prefix}__file-ext`;
    kind.dataset.ext = ext.toUpperCase();
    chip.append(icon, name, kind);
    chip.setAttribute("role", "img");
    chip.setAttribute("aria-label", `${label} (${ext})`);
    return chip;
  }
  // embedBar stands beside a line that is nothing but a picture, a player
  // or a file: what the line holds, the way back to its markdown, and the
  // line gone. It is drawn from attributes alone - the kind is generated
  // content - so the bar adds no character to the document.
  embedBar(segment, kind) {
    const texts = this.editor.texts;
    const bar = document.createElement("span");
    bar.className = `${this.prefix}__embed-bar`;
    bar.contentEditable = "false";
    bar.addEventListener("click", (event) => event.stopPropagation());
    const label = document.createElement("span");
    label.className = `${this.prefix}__embed-kind`;
    label.dataset.kind = kind;
    label.setAttribute("aria-hidden", "true");
    const source = tool({
      prefix: this.prefix,
      key: "embed-source",
      icon: "icon-code",
      title: texts.source,
      run: (event) => {
        event.stopPropagation();
        this.toggleSource(segment, source);
      }
    });
    source.setAttribute("aria-pressed", String(this.sources.has(read(segment))));
    const remove = tool({
      prefix: this.prefix,
      key: "embed-delete",
      icon: "icon-trash",
      title: texts.delete,
      run: (event) => {
        event.stopPropagation();
        this.removeLine(segment);
      }
    });
    bar.append(label, source, remove);
    return bar;
  }
  // toggleSource switches one line between what it draws and the markdown
  // it is written as. The markers show on that line either way: a source
  // view with the source hidden is no source view.
  toggleSource(segment, button) {
    const line = read(segment);
    const on = !this.sources.has(line);
    if (on) {
      this.sources.add(line);
    } else {
      this.sources.delete(line);
    }
    segment.toggleAttribute("data-source", on);
    button.setAttribute("aria-pressed", String(on));
    this.editor.emit("source", { line, source: on });
  }
  // removeLine takes one line out of the document, with the newline that
  // ended it, and leaves the caret where the line began: the writer is
  // looking at the block they just took away.
  removeLine(segment) {
    if (!segment || !this.element.contains(segment)) {
      return;
    }
    const start = this.startOf(segment);
    const length = read(segment).length;
    const last = segment === this.element.lastElementChild;
    const first = segment === this.element.firstElementChild;
    this.sources.delete(read(segment));
    if (!last) {
      this.replace(start, start + length + 1, "", start);
      return;
    }
    if (!first) {
      this.replace(start - 1, start + length, "", start - 1);
      return;
    }
    this.replace(start, start + length, "", 0);
  }
  // cardKey answers what the host would draw a card for on one line, or
  // null. The capture names it where the pattern has one, the whole line
  // where it does not.
  cardKey(line) {
    if (!this.cards) {
      return null;
    }
    const found = line.trim().match(this.cards.pattern);
    return found ? found[1] ?? found[0] : null;
  }
  // card draws the block a host answers for one of its own markers: a
  // citation, an embedded video, whatever the project's documents carry a
  // marker for.
  //
  // It is drawn in a root of its own. The surface reads the document out of
  // the characters in its lines, so a title or a byline sitting in one
  // would be in what the form posts; a shadow root keeps the host's markup
  // out of the line's text, the way a picture carries none. The host's own
  // stylesheet goes in with it, since the page's rules do not reach inside.
  //
  // A link in a card leaves for another tab: a click here is a click in an
  // editor holding an unsaved document.
  card(key) {
    const element = document.createElement("span");
    element.className = `${this.prefix}__card`;
    element.dataset.key = key;
    element.contentEditable = "false";
    const root = element.attachShadow({ mode: "open" });
    if (this.cards.styles) {
      const style = document.createElement("style");
      style.textContent = this.cards.styles;
      root.appendChild(style);
    }
    Promise.resolve(this.cards.render(key, this.editor)).then((content) => {
      if (typeof content === "string") {
        const holder = document.createElement("div");
        holder.innerHTML = content;
        root.appendChild(holder);
      } else if (content) {
        root.appendChild(content);
      }
      for (const link of root.querySelectorAll("a[href]")) {
        link.target = "_blank";
        link.rel = "noopener";
      }
    }).catch((error) => this.editor.emit("error", { phase: "card", error }));
    return element;
  }
  // label draws the level a heading is written at, at the end of its line.
  // It carries no text: the stylesheet writes the level, so the markdown
  // the surface answers is the writer's own characters and the caret counts
  // the same ones either way.
  label(level) {
    const element = document.createElement("span");
    element.className = `${this.prefix}__level`;
    element.dataset.level = String(level);
    element.contentEditable = "false";
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `${this.editor.texts.heading} ${level}`);
    return element;
  }
  // levelAt answers the level one line of the surface is written at, and 0
  // for a line that is not a heading.
  levelAt(segment) {
    return segment && this.element.contains(segment) ? levelOf(read(segment)) : 0;
  }
  // setLevel writes one line as a heading of the level named, or as a
  // paragraph at level zero, and leaves the caret where the text starts.
  setLevel(segment, level) {
    if (!segment || !this.element.contains(segment)) {
      return;
    }
    const start = this.startOf(segment);
    const had = read(segment).match(PREFIX)?.[0].length ?? 0;
    const want = prefixOf(Math.min(Math.max(level, 0), LEVELS));
    this.replace(start, start + had, want, start + want.length);
  }
  // cell answers the nodes for one table cell: a cell holds markdown, and
  // it reads here the way a line does.
  cell(text2) {
    const nodes = this.nodes(inlineTokens(text2));
    return nodes.length ? nodes : [document.createElement("br")];
  }
  // plain answers the nodes for one front matter cell.
  plain(text2) {
    return text2 === "" ? [document.createElement("br")] : [document.createTextNode(text2)];
  }
  contextOf(segment) {
    return segment && "in" in segment.dataset ? segment.dataset.in : null;
  }
  // carry paints the lines below an edit until the fence context agrees
  // again: opening or closing a fence changes how every line under it
  // reads.
  carry(from, context) {
    let carry = context;
    for (let next = from.nextElementSibling; next; next = next.nextElementSibling) {
      if (isWidget(next) || this.contextOf(next) === carry) {
        return;
      }
      carry = this.paint(next, read(next), carry);
    }
  }
  // ── Where the caret is ────────────────────────────────────────────────
  live() {
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (this.element.contains(range.commonAncestorContainer)) {
        return range;
      }
    }
    if (this.mark && this.element.contains(this.mark.commonAncestorContainer)) {
      return this.mark;
    }
    return null;
  }
  // active answers the source the next move acts on: one cell of a drawn
  // table when the caret stands in one, and the document itself everywhere
  // else. A tool, a paste and an upload all go through this, so none of
  // them has to know a table is drawn as a table.
  get active() {
    const found = this.widgetAt();
    return found?.cell ? new Cell(this, found.widget, found.cell) : this;
  }
  // cellSource answers one named cell as a source of its own, for a panel
  // that found its cell by something other than the caret.
  cellSource(cell) {
    const widget = this.segmentOf(cell);
    return widget && isWidget(widget) ? new Cell(this, widget, cell) : null;
  }
  // widgetAt answers the drawn table the caret stands in, and the cell with
  // it when the whole selection is inside one. A selection that runs across
  // cells names the widget and no cell: there is no one cell to edit.
  widgetAt() {
    const range = this.live();
    const segment = range && this.segmentOf(range.startContainer);
    if (!segment || !isWidget(segment)) {
      return null;
    }
    const cell = cellOf(range.startContainer);
    return { widget: segment, cell: cell?.contains(range.endContainer) ? cell : null };
  }
  // offsetIn answers how many of an element's characters stand before one
  // of its children: what the image panel needs to find the marker a
  // picture stands on.
  offsetIn(element, child) {
    const parent = child.parentNode;
    return within(element, parent, [...parent.childNodes].indexOf(child));
  }
  segmentOf(node) {
    let at3 = node;
    while (at3 && at3 !== this.element && at3.parentNode !== this.element) {
      at3 = at3.parentNode;
    }
    return at3 && at3 !== this.element ? at3 : null;
  }
  startOf(segment) {
    let total = 0;
    for (const child of this.element.children) {
      if (child === segment) {
        return total;
      }
      total += read(child).length + 1;
    }
    return Math.max(0, total - 1);
  }
  offsetOf(container, offset) {
    const segment = this.segmentOf(container);
    if (!segment) {
      return this.startOf(this.element.children[offset] ?? null);
    }
    if (isWidget(segment)) {
      const cell = cellOf(container);
      const map = segment.dataset.kind === "frontmatter" ? offsetAt2 : offsetAt;
      const found = cell ? map(read(segment), Number(cell.dataset.row), Number(cell.dataset.column), within(cell, container, offset)) : null;
      return this.startOf(segment) + (found ?? 0);
    }
    return this.startOf(segment) + within(segment, container, offset);
  }
  positionAt(want) {
    let at3 = 0;
    for (const segment of this.element.children) {
      const length = read(segment).length;
      if (want <= at3 + length) {
        return this.inside(segment, want - at3);
      }
      at3 += length + 1;
    }
    const last = this.element.lastElementChild;
    return last ? this.inside(last, read(last).length) : { node: this.element, offset: 0 };
  }
  // inside answers the DOM position one offset into a segment names.
  inside(segment, offset) {
    if (isWidget(segment)) {
      const block = read(segment);
      if (offset > 0 && offset < block.length) {
        const found = segment.dataset.kind === "frontmatter" ? at2(block, offset) : at(block, offset);
        const cell = found && segment.querySelector(`[data-row="${found.row}"][data-column="${found.column}"]`);
        if (cell) {
          return this.visible(locate(cell, found.at), cell);
        }
      }
      const index = [...this.element.children].indexOf(segment);
      return { node: this.element, offset: offset >= block.length ? index + 1 : index };
    }
    return this.visible(locate(segment, offset), segment);
  }
  // edge answers where a caret standing between two blocks is, or null. A
  // widget takes no caret, so the caret stands before it or after it, and
  // there the browser has no line to move through or to type into.
  edge() {
    const range = this.live();
    if (!range || !range.collapsed || range.startContainer !== this.element) {
      return null;
    }
    return { index: range.startOffset, at: this.offsetOf(this.element, range.startOffset) };
  }
  // visible keeps the caret out of a marker the toggle has hidden: there is
  // no box to draw one in, so it moves to the nearest character the writer
  // can see.
  visible(position, segment) {
    if (this.editor.marks || !this.hidden(position.node)) {
      return position;
    }
    const nodes = textNodes(segment);
    const at3 = nodes.indexOf(position.node);
    for (let index = at3 + 1; index < nodes.length; index += 1) {
      if (!this.hidden(nodes[index])) {
        return { node: nodes[index], offset: 0 };
      }
    }
    return { node: segment, offset: segment.childNodes.length };
  }
  hidden(node) {
    return Boolean(node.parentElement?.closest(`.${this.prefix}-mark`));
  }
  // ── Typing ────────────────────────────────────────────────────────────
  attach(signal) {
    const on = (name, handler) => this.element.addEventListener(name, handler, { signal });
    on("beforeinput", (event) => this.before(event));
    on("input", (event) => this.after(event));
    on("keydown", (event) => this.keydown(event));
    on("paste", (event) => this.paste(event));
    on("drop", (event) => this.drop(event));
    on("dragover", (event) => event.preventDefault());
    on("compositionstart", () => {
      this.composing = true;
    });
    on("compositionend", () => {
      this.composing = false;
      this.after();
    });
    document.addEventListener("selectionchange", () => this.remember(), { signal });
  }
  remember() {
    if (this.frontmatterSource(document.activeElement)) {
      return;
    }
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (this.element.contains(range.commonAncestorContainer)) {
      this.mark = range.cloneRange();
    }
    this.decorate();
  }
  // frontmatterSource answers the YAML source field a node belongs to.
  frontmatterSource(node) {
    return node?.closest?.(`.${this.prefix}__frontmatter-source`) ?? null;
  }
  before(event) {
    if (this.frontmatterSource(event.target)) {
      return;
    }
    if (!this.pending) {
      this.pending = { value: this.value, caret: this.selection.start };
    }
    this.boundary = event.inputType !== "insertText" || /\s/.test(event.data ?? " ") || Date.now() - this.stamp > COALESCE;
    this.typePastMarkers(event);
  }
  // typePastMarkers writes the character itself when the caret stands past
  // the end of the visible line, after markers the toggle has hidden.
  //
  // There is no box after a hidden marker, so that caret is a position on
  // the line element rather than one inside a character of it. A browser
  // asked to insert there falls back to the last place it can draw, which
  // is before the markers and therefore inside the construct they close:
  // the backtick closing `x` would be stepped over and the next letter
  // would land in the span, which never ends. The offset is not in doubt -
  // visible() put the caret there - so the edit is made against it.
  typePastMarkers(event) {
    if (event.inputType !== "insertText" || typeof event.data !== "string") {
      return;
    }
    const range = this.live();
    if (!range || range.startContainer.nodeType === TEXT) {
      return;
    }
    const segment = this.segmentOf(range.startContainer);
    if (!segment || isWidget(segment)) {
      return;
    }
    event.preventDefault();
    const { start, end } = this.selection;
    this.replace(start, end, event.data, start + event.data.length);
    this.stamp = Date.now();
  }
  // after is the typing path: one line changed, so one line is tokenised
  // again and the caret goes back where the writer left it.
  after(event) {
    if (this.frontmatterSource(event?.target)) {
      this.frontmatterSourceInput(event.target);
      return;
    }
    if (this.composing) {
      return;
    }
    const range = this.live();
    const segment = range && this.segmentOf(range.startContainer);
    if (segment && isWidget(segment)) {
      this.cellInput(segment, range);
      return;
    }
    if (!segment || !this.intact(segment)) {
      const caret = range ? this.offsetOf(range.startContainer, range.startOffset) : 0;
      this.load(this.text());
      this.select(caret);
    } else {
      const at3 = within(segment, range.startContainer, range.startOffset);
      this.retokenise(segment);
      this.place(segment, at3);
    }
    if (this.boundary) {
      this.commit();
    }
    this.stamp = Date.now();
    this.announce();
  }
  // cellInput takes a keystroke in a table cell. The cell is tokenised
  // again the way a line is, and the block's markdown is written back off
  // its cells: the document is what the widget answers, not what it draws.
  cellInput(widget, range) {
    const cell = cellOf(range.startContainer);
    if (cell) {
      const at3 = within(cell, range.startContainer, range.startOffset);
      const text2 = cell.textContent.replace(SPACE, " ");
      const nodes = widget.dataset.kind === "frontmatter" ? this.plain(text2) : this.cell(text2);
      cell.replaceChildren(...nodes);
      this.place(cell, at3);
    }
    widget.dataset.block = written(widget);
    if (this.boundary) {
      this.commit();
    }
    this.stamp = Date.now();
    this.announce();
  }
  intact(segment) {
    return (
      // A bare text node the browser left at a widget's edge is not a
      // line and cannot be tokenised in place.
      segment.nodeType === ELEMENT && segment.classList.contains(`${this.prefix}__line`) && segment.dataset.block === void 0 && !segment.querySelector("div, p, li, br + *")
    );
  }
  retokenise(segment) {
    const carry = this.paint(segment, read(segment), this.contextOf(segment));
    this.carry(segment, carry);
  }
  place(segment, offset) {
    const position = this.inside(segment, offset);
    const range = document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.mark = range.cloneRange();
  }
  // text reads the markdown out of a surface a browser has restructured:
  // every block element ends a line, and so does a break that has anything
  // after it. textContent is what it reads, so a hidden marker counts.
  text() {
    const lines = [];
    let current = "";
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === TEXT) {
          current += child.data;
          continue;
        }
        if (child.nodeName === "BR") {
          if (child.nextSibling) {
            lines.push(current);
            current = "";
          }
          continue;
        }
        if (isWidget(child)) {
          current += child.dataset.block;
          continue;
        }
        const block = BLOCKS.has(child.nodeName);
        if (block && current !== "") {
          lines.push(current);
          current = "";
        }
        walk(child);
        if (block) {
          lines.push(current);
          current = "";
        }
      }
    };
    walk(this.element);
    if (current !== "") {
      lines.push(current);
    }
    return lines.join("\n").replace(SPACE, " ");
  }
  // ── The keys that would restructure the surface ───────────────────────
  keydown(event) {
    if (this.frontmatterSource(event.target)) {
      return;
    }
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (meta && (key === "z" || key === "y")) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }
    if (meta && (key === "home" || key === "end")) {
      event.preventDefault();
      if (key === "end" && !event.shiftKey && this.tail()) {
        return;
      }
      const to = key === "end" ? this.value.length : 0;
      const from = event.shiftKey ? this.selection.start : to;
      this.select(Math.min(from, to), Math.max(from, to));
      return;
    }
    const inside = this.widgetAt();
    if (inside) {
      this.widgetKey(event, inside, meta, key);
      return;
    }
    if (meta) {
      return;
    }
    if (!this.editor.marks && this.levelKey(event)) {
      return;
    }
    if (this.edgeKey(event)) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const { start, end } = this.selection;
      if (!event.shiftKey && start === end && (this.fenceEnter(start) || this.listEnter(start))) {
        return;
      }
      const text2 = event.shiftKey ? "  \n" : "\n";
      this.replace(start, end, text2, start + text2.length);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      const { start, end } = this.selection;
      if (start !== end) {
        event.preventDefault();
        this.replace(start, end, "", start);
        return;
      }
      const value = this.value;
      const back = event.key === "Backspace";
      const joins = back ? start > 0 && value[start - 1] === "\n" : value[start] === "\n";
      if (joins) {
        event.preventDefault();
        const at3 = back ? start - 1 : start;
        this.replace(at3, at3 + 1, "", at3);
      }
    }
  }
  // fenceEnter closes a fenced block nothing closes, and answers whether it
  // had one to close.
  //
  // Inside a block every key is a character of the code, Enter included, so
  // a writer who opened one at the foot of a document has no way out of it
  // but to type the fence again - and nothing on the page says that is what
  // they have to do. A blank line, then Enter on a second blank line, is
  // the gesture a writer reaches for, and it writes the fence: the two
  // blank lines they typed to escape go, and the caret lands below the
  // block.
  fenceEnter(at3) {
    const range = this.live();
    const segment = range && this.segmentOf(range.startContainer);
    if (!segment || isWidget(segment) || !("in" in segment.dataset)) {
      return false;
    }
    const value = this.value;
    const from = value.lastIndexOf("\n", at3 - 1) + 1;
    const end = value.indexOf("\n", at3);
    const to = end < 0 ? value.length : end;
    if (from === 0 || value.slice(from, to).trim() !== "") {
      return false;
    }
    const above = value.lastIndexOf("\n", from - 2) + 1;
    if (value.slice(above, from - 1).trim() !== "") {
      return false;
    }
    const lines = value.slice(to).split("\n");
    if (lines.some((line) => FENCE.test(line))) {
      return false;
    }
    let opener = null;
    for (const line of value.slice(0, above).split("\n").reverse()) {
      const found = line.match(FENCE);
      if (found) {
        opener = `${found[1]}${found[2]}`;
        break;
      }
    }
    if (opener === null) {
      return false;
    }
    this.replace(above, to, `${opener}
`, above + opener.length + 1);
    return true;
  }
  // listEnter carries a list on to its next item, and answers whether the
  // caret stands in one.
  //
  // A list is a column of lines that each start with the same marker, and
  // typing that marker again on every line is the writer doing the
  // editor's work. Enter at the end of an item opens the next one with its
  // marker already there, indented as deep as the item it came from, and a
  // numbered list counts on. Enter in the middle of one splits it, both
  // halves still items.
  //
  // Enter on an item with nothing in it ends the list: the marker goes, the
  // line it stood on is left blank - which is the line markdown wants
  // between a list and the paragraph after it - and the caret lands on a
  // line of its own below.
  listEnter(at3) {
    const value = this.value;
    const from = value.lastIndexOf("\n", at3 - 1) + 1;
    const end = value.indexOf("\n", at3);
    const to = end < 0 ? value.length : end;
    const found = value.slice(from, to).match(ITEM);
    if (!found || at3 < from + found[1].length) {
      return false;
    }
    if (found[2].trim() === "") {
      this.replace(from, to, "\n", from + 1);
      return true;
    }
    const marker = found[1].replace(/\d+/, (number) => String(Number(number) + 1));
    this.replace(at3, at3, `
${marker}`, at3 + 1 + marker.length);
    return true;
  }
  // levelKey answers the two keys that move a heading between its levels,
  // and whether it had one to move.
  //
  // With the hashes hidden there are no characters on the page to edit: the
  // caret stands at the head of the heading's text, and the keys a writer
  // reaches for there are a hash for one level deeper and Backspace for one
  // back. Backspace on a first-level heading leaves a paragraph, which is
  // the way out of the construct altogether. Left to the browser, both
  // would edit the hidden prefix and leave a line of `##text` that is no
  // longer a heading at all.
  levelKey(event) {
    if (event.key !== "Backspace" && event.key !== "#" || event.altKey) {
      return false;
    }
    const range = this.live();
    if (!range || !range.collapsed) {
      return false;
    }
    const segment = this.segmentOf(range.startContainer);
    if (!segment || isWidget(segment) || segment.dataset.level === void 0) {
      return false;
    }
    const prefix = read(segment).match(PREFIX);
    if (!prefix || within(segment, range.startContainer, range.startOffset) !== prefix[0].length) {
      return false;
    }
    const level = prefix[1].length;
    const want = event.key === "#" ? Math.min(level + 1, LEVELS) : level - 1;
    if (want === level) {
      return false;
    }
    event.preventDefault();
    this.setLevel(segment, want);
    return true;
  }
  // tail opens the line at the foot of a document that ends in a drawn
  // table, and answers whether it had to.
  //
  // A browser keeps no caret beside a block it cannot edit: it abandons the
  // position the moment a key arrives, so there is no standing after such a
  // table to press Enter from. Markdown holds no position after a table
  // either - the end of its last row is the end of the file - so Ctrl-End
  // and Down write the newline that puts a line below it.
  tail(widget = this.element.lastElementChild) {
    const last = this.element.lastElementChild;
    if (!last || last !== widget || !isWidget(last)) {
      return false;
    }
    const at3 = this.value.length;
    this.replace(at3, at3, "\n", at3 + 1);
    return true;
  }
  // edgeKey answers the keys pressed with the caret at the edge of a drawn
  // table. There is no line there for a browser to work on: it drops a
  // keystroke on the floor and a Backspace takes the whole widget out of
  // the surface, so the edit is made in the markdown at that offset. The
  // selection is read at keydown, since a browser moves the caret off the
  // edge of its own accord before it reports the input.
  edgeKey(event) {
    const edge = this.edge();
    if (!edge) {
      return false;
    }
    if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      this.replace(edge.at, edge.at, event.key, edge.at + event.key.length);
      return true;
    }
    if (event.key === "Backspace" && edge.at > 0) {
      event.preventDefault();
      this.replace(edge.at - 1, edge.at, "", edge.at - 1);
      return true;
    }
    if (event.key === "Delete" && edge.at < this.value.length) {
      event.preventDefault();
      this.replace(edge.at, edge.at + 1, "", edge.at);
      return true;
    }
    return false;
  }
  // widgetKey answers the keys pressed inside a drawn table. Inside one
  // cell the browser may edit the characters itself - a cell is an editing
  // host of its own and cellInput() writes the block back off it - and
  // everything that would reach past the cell is answered here.
  widgetKey(event, { widget, cell }, meta, key) {
    if (meta) {
      if (key === "a" && cell) {
        event.preventDefault();
        const source = new Cell(this, widget, cell);
        source.select(0, source.value.length);
      }
      return;
    }
    if (!cell) {
      if (event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
    }
    if (event.key === "Backspace" && this.backCell(widget, cell)) {
      event.preventDefault();
      return;
    }
    const rows = [...widget.querySelectorAll("tr")];
    if (event.key === "ArrowDown" && cell.closest("tr") === rows[rows.length - 1] && this.tail(widget)) {
      event.preventDefault();
    }
  }
  // backCell answers Backspace in an empty cell, and whether it had
  // anything to answer.
  //
  // There are no characters left to take out, so the key means the cell
  // before this one. In the first cell of a row with nothing in any of its
  // cells it means the row: the writer added it with Tab, left it empty,
  // and Backspace is how a row goes away again.
  backCell(widget, cell) {
    const source = new Cell(this, widget, cell);
    if (source.value !== "" || source.selection.start !== 0) {
      return false;
    }
    if (widget.dataset.kind === "frontmatter") {
      return this.backFrontmatterCell(widget, cell);
    }
    const line = cell.closest("tr");
    const first = cell === line.firstElementChild;
    const bare = [...line.children].every((other) => other.textContent.trim() === "");
    const row = Number(cell.dataset.row ?? 0);
    if (first && bare && row > 0) {
      const table2 = parse(widget.dataset.block);
      table2.rows.splice(row, 1);
      this.rewrite(widget, format(table2), {
        row: Math.max(row - 1, 0),
        column: Math.max(table2.alignments.length - 1, 0)
      });
      this.editor.emit("change", { value: this.value });
      return true;
    }
    const cells2 = [...widget.querySelectorAll("th, td")];
    const back = cells2[cells2.indexOf(cell) - 1];
    if (!back) {
      return true;
    }
    const previous = this.enter(widget, back);
    previous.select(previous.value.length);
    return true;
  }
  // stepCell moves the caret on to the next cell of a drawn table, or back
  // to the one before it, and answers whether the caret stands in a cell:
  // Tab in a table is how a writer crosses it.
  stepCell(forward) {
    const found = this.widgetAt();
    if (!found?.cell) {
      return false;
    }
    const cells2 = [...found.widget.querySelectorAll('[contenteditable="true"][data-row][data-column]')];
    const next = cells2[cells2.indexOf(found.cell) + (forward ? 1 : -1)];
    if (next) {
      this.enter(found.widget, next);
      return true;
    }
    if (forward) {
      this.addRow(found.widget);
    }
    return true;
  }
  // enter puts the caret in one cell of a drawn table, with what the cell
  // already holds selected, the way Tab arrives in a cell.
  enter(widget, cell) {
    const source = new Cell(this, widget, cell);
    cell.focus();
    source.select(0, source.value.length);
    return source;
  }
  // addRow puts a row of empty cells at the foot of a drawn table and the
  // caret in the first of them.
  addRow(widget) {
    if (widget.dataset.kind === "frontmatter") {
      this.frontmatterAddRow(widget);
      return;
    }
    const table2 = parse(widget.dataset.block);
    table2.rows.push(Array(table2.alignments.length).fill(""));
    this.rewrite(widget, format(table2), { row: table2.rows.length - 1, column: 0 });
    this.editor.emit("change", { value: this.value });
  }
  // frontmatterAddRow puts an empty key and value at the foot of the fields.
  frontmatterAddRow(widget) {
    if (widget.dataset.mode === "source") {
      return;
    }
    const body = widget.querySelector("tbody");
    if (!body) {
      return;
    }
    const last = [...body.querySelectorAll("tr")].pop();
    const lastKey = last?.querySelector('[data-column="0"]');
    if (last?.hasAttribute("data-new") && lastKey) {
      this.enter(widget, lastKey);
      return;
    }
    const index = String(widget.querySelectorAll("tbody tr[data-row]").length);
    const line = document.createElement("tr");
    line.dataset.new = "true";
    line.dataset.row = index;
    const key = document.createElement("td");
    key.className = `${this.prefix}__frontmatter-key`;
    key.contentEditable = "true";
    key.dataset.row = index;
    key.dataset.column = "0";
    key.replaceChildren(...this.plain(""));
    const value = document.createElement("td");
    value.className = `${this.prefix}__frontmatter-value`;
    value.contentEditable = "true";
    value.dataset.row = index;
    value.dataset.column = "1";
    value.replaceChildren(...this.plain(""));
    line.append(key, value);
    body.appendChild(line);
    this.enter(widget, key);
  }
  // backFrontmatterCell answers Backspace in an empty field.
  backFrontmatterCell(widget, cell) {
    const line = cell.closest("tr");
    if (line?.hasAttribute("data-new")) {
      const key = line.querySelector('[data-column="0"]');
      if (key && key !== cell) {
        const previous = this.enter(widget, key);
        previous.select(previous.value.length);
        return true;
      }
      const rows = [...widget.querySelectorAll("tbody tr")].filter(
        (row) => !row.classList.contains(`${this.prefix}__frontmatter-group`)
      );
      const at3 = rows.indexOf(line);
      line.remove();
      const before2 = rows[at3 - 1];
      const target = before2?.querySelector('[contenteditable="true"][data-column="1"]') ?? before2?.querySelector('[contenteditable="true"][data-column="0"]');
      if (target) {
        const previous = this.enter(widget, target);
        previous.select(previous.value.length);
      }
      return true;
    }
    const cells2 = [...widget.querySelectorAll('[contenteditable="true"][data-row][data-column]')];
    const before = cells2[cells2.indexOf(cell) - 1];
    if (before) {
      const previous = this.enter(widget, before);
      previous.select(previous.value.length);
    }
    return true;
  }
  // toggleFrontmatterSource swaps the fields for the YAML source and back.
  toggleFrontmatterSource(widget, button) {
    const field = widget.querySelector(`textarea.${this.prefix}__frontmatter-source`);
    if (field) {
      const source = field.value.replace(RETURNS, "\n");
      const model2 = complete(source);
      if (!model2) {
        widget.setAttribute("data-invalid", "");
        field.setAttribute("aria-invalid", "true");
        field.title = this.editor.texts.frontmatterInvalid;
        return;
      }
      widget.removeAttribute("data-invalid");
      widget.removeAttribute("data-mode");
      field.removeAttribute("aria-invalid");
      const markdown = model2.lines.join("\n");
      const first = model2.data.find((row) => row.editableValue);
      widget.dataset.block = markdown;
      this.rewrite(widget, markdown, first ? { row: first.row, column: first.editableKey ? 0 : 1 } : null);
      return;
    }
    this.commit();
    this.history.commit({ value: this.value, caret: this.startOf(widget) });
    const textarea = document.createElement("textarea");
    textarea.className = `${this.prefix}__frontmatter-source`;
    textarea.spellcheck = false;
    textarea.value = widget.dataset.block;
    textarea.rows = Math.max(3, widget.dataset.block.split("\n").length);
    textarea.setAttribute("aria-label", this.editor.texts.frontmatter);
    widget.setAttribute("data-mode", "source");
    widget.appendChild(textarea);
    button?.setAttribute("aria-pressed", "true");
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  }
  // frontmatterSourceInput writes the YAML source view back into the block.
  frontmatterSourceInput(field) {
    const widget = field.closest(`.${this.prefix}__widget--frontmatter`);
    if (!widget) {
      return;
    }
    const source = field.value.replace(RETURNS, "\n");
    if (source !== field.value) {
      field.value = source;
    }
    widget.dataset.block = source;
    widget.toggleAttribute("data-invalid", !complete(source));
    this.stamp = Date.now();
    this.announce();
  }
  // rewrite swaps the markdown a widget stands for and draws it again.
  rewrite(widget, markdown, land) {
    this.commit();
    this.history.commit({ value: this.value, caret: this.startOf(widget) });
    const fresh = widget.dataset.kind === "frontmatter" ? frontmatter(this, markdown) : table(this, markdown);
    widget.replaceWith(fresh);
    this.announce();
    if (land) {
      const cell = fresh.querySelector(`[data-row="${land.row}"][data-column="${land.column}"]`);
      if (cell) {
        this.enter(fresh, cell);
      }
    }
    return fresh;
  }
  paste(event) {
    if (this.frontmatterSource(event.target)) {
      return;
    }
    const files = [...event.clipboardData?.files ?? []];
    if (files.length && this.editor.uploads?.accepts("paste")) {
      event.preventDefault();
      this.editor.uploads.files(files);
      return;
    }
    event.preventDefault();
    const text2 = (event.clipboardData?.getData("text/plain") ?? "").replace(RETURNS, "\n");
    if (text2 === "") {
      return;
    }
    const source = this.active;
    const { start, end } = source.selection;
    source.replace(start, end, text2, start + text2.length);
  }
  drop(event) {
    if (this.frontmatterSource(event.target)) {
      event.preventDefault();
      return;
    }
    const files = [...event.dataTransfer?.files ?? []];
    if (files.length && this.editor.uploads?.accepts("drop")) {
      event.preventDefault();
      this.editor.uploads.files(files);
    }
  }
  // ── Undo ──────────────────────────────────────────────────────────────
  commit() {
    if (!this.pending) {
      return;
    }
    this.history.commit(this.pending);
    this.pending = null;
  }
  undo() {
    this.commit();
    this.step(this.history.undo({ value: this.value, caret: this.selection.start }));
  }
  redo() {
    this.step(this.history.redo({ value: this.value, caret: this.selection.start }));
  }
  step(snapshot) {
    if (!snapshot) {
      return;
    }
    this.load(snapshot.value);
    this.select(snapshot.caret);
    this.announce();
  }
  // announce puts the markdown in the textarea the form posts and tells the
  // host the document changed.
  announce() {
    const value = this.value;
    if (this.field) {
      this.field.value = value;
    }
    this.markOpenFence();
    this.editor.emit("change", { value });
  }
  // markOpenFence says at the foot of the surface that the document ends
  // inside a fenced block. The last line carries the language it is read
  // in, so one attribute answers it; what the foot says is the
  // stylesheet's, and generated content lands in no document.
  markOpenFence() {
    const last = this.element.lastElementChild;
    this.element.toggleAttribute("data-open-fence", Boolean(last && "in" in last.dataset));
  }
};

// src/uploads.js
function snippetFor(url, file) {
  if ((file.type || "").startsWith("image/")) {
    return `![](${url})`;
  }
  return `[${file.name || url}](${url})`;
}
var Uploads = class {
  constructor(editor, options) {
    this.editor = editor;
    this.options = options;
    this.counter = 0;
    this.picker = null;
    this.receive = null;
    this.records = /* @__PURE__ */ new Map();
    this.byLine = /* @__PURE__ */ new Map();
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
        this.picker.accept = accept.map((type) => type.endsWith("/") ? `${type}*` : type).join(",");
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
    const limit = await resolve(this.options.maxBytes ?? 2 * 1024 * 1024, file);
    if (typeof accept === "function") {
      if (!accept(file)) {
        return texts.notAccepted;
      }
    } else if (Array.isArray(accept) && accept.length) {
      const type = file.type || "";
      const ok = accept.some((want) => want.endsWith("/") ? type.startsWith(want) : type === want);
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
    if (refusal && inCell) {
      this.editor.emit("error", { phase: "upload", file, error: new Error(refusal) });
      return null;
    }
    this.counter += 1;
    const image = (file.type || "").startsWith("image/");
    const placeholder = this.options.placeholder ? this.options.placeholder(file, this.counter) : `${image ? "!" : ""}[${texts.uploading} ${this.counter}...]()`;
    const { start } = this.editor.selection;
    const value = this.editor.value;
    const head = value.lastIndexOf("\n", start - 1) + 1;
    const line = value.slice(head, start) + placeholder;
    const inline = line.trim() !== placeholder.trim();
    const watched = !inCell && !placeholder.includes("\n");
    const record = watched ? this.arm(file, line, inline, refusal ? "failed" : "start", refusal ?? "", placeholder) : null;
    this.editor.insert(`${placeholder}
`);
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
      const snippet = this.options.snippet ? this.options.snippet(url, file) : snippetFor(url, file);
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
        this.swap(`${placeholder}
`, "");
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
      dead: false
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
    const at3 = ids.indexOf(record.id);
    if (at3 >= 0) {
      ids.splice(at3, 1);
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
      const snippet = this.options.snippet ? this.options.snippet(url, file) : snippetFor(url, file);
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
    const text2 = this.editor.value.slice(lineStart, lineStart + record.line.length);
    if (text2 !== record.line) {
      return null;
    }
    const placeholder = record.placeholder ?? record.line;
    const at3 = text2.indexOf(placeholder);
    if (at3 < 0) {
      return { lineStart, at: lineStart, placeholder: record.line, before: "", after: "" };
    }
    return {
      lineStart,
      at: lineStart + at3,
      placeholder,
      before: text2.slice(0, at3),
      after: text2.slice(at3 + placeholder.length)
    };
  }
  // write replaces a line and keeps the caret where the writer has moved
  // on to: by the time an upload answers, its line can be several lines
  // behind them.
  write(at3, length, replacement) {
    const { start, end } = this.editor.selection;
    const shift = replacement.length - length;
    const move3 = (position) => position <= at3 ? position : position + shift;
    this.editor.source.replace(at3, at3 + length, replacement, move3(start), move3(end));
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
    const headers = { ...await resolve(options.headers, file) ?? {} };
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
      for (const [name, value] of Object.entries(await resolve(options.params, file) ?? {})) {
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
        if (!event.lengthComputable || record && record.dead) {
          return;
        }
        const ratio = event.total ? event.loaded / event.total : 0;
        if (record) {
          const now = performance.now();
          if (!record.started) {
            record.started = now;
          }
          const elapsed = (now - record.started) / 1e3;
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
          ratio
        });
      });
      call.addEventListener("load", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(call.responseText);
        } catch {
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
    const at3 = this.editor.value.indexOf(needle);
    if (at3 < 0) {
      return false;
    }
    this.write(at3, needle.length, replacement);
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
      }
    }
    this.records.clear();
    this.byLine.clear();
    this.picker?.remove();
    this.picker = null;
    this.receive = null;
  }
};

// src/editor.js
var TEXTS = {
  formatting: "Formatting",
  document: "Markdown",
  upload: "Upload files",
  uploading: "uploading",
  uploadEta: "ETA",
  uploadFailed: "Upload failed",
  uploadUnreachable: "network error",
  uploadUnconfigured: "uploads are not configured",
  uploadRetry: "Choose a file again",
  uploadQueue: "Uploads",
  uploadChoose: "Choose files",
  uploadEmpty: "Nothing is uploading. Choose files to send them all at once.",
  uploadForget: "Put this away",
  uploadDone: "Uploaded",
  notAccepted: "That file cannot be uploaded here.",
  tooLarge: "That file is too large.",
  tableGrid: "Table",
  linkPanel: "Links",
  linkOrder: "#",
  linkText: "Link text",
  linkAddress: "Address",
  linkImage: "Image",
  linkImageAddress: "Image address",
  linkNone: "This document has no links.",
  linkEmpty: "No address yet",
  linkPicture: "Picture",
  linkView: "View the picture",
  save: "Save",
  cancel: "Cancel",
  marks: "Show the markup",
  heading: "Heading",
  headingText: "Plain text",
  headingLevel: "Heading level",
  imagePanel: "Image",
  imageCaption: "Caption",
  imageAddress: "Address",
  imageMissing: "That address answers no image.",
  imageReplace: "Replace this image",
  imageLeft: "Float left",
  imageCenter: "Centre",
  imageRight: "Float right",
  cell: "Cell",
  rowAdd: "Add a row",
  rowRemove: "Remove this row",
  columnAdd: "Add a column",
  columnRemove: "Remove this column",
  align: "Align this column",
  tableMenu: "Table",
  frontmatter: "Document front-matter",
  frontmatterName: "Name",
  frontmatterValue: "Value",
  frontmatterRowAdd: "Add a field",
  frontmatterRich: "rich type, edit via source",
  frontmatterInvalid: "This is not a front matter block",
  rowAbove: "Row above",
  rowBelow: "Row below",
  columnLeft: "Column to the left",
  columnRight: "Column to the right",
  alignLeft: "Align left",
  alignCenter: "Align centre",
  alignRight: "Align right",
  source: "Edit the markdown",
  delete: "Delete",
  done: "Done",
  proof: "Read it over",
  proofPanel: "Proofing",
  proofReading: "Reading...",
  proofClean: "Nothing to look at.",
  proofFailed: "The proofreader did not answer.",
  proofAgain: "Read again",
  proofShow: "Show it in the document",
  proofWhole: "Read the whole sentence",
  proofEdit: "Write the sentence yourself",
  proofIgnore: "Leave it",
  proofKeep: "Keep",
  proofKeepTitle: "Keep this, here and in everything after it"
};
var sequence = 0;
var MarkdownEditor = class _MarkdownEditor {
  // mount builds an editor over every textarea a selector, an element or a
  // node list names, and answers them. The common case is one call per
  // kind of field:
  //
  //	MarkdownEditor.mount("textarea[data-markdown]", {...});
  static mount(target, options = {}) {
    const nodes = typeof target === "string" ? document.querySelectorAll(target) : target instanceof Element ? [target] : target ?? [];
    return [...nodes].map((node) => new _MarkdownEditor(node, options));
  }
  constructor(field, options = {}) {
    this.field = field;
    this.options = options;
    this.prefix = options.prefix ?? "mdedit";
    this.texts = { ...TEXTS, ...options.texts };
    this.listeners = /* @__PURE__ */ new Map();
    this.releasingTab = false;
    this.marks = options.marks !== false;
    this.aborter = new AbortController();
    this.uploads = options.uploads ? new Uploads(this, options.uploads) : null;
    this.uploadPanel = this.uploads ? new UploadPanel(this) : null;
    this.grid = new TableGrid(this);
    this.imagePanel = new ImagePanel(this);
    this.linkPanel = new LinkPanel(this);
    this.proofPanel = options.proof ? new ProofPanel(this) : null;
    this.tableMenu = new TableMenu(this);
    this.levelMenu = new LevelMenu(this);
    this.tools = {
      ...defaultTools(),
      ...this.uploads ? {
        upload: {
          label: "Img",
          // An upward arrow is a guess on its own: the word
          // says what lands where.
          word: true,
          icon: "icon-upload",
          title: this.texts.upload,
          run: (editor, event) => editor.uploadPanel?.toggle(event)
        }
      } : {},
      ...options.proof ? {
        proof: {
          label: "Proof",
          icon: "icon-proof",
          title: this.texts.proof,
          run: (editor, event) => editor.proofPanel?.toggle(event)
        }
      } : {},
      ...options.tools
    };
    if (!field.id) {
      sequence += 1;
      field.id = `${this.prefix}-${sequence}`;
    }
    this.build();
  }
  // ── The surface ───────────────────────────────────────────────────────
  build() {
    const field = this.field;
    const name = (part2) => `${this.prefix}__${part2}`;
    this.root = document.createElement("div");
    this.root.className = this.prefix;
    field.parentNode.insertBefore(this.root, field);
    this.surface = document.createElement("div");
    this.surface.id = `${field.id}-surface`;
    this.surface.className = name("surface");
    this.surface.contentEditable = "true";
    this.surface.spellcheck = this.options.spellcheck !== false;
    this.surface.setAttribute("role", "textbox");
    this.surface.setAttribute("aria-multiline", "true");
    this.surface.setAttribute("aria-label", field.getAttribute("aria-label") ?? this.texts.document);
    this.surface.setAttribute("autocorrect", "off");
    this.surface.setAttribute("autocapitalize", "off");
    this.bar = this.buildBar();
    if (this.bar) {
      this.root.appendChild(this.bar);
    }
    this.frame = document.createElement("div");
    this.frame.className = name("frame");
    this.frame.appendChild(this.surface);
    this.root.appendChild(this.frame);
    field.hidden = true;
    this.frame.appendChild(field);
    this.source = new Surface(this, this.surface, field);
    this.source.load(field.value);
    const signal = this.aborter.signal;
    this.source.attach(signal);
    this.surface.addEventListener("keydown", (event) => this.keydown(event), { signal });
    this.imagePanel.attach(signal);
    this.tableMenu.attach(signal);
    this.levelMenu.attach(signal);
    this.toggleMarks(this.marks);
  }
  // keydown holds Tab inside the document: a tab is a character in a code
  // block, and markdown reads it as indentation everywhere else. Escape
  // first and the next Tab moves the focus on, which is the way out for
  // anyone driving the page from the keyboard; `tab: false` turns the
  // whole thing off.
  // The shortcuts every editor has, over the markers markdown spells the
  // same decorations with. A host that binds its own takes `shortcuts:
  // false` and reads the keys itself.
  //
  // Ctrl+U is not here: markdown has no underline, and writing one means
  // raw HTML, which a publisher is as likely to strip as to render.
  static SHORTCUTS = {
    b: "bold",
    i: "italic",
    // Strikethrough has no one key. These two are what the editors a
    // writer is coming from use.
    x: "strike",
    s: "strike"
  };
  // shortcut answers the tool a keystroke names, or nothing.
  shortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return "";
    }
    const key = event.key.toLowerCase();
    const tool2 = _MarkdownEditor.SHORTCUTS[key];
    if (!tool2) {
      return "";
    }
    if ((key === "x" || key === "s") !== event.shiftKey) {
      return "";
    }
    return this.tools[tool2] ? tool2 : "";
  }
  keydown(event) {
    if (event.target?.closest?.(`.${this.prefix}__frontmatter-source`)) {
      return;
    }
    if (this.options.shortcuts !== false) {
      const tool2 = this.shortcut(event);
      if (tool2) {
        event.preventDefault();
        this.run(tool2, event);
        return;
      }
    }
    if (event.key === "Escape") {
      this.releasingTab = true;
      return;
    }
    if (event.key !== "Tab") {
      this.releasingTab = false;
      return;
    }
    if (this.options.tab === false) {
      return;
    }
    if (this.releasingTab) {
      this.releasingTab = false;
      return;
    }
    event.preventDefault();
    if (this.source.stepCell(!event.shiftKey)) {
      return;
    }
    const { text: text2 } = this.selection;
    if (event.shiftKey) {
      this.source.outdent();
      return;
    }
    if (text2.includes("\n")) {
      this.source.indent();
      return;
    }
    this.insert("	");
  }
  buildBar() {
    const toolbar = this.options.toolbar ?? (this.uploads ? [...TOOLBAR_FULL, "upload"] : TOOLBAR_FULL);
    if (toolbar === false) {
      this.marksButton = null;
      return null;
    }
    const bar = document.createElement("div");
    bar.className = `${this.prefix}__bar`;
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", this.texts.formatting);
    bar.setAttribute("aria-controls", this.surface.id);
    for (const key of toolbar) {
      const tool2 = this.tools[key];
      if (!tool2) {
        continue;
      }
      bar.appendChild(
        this.button(key, tool2.label, tool2.title, (event) => this.run(key, event), tool2.icon, tool2.word)
      );
    }
    this.marksButton = this.button("marks", "\xB6", this.texts.marks, () => this.toggleMarks(), "icon-paragraph");
    bar.appendChild(this.marksButton);
    roving(bar, this.aborter.signal);
    return bar;
  }
  // button draws one of the bar's buttons through the shared builder: the
  // toolbar holds the caret, so every button on it does.
  button(key, label, title, run, icon, word) {
    return tool({ prefix: this.prefix, key, label, title, icon, word, run });
  }
  // stage is the element the document stands in. The table grid takes its
  // place while it is open.
  get stage() {
    return this.frame;
  }
  // refresh builds the surface again from the textarea: for a value a host
  // set behind the editor's back.
  refresh() {
    this.source.forget();
    this.source.load(this.field.value);
  }
  // ── Editing ───────────────────────────────────────────────────────────
  get value() {
    return this.source.value;
  }
  set value(text2) {
    this.source.value = text2;
  }
  get selection() {
    return this.source.selection;
  }
  focus(options) {
    this.source.focus(options);
  }
  // Every move runs against the source the caret stands in. One cell of a
  // drawn table holds its own markdown, so a tool run with the caret there
  // writes in that cell.
  insert(text2, cursor, length) {
    this.source.active.insert(text2, cursor, length);
  }
  insertBlock(text2, cursor, length) {
    this.source.active.insertBlock(text2, cursor, length);
  }
  wrap(marker, placeholder) {
    this.source.active.wrap(marker, placeholder);
  }
  prefixLines(marker) {
    this.source.active.prefixLines(marker);
  }
  // run fires one tool by its key: what the toolbar button does, available
  // to a keyboard shortcut or a menu of the host's own. The event that ran
  // it comes along, for a tool that opens something under the pointer.
  run(key, event) {
    const tool2 = this.tools[key];
    if (!tool2) {
      return;
    }
    if (document.activeElement?.closest?.(`.${this.prefix}__frontmatter-source`)) {
      return;
    }
    if (this.proofPanel?.editing && this.owns(document.activeElement)) {
      return;
    }
    tool2.run(this, event);
    if (!this.owns(document.activeElement)) {
      this.focus();
    }
  }
  // owns answers whether one of this editor's own fields holds the focus: a
  // panel's draft, an address in the links table, a cell. The caret a
  // writer is typing at is in there and not in the document.
  owns(node) {
    return Boolean(node) && this.root.contains(node) && ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
  }
  // toggleMarks shows or hides the marker characters. Shown, the document
  // reads as markdown with every construct already in its own face; hidden,
  // only what the markers marked shows, and it goes on being edited where
  // it stands.
  toggleMarks(on = !this.marks) {
    this.marks = on;
    this.root.classList.toggle(`${this.prefix}--marks`, on);
    this.marksButton?.setAttribute("aria-pressed", String(on));
    this.emit("marks", { marks: on });
    return on;
  }
  // editTable opens the grid over the table the caret sits in, and
  // answers whether it found one. The table tool calls it before writing a
  // new table, so the button reads as "table" either way.
  editTable() {
    return this.grid.toggle();
  }
  upload(file) {
    if (!this.uploads) {
      return Promise.resolve(null);
    }
    return this.uploads.handle(file);
  }
  // ── Events ────────────────────────────────────────────────────────────
  // on registers a listener and answers the function that removes it.
  // Events: change, marks, table, upload, error.
  on(name, listener) {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, /* @__PURE__ */ new Set());
    }
    this.listeners.get(name).add(listener);
    return () => this.listeners.get(name)?.delete(listener);
  }
  emit(name, detail) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ ...detail, editor: this });
    }
  }
  // destroy puts the textarea back under its original parent and drops
  // everything this editor added, listeners included.
  destroy() {
    this.grid.close();
    this.imagePanel.close();
    this.linkPanel.close();
    this.tableMenu.close();
    this.levelMenu.close();
    this.uploadPanel?.close();
    this.uploads?.destroy();
    this.aborter.abort();
    this.listeners.clear();
    this.field.hidden = false;
    this.root.parentNode?.insertBefore(this.field, this.root);
    this.root.remove();
  }
};

// src/index.js
var version = "0.1.0";
export {
  MarkdownEditor,
  ProofPanel,
  Source,
  Surface,
  TEXTS,
  TOOLBAR_FULL,
  TOOLBAR_INLINE,
  UploadPanel,
  Uploads,
  alignImage,
  defaultTools,
  escapeHTML,
  highlight,
  highlightCode,
  iconFor,
  imageAlign,
  imageMarkdown,
  renderInline,
  size,
  tokenLines,
  tokenise,
  version
};
