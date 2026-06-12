import { createError, getQuery, getRouterParam } from 'h3'
import type { H3Event } from 'h3'

export type SqlBinding = string | number | bigint | boolean | null | Uint8Array

export function requiredString(value: unknown, name: string, maxLength = 512) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError({ statusCode: 400, statusMessage: `${name} is required` })
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw createError({ statusCode: 400, statusMessage: `${name} is too long` })
  }
  return trimmed
}

export function requiredParam(event: H3Event, name: string) {
  const value = getRouterParam(event, name)
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `${name} is required` })
  }
  return value
}

export function optionalString(value: unknown, maxLength = 4096) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

export function optionalJson(value: unknown) {
  if (value === undefined || value === null) return null
  return value
}

export function pagination(event: Parameters<typeof getQuery>[0]) {
  const query = getQuery(event)
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '20'), 10) || 20))
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  }
}

export function jsonOk<T>(data: T) {
  return { success: true, data }
}
