import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  AutoStageKey,
  AutoStageStatus,
  QueueItem,
  QueueSummary,
  SceneVideoBadge
} from '~/lib/asset-workbench-types'

export const AUTO_STAGE_HINTS: Record<AutoStageKey, string> = {
  parse: '粘贴剧本后点击解析，系统会自动拆分场景并补齐资产规划。',
  assets: '默认自动补齐资产；也支持用户手动上传角色图、环境图、道具图并随时替换。',
  videos: '批量生成场景视频并自动重试失败场景一次；生成效果不理想时可拆分或合并场景后再重试。',
  final: '合成并下载最终视频（可选）。'
}

export function buildQueueSummary(queueItems: QueueItem[]): QueueSummary {
  const total = queueItems.length
  const running = queueItems.filter(item => item.status === 'running').length
  const done = queueItems.filter(item => item.status === 'done').length
  const error = queueItems.filter(item => item.status === 'error').length

  return { total, running, done, error }
}

export function resolveAutoStageStatus(options: {
  key: AutoStageKey
  done: boolean
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
}): AutoStageStatus {
  if (options.done) return 'done'
  if (options.autoRunning && options.autoRunCurrentStage === options.key) return 'running'
  return 'pending'
}

export function buildAutoStages(options: {
  hasScenes: boolean
  assetsReady: boolean
  videosDone: boolean
  finalDone: boolean
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
}): Array<{ key: AutoStageKey, label: string, status: AutoStageStatus }> {
  return [
    {
      key: 'parse',
      label: '剧本解析',
      status: resolveAutoStageStatus({
        key: 'parse',
        done: options.hasScenes,
        autoRunning: options.autoRunning,
        autoRunCurrentStage: options.autoRunCurrentStage
      })
    },
    {
      key: 'assets',
      label: '资产准备',
      status: resolveAutoStageStatus({
        key: 'assets',
        done: options.hasScenes && options.assetsReady,
        autoRunning: options.autoRunning,
        autoRunCurrentStage: options.autoRunCurrentStage
      })
    },
    {
      key: 'videos',
      label: '场景视频',
      status: resolveAutoStageStatus({
        key: 'videos',
        done: options.videosDone,
        autoRunning: options.autoRunning,
        autoRunCurrentStage: options.autoRunCurrentStage
      })
    },
    {
      key: 'final',
      label: '最终成片',
      status: resolveAutoStageStatus({
        key: 'final',
        done: options.finalDone,
        autoRunning: options.autoRunning,
        autoRunCurrentStage: options.autoRunCurrentStage
      })
    }
  ]
}

export function inferActiveAutoStage(options: {
  hasScenes: boolean
  assetsReady: boolean
  queueSummary: QueueSummary
}): AutoStageKey {
  if (!options.hasScenes) return 'parse'
  if (!options.assetsReady) return 'assets'
  if (
    options.queueSummary.total === 0
    || options.queueSummary.done < options.queueSummary.total
  ) {
    return 'videos'
  }
  return 'final'
}

export function buildNextQueueItems(
  scenes: SceneData[],
  queueItems: QueueItem[]
): QueueItem[] {
  const previousMap = new Map(queueItems.map(item => [item.sceneId, item]))

  return scenes.map((scene) => {
    const previous = previousMap.get(scene.id)
    if (!previous) {
      return {
        sceneId: scene.id,
        status: scene.videoStatus === 'done' ? 'done' : 'pending'
      }
    }

    if (scene.videoStatus === 'done') {
      return { ...previous, status: 'done', error: undefined }
    }

    if (previous.status === 'done') {
      return { ...previous, status: 'pending', error: undefined }
    }

    return previous
  })
}

function isSceneQueueRunning(sceneId: string, queueItems: QueueItem[]): boolean {
  return queueItems.some(item => item.sceneId === sceneId && item.status === 'running')
}

export function isScenePreparing(scene: SceneData, queueItems: QueueItem[]): boolean {
  return isSceneQueueRunning(scene.id, queueItems) && scene.videoStatus !== 'generating'
}

export function isSceneBusy(scene: SceneData, queueItems: QueueItem[]): boolean {
  return scene.referenceStatus === 'generating'
    || scene.videoStatus === 'generating'
    || isSceneQueueRunning(scene.id, queueItems)
}

export function resolveSceneVideoBadge(
  scene: SceneData,
  queueItems: QueueItem[]
): SceneVideoBadge {
  if (scene.videoStatus === 'done') {
    return { variant: 'secondary', label: '视频完成' }
  }
  if (scene.videoStatus === 'error') {
    return { variant: 'destructive', label: '视频失败' }
  }
  if (scene.videoStatus === 'generating') {
    return { variant: 'default', label: '视频生成中' }
  }
  if (isScenePreparing(scene, queueItems)) {
    return { variant: 'default', label: '准备中' }
  }
  return { variant: 'outline', label: '待生成' }
}
