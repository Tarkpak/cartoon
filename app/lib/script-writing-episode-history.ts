import type { ScriptWritingStudio } from '#shared/types/script-writing'

const EPISODE_HISTORY_LIMIT = 30

export function appendEpisodeHistory(studio: ScriptWritingStudio, episodeId: string, label: string, now = new Date()): ScriptWritingStudio {
  const episode = studio.episodes.find(item => item.id === episodeId)
  if (!episode) return studio
  const latest = studio.versions.find(version => version.source === 'episode' && version.episodeId === episodeId)
  const previous = latest?.snapshot.episodes.find(item => item.id === episodeId)
  if (previous?.draft === episode.draft && previous.continuityNotes === episode.continuityNotes) return studio
  const { draftSource: _draftSource, review: _review, ...historicalEpisode } = episode
  const createdAt = now.toISOString()
  const version = {
    id: `episode_history_${crypto.randomUUID()}`,
    label, note: '', kind: 'protection' as const, pinned: false,
    source: 'episode' as const, episodeId, createdAt,
    snapshot: { storyBible: null, episodes: JSON.parse(JSON.stringify([{ ...historicalEpisode, review: '' }])), review: null }
  }
  let count = 0
  return {
    ...studio,
    versions: [version, ...studio.versions].filter(item => {
      if (item.source !== 'episode' || item.episodeId !== episodeId || item.pinned) return true
      return ++count <= EPISODE_HISTORY_LIMIT
    }),
    updatedAt: createdAt
  }
}
