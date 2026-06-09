import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AppLogsPage from './pages/app-logs.vue'
import AssetWorkbenchPage from './pages/asset-workbench.vue'
import HomePage from './pages/index.vue'
import ModelLogsPage from './pages/model-logs.vue'
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
    path: '/model-logs',
    component: ModelLogsPage,
    meta: { layout: 'default' }
  },
  {
    path: '/app-logs',
    component: AppLogsPage,
    meta: { layout: 'default' }
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
