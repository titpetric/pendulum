<template>
	<div class="index-page">
		<div class="container-fluid">
			<div class="row heading">
				<div class="col-12">
					<logo></logo> <b>{{ path }}</b>
				</div>
			</div>

			<div class="alert alert-danger" v-for="error in errors">{{error.message}}</div>

			<table class="table">
				<thead>
					<th>Name</th>
					<th class="tar">Last modified</th>
				</thead>
				<tbody>
					<tr v-for="item in files">
						<td v-if="item.type === 'dir'"><router-link :to="item.path"><i class="mdi mdi-folder-outline"></i> {{ item.name }}/</router-link></td>
						<td v-else><router-link :to="'/edit'+item.path"><i class="mdi mdi-file-document"></i> {{ item.name }}</router-link></td>
						<td class="tar">{{ item.last_modified }}</td>
					</tr>
				</tbody>
			</table>
		</div>
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

<style lang="scss">
.index-page {
	.container-fluid {
		padding-top: 1em;
		padding-bottom: 1em;
	}
	.heading {
		padding-bottom: 1em;
	}
}
</style>