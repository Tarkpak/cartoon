import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { RouterLink } from 'vue-router'
import App from './app.vue'
import { router } from './router'
import { installFrontendObservability } from './lib/observability'
import './assets/css/main.css'

function applyInitialTheme() {
  if (typeof window === 'undefined') return

  const saved = window.localStorage.getItem('theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = saved === 'light' || saved === 'dark'
    ? saved
    : prefersDark ? 'dark' : 'light'
  const root = document.documentElement

  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

applyInitialTheme()

const app = createApp(App)

installFrontendObservability(app)
app.use(createPinia())
app.use(router)
app.component('NuxtLink', RouterLink)

app.mount('#app')
