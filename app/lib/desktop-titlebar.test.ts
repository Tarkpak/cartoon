import { describe, expect, it } from 'vitest'
import { hasOverlayTitlebar, hasWindowsTitlebarControls } from './desktop-titlebar'

const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

describe('hasOverlayTitlebar', () => {
  it('only applies to the macOS desktop app', () => {
    expect(hasOverlayTitlebar({ __TAURI_INTERNALS__: {}, navigator: { userAgent: mac } } as never)).toBe(true)
    expect(hasOverlayTitlebar({ __TAURI_INTERNALS__: {}, navigator: { userAgent: win } } as never)).toBe(false)
    expect(hasOverlayTitlebar({ navigator: { userAgent: mac } } as never)).toBe(false)
    expect(hasOverlayTitlebar(undefined)).toBe(false)
  })
})

describe('hasWindowsTitlebarControls', () => {
  it('only applies to the Windows desktop app', () => {
    expect(hasWindowsTitlebarControls({ __TAURI_INTERNALS__: {}, navigator: { userAgent: win } } as never)).toBe(true)
    expect(hasWindowsTitlebarControls({ __TAURI_INTERNALS__: {}, navigator: { userAgent: mac } } as never)).toBe(false)
    expect(hasWindowsTitlebarControls({ navigator: { userAgent: win } } as never)).toBe(false)
  })
})
