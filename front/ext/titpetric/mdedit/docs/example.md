# mdedit, every feature in one page

The README takes its screenshot from this document. Open it in the demo server and the editor shows the lot: `phpscript mdedit.php docs`.

## Emphasis and spans

Text takes **bold**, **also bold**, *italic*, ~~struck out~~ and `inline code`. A [link to an address](https://example.com/writing) is a link, and the editor checks nothing about where it points.

### Third level

Headings read at a heading's size, down to the third level. Below that they stay the size of the body and show the hashes.

With the markers hidden the hashes go, and the level stands at the end of the line as a label: `H1` down to `H6`. A hash typed at the head of the text writes one level deeper, Backspace there takes one back, and off the last level the line is a paragraph. A click on the label opens the six levels and the paragraph, each at the size it writes.

## Lists

Enter at the end of an item opens the next one with its marker there already, and on an empty item it takes the marker off and ends the list.

- a bullet, which takes **the same spans** as a paragraph
- another one
  - a nested item, indented two spaces
    - and one nested under that
- back at the top level

1. numbered lists count themselves
2. the editor paints the marker and leaves the text alone
3. both stay the writer's own characters

## Quotes

> A quote keeps its markers and reads in italics, so the shape of the document is legible without rendering it.

## Code

A fenced block paints as one surface and colours by the word on the fence. With the markers hidden the fences go and the word stands at the top right of the block, where a press on it opens the languages.

```go
// shipped counts what went out.
func shipped(items []string) (int, error) {
	if len(items) == 0 {
		return 0, errors.New("nothing to ship")
	}

	return len(items), nil
}
```

```php
<?php

final class Shipment
{
	public function store(string $name, int $count): bool
	{
		if ($count < 1) {
			throw new Exception("nothing to ship");
		}

		return file_put_contents($name, json_encode(["count" => $count])) !== false;
	}
}
```

A document that ends inside a block says so at its foot, since every key inside one is a character of the code. A blank line, then Enter on a second blank line, writes the fence that closes it.

A fence with no language keeps its characters uncoloured, and its block says `text` at the top right:

```
make build && ./pendulum -ext jpg,png ~/notes
```

## Tables

A cell holds markdown and reads as markdown, so a span in a cell is a span:

| Tool  | Writes        | Reads as                    |
|-------|---------------|-----------------------------|
| **B** | `**bold**`    | **bold**                    |
| *I*   | `_italic_`    | *italic*                    |
| ~~S~~ | `~~struck~~`  | ~~struck~~                  |
| `<>`  | `code`        | `code`                      |
| `[ ]` | `[text](url)` | [text](https://example.com) |

The pilcrow hides the markers in a cell the way it hides them in a line. The `<>` button on the table swaps the whole block for its own markdown, which is the way to edit the alignment row or paste a column in, and the grid button opens the fuller editor for rows, columns and alignment.

Tab crosses the cells and, pressed in the last one, adds a row and stands in the first cell of it, so the writer fills a table in without reaching for anything. Backspace in an empty cell steps back one, and in the first cell of an empty row it takes the row out again. A click or a tap outside the table is the way out of it.

A right-click on a cell, a long press or a double tap opens the menu: a row above or below, the row gone, a column either side, the column gone, and the column laid out left, centre or right. Each one rewrites the markdown and draws the table again, and undo takes it back.

## Images

![The mdedit logo](/assets/docs/mdedit-logo.png#left)

An image states where it sits in the anchor on its address, so a document that allows no raw HTML can still lay one out. This paragraph wraps around the picture beside it, as `#left` lays it out; `#right` sends it the other way and `#center` puts it on a line of its own. The anchor travels with the markdown, so wherever a publisher puts the file, the picture sits where the author put it.

Click an image, or right-click it, in either mode, and a panel opens with what the address answers, its caption, three alignment buttons and Replace. The alignment rides on the address as `#left`, `#center` or `#right`, which the stylesheet floats or centres on, so the document stays markdown with no HTML in it. Replace uploads another file and swaps the address, keeping the caption and the alignment.

Paste or drop a file and it uploads where the project says, which here is the demo server's own folder.

## Rendering

The pilcrow on the bar renders the document in place: the markers go, the prose takes a proportional face, code keeps the monospace one, and the headings read at a document's sizes with their level on a label at the end of the line. Tables and images stay editable there, and the button brings the markers back.
