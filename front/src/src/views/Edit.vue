<template>
	<div class="edit-page">
		<div class="container-fluid">

			<div class="alert alert-danger" v-for="error in errors">{{error.message}}</div>

			<div class="row heading">
				<div class="col-12">
					<logo></logo> <b class="legend">{{ file.path }}</b>
					<div class="actions">
						<button @click="save" class="btn btn-primary btn-sm">Save</button>
						<button @click="close" class="btn btn-secondary btn-sm">Close</button>
					</div>
				</div>
			</div>

			<div class="row fill-height">
				<div class="col-6">
					<textarea name="contents" class="form-control textarea" v-model="file.contents" @scroll="updateScrollTextarea" @input="update"></textarea>
				</div>
				<div class="col-6">
					<div class="preview" v-html="preview" @scroll="updateScrollPreview"></div>
				</div>
			</div>
		</div>
	</div>
</template>

<script>
import axios from 'axios'
import marked from 'marked'

var debounce = require('lodash.debounce')

export default {
  data () {
    return {
      file: {
        dir: '',
        name: '',
        path: '',
        contents: ''
      },
      path: this.$route.path,
      errors: [],
      cancelScroll: false,
      saved: true
    }
  },
  computed: {
    preview: function () {
      var contents = this.file.contents
      contents = contents.replace(/!\[\]\(/g, '![](/contents' + this.file.dir + '/')
      // Leanpub markdown
      contents = contents.replace(/A>/g, '>')
      window.contents = contents
      console.log(contents)
      return marked(contents, { sanitize: true })
    }
  },
  beforeRouteLeave (to, from, next) {
    if (to.meta.componentName === 'Edit') {
      this.loadContents(to.path, next)
    } else {
      next()
    }
  },
  beforeRouteUpdate (to, from, next) {
    this.loadContents(to.path, next)
  },
  created () {
    this.loadContents(this.$route.path)
  },
  methods: {
    update (e) {
      this.saved = false
      this.cancelScroll = false
      this.updateScrollTextarea()
    },
    updateScrollTextarea: debounce(function () {
      if (this.cancelScroll) {
        this.cancelScroll = false
        return
      }
      this.cancelScroll = true
      var friend = this.$el.querySelector('.preview')
      var self = this.$el.querySelector('.textarea')
      var offset = self.scrollTop / (self.scrollHeight - self.clientHeight)
      friend.scrollTop = (friend.scrollHeight - friend.clientHeight) * offset
    }, 10),
    updateScrollPreview: debounce(function (e) {
      if (this.cancelScroll) {
        this.cancelScroll = false
        return
      }
      this.cancelScroll = true
      var friend = this.$el.querySelector('.textarea')
      var self = this.$el.querySelector('.preview')
      var offset = self.scrollTop / (self.scrollHeight - self.clientHeight)
      friend.scrollTop = (friend.scrollHeight - friend.clientHeight) * offset
    }, 10),
    save () {
      this.saveContents(this.$route.path)
    },
    close () {
      if (this.saved || confirm('You have unsaved changes, discard them?')) {
        this.$router.go(-1)
      }
    },
    saveContents (path, callback) {
      this.path = path
      this.errors = []
      var params = new FormData()
      params.append('contents', this.file.contents)
      var link = '/api/store' + path.replace('edit/', '')
      return axios
        .post(link, params)
        .then(response => {
          if ('error' in response.data) {
            this.errors = [ response.data.error ]
          } else {
            this.saved = true
          }
          if (typeof callback === 'function') {
            callback()
          }
        })
        .catch(err => {
          this.errors = [
            { message: err }
          ]
          if (typeof callback === 'function') {
            callback()
          }
        })
    },
    loadContents (path, callback) {
      this.path = path
      this.errors = []
      var params = {}
      var link = '/api/read' + path.replace('edit/', '')
      return axios
        .get(link, params)
        .then(response => {
          if ('error' in response.data) {
            this.errors = [ response.data.error ]
          } else {
            this.file = response.data.response
          }
          if (typeof callback === 'function') {
            callback()
          }
        })
        .catch(err => {
          this.file = { name: '', path: '', contents: '' }
          this.errors = [
            { message: err }
          ]
          if (typeof callback === 'function') {
            callback()
          }
        })
    }
  }
}
</script>

<style lang="scss">
.edit-page {
	.container-fluid {
		height: 100vh;
		display: flex;
		flex-direction: column;
		padding-top: 1em;
		padding-bottom: 1em;
	}
	.fill-height {
		flex: 1;
	}
	.textarea, .textarea:focus {
		background: #263238;
		color: #eee;
		width: 100%;
		font-family: monospace;
	}
	.textarea, .preview {
		height: 100%;
		border: 1px solid #ccc;
		border-radius: 5px;
		padding: 15px;
	}
	.preview {
		overflow-y: scroll;
		img {
			max-width: 100%;
		}
		blockquote {
			border-left: 3px solid #ccc;
			padding-left: 10px;
		}
		code {
			background: #eee;
			color: #933;
			padding: 2px 4px;
		}
		pre > code {
			background: #263238;
			color: #eee;
			font-size: 0.9em;
			line-height: 1.2;
			display: block;
			padding: 10px;
			border-radius: 3px;
			border: 1px solid #ccc;
		}
	}
	.heading {
		padding-bottom: 1em;
	}
	.actions {
		float: right;
	}
}
</style>
