<?php

if (!in_array("debug", $argv)) {
	echo "No no nooooo, you don't love me and I know now";
	exit;
}

include("vendor/autoload.php");
include("bootstrap.php");
include("api.php");

$api = new API;
$app = $api->get();

function request($method, $url) {
	global $app;
	$env = Slim\Http\Environment::mock([
		'REQUEST_METHOD' => strtoupper($method),
		'REQUEST_URI' => $url
	]);
	$req = Slim\Http\Request::createFromEnvironment($env);
	$app->getContainer()['request'] = $req;
	$response = $app->run(true);
	return json_decode((string)$response->getBody(), true);
}

var_dump(request("get", "/list"));
var_dump(request("get", "/list/folder"));
var_dump(request("get", "/read/folder/file2.txt"));

$_SERVER['REMOTE_ADDR'] = "127.0.0.1";
$_POST['contents'] = "Hello world " . date("H:i:s");
var_dump(request("post", "/store/folder/file2.txt"));

var_dump(request("post", "/store/subgit/hello.txt"));

exit;
