import { isRef, ref, type Ref } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'

type PageMeta = Record<string, unknown>

type NavigateOptions = {
  replace?: boolean
}

type HeadConfig = {
  title?: string
  htmlAttrs?: {
    lang?: string
  }
  meta?: Array<{
    name?: string
    property?: string
    content?: string
  }>
  link?: Array<{
    rel?: string
    href?: string
  }>
}

const globalState = new Map<string, Ref<unknown>>()

function setOrUpdateMetaTag(key: 'name' | 'property', id: string, content?: string) {
  if (typeof document === 'undefined' || !id) return
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${key}="${id}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(key, id)
    document.head.appendChild(element)
  }
  if (content !== undefined) {
    element.setAttribute('content', content)
  }
}

function setOrUpdateLinkTag(rel?: string, href?: string) {
  if (typeof document === 'undefined' || !rel || !href) return
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', rel)
    document.head.appendChild(element)
  }
  element.setAttribute('href', href)
}

export function definePageMeta(_meta: PageMeta): void {}

export function useState<T>(key: string, init?: () => T): Ref<T> {
  const existing = globalState.get(key)
  if (existing) return existing as Ref<T>

  const initial = init ? init() : undefined
  let created: Ref<T>
  if (isRef(initial)) {
    created = initial as Ref<T>
  } else {
    created = ref(initial as T) as Ref<T>
  }
  globalState.set(key, created as Ref<unknown>)
  return created
}

export function navigateTo(to: RouteLocationRaw, options?: NavigateOptions) {
  const router = useRouter()
  if (options?.replace) {
    return router.replace(to)
  }
  return router.push(to)
}

export function useHead(config: HeadConfig) {
  if (typeof document === 'undefined') return

  if (config.title) {
    document.title = config.title
  }

  if (config.htmlAttrs?.lang) {
    document.documentElement.lang = config.htmlAttrs.lang
  }

  for (const item of config.meta || []) {
    if (item.name) {
      setOrUpdateMetaTag('name', item.name, item.content)
    } else if (item.property) {
      setOrUpdateMetaTag('property', item.property, item.content)
    }
  }

  for (const item of config.link || []) {
    setOrUpdateLinkTag(item.rel, item.href)
  }
}

export function useSeoMeta(config: Record<string, string | undefined>) {
  if (typeof document === 'undefined') return

  if (config.title) {
    document.title = config.title
  }

  if (config.description) {
    setOrUpdateMetaTag('name', 'description', config.description)
  }

  if (config.ogTitle) {
    setOrUpdateMetaTag('property', 'og:title', config.ogTitle)
  }

  if (config.ogDescription) {
    setOrUpdateMetaTag('property', 'og:description', config.ogDescription)
  }
}
