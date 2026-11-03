import { describe, expect, it } from 'vitest'
import { createScrollRestoreTracker } from './keep-alive-scroll-restore'

function fakeElement(scrollTop = 0) {
  return { isConnected: true, scrollTop, scrollLeft: 0 } as unknown as Element & { isConnected: boolean }
}

describe('createScrollRestoreTracker', () => {
  it('restores the offset a container lost while detached', () => {
    const tracker = createScrollRestoreTracker()
    const element = fakeElement(420)
    tracker.record(element)

    // KeepAlive detaches the DOM: the browser resets the offset.
    element.isConnected = false
    element.scrollTop = 0
    tracker.record(element)
    tracker.restore()
    expect(element.scrollTop).toBe(0)

    element.isConnected = true
    tracker.restore()
    expect(element.scrollTop).toBe(420)
  })

  it('keeps offsets changed while attached, including scrolling back to top', () => {
    const tracker = createScrollRestoreTracker()
    const element = fakeElement(300)
    tracker.record(element)
    element.scrollTop = 0
    tracker.record(element)
    tracker.restore()
    expect(element.scrollTop).toBe(0)
  })
})

describe('createPageScrollMemory', () => {
  it('keeps one offset per route and starts unseen routes at the top', async () => {
    const { createPageScrollMemory } = await import('./keep-alive-scroll-restore')
    const memory = createPageScrollMemory()
    const container = { isConnected: true, scrollTop: 0 } as unknown as HTMLElement
    memory.setContainer(container)
    const raf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 0 }) as typeof requestAnimationFrame

    container.scrollTop = 500
    memory.save('/projects')
    memory.restore('/library')
    expect(container.scrollTop).toBe(0)

    container.scrollTop = 120
    memory.save('/library')
    memory.restore('/projects')
    expect(container.scrollTop).toBe(500)

    globalThis.requestAnimationFrame = raf
  })
})
