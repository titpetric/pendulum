<template>
	<div class="index-page">
		<front-header></front-header>

		<h3>Currently browsing: {{ path }}

		<div class="alert alert-danger" v-for="error in errors">{{error.message}}</div>

		<table class="table">
			<thead>
				<th>Name</th>
			</thead>
			<tbody>
				<tr v-for="item in files">
					<td v-if="item.type === 'dir'"><router-link :to="item.path">{{ item.name }}</router-link></td>
					<td v-else><router-link :to="'/edit'+item.path">{{ item.name }}</router-link></td>
				</tr>
			</tbody>
		</table>

		<front-footer></front-footer>
	</div>
</template>

<script>
import axios from 'axios'

export default {
  data () {
    return {
      path: this.$route.path,
      errors: [],
      files: []
    }
  },
  beforeRouteLeave (to, from, next) {
    if (to.meta.componentName === 'Index') {
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
    loadContents (path, callback) {
      this.path = path
      var params = {}
      var link = '/api/list' + path
      return axios
        .get(link, params)
        .then(response => {
          console.log(response.data)
          if ('error' in response.data) {
            this.errors = [ response.data.error ]
          } else {
            this.files = response.data.response.files
          }
          if (typeof callback === 'function') {
            callback()
          }
        })
        .catch(err => {
          this.files = []
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
