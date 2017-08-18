<template>
	<header>
		<div :class="options.container">

			<div class="row">
				<div class="col-12">
					<div class="body">
						<router-link class="logo" to="/">
							<i :class="'mdi mdi-' + options.logo_icon + ' logo-icon'"></i><span class="large-text">{{ options.title_short }}</span>
						</router-link>

						<nav>

							<ul>
								<!-- <li v-for="item in menu" :class="item.class"><a :href="item.link" :class="item.link_class" :title="item.title">{{item.title}}</a></li> -->

								<router-link v-for="(item,index) in menu" :to="item.link" tag="li" :ref="item.title" :class="item.class">
									<a :class="item.link_class">
										<icon v-if="item.icon" :name="item.icon"></icon>
										<span>{{item.title}}</span>
									</a>
								</router-link>
							</ul>
						</nav>
					</div>
				</div>
			</div>
		</div>
	</header>
</template>

<script>
import menu from '@/api/menu.json'
import config from '@/api/config.json'

export default {
  data () {
    return {
      options: config.options,
      menu: menu['front']['header']
    }
  }
}
</script>

<style lang="scss" scoped>
header {
	box-shadow: 0 0px 15px 0 rgba(0,0,0,.25);
	.logo:hover {
		text-decoration: none;
	}

	.body {
		display: flex;
		flex-flow: row wrap;
	}

	nav {
		flex-grow: 1;
		align-self: center;
	}

	nav ul::after {
		content: '';
		flex-grow: 1;
		order: 0;
	}
	nav ul {
		display: flex;
		list-style: none;
		justify-content: flex-end;
		align-items: center;
		margin: 0 0 0 20px;
	}
	nav ul li {
		list-style: none;
		margin: 0 auto 0 1em;
	}
	nav ul li.right {
		order: 1;
	}
}
a.logo {
	&:hover {
		text-decoration: none;
	}
	.mdi {
		color: #c44;
		font-size: 2.5em;
	}
	.large-text {
		color: #c44;
		font-size: 1.5em;
		vertical-align: 0.28em;
	}
}
</style>
