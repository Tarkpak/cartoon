import type { ScriptWritingPublication } from '#shared/types/script-writing'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'

export function buildPublishedWritingEpisodePlan(
  publication: ScriptWritingPublication
): ScriptEpisodePlanItem[] {
  return publication.episodes.map(episode => ({
    ...episode,
    episodeAssets: {
      characters: [],
      environments: [],
      props: []
    }
  }))
}

export function clearParsedWorkflowForPublishedWriting(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  return {
    ...raw,
    sceneConfigs: {},
    sceneVideoHistories: {},
    finalVideo: null
  }
}
