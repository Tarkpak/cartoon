export function tosUserScopeComponent(account: string): string {
  return account
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
}

export type TosAssetCategory = 'all' | 'images' | 'videos'

export function tosAdminAssetPrefix(account: string, category: TosAssetCategory): string {
  if (account === '__all__') return 'users'

  const scope = tosUserScopeComponent(account)
  return category === 'all' ? `users/${scope}` : `users/${scope}/${category}`
}
