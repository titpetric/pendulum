# Development guide

The demo server, the test suites, the build, and how the screenshots in this repository get taken. A project that only uses `dist/` needs none of it.

## The demo server

```sh
phpscript mdedit.php demo/data
```

One PHP script, run by [phpscript](https://github.com/titpetric/phpscript), that is itself the HTTP server: it indexes the markdown under a folder, serves the editor over it, saves what you write, and stores pasted images under ulid names behind a token minted at boot. Run it from this directory, since phpscript roots the filesystem where it starts. `mdedit.php` doubles as the reference implementation of the upload contract.

The test runner starts the same script on a free port against a copy of `demo/data`, so a suite that uploads leaves nothing behind in the tree.

## Tests

```sh
PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/usr/lib/chromium/chromium atkins test
```

Sixteen suites drive a real browser over the demo server, which the runner starts on a port of its own against a copy of `demo/data`:

| Suite         | What it drives                                                    |
|---------------|-------------------------------------------------------------------|
| `surface`     | the document, the bar, the widgets, the form                      |
| `editing`     | undo, paste, the grid, the image panel, uploads                   |
| `keys`        | Tab, Shift-Tab, Escape, and where the focus goes                  |
| `headings`    | the level label, the keys that move it, the chooser               |
| `langs`       | the language on a code block, and the menu that writes it         |
| `cards`       | the block a host draws for a marker of its own                    |
| `tables`      | Tab and Backspace through a table, and the menu over it           |
| `frontmatter` | the YAML head, its fields, source view and rich rows              |
| `media`       | players, linked files, per-file limits, progress                  |
| `uploads`     | the preview on its way, the queue, the resolved marker            |
| `links`       | the table over a document's links, empty addresses and pictures   |
| `proof`       | what a host reports about a document, and writing a suggestion in |
| `stress`      | a long document, failed uploads, two editors                      |
| `touch`       | a phone: taps, the wrapped bar, a released float                  |
| `fuzz`        | random keystrokes against the invariants                          |
| `model`       | the same keys against a model of the document                     |

`node tests/run.mjs keys touch` runs the ones named. A failing suite prints the document, the keys that got there and the seed, which is enough to replay it by hand.

## Build

| Command         | What it does                          |
|-----------------|---------------------------------------|
| `atkins bundle` | rebuild `dist/` from `src/`           |
| `atkins check`  | fail when `dist/` and `src/` disagree |
| `atkins demo`   | serve `demo/data` on `127.0.0.1:8088` |

The repository commits `dist/`, so a project that copies it needs no toolchain. The bundler is esbuild, a Go binary that `atkins bundle` installs through `go install` when PATH holds none. `atkins check` compares a hash of `src/` against `dist/mdedit.stamp` and runs without node or esbuild, which makes it the gate for a consuming pipeline.

| Source               | What is in it                                                              |
|----------------------|----------------------------------------------------------------------------|
| `src/index.js`       | the entry point, and what the package exports                              |
| `src/editor.js`      | the class: the surface, the bar, the events                                |
| `src/source.js`      | the textarea as an editable source                                         |
| `src/highlight.js`   | the tokeniser that reads one line                                          |
| `src/escape.js`      | what the colourer and the renderers escape first                           |
| `src/tools.js`       | the default toolbar                                                        |
| `src/code.js`        | the colour inside a fenced block                                           |
| `src/language.js`    | the language on a code block, and the menu that writes it                  |
| `src/surface.js`     | the contenteditable surface, the caret and the keys                        |
| `src/widgets.js`     | the table and front matter a document draws in place                       |
| `src/frontmatter.js` | the YAML block, its fields and its source offsets                          |
| `src/menu.js`        | the menu over a drawn table                                                |
| `src/inline.js`      | the inline level, and what an image holds                                  |
| `src/table.js`       | the table grid                                                             |
| `src/images.js`      | the image panel                                                            |
| `src/heading.js`     | the level a heading names, and its chooser                                 |
| `src/uploads.js`     | paste, drop, pick, the records and the request                             |
| `src/preview.js`     | the drawing of a file on its way, and its sizes                            |
| `src/queue.js`       | the panel over every file the editor is sending                            |
| `src/links.js`       | the table over every link in the document                                  |
| `src/util.js`        | the shared button, the panel placing, the bar keys                         |
| `src/mdedit.css`     | the stylesheet                                                             |
| `src/components/`    | the widget and front matter styles, imported by `src/mdedit.css`           |
| `mdedit.php`         | the demo server, a [phpscript](https://github.com/titpetric/phpscript) app |
| `demo/`              | the demo page and its sample markdown                                      |

## Screenshots

`node tests/shots.mjs` takes the images in `docs/`, one scene per name and every scene with no name given:

```sh
PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/usr/lib/chromium/chromium node tests/shots.mjs
node tests/shots.mjs editor render
```

It runs what the browser suites run: the demo server over a copy of `demo/data` with `docs/example.md` beside it, a Chromium window 960 pixels wide and a clip of the `.mdedit` element, widened to take in a panel that stands outside the editor's box.

| Image                                | Scene                                                             |
|--------------------------------------|-------------------------------------------------------------------|
| `editor.png`, `render.png`           | `docs/example.md`, markers shown and then hidden                  |
| `upload.png`                         | one file in flight at 60%, `ETA 12s`                              |
| `upload-failed.png`                  | one file refused by the server, the reason on its preview         |
| `upload-queue.png`                   | the queue over three files: one refused, one landed, one at 40%   |
| `table.png`, `menu.png`, `image.png` | the table, the menu over a cell and the image panel               |
| `heading.png`, `links.png`           | the level chooser and the links table                             |
| `code.png`, `code-menu.png`          | three code blocks with their fences hidden, and the menu over one |
| `frontmatter.png`                    | the fields at the head of a document                              |

`docs/example.md` is the fixture for the first two, so a change to it means taking both again. A change to the bar means taking all of them, since every image holds it. Playwright and Chromium are not dependencies of this project. A machine with Docker can use an image holding Node, Chromium and phpscript, set `PLAYWRIGHT` and `CHROMIUM` for it as the Tests section says, and copy the repository in with `docker cp` when a bind mount does not reach the working tree.

## Prose

`registry.cdn.si/vale` lints the Markdown here with the `llm-slop` style, and every rule gates:

```sh
docker run --rm -v "$PWD:/src" registry.cdn.si/vale --output=line README.md docs
```

A run that prints nothing has passed.

---

Previous: [Integration guide](integration.md)
