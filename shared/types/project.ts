export type ProjectWorkbenchStage = 'parse' | 'assets' | 'videos' | 'final'

export function resolveProjectWorkbenchPath(
  projectId: string,
  stage?: ProjectWorkbenchStage
): string {
  const query = new URLSearchParams({
    project: projectId
  })
  if (stage) {
    query.set('stage', stage)
  }
  return `/asset-workbench?${query.toString()}`
}

export function resolveProjectDetailPath(projectId: string): string {
  return resolveProjectWorkbenchPath(projectId)
}
