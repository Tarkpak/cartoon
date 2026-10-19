export type ProjectWorkbenchStage = 'parse' | 'assets' | 'videos' | 'final'

export const PROJECT_PERMISSION_KEYS = [
  'view',
  'edit',
  'generate',
  'export',
  'delete',
  'manage_members'
] as const

export type ProjectPermission = typeof PROJECT_PERMISSION_KEYS[number]
export type ProjectMemberRole = 'manager' | 'editor' | 'viewer' | 'custom'

export interface ProjectAccess {
  role: 'owner' | 'admin' | ProjectMemberRole
  permissions: ProjectPermission[]
  isOwner: boolean
}

export interface ProjectMember {
  userId: string
  account: string
  displayName: string
  role: ProjectMemberRole
  permissions: ProjectPermission[]
  createdAt: string
  updatedAt: string
}

export interface ProjectMemberCandidate {
  id: string
  account: string
  displayName: string
  role: string
}

export const PROJECT_ROLE_PERMISSIONS: Record<Exclude<ProjectMemberRole, 'custom'>, ProjectPermission[]> = {
  manager: ['view', 'edit', 'generate', 'export', 'manage_members'],
  editor: ['view', 'edit', 'generate', 'export'],
  viewer: ['view']
}

export const PROJECT_ROLE_LABELS: Record<'owner' | 'admin' | ProjectMemberRole, string> = {
  owner: '所有者',
  admin: '系统管理员',
  manager: '项目管理员',
  editor: '编辑者',
  viewer: '查看者',
  custom: '自定义'
}

export const PROJECT_PERMISSION_LABELS: Record<ProjectPermission, string> = {
  view: '查看项目',
  edit: '编辑内容',
  generate: '生成内容',
  export: '导出项目',
  delete: '删除项目',
  manage_members: '管理成员'
}

export function resolveProjectRolePermissions(
  role: ProjectMemberRole,
  customPermissions: ProjectPermission[] = []
): ProjectPermission[] {
  if (role !== 'custom') return [...PROJECT_ROLE_PERMISSIONS[role]]
  const requested = new Set(customPermissions)
  requested.add('view')
  if (requested.has('generate')) requested.add('edit')
  return PROJECT_PERMISSION_KEYS.filter(permission => requested.has(permission))
}

export function projectAccessCan(
  access: ProjectAccess | null | undefined,
  permission: ProjectPermission
): boolean {
  return access?.permissions.includes(permission) === true
}

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
