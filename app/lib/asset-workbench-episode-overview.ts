import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { SceneData } from '~/composables/useAssetWorkbench'

const EPISODE_OVERVIEW_TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]\s*/u
const EPISODE_OVERVIEW_STRUCTURED_HEADING_REGEX = /^(?:场景功能\/情绪定位|场景功能|情绪定位|镜头设计|声音设计|台词节奏|表演关键点|Scene function \/ emotional beat|Shot design|Sound design|Dialogue rhythm|Performance notes)\s*[：:]?\s*$/u
const EPISODE_OVERVIEW_MAX_LENGTH = 180

export function resolveSceneDescriptionOverviewText(description: string): string {
  const lines = description
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return ''

  const timelineLines = lines
    .filter(line => EPISODE_OVERVIEW_TIMELINE_PREFIX_REGEX.test(line))
    .map(line => line.replace(EPISODE_OVERVIEW_TIMELINE_PREFIX_REGEX, '').trim())
    .filter(Boolean)

  if (timelineLines.length > 0) {
    return timelineLines.slice(0, 2).join(' ')
  }

  return lines
    .filter(line => !EPISODE_OVERVIEW_STRUCTURED_HEADING_REGEX.test(line))
    .slice(0, 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipEpisodeOverviewText(text: string): string {
  if (text.length <= EPISODE_OVERVIEW_MAX_LENGTH) return text
  return `${text.slice(0, EPISODE_OVERVIEW_MAX_LENGTH).trim()}...`
}

/** One-line summary per episode built from its first scenes, shown in the episode directory. */
export function buildEpisodeOverviews(
  episodePlan: Array<Pick<ScriptEpisodePlanItem, 'id'>>,
  scenes: Array<Pick<SceneData, 'episodeId' | 'title' | 'description'>>
): Record<string, string> {
  if (episodePlan.length === 0 || scenes.length === 0) return {}

  const overviewMap: Record<string, string> = {}
  for (const episode of episodePlan) {
    const episodeScenes = scenes.filter((scene) => {
      return (scene.episodeId?.trim() || '') === episode.id
    })
    if (episodeScenes.length === 0) continue

    const sceneSummaryParts = episodeScenes
      .map((scene) => {
        const descriptionSummary = resolveSceneDescriptionOverviewText(scene.description || '')
        const sceneTitle = scene.title?.trim() || ''
        if (sceneTitle && descriptionSummary) {
          return descriptionSummary.startsWith(sceneTitle)
            ? descriptionSummary
            : `${sceneTitle}：${descriptionSummary}`
        }
        return sceneTitle || descriptionSummary
      })
      .filter(Boolean)
      .slice(0, 3)

    if (sceneSummaryParts.length === 0) continue
    overviewMap[episode.id] = clipEpisodeOverviewText(sceneSummaryParts.join('；'))
  }

  return overviewMap
}
