import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AssetWorkbenchPage from './pages/asset-workbench.vue'
import HomePage from './pages/index.vue'
import LoginPage from './pages/login.vue'
import LogsPage from './pages/logs.vue'
import ProjectRedirectPage from './pages/projects/[id].vue'
import ProjectsPage from './pages/projects/index.vue'
import SettingsPage from './pages/settings.vue'
import TosFilesPage from './pages/tos-files.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: LoginPage,
    meta: { layout: 'default', hideSidebar: true }
  },
  {
    path: '/',
    component: HomePage,
    meta: { layout: 'default' }
  },
  {
    path: '/projects',
    component: ProjectsPage,
    meta: { layout: 'default' }
  },
  {
    path: '/projects/:id',
    component: ProjectRedirectPage,
    meta: { layout: 'default', hideSidebar: true }
  },
  {
    path: '/asset-workbench',
    component: AssetWorkbenchPage,
    meta: { layout: 'default', hideSidebar: true }
  },
  {
    path: '/settings',
    component: SettingsPage,
    meta: { layout: 'default' }
  },
  {
    path: '/logs',
    component: LogsPage,
    meta: { layout: 'default' }
  },
  {
    path: '/model-logs',
    redirect: to => ({
      path: '/logs',
      query: {
        ...to.query,
        tab: 'model'
      }
    })
  },
  {
    path: '/app-logs',
    redirect: to => ({
      path: '/logs',
      query: {
        ...to.query,
        tab: 'system'
      }
    })
  },
  {
    path: '/tos-files',
    component: TosFilesPage,
    meta: { layout: 'default' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

let cloudBootstrapped = false

router.beforeEach(async (to) => {
  if (to.path === '/login') return true

  try {
    const statusResponse = await fetch('/api/cloud/status')
    if (!statusResponse.ok) throw new Error('cloud status failed')
    const statusPayload = await statusResponse.json() as {
      success: boolean
      data?: { authenticated?: boolean }
    }
    if (!statusPayload.data?.authenticated) {
      return {
        path: '/login',
        query: { redirect: to.fullPath }
      }
    }

    if (!cloudBootstrapped) {
      const bootstrapResponse = await fetch('/api/cloud/bootstrap', { method: 'POST' })
      if (!bootstrapResponse.ok) throw new Error('cloud bootstrap failed')
      cloudBootstrapped = true
    }

    return true
  } catch {
    return {
      path: '/login',
      query: { redirect: to.fullPath }
    }
  }
})
