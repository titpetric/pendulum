<?php

class API {
	public $folder = false;
	public function __construct() {
		$this->folder = dirname(__DIR__) . "/contents";
	}

	public function get() {
		$respondWith = function($callback) {
			return function($request, $response, $args) use ($callback) {
				return $response->withCors()->withJson($callback($request, $args));
			};
		};

		$app = new App();
		$app->get("/list[{path:.*}]", $respondWith(array(&$this, "listFiles")));
		$app->get("/read[{path:.*}]", $respondWith(array(&$this, "readFile")));
		$app->post("/store[{path:.*}]", $respondWith(array(&$this, "storeFile")));
		$app->get("/[{path:.*}]", $respondWith(function() {
			return array("error" => array("message" => "Invalid route, my friend"));
		}));
		return $app;
	}

	/** Lists a folder contents, folders first in response */
	public function listFiles($request=false, $args = array()) {
		// Check [path] first
		$path = realpath($this->folder . (isset($args['path']) ? rtrim($args['path'], '/') : ""));
		if ($path === false || strpos($path, $this->folder) === false) {
			return array("error" => array("message" => "Directory traversal? For shame."));
		}
		// List passed path contents
		$response = array("folder" => str_replace($this->folder, "", $path . "/"), "files" => array());
		$paths = glob($path . '/*', GLOB_MARK);
		foreach ($paths as $k => $path) {
			$type = substr($path, -1) === '/' ? "dir" : "file";
			$name = basename($path);
			$path = str_replace($this->folder, "", $path);
			$paths[$k] = compact("type", "path", "name");
		}
		foreach ($paths as $path) {
			if ($path['type'] === "dir") {
				$response['files'][] = $path;
			}
		}
		foreach ($paths as $path) {
			if ($path['type'] === "file") {
				$response['files'][] = $path;
			}
		}
		return compact("response");
	}

	/** Retrieves a file contents with full path */
	public function readFile($request=false, $args = array()) {
		// Check [path] first
		$path = realpath($this->folder . (isset($args['path']) ? rtrim($args['path'], '/') : ""));
		if ($path === false || strpos($path, $this->folder) === false) {
			return array("error" => array("message" => "Directory traversal? For shame."));
		}
		if (!is_file($path)) {
			return array("error" => array("message" => "No such file."));
		}
		$response = [
			"name" => basename($path),
			"path" => str_replace($this->folder, "", $path),
			"contents" => file_get_contents($path)
		];
		return compact("response");
	}

	public function storeFile($request=false, $args = array()) {
		// Check [path] first
		$path = $this->folder . (isset($args['path']) ? rtrim($args['path'], '/') : "");
		// Only check that folder exists, realname will fail if no file (new file)
		$path_dir = realpath(dirname($path));
		if ($path_dir === false || strpos($path_dir, $this->folder) === false) {
			return array("error" => array("message" => "Directory traversal? For shame."));
		}

		if (!is_writable($path)) {
			return array("error" => array("message" => "Path/file not writable: " . str_replace($this->folder, "", $path)));
		}

		$contents = str_replace("\r", "", $_POST['contents']);
		file_put_contents($path, $contents);

		$path_relative = str_replace($this->folder . "/", "", $path);

		$folder = $path;
		$response = [
			"name" => basename($path),
			"path" => str_replace($this->folder, "", $path),
			"contents" => file_get_contents($path)
		];
		$i = 0;
		do {
			$folder = dirname($folder);
			// we went beyond root
			if (strpos($path, $this->folder) === false) {
				break;
			}
			// find a .git folder in directory traversal
			if (is_dir($folder . "/.git")) {
				chdir(dirname($path));
				$retval = array();
				exec("git add " . $response['name'], $retval);
				exec("git commit -m 'Edited online at " . date("r") . " from " . addslashes($_SERVER['REMOTE_ADDR']) . "@" . php_uname("n") . "'", $retval);
				$response['log'] = $retval;
				break;
			}
			$i++;
		} while (true && $i < 10 && !empty($folder));
		return compact("response");
	}
}
