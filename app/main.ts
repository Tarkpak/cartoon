import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { RouterLink } from 'vue-router'
import App from './app.vue'
import { router } from './router'
import './assets/css/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.component('NuxtLink', RouterLink)

app.mount('#app')
