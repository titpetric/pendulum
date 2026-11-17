import { chromium, devices } from "./lib.mjs";
const browser = await chromium.launch({ executablePath: "/usr/lib/chromium/chromium" });
const problems = [];
const ok = (label, pass, detail = "") => { console.log(`${pass ? "PASS" : "FAIL"} ${label}${detail ? ` :: ${detail}` : ""}`); if (!pass) problems.push(label); };

// A phone: touch, no mouse, a narrow column.
const context = await browser.newContext({ ...devices["Pixel 5"], hasTouch: true, isMobile: true });
const page = await context.newPage();
page.on("pageerror", (e) => ok(`pageerror ${e.message}`, false));
await page.goto(`http://127.0.0.1:${process.env.MDEDIT_PORT ?? "18899"}/edit?file=welcome.md`, { waitUntil: "networkidle" });
await page.waitForSelector(".mdedit__surface");

await page.evaluate(() => { window.editor.value = "above\n\n![a logo](/assets/docs/mdedit-logo.png)\n\nbelow\n"; });
await page.waitForTimeout(400);

const fits = await page.evaluate(() => ({
  bar: document.querySelector(".mdedit__bar").scrollWidth <= document.querySelector(".mdedit__bar").clientWidth + 1,
  page: document.documentElement.scrollWidth <= window.innerWidth + 1,
  rows: new Set([...document.querySelectorAll(".mdedit__tool")].map(n => Math.round(n.getBoundingClientRect().top))).size,
  tap: (() => { const t = document.querySelector(".mdedit__tool"); const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
}));
ok("phone: the bar wraps to another row", fits.bar && fits.page, JSON.stringify(fits));
ok("phone: a tool is big enough to hit with a finger", fits.tap.w >= 28 && fits.tap.h >= 28, JSON.stringify(fits.tap));

// A tap on the picture opens the panel.
await page.locator(".mdedit__surface img.mdedit__pic").tap();
await page.waitForTimeout(400);
const opened = await page.evaluate(() => {
  const panel = document.querySelector(".mdedit__image");
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  return { caption: panel.querySelector("input")?.value, inWindow: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, width: Math.round(r.width), window: window.innerWidth };
});
ok("phone: a tap on the picture opens the panel", opened !== null, JSON.stringify(opened));
ok("phone: and the panel stands inside the screen", opened?.inWindow === true, JSON.stringify(opened));
ok("phone: it reads the caption the marker carries", opened?.caption === "a logo", JSON.stringify(opened?.caption));

// Writing on a phone: the virtual keyboard sends plain key events.
await page.evaluate(() => document.querySelector(".mdedit__image .mdedit__tool--image-done")?.click());
await page.evaluate(() => { const lines = [...document.querySelectorAll(".mdedit__surface > *")]; const last = lines[lines.length - 2]; const r = last.getBoundingClientRect(); window.__tapAt = [Math.round(r.left + 5), Math.round(r.top + r.height / 2)]; });
const at = await page.evaluate(() => window.__tapAt);
await page.touchscreen.tap(at[0], at[1]);
await page.waitForTimeout(150);
await page.keyboard.type("X");
await page.waitForTimeout(200);
const typed = await page.evaluate(() => window.editor.value);
ok("phone: a tap puts the caret where it landed and typing goes there", typed.split("\n").some((line) => line.includes("X") && line.includes("elow")), JSON.stringify(typed));

// A picture laid out left is not floated on a column this narrow.
await page.evaluate(() => { window.editor.value = "![a](/assets/docs/mdedit-logo.png#left)\n\nprose beside it that would have nowhere to go.\n"; });
await page.waitForTimeout(300);
const laid = await page.evaluate(() => { const s = getComputedStyle(document.querySelector(".mdedit__pic")); return { float: s.float, width: Math.round(document.querySelector(".mdedit__pic").getBoundingClientRect().width), column: Math.round(document.querySelector(".mdedit__surface").clientWidth) }; });
ok("phone: a floated picture takes the whole width", laid.float === "none", JSON.stringify(laid));

// ── the table menu, by finger ─────────────────────────────────────────────

await page.evaluate(() => {
	window.editor.value = "| dish | who |\n| --- | --- |\n| carbonara | guanciale |\n";
	window.editor.toggleMarks(true);
});
await page.waitForTimeout(400);

const cell = await page.evaluate(() => {
	const node = document.querySelector('.mdedit__widget--table [data-row="1"][data-column="0"]');
	const box = node.getBoundingClientRect();
	return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
});

// A long press: the finger goes down, stays still, and the menu opens under
// it without the finger lifting.
await page.touchscreen.tap(cell.x, cell.y);
await page.waitForTimeout(150);
await page.evaluate(
	([x, y]) => {
		const node = document.elementFromPoint(x, y);
		node.dispatchEvent(
			new PointerEvent("pointerdown", { pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }),
		);
	},
	[cell.x, cell.y],
);
await page.waitForTimeout(700);
const pressed = await page.evaluate(() => {
	const open = document.querySelector(".mdedit__menu");
	if (!open) return null;
	const box = open.getBoundingClientRect();
	const item = open.querySelector(".mdedit__menu-item").getBoundingClientRect();
	return {
		items: open.querySelectorAll(".mdedit__menu-item").length,
		inWindow: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
		rowHeight: Math.round(item.height),
	};
});
ok("phone: a long press on a cell opens the table menu", pressed !== null, JSON.stringify(pressed));
ok("phone: it carries the nine edits and stands on the screen", pressed?.items === 9 && pressed?.inWindow === true, JSON.stringify(pressed));
ok("phone: a menu row is big enough for a finger", pressed?.rowHeight >= 40, JSON.stringify(pressed?.rowHeight));

// Choosing from it writes the markdown.
await page.evaluate(() => document.querySelector(".mdedit__menu-item--row-add-below").click());
await page.waitForTimeout(350);
const added = await page.evaluate(() => window.editor.value);
ok(
	"phone: choosing a row from it writes the row",
	added.split("\n").filter((line) => line.startsWith("|")).length === 4,
	JSON.stringify(added),
);

// A finger that wanders is a scroll, not a press: no menu.
await page.evaluate(
	([x, y]) => {
		const node = document.elementFromPoint(x, y);
		node.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }));
		node.dispatchEvent(new PointerEvent("pointermove", { pointerType: "touch", clientX: x, clientY: y + 60, bubbles: true, cancelable: true }));
	},
	[cell.x, cell.y],
);
await page.waitForTimeout(700);
ok("phone: a finger that moves is a scroll and opens nothing", (await page.evaluate(() => document.querySelectorAll(".mdedit__menu").length)) === 0);

