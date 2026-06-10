import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AssetWorkbenchPage from './pages/asset-workbench.vue'
import HomePage from './pages/index.vue'
import LogsPage from './pages/logs.vue'
import ProjectRedirectPage from './pages/projects/[id].vue'
import ProjectsPage from './pages/projects/index.vue'
import SettingsPage from './pages/settings.vue'
import TosFilesPage from './pages/tos-files.vue'

const routes: RouteRecordRaw[] = [
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
