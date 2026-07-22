import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AssetWorkbenchPage from './pages/asset-workbench.vue'
import ArkAssetsPage from './pages/ark-assets.vue'
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
import AsrPage from './pages/tools/asr.vue'
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
    path: '/ark-assets',
    component: ArkAssetsPage,
    meta: { layout: 'default' }
  },
  {
    path: '/tools/video-enhance',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        type: 'video',
        view: 'create',
        mode: 'cloud'
      }
    })
  },
  {
    path: '/tools/enhance',
    component: EnhancePage,
    meta: { layout: 'default' }
  },
  {
    path: '/tools/asr',
    component: AsrPage,
    meta: { layout: 'default' }
  },
  {
    path: '/tools/local-video-enhance',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        type: 'video',
        view: 'create',
        mode: 'local'
      }
    })
  },
  {
    path: '/tools/local-enhance',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        view: 'create',
        mode: 'local'
      }
    })
  },
  {
    path: '/tools/video-enhance-tasks',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        type: 'video',
        view: 'tasks'
      }
    })
  },
  {
    path: '/tools/enhance-tasks',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        view: 'tasks'
      }
    })
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
        type: 'image',
        view: 'create',
        mode: 'cloud'
      }
    })
  },
  {
    path: '/tools/local-image-enhance',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        type: 'image',
        view: 'create',
        mode: 'local'
      }
    })
  },
  {
    path: '/tools/image-enhance-tasks',
    redirect: to => ({
      path: '/tools/enhance',
      query: {
        ...to.query,
        type: 'image',
        view: 'tasks'
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

    return true
  } catch {
    return {
      path: '/login',
      query: { redirect: to.fullPath }
    }
  }
})
