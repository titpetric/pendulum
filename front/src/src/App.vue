<template>
	<div id="app">
		<router-view class="view"></router-view>
	</div>
</template>
<script>
export default {
  created () {
    var development = (document.domain.indexOf('.lan') > -1)
    var hostname = development ? 'http://auth.' + document.domain : 'https://auth.cdn.si'
    this.$root.api = hostname
  }
}
</script>
