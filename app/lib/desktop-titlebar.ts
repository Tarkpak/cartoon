// The macOS desktop window hides its native title bar (TitleBarStyle::Overlay in src-tauri/src/lib.rs),
// so web content starts at the window's top edge under the traffic-light buttons.

type TauriWindow = Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

/** True when running inside the macOS desktop app, where the page must leave room for the traffic lights. */
export function hasOverlayTitlebar(runtime: TauriWindow | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!runtime) return false
  const isDesktop = !!runtime.__TAURI__ || !!runtime.__TAURI_INTERNALS__
  return isDesktop && /Mac/i.test(runtime.navigator?.userAgent ?? '')
}

export function hasWindowsTitlebarControls(runtime: TauriWindow | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!runtime) return false
  return (!!runtime.__TAURI__ || !!runtime.__TAURI_INTERNALS__)
    && /Windows/i.test(runtime.navigator?.userAgent ?? '')
}
