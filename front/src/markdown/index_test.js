var fs = require("fs");
var assert = require("assert");

//import markdown from 'index.js'
var markdown = require("./index.js");

describe('Markdown', function(){
  describe('Replacements', function(){

    it('should replace metadata', function(){
      var contents = `title: 'The thing about dates'
date: 2017-08-16 18:00:00
tags: [golang, tips, tricks]
---

Adorable`;

      var contentsExpected = `| Name | Value |
|------|-------|
| title |  'The thing about dates' |
| date |  2017-08-16 18 |
| tags |  [golang, tips, tricks] |
---

Adorable`

      contentsNew = markdown.Transform(contents)

      assert.equal(contentsNew, contentsExpected)
    })

    it('should replace image', function(){
	var content = '{% asset_img heading.jpg %}'
        var expected = '![](heading.jpg)'
	assert.equal(markdown.Transform(content), expected)
    }) 

    it('should replace pagebreak from hugo', function(){
	var content = '<!--more--> <!--more-->'
        var expected = '<hr class="pagebreak"/> <hr class="pagebreak"/>'
	assert.equal(markdown.Transform(content), expected)
    }) 

    it('should replace pagebreak from leanpub', function(){
	var content = '{pagebreak} {pagebreak}'
        var expected = '<hr class="pagebreak"/> <hr class="pagebreak"/>'
	assert.equal(markdown.Transform(content), expected)
    }) 

  })
});

