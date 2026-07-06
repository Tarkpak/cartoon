import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AssetWorkbenchPage from './pages/asset-workbench.vue'
import HomePage from './pages/index.vue'
import ImportVideoDetailPage from './pages/import/video-detail.vue'
import ImportVideoPage from './pages/import/video.vue'
import LoginPage from './pages/login.vue'
import LogsPage from './pages/logs.vue'
import ProjectRedirectPage from './pages/projects/[id].vue'
import ProjectsPage from './pages/projects/index.vue'
import SettingsPage from './pages/settings.vue'
import TosFilesPage from './pages/tos-files.vue'
import EnhancePage from './pages/tools/enhance.vue'
import EnhanceTasksPage from './pages/tools/enhance-tasks.vue'
import LocalEnhancePage from './pages/tools/local-enhance.vue'
import ShortVideoDownloadPage from './pages/tools/short-video-download.vue'

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
    path: '/import/video',
    component: ImportVideoPage,
    meta: { layout: 'default' }
  },
  {
    path: '/import/video/:id',
    component: ImportVideoDetailPage,
    meta: { layout: 'default' }
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
    path: '/tools/video-enhance',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        type: 'video'
      }
    })
  },
  {
    path: '/tools/enhance',
    component: EnhancePage,
    meta: { layout: 'default' }
  },
  {
    path: '/tools/local-video-enhance',
    redirect: to => ({
      path: '/tools/local-enhance',
      query: {
        ...to.query,
        type: 'video'
      }
    })
  },
  {
    path: '/tools/local-enhance',
    component: LocalEnhancePage,
    meta: { layout: 'default' }
  },
  {
    path: '/tools/video-enhance-tasks',
    redirect: to => ({
      path: '/tools/enhance-tasks',
      query: {
        ...to.query,
        type: 'video'
      }
    })
  },
  {
    path: '/tools/enhance-tasks',
    component: EnhanceTasksPage,
    meta: { layout: 'default' }
  },
  {
    path: '/tools/short-video-download',
    component: ShortVideoDownloadPage,
    meta: { layout: 'default' }
  },
  {
    path: '/tools/wx-channels-download',
    redirect: '/tools/short-video-download'
  },
  {
    path: '/tools/douyin-download',
    redirect: '/tools/short-video-download'
  },
  {
    path: '/tools/image-enhance',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        type: 'image'
      }
    })
  },
  {
    path: '/tools/local-image-enhance',
    redirect: to => ({
      path: '/tools/local-enhance',
      query: {
        ...to.query,
        type: 'image'
      }
    })
  },
  {
    path: '/tools/image-enhance-tasks',
    redirect: to => ({
      path: '/tools/enhance-tasks',
      query: {
        ...to.query,
        type: 'image'
      }
    })
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
      data?: {
        authenticated?: boolean
        wxChannels?: { hasYuanbaoCookie?: boolean }
      }
    }
    if (!statusPayload.data?.authenticated) {
      return {
        path: '/login',
        query: { redirect: to.fullPath }
      }
    }

    let cloudStatus = statusPayload.data
    if (!cloudBootstrapped || to.path === '/tools/short-video-download') {
      const bootstrapResponse = await fetch('/api/cloud/bootstrap', { method: 'POST' })
      if (!bootstrapResponse.ok) throw new Error('cloud bootstrap failed')
      const bootstrapPayload = await bootstrapResponse.json() as {
        success: boolean
        data?: {
          wxChannels?: { hasYuanbaoCookie?: boolean }
        }
      }
      cloudStatus = { ...cloudStatus, ...bootstrapPayload.data }
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
