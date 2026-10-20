import type { ProjectEditSessionState } from '~/composables/useProjectEditSession'

export interface ProjectParticipant { userId: string, displayName: string, locations: string[] }

/** Window-level presence is summarized once per person for the collaboration bar. */
export function summarizeProjectPresence(collaborators: ProjectEditSessionState['collaborators'] = [], participants: ProjectParticipant[] = []) {
  const members = new Map<string, { userId: string, displayName: string, locks: Set<string>, edits: Set<string>, locations: Set<string> }>()
  const memberFor = (person: { userId: string, displayName: string }) => {
    let member = members.get(person.userId)
    if (!member) {
      member = { ...person, locks: new Set(), edits: new Set(), locations: new Set() }
      members.set(person.userId, member)
    }
    return member
  }
  for (const person of collaborators) {
    const member = memberFor(person)
    if (person.locked) member.locks.add(person.activity)
    else if (person.activity && person.activity !== '正在查看') member.edits.add(person.activity)
  }
  for (const person of participants) {
    const member = memberFor(person)
    for (const location of person.locations) member.locations.add(location)
  }
  return [...members.values()].map(member => ({
    userId: member.userId,
    displayName: member.displayName,
    locked: member.locks.size > 0,
    activity: member.locks.size ? [...member.locks].join('；')
      : member.locations.size ? `正在编辑 ${[...member.locations].join('、')}`
        : member.edits.size ? [...member.edits].join('；') : '正在查看'
  })).sort((a, b) => Number(b.locked) - Number(a.locked) || Number(a.activity === '正在查看') - Number(b.activity === '正在查看'))
}
