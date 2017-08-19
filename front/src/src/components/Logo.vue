<template>
	<router-link class="logo" to="/">
		<i :class="'mdi mdi-' + options.logo_icon + ' logo-icon'"></i><span class="large-text">{{ options.title_short }}</span>
	</router-link>
</template>

<script>
import config from '@/api/config.json'

export default {
  data () {
    return {
      options: config.options
    }
  }
}
</script>

<style lang="scss">
a.logo {
	margin-right: 2em;
	&:hover {
		text-decoration: none;
	}
	.logo-icon {
	    color: #c44;
	    font-size: 1.5em;
	    margin-right: .1em;
	    vertical-align: -0.125em;
	    line-height: 1.0;
	}
	.large-text {
	    color: #c44;
	}
}
</style>
