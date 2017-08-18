<template>
	<div class="edit-page">
		<front-header></front-header>

		<div class="container-fluid">

			<div class="alert alert-danger" v-for="error in errors">{{error.message}}</div>


			<div class="row heading">
				<div class="col-12">
					<b class="legend">Editing: {{ file.path }} {{ file.name }}</b>
					<button @click="save" class="btn btn-primary btn-sm">Save</button>
				</div>
			</div>
			<div class="row">
				<div class="col-6">
					<textarea name="contents" class="form-control textarea" v-model="file.contents" @scroll="updateScrollTextarea" @input="update"></textarea>
				</div>
				<div class="col-6">
					<div class="preview" v-html="preview" @scroll="updateScrollPreview"></div>
				</div>
			</div>
		</div>

		<front-footer></front-footer>
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
        name: '',
        path: '',
        contents: ''
      },
      path: this.$route.path,
      errors: [],
      cancelScroll: false
    }
  },
  computed: {
    preview: function () {
      return marked(this.file.contents, { sanitize: true })
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
      // this.file.contents = e.target.value
      console.log('typing...')
      this.cancelScroll = false
      this.updateScrollTextarea()
    },
    updateScrollTextarea: debounce(function () {
      if (this.cancelScroll) {
        this.cancelScroll = false
        return
      }
      this.cancelScroll = true
      console.log('textarea')
      var friend = this.$el.querySelector('.preview')
      var self = this.$el.querySelector('.textarea')
      var offset = self.scrollTop / self.scrollHeight
      friend.scrollTop = friend.scrollHeight * offset
    }, 10),
    updateScrollPreview: debounce(function (e) {
      if (this.cancelScroll) {
        this.cancelScroll = false
        return
      }
      this.cancelScroll = true
      console.log('preview')
      var friend = this.$el.querySelector('.textarea')
      var offset = self.scrollTop / self.scrollHeight
      friend.scrollTop = friend.scrollHeight * offset
    }, 10),
    save (e) {
      console.log(this.file)
    },
    loadContents (path, callback) {
      this.path = path
      var params = {}
      var link = '/api/read' + path.replace('edit/', '')
      return axios
        .get(link, params)
        .then(response => {
          console.log(response.data)
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
		padding-top: 1em;
		padding-bottom: 1em;
	}
	textarea {
		width: 100%;
		min-height: 600px;
	}
	textarea, .preview {
		height: 70vh;
		border: 1px solid #ccc;
		border-radius: 5px;
		padding: 15px;
	}
	.preview {
		max-height: 70vh;
		overflow-y: scroll;
		img {
			max-width: 100%;
		}
	}
	.heading {
		padding-bottom: 1em;
	}
	.btn-primary {
		float: right;
	}
}
</style>
