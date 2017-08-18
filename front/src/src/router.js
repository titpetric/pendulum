import Vue from 'vue'
import VueRouter from 'vue-router'

Vue.use(VueRouter)

export default new VueRouter({
  mode: 'history',
  routes: [
    route('/edit/*', 'Edit'),
    route('*', 'Index')
  ]
})

/*
 * Converts path into route with component
 *
 * ~~~
 * path=/account/login -> component = views/Account/Login.vue
 * path=/ -> component = views/Index.vue
 * path=/, componentName=Landing -> component = views/Landing.vue
 * ~~~
 */
function route (path, componentName) {
  var result = { path: path }
  if (typeof componentName !== 'string') {
    componentName = path.substring(1).split('/')
    if (path.length === 1) {
      componentName = []
    }
    componentName = componentName.map(function (str) {
      return str.charAt(0).toUpperCase() + str.slice(1)
    })
    if (path.charAt(path.length - 1) === '/') {
      componentName.push('Index')
    }
    while (componentName[componentName.length - 1].charAt(0) === ':') {
      componentName.pop()
    }
    componentName = componentName.join('/')
  }
  result.component = view(componentName)
  result.meta = {
    componentName: componentName
  }
  return result
}

function view (name, resolve) {
  return function (resolve) {
    require(['./views/' + name + '.vue'], resolve)
  }
}
