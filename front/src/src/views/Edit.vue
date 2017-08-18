<template>
	<div class="edit-page">
		<front-header></front-header>

		<h3>Editing: {{ file.path }} {{ file.name }}

		<div class="alert alert-danger" v-for="error in errors">{{error.message}}</div>

		<div class="row">
			<div class="col-6">
				<textarea name="contents" :value="file.contents" @input="update"></textarea>
			</div>
			<div class="col-6">
				<div class="contents-preview" v-html="preview"></div>
			</div>
		</div>

		<front-footer></front-footer>
	</div>
</template>

<script>
import axios from 'axios'
import marked from 'marked'

export default {
  data () {
    return {
      file: {
        name: '',
        path: '',
        contents: ''
      },
      path: this.$route.path,
      errors: []
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
      this.file.contents = e.target.value
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

<style type="text/css" scoped>
textarea {
	width: 100%;
	min-height: 600px;
}
textarea,
.contents-preview {
	height: 70vh;
	border: 1px solid #ccc;
	border-radius: 5px;
	padding: 15px;
}

.contents-preview {
	max-height: 70vh;
	overflow-y: scroll;
}
</style>
