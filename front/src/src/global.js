import Vue from 'vue'

// Global Axios defaults

import axios from 'axios'
axios.defaults.timeout = 15000

// Global Vue settings

Vue.config.productionTip = false

// Global Vue components

addComponents([
  'Logo'
])

/** Map component path into component name (Front/Header.vue -> <front-header>) */
function addComponents (components) {
  components.forEach(function (componentPath) {
    var name = componentPath.toLowerCase().replace('/', '-')
    Vue.component(name, component(componentPath))
  })
}

function component (name, resolve) {
  return function (resolve) {
    require(['./components/' + name + '.vue'], resolve)
  }
}
