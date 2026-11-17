<?php

// The mdedit demo server: the index of the markdown under a folder, the editor
// over one of those files, and the images that editor uploads.
//
//	phpscript mdedit.php                 # this folder, on 127.0.0.1:8088
//	phpscript mdedit.php demo/data       # another folder
//	phpscript mdedit.php demo/data :9000 # another address
//
// phpscript roots the filesystem at the directory it starts in, so every path
// here is root relative and the folder has to sit under that directory. For
// markdown that lives elsewhere, symlink it in: a symlink out of the root
// resolves.
//
// The upload contract: the page carries the endpoint and a token minted at
// boot, the editor posts one file per request as multipart field "file", and
// this side names what it stores. The name is a ulid and the extension comes
// from the declared type, so the name the browser sent reaches nothing but the
// <ulid>.json sidecar beside the file. One upload answers {"url": ...}.
function main($argv) {
	$app = new Mdedit($argv);

	$mux = new HTTP\Mux;

	// '{$}' anchors the root: a bare "GET /" is a net/http subtree and would
	// answer for every path nothing else claimed.
	$mux->handle('GET /{$}', $app->index);
	$mux->handle("GET /edit", $app->edit);
	$mux->handle("POST /new", $app->create);
	$mux->handle("POST /save", $app->save);
	$mux->handle("POST /upload", $app->upload);
	$mux->handle("GET /uploads/{name}", $app->serveUpload);
	$mux->handle("GET /assets/{path...}", $app->serveAsset);
	$mux->handle("GET /favicon.ico", $app->favicon);

	// This process is the server and runs until Ctrl-C, where a
	// max_execution_time would stop it mid-session.
	set_time_limit(0);

	$http = new HTTP\Server($app->addr, $mux, 4, 64);

	$http->listen();

	register_shutdown_function(function() use ($http) {
		$http->shutdown();
		echo "server stopped\n";
	});

	echo "mdedit serving ", issetor($app->dir, "/"), " on http://", $http->addr(), "\n";
	echo "uploads land in ", $app->uploads, "\n";

	$http->wait();
}

class Mdedit {
	// The folder of markdown, root relative: "" is the directory phpscript
	// started in, "/demo/data" one below it.
	public $dir = "";
	public $uploads = "";
	public $assets = "";
	public $addr = "127.0.0.1:8088";
	public $token = "";

	// What an upload may be, and the extension each type lands under.
	public $images = array(
		"image/png" => "png",
		"image/jpeg" => "jpg",
		"image/gif" => "gif",
		"image/webp" => "webp",
		"image/svg+xml" => "svg",
	);

	public $types = array(
		"css" => "text/css; charset=utf-8",
		"js" => "text/javascript; charset=utf-8",
		"json" => "application/json",
		"svg" => "image/svg+xml",
		"png" => "image/png",
		"jpg" => "image/jpeg",
		"jpeg" => "image/jpeg",
		"gif" => "image/gif",
		"webp" => "image/webp",
		"md" => "text/markdown; charset=utf-8",
		"html" => "text/html; charset=utf-8",
	);

	function __construct($argv) {
		$dir = trim(issetor($argv[1], "."), "/");
		$this->dir = $dir == "." ? "" : "/" . $dir;
		$this->addr = issetor($argv[2], $this->addr);
		$this->uploads = $this->dir . "/uploads";
		$this->assets = rtrim(__DIR__, "/");
		$this->token = ulid();

		if (!is_dir($this->uploads)) {
			mkdir($this->uploads, 493, true);
		}
	}

	function index($w, $r) {
		$files = $this->files();

		$this->head($w, "mdedit");
		echo '<main class="page">', "\n";
		echo "<h1>mdedit</h1>\n";
		echo "<p class=\"lede\">Markdown under <code>", htmlspecialchars(issetor($this->dir, "/")), "</code>. ";
		echo "Open one to write; paste an image to upload it.</p>\n";

		if (count($files) == 0) {
			echo "<p>No markdown here yet.</p>\n";
		} else {
			echo '<ul class="files">', "\n";
			foreach ($files as $entry) {
				echo '<li><a href="/edit?file=', htmlspecialchars(urlencode($entry["file"])), '">';
				echo htmlspecialchars($entry["file"]), "</a> <span>", $entry["size"], " bytes</span></li>\n";
			}

			echo "</ul>\n";
		}

		echo '<form class="new" method="post" action="/new">', "\n";
		echo '<label for="file">New file</label>', "\n";
		echo '<input id="file" name="file" value="notes.md" spellcheck="false">', "\n";
		echo '<button type="submit">Create</button>', "\n";
		echo "</form>\n";
		echo "</main>\n</body></html>\n";
	}

