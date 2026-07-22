export function tosUserScopeComponent(account: string): string {
  return account
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
}