// A double tap opens it too, for anyone who does not hold still.
await page.touchscreen.tap(cell.x, cell.y);
await page.waitForTimeout(60);
await page.touchscreen.tap(cell.x, cell.y);
await page.waitForTimeout(400);
const tapped = await page.evaluate(() => document.querySelectorAll(".mdedit__menu").length);
ok("phone: a double tap opens it as well", tapped === 1, String(tapped));

// A tap elsewhere puts it away.
await page.touchscreen.tap(10, 10);
await page.waitForTimeout(300);
ok("phone: a tap outside puts it away", (await page.evaluate(() => document.querySelectorAll(".mdedit__menu").length)) === 0);

// Tab is not a key a phone has: the writer crosses the table by tapping,
// and a tap in a cell puts the caret there.
await page.evaluate(() => {
	const node = document.querySelector('.mdedit__widget--table [data-row="1"][data-column="1"]');
	node.focus();
});
await page.keyboard.type("!");
await page.waitForTimeout(200);
ok(
	"phone: typing in a cell reaches the markdown",
	/\|\s*!guanciale\s*\|/.test(await page.evaluate(() => window.editor.value)),
	JSON.stringify(await page.evaluate(() => window.editor.value)),
);

await page.screenshot({ path: "/tmp/shots/mdedit-phone.png", fullPage: true });
await browser.close();
console.log(problems.length === 0 ? "\nALL PASS" : `\n${problems.length} FAILING`);
if (problems.length) process.exitCode = 1;