	function edit($w, $r) {
		$file = $r->url->query()->get("file");
		$path = $this->path($file);
		if ($path == "" || !is_file($path)) {
			$this->head($w, "Not found", 404);
			echo '<main class="page"><h1>Not found</h1><p><a href="/">Back to the index</a></p></main>', "\n";
			echo "</body></html>\n";
			return;
		}

		$body = file_get_contents($path);

		$this->head($w, $file . " - mdedit");
		echo '<main class="page page--wide">', "\n";
		echo '<p class="crumbs"><a href="/">&larr; index</a> <code>', htmlspecialchars($file), "</code></p>\n";
		echo '<form id="editor" method="post" action="/save">', "\n";
		echo '<textarea id="body" name="body" rows="24" data-markdown>', htmlspecialchars($body), "</textarea>\n";
		echo '<div class="actions"><button type="submit">Save</button> <span id="status" role="status"></span></div>', "\n";
		echo "</form>\n";
		// demo/demo.js reads the settings of the page out of this block.
		echo '<script type="application/json" id="config">';
		echo json_encode(array(
			"file" => $file,
			"save" => "/save",
			"upload" => "/upload",
			"token" => $this->token,
		));
		echo "</script>\n";
		echo '<script type="module" src="/assets/demo/demo.js"></script>', "\n";
		echo "</main>\n</body></html>\n";
	}

	function create($w, $r) {
		$file = $r->form_value("file");
		$path = $this->path($file);
		if ($path == "") {
			$w->write_header(422);
			$w->write("a file name has to end in .md\n");
			return;
		}

		$folder = dirname($path);
		if (!is_dir($folder)) {
			mkdir($folder, 493, true);
		}

		if (!is_file($path)) {
			file_put_contents($path, "# " . basename($file, ".md") . "\n\n");
		}

		$w->header()->set("Location", "/edit?file=" . urlencode(trim($file, "/")));
		$w->write_header(303);
	}

	function save($w, $r) {
		$w->header()->set("Content-Type", "application/json");
		$answer = new JSON\Encoder($w);

		$path = $this->path($r->form_value("file"));
		if ($path == "" || !is_file($path)) {
			$w->write_header(404);
			$answer->encode(array("error" => "no such file"));
			return;
		}

		$written = file_put_contents($path, $r->form_value("body"));
		if ($written === false) {
			$w->write_header(500);
			$answer->encode(array("error" => "the file could not be written"));
			return;
		}

		$answer->encode(array("bytes" => $written));
	}

	function upload($w, $r) {
		$w->header()->set("Content-Type", "application/json");
		$answer = new JSON\Encoder($w);

		if ($r->header->get("Authorization") != "Bearer " . $this->token) {
			$w->write_header(401);
			$answer->encode(array("error" => "that upload token is not this server's"));
			return;
		}

		$r->parse_multipart_form(8 * 1024 * 1024);
		$form = $r->multipart_form;
		$parts = issetor($form->File["file"], array());
		if (count($parts) == 0) {
			$w->write_header(422);
			$answer->encode(array("error" => "no file arrived under 'file'"));
			return;
		}

		$part = $parts[0];
		$declared = issetor($part->Header["Content-Type"][0], "");
		if (!isset($this->images[$declared])) {
			$w->write_header(415);
			$answer->encode(array("error" => "that file type is not an image this server stores"));
			return;
		}

		$bytes = stream_get_contents($part->open());
		$id = ulid();
		$name = $id . "." . $this->images[$declared];
		$written = file_put_contents($this->uploads . "/" . $name, $bytes);
		if ($written === false) {
			$w->write_header(500);
			$answer->encode(array("error" => "the upload could not be stored"));
			return;
		}

		// The sidecar holds what the request carried, the sent name among it:
		// the server's business, never the document's.
		file_put_contents($this->uploads . "/" . $id . ".json", json_encode(array(
			"name" => $name,
			"original" => basename($part->Filename),
			"content_type" => $declared,
			"size" => $written,
			"sha256" => hash("sha256", $bytes),
			"stored_at" => DateTime::now()->utc()->format(TIME_RFC3339),
		)));

		$answer->encode(array("url" => "/uploads/" . $name));
	}

