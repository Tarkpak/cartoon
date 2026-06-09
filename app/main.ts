import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { RouterLink } from 'vue-router'
import App from './app.vue'
import { router } from './router'
import { installFrontendObservability } from './lib/observability'
import './assets/css/main.css'

const app = createApp(App)

installFrontendObservability(app)
app.use(createPinia())
app.use(router)
app.component('NuxtLink', RouterLink)

app.mount('#app')
