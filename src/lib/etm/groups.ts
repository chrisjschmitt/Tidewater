import { groupForCategory } from '../categories'
import type { GroupId } from '../types'

/**
 * The expense group for a category inside expense tracking: the user's own
 * override first (EtmConfig.categoryGroups), then the shared keyword mapping.
 * Only ETM calls this, so the budget import outside it is unaffected.
 */
export function etmGroupFor(category: string, overrides?: Record<string, GroupId>): GroupId {
  if (overrides) {
    const wanted = category.trim().toLowerCase()
    for (const [name, group] of Object.entries(overrides)) {
      if (name.trim().toLowerCase() === wanted) return group
    }
  }
  return groupForCategory(category)
}
