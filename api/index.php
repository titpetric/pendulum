<?php

include("vendor/autoload.php");
include("bootstrap.php");
include("api.php");

$api = new API;
$api->get()->run();