	function serveUpload($w, $r) {
		$name = $r->path_value("name");
		if (!preg_match('~^[0-9A-Z]{26}\.[a-z]{3,4}$~', $name)) {
			$w->write_header(404);
			return;
		}

		$this->serve($w, $this->uploads . "/" . $name);
	}

	function serveAsset($w, $r) {
		$path = trim($r->path_value("path"), "/");
		if (str_contains($path, "..") || !preg_match('~^(dist|demo|src|docs)/[A-Za-z0-9._/-]+$~', $path)) {
			$w->write_header(404);
			return;
		}

		$this->serve($w, $this->assets . "/" . $path);
	}

	function favicon($w, $r) {
		$w->write_header(204);
	}

	// files lists the markdown under the folder as paths relative to it,
	// shallow first and alphabetical within a level. A glob '*' matches one
	// level, so the walk globs each folder it finds. The uploads folder holds
	// what this server stores, never a document, so it stays out of the index.
	function files() {
		$found = array();
		$folders = array($this->dir);

		while (count($folders) > 0) {
			$folder = array_shift($folders);
			foreach (glob($folder . "/*") as $path) {
				if ($path == $this->uploads) {
					continue;
				}

				if (is_dir($path)) {
					$folders[] = $path;
					continue;
				}

				if (str_ends_with($path, ".md")) {
					$found[] = array(
						"file" => substr($path, strlen($this->dir) + 1),
						"size" => filesize($path),
					);
				}
			}
		}

		return $found;
	}

	// path answers the readable path for a ?file= value, or "" for a value this
	// server will not touch: markdown, under the folder, no traversal.
	function path($file) {
		$file = trim($file, "/");
		if (str_contains($file, "..") || !str_ends_with($file, ".md") || !preg_match('~^[A-Za-z0-9._/-]+$~', $file)) {
			return "";
		}

		return $this->dir . "/" . $file;
	}

	// head writes the status and everything above the page's own markup. The
	// head sets the content type before write_header, or the status freezes the
	// headers first and the browser learns nothing about the body.
	function head($w, $title, $status = 200) {
		$w->header()->set("Content-Type", "text/html; charset=utf-8");
		if ($status != 200) {
			$w->write_header($status);
		}

		echo '<!DOCTYPE html>', "\n";
		echo '<html lang="en"><head><meta charset="utf-8">', "\n";
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">', "\n";
		echo "<title>", htmlspecialchars($title), "</title>\n";
		echo '<link rel="stylesheet" href="/assets/dist/mdedit.css">', "\n";
		echo '<link rel="stylesheet" href="/assets/demo/demo.css">', "\n";
		echo "</head><body>\n";
	}

	function serve($w, $path) {
		if (!is_file($path)) {
			$w->write_header(404);
			$w->write("not found\n");
			return;
		}

		$extension = strtolower(issetor(pathinfo($path)["extension"], ""));

		$w->header()->set("Content-Type", issetor($this->types[$extension], "application/octet-stream"));
		$w->write(file_get_contents($path));
	}
}

// issetor returns the first parameter with a value, and the last one when none
// of them qualified. phpscript has no ?? operator, and a missing read - an
// absent key, an absent property - arrives here as null:
//
//	issetor($argv[1], ".")                 // "." when the caller names no folder
//	issetor($form->File["file"], array())  // the parts, or none
//
// The tail is the caller's stated fallback, so "" answers even though it does
// not qualify on its own. null is what an unset read arrives as, not a
// fallback, so it answers false - as does a call with no arguments.
function issetor() {
	$args = func_get_args();
	foreach ($args as $arg) {
		if (is_string($arg) && strlen($arg) > 0) {
			return $arg;
		}

		if (is_int($arg) || is_array($arg)) {
			return $arg;
		}

		if (!empty($arg)) {
			return $arg;
		}
	}

	if (count($args) === 0) {
		return false;
	}

	$fallback = end($args);
	if ($fallback === null) {
		return false;
	}

	return $fallback;
}

main($argv);
