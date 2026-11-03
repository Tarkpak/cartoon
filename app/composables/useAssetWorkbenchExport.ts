import { ref, type Ref } from 'vue'
import { useToast } from '~/composables/useToast'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { FinalMergeOptions } from '~/lib/asset-workbench-types'
import {
  exportAssetWorkbenchJianyingProject,
  exportAssetWorkbenchScriptDocx
} from '~/lib/asset-workbench-api'

/** Downloads: the Jianying (CapCut) project of the final cut and the formatted script DOCX. */
export function useAssetWorkbenchExport(options: {
  projectId: Ref<string | undefined>
  projectName: Ref<string>
  projectAspectRatio: Ref<'16:9' | '9:16' | '1:1'>
  scenes: Ref<SceneData[]>
  finalStageSceneOrder: Ref<string[]>
  finalStageMergeOptions: Ref<FinalMergeOptions>
  resolveUiError: (error: unknown, fallback: string) => string
}) {
  const {
    projectId,
    projectName,
    projectAspectRatio,
    scenes,
    finalStageSceneOrder,
    finalStageMergeOptions,
    resolveUiError
  } = options
  const { toast } = useToast()
  const exportingScriptDocx = ref(false)
  const exportingJianyingProject = ref(false)

  function downloadBlobFile(blob: Blob, fileName: string) {
    if (typeof window === 'undefined') return

    const objectUrl = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(objectUrl)
  }

  function buildFinalStageExportScenes(): SceneData[] {
    const readySceneMap = new Map(
      scenes.value
        .filter(scene => scene.videoStatus === 'done' && !!scene.videoUrl)
        .map(scene => [scene.id, scene] as const)
    )

    const orderedIds: string[] = []
    const consumed = new Set<string>()

    for (const sceneId of finalStageSceneOrder.value) {
      if (consumed.has(sceneId)) continue
      if (!readySceneMap.has(sceneId)) continue
      consumed.add(sceneId)
      orderedIds.push(sceneId)
    }

    for (const sceneId of readySceneMap.keys()) {
      if (consumed.has(sceneId)) continue
      consumed.add(sceneId)
      orderedIds.push(sceneId)
    }

    return orderedIds
      .map(sceneId => readySceneMap.get(sceneId))
      .filter((scene): scene is SceneData => !!scene)
  }

  async function handleExportJianyingProject() {
    if (exportingJianyingProject.value) return

    const orderedScenes = buildFinalStageExportScenes()
    if (orderedScenes.length === 0) {
      toast.warning('请先生成至少一个分镜视频')
      return
    }

    const transitionType = finalStageMergeOptions.value.transitionType || 'none'
    const transitionDuration = Number.isFinite(Number(finalStageMergeOptions.value.transitionDuration))
      ? Math.max(0.1, Math.min(2, Number(finalStageMergeOptions.value.transitionDuration)))
      : 0.5
    const bgmUrl = (finalStageMergeOptions.value.bgmUrl || '').trim()
    const bgmVolume = Number.isFinite(Number(finalStageMergeOptions.value.bgmVolume))
      ? Math.max(0, Math.min(1, Number(finalStageMergeOptions.value.bgmVolume)))
      : 0.3
    const audioTracks = Array.isArray(finalStageMergeOptions.value.audioTracks)
      ? finalStageMergeOptions.value.audioTracks
      : []
    const selectedBgm = audioTracks.find(track => track.kind === 'bgm' && track.url.trim())
    const soundEffects = audioTracks
      .filter(track => track.kind === 'sfx' && track.url.trim())
      .map((track) => {
        const volume = Number(track.volume)
        return {
          id: track.id,
          url: track.url.trim(),
          startTime: Math.max(0, Number(track.startTime) || 0),
          duration: Number.isFinite(Number(track.duration)) ? Math.max(0.1, Number(track.duration)) : undefined,
          volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.6
        }
      })

    exportingJianyingProject.value = true

    try {
      const { blob, fileName } = await exportAssetWorkbenchJianyingProject({
        projectId: projectId.value,
        projectName: projectName.value,
        aspectRatio: projectAspectRatio.value,
        sceneOrder: orderedScenes.map(scene => scene.id),
        scenes: orderedScenes.map(scene => ({
          id: scene.id,
          title: scene.title,
          description: scene.description,
          videoUrl: scene.videoUrl || '',
          duration: scene.duration,
          narration: scene.narration || null
        })),
        options: {
          addSubtitles: finalStageMergeOptions.value.addSubtitles === true,
          transition: {
            type: transitionType,
            duration: transitionDuration
          },
          bgm: selectedBgm?.url || bgmUrl
            ? {
                url: selectedBgm?.url || bgmUrl,
                volume: selectedBgm && Number.isFinite(Number(selectedBgm.volume))
                  ? Math.max(0, Math.min(1, Number(selectedBgm.volume)))
                  : bgmVolume
              }
            : undefined,
          soundEffects
        }
      })

      downloadBlobFile(blob, fileName)
    } catch (error) {
      toast.error(resolveUiError(error, '导出剪映工程失败'))
    } finally {
      exportingJianyingProject.value = false
    }
  }

  async function handleExportFormattedScriptDocx() {
    if (exportingScriptDocx.value) return
    if (scenes.value.length === 0) return

    exportingScriptDocx.value = true

    try {
      const { blob, fileName } = await exportAssetWorkbenchScriptDocx({
        projectId: projectId.value,
        projectName: projectName.value,
        scenes: scenes.value.map(scene => ({
          title: scene.title,
          description: scene.description,
          narration: scene.narration || null,
          duration: scene.duration,
          setting: scene.setting
            ? {
                location: scene.setting.location,
                timeOfDay: scene.setting.timeOfDay
              }
            : undefined,
          characters: scene.characters?.map(character => ({
            name: character.name
          })) || []
        }))
      })

      downloadBlobFile(blob, fileName)
      toast.success('格式化 DOCX 已导出', {
        description: fileName
      })
    } catch (error) {
      toast.error(resolveUiError(error, '导出格式化 DOCX 失败'))
    } finally {
      exportingScriptDocx.value = false
    }
  }

  return {
    exportingScriptDocx,
    exportingJianyingProject,
    handleExportJianyingProject,
    handleExportFormattedScriptDocx
  }
}
