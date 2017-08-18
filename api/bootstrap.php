<?php

/** Custom response object adding CORS helper and JSON formatting */
class AppResponse extends Slim\Http\Response
{
	public function withJson($data, $status = null, $encodingOptions = 0)
	{
		return parent::withJson($data, $status, JSON_PRETTY_PRINT);
	}

	public function withCors() {
		return $this->withHeader('Access-Control-Allow-Origin', '*');
	}
}

/** Extend Slim App with actual app logic */
class App extends Slim\App
{
	protected $db = false;

	/** Constructor */
	public function __construct()
	{
		// Provide custom Response object
		parent::__construct(new Slim\Container(array(
			'response' => function () {
				return new AppResponse();
			}
		)));

		// allow CORS on options requests
		$this->options('/{name}', function($request, $response, $args) {
			return $response->withHeader('Access-Control-Allow-Origin', '*')
					->withHeader('Access-Control-Allow-Headers', array('Content-Type', 'X-Requested-With', 'Authorization'))
					->withHeader('Access-Control-Allow-Methods', array('GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'))
					->withHeader("Content-Type", "application/json")->withStatus(204);
		});
	}
}