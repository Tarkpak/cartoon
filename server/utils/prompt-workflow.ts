import { getQuery, type H3Event } from 'h3'
import {
  normalizeProjectWorkflowType,
  type ProjectWorkflowType
} from '../../shared/types/project'

export function resolvePromptWorkflowFromEvent(event: H3Event): ProjectWorkflowType {
  const query = getQuery(event)
  const rawWorkflow = Array.isArray(query.workflow) ? query.workflow[0] : query.workflow
  return normalizeProjectWorkflowType(rawWorkflow)
}
