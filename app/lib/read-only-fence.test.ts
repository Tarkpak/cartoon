import { describe, expect, it } from 'vitest'
import { shouldLockControl } from './read-only-fence'

/** A fake element that is "inside" the given selectors. */
function controlInside(...selectors: string[]) {
  return { closest: (selector: string) => (selectors.includes(selector) ? ({} as Element) : null) }
}

describe('shouldLockControl', () => {
  it('leaves everything usable when the project is editable', () => {
    expect(shouldLockControl(controlInside(), { readOnly: false })).toBe(false)
  })

  it('locks controls in read-only mode unless they are allowed', () => {
    expect(shouldLockControl(controlInside(), { readOnly: true })).toBe(true)
    expect(shouldLockControl(controlInside('[data-readonly-allowed]'), { readOnly: true })).toBe(false)
    expect(shouldLockControl(controlInside('[data-asset-tab]'), { readOnly: true, allow: ['[data-asset-tab]'] })).toBe(false)
  })

  it('applies conditional rules in both modes', () => {
    const exportControl = controlInside('[data-export]')
    const rules = (enabled: boolean) => [{ selector: '[data-export]', enabled }]
    expect(shouldLockControl(exportControl, { readOnly: true, conditional: rules(true) })).toBe(false)
    expect(shouldLockControl(exportControl, { readOnly: false, conditional: rules(false) })).toBe(true)
  })
})
