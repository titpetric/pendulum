var markdown = {
  Transform: function (contents, folder) {
    contents = this.transformPageBreaks(contents)
    contents = this.transformMeta(contents)
    contents = this.transformLeanpub(contents)
    contents = this.transformHugo(contents)
    contents = this.transformImages(contents, folder)
    return contents
  },
  transformPageBreaks: function (contents) {
    var replacement = '<hr class="pagebreak"/>'
    contents = contents.replace(/<!--more-->/gi, replacement)
    contents = contents.replace(/{pagebreak}/gi, replacement)
    return contents
  },
  transformHugo: function(contents, folder) {
    contents = contents.replace(/{% asset_img ([^ ]+) %}/, '![]($1)')
    return contents
  },
  transformImages: function (contents, folder) {
    contents = contents.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, function (m, group) {
      if (m.match(/\]\(http/)) {
        return m
      }
      return m.replace('](', '](/contents' + folder + '/');
    })
    return contents
  },
  transformLeanpub: function (contents) {
    contents = contents.replace(/A>/g, '>')
    return contents
  },
  transformMeta: function (contents) {
    // hugo start of meta
    if (contents.substring(0,3) === '---') {
      contents = contents.substring(3)
    }
    // next token is end of meta
    if (contents.indexOf('---') === -1) {
      return contents
    }
    var parts = contents.split("---", 2)
    var heading = parts[0].trim().split("\n")
    var isMeta = true
    var headingTable = []
    headingTable.push('| Name | Value |')
    headingTable.push('|------|-------|')
    heading.forEach(function (row) {
      if (!isMeta) {
        return
      }
      var columns = row.split(':', 2)
      if (columns.length < 2) {
        isMeta = false
        return
      }
      headingTable.push('| ' + columns.join(' | ') + ' |')
    })
    if (!isMeta) {
      return contents;
    }
    parts[0] = headingTable.join("\n")
    return parts.join("\n---")
  }
}

if (typeof module === "object") {
	module.exports = Object.create(markdown);
}