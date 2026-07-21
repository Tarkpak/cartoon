import { describe, expect, test } from 'bun:test'
import { buildClientReleaseNotes, type ClientVersionRow } from './client-versions'

function versionRow(version: string, releaseNotes: string, platform = 'darwin'): ClientVersionRow {
  return {
    id: version,
    app_key: 'cartoon-desktop',
    platform,
    arch: 'aarch64',
    channel: 'stable',
    version,
    build_number: 0,
    status: 'published',
    download_url: '',
    sha256: '',
    signature: '',
    release_notes: releaseNotes,
    force_update: 0,
    min_supported_version: '',
    rollout_percent: 100,
    published_at: null,
    created_at: '',
    updated_at: ''
  }
}

describe('client update release notes', () => {
  test('combines every release after the current version through the latest version', () => {
    const rows = [
      versionRow('1.0.4', '版本：v1.0.4\n范围：v1.0.3 -> v1.0.4\n更新内容\n- fourth change'),
      versionRow('1.0.3', '版本：v1.0.3\n范围：v1.0.2 -> v1.0.3\n更新内容\n- third change'),
      versionRow('1.0.2', '- second change'),
      versionRow('1.0.1', '- already installed')
    ]

    expect(buildClientReleaseNotes(rows, '1.0.1', '1.0.4')).toBe([
      '版本：v1.0.4\n- fourth change',
      '版本：v1.0.3\n- third change',
      '版本：v1.0.2\n- second change'
    ].join('\n\n'))
  })

  test('keeps the original text when only one release is in the update range', () => {
    const notes = '版本：v1.0.2\n更新内容\n- one change'
    expect(buildClientReleaseNotes([versionRow('1.0.2', notes)], '1.0.1', '1.0.2')).toBe(notes)
  })

  test('ignores releases outside the requested range and versions without notes', () => {
    const rows = [
      versionRow('1.0.5', '- not rolled out to this device'),
      versionRow('1.0.4', '- latest change'),
      versionRow('1.0.3', ''),
      versionRow('1.0.2', '- earlier change')
    ]

    expect(buildClientReleaseNotes(rows, '1.0.2', '1.0.4')).toBe('- latest change')
    expect(buildClientReleaseNotes(rows, '1.0.4', '1.0.4')).toBe('')
  })

  test('deduplicates platform-specific rows for the same version', () => {
    const rows = [
      versionRow('1.0.3', '- macOS change', 'darwin'),
      versionRow('1.0.3', '- universal duplicate', 'all'),
      versionRow('1.0.2', '- shared change', 'all')
    ]

    expect(buildClientReleaseNotes(rows, '1.0.1', '1.0.3')).toBe(
      '版本：v1.0.3\n- macOS change\n\n版本：v1.0.2\n- shared change'
    )
  })
})
