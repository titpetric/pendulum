// Where the browser is. Playwright is not a dependency of this project -
// there is no package.json to put it in - so a machine that has one points
// at it, and the suites import chromium from here:
//
//	PLAYWRIGHT=/path/to/playwright/index.mjs   the module
//	CHROMIUM=/usr/lib/chromium/chromium        the browser it drives
//
// Both are read by `atkins test`, which also serves demo/data for the
// suites to edit.

const module = await import(process.env.PLAYWRIGHT ?? "playwright").catch(() => {
	console.error(
		"playwright is not installed here. Point PLAYWRIGHT at the module and CHROMIUM at the browser:\n" +
			"  PLAYWRIGHT=/path/to/playwright/index.mjs CHROMIUM=/usr/lib/chromium/chromium atkins test",
	);
	process.exit(1);
});

const browser = module.chromium;

// launch answers the browser with the project's own executable where the
// machine named one, so a suite calls chromium.launch() and gets it.
export const chromium = {
	launch: (options = {}) =>
		browser.launch({
			executablePath: process.env.CHROMIUM || options.executablePath || undefined,
			...options,
			...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
		}),
};

export const devices = module.devices;
