var fs = require("fs");
var assert = require("assert");

//import markdown from 'index.js'
var markdown = require("./index.js");

describe('Markdown', function () {
  describe('Replacements', function () {

    var folder = '/test'

    it('should replace metadata', function () {
      var content = `title: 'The thing about dates'
date: 2017-08-16 18:00:00
tags: [golang, tips, tricks]
---

Adorable`;

      var contentExpected = `| Name | Value |
|------|-------|
| title |  'The thing about dates' |
| date |  2017-08-16 18 |
| tags |  [golang, tips, tricks] |
---

Adorable`

      contentNew = markdown.Transform(content, folder)

      assert.equal(contentNew, contentExpected)
    })

    it('should replace metadata image', function () {
      var content = `title: 'The thing about dates'
image: ../post/the-thing-about-dates/heading.jpg
---

Adorable`;

      var contentExpected = `| Name | Value |
|------|-------|
| title |  'The thing about dates' |
| image | ![](/contents/test/../post/the-thing-about-dates/heading.jpg) |
---

Adorable`

      contentNew = markdown.Transform(content, folder)

      assert.equal(contentNew, contentExpected)
    })

    it('should replace single quoted metadata image', function () {
      var content = `title: 'The thing about dates'
image: '../post/the-thing-about-dates/heading.jpg'
---

Adorable`;

      var contentExpected = `| Name | Value |
|------|-------|
| title |  'The thing about dates' |
| image | ![](/contents/test/../post/the-thing-about-dates/heading.jpg) |
---

Adorable`

      contentNew = markdown.Transform(content, folder)

      assert.equal(contentNew, contentExpected)
    })

    it('should replace double quoted metadata image', function () {
      var content = `title: 'The thing about dates'
image: "../post/the-thing-about-dates/heading.jpg"
---

Adorable`;

      var contentExpected = `| Name | Value |
|------|-------|
| title |  'The thing about dates' |
| image | ![](/contents/test/../post/the-thing-about-dates/heading.jpg) |
---

Adorable`

      contentNew = markdown.Transform(content, folder)

      assert.equal(contentNew, contentExpected)
    })

    it('should keep http/s images', function () {
        var content = '![](https://scene-si.org/post/2017-09-02-parsing-strings-with-go/heading.jpg)'
        var expected = '![](https://scene-si.org/post/2017-09-02-parsing-strings-with-go/heading.jpg)'
	assert.equal(markdown.Transform(content, folder), expected)
    })

    it('should replace image', function () {
	var content = '{% asset_img heading.jpg %} {% asset_img heading.jpg %}'
        var expected = '![](/contents/test/heading.jpg) ![](/contents/test/heading.jpg)'
	assert.equal(markdown.Transform(content, folder), expected)
    })

    it('should replace image with caption', function () {
	var content = '{% asset_img heading.jpg "caption one" %} {% asset_img heading.jpg \'caption two\' %}'
        var expected = '![caption one](/contents/test/heading.jpg) ![caption two](/contents/test/heading.jpg)'
	assert.equal(markdown.Transform(content, folder), expected)
    })

    it('should replace pagebreak from hugo', function () {
	var content = '<!--more--> <!--more-->'
        var expected = '<hr class="pagebreak"/> <hr class="pagebreak"/>'
	assert.equal(markdown.Transform(content, folder), expected)
    })

    it('should replace pagebreak from leanpub', function () {
	var content = '{pagebreak} {pagebreak}'
        var expected = '<hr class="pagebreak"/> <hr class="pagebreak"/>'
	assert.equal(markdown.Transform(content, folder), expected)
    })

    it('should replace cite from leanpub', function () {
	var content = 'A> this is a bordered citation using `A>` syntax'
	var expected = '> this is a bordered citation using `A>` syntax'
	assert.equal(markdown.Transform(content, folder), expected)
    })
  })
});

