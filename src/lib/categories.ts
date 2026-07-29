import type { Group, GroupId } from './types'

export const GROUPS: Group[] = [
  { id: 'home', name: 'Home & Shelter', blurb: 'The roof over your head', color: '#0f766e', soft: '#d5e8e4' },
  { id: 'food', name: 'Food & Groceries', blurb: 'What nourishes you', color: '#3f8f5c', soft: '#dcecdf' },
  { id: 'transport', name: 'Getting Around', blurb: 'How you move through the world', color: '#4a7fa5', soft: '#dbe6ef' },
  { id: 'health', name: 'Health & Wellbeing', blurb: 'Looking after yourself', color: '#7a6bb0', soft: '#e4e0f0' },
  { id: 'personal', name: 'Personal & Everyday', blurb: 'The small daily things', color: '#a9713f', soft: '#efe3d6' },
  { id: 'joy', name: 'Joy & Connection', blurb: 'Time with people you love', color: '#c96a4e', soft: '#f4dfd7' },
  { id: 'family', name: 'Family & Pets', blurb: 'Those who depend on you', color: '#b5567f', soft: '#f2dde7' },
  { id: 'financial', name: 'Financial & Insurance', blurb: 'Keeping things steady', color: '#5c7a8a', soft: '#dfe7eb' },
  { id: 'future', name: 'Future & Giving', blurb: 'Tomorrow, and other people', color: '#2f6f8f', soft: '#d9e8ef' },
  { id: 'other', name: 'Everything Else', blurb: 'Odds and ends', color: '#7d8a86', soft: '#e4e8e6' },
]

export const GROUP_BY_ID: Record<GroupId, Group> = Object.fromEntries(
  GROUPS.map((g) => [g.id, g]),
) as Record<GroupId, Group>

/**
 * Movements between your own accounts. They are not income or spending, and
 * leaving them in makes an imported budget look wildly wrong.
 */
const INTERNAL = [
  'transfer',
  'credit card payment',
  'balance adjustment',
  'payment',
  'transfers',
]

const INCOME_HINTS = [
  'paycheck',
  'paycheque',
  'salary',
  'wages',
  'income',
  'bonus',
  'cpp',
  'oas',
  'rif',
  'rrif',
  'pension',
  'dividend',
  'interest',
  'reimbursement',
  'rebate',
  'refund',
  'benefit',
  'child tax',
  'gst',
]

const RULES: Array<[GroupId, string[]]> = [
  ['home', ['rent', 'mortgage', 'condo fee', 'property tax', 'home insurance', 'electric', 'hydro', 'water', 'gas bill', 'utilit', 'internet', 'cable', 'phone', 'mobile', 'home improvement', 'home repair', 'condo repair', 'furnish', 'lawn', 'garden', 'security', 'storage', 'special assessment', 'housing', 'home service', 'maintenance']],
  ['food', ['grocer', 'supermarket', 'food', 'coffee shop', 'market']],
  ['transport', ['gas', 'fuel', 'auto', 'car ', 'car repair', 'car insurance', 'car payment', 'parking', 'toll', 'transit', 'transport', 'rideshare', 'uber', 'lyft', 'taxi', 'vehicle', 'bike', 'ev charg']],
  ['health', ['health', 'medical', 'dental', 'dentist', 'pharmac', 'doctor', 'therapy', 'fitness', 'gym', 'wellness', 'weight loss', 'vision', 'eye', 'life insurance', 'disability']],
  ['personal', ['personal', 'clothing', 'shopping', 'hair', 'beauty', 'salon', 'laundry', 'dry clean', 'allowance', 'cash for spending', 'electronics', 'subscription', 'software', 'miscellaneous', 'misc']],
  ['joy', ['restaurant', 'bar', 'dining', 'entertainment', 'recreation', 'travel', 'vacation', 'cruise', 'lodging', 'hotel', 'airfare', 'flight', 'tours', 'entrance fee', 'trailer', 'hobby', 'sport', 'music', 'movie', 'streaming', 'gift', 'events', 'concert', 'alcohol', 'liquor']],
  ['family', ['child', 'kid', 'daycare', 'childcare', 'school', 'tuition', 'education', 'pet', 'vet', 'baby', 'family']],
  ['financial', ['bank fee', 'financial fee', 'fee', 'insurance', 'tax', 'interest charge', 'loan', 'debt', 'legal', 'accounting', 'business', 'advisor']],
  ['future', ['saving', 'savings', 'investment', 'invest', 'rrsp', 'tfsa', 'resp', 'retirement', 'emergency fund', 'charity', 'charitable', 'donation', 'giving', 'tithe']],
]

const norm = (s: string) => s.trim().toLowerCase()

export function isInternalCategory(category: string): boolean {
  const c = norm(category)
  return INTERNAL.some((t) => c === t || c.startsWith(t))
}

export function looksLikeIncome(category: string): boolean {
  const c = norm(category)
  return INCOME_HINTS.some((t) => c.includes(t))
}

/** Best-effort mapping of an arbitrary category name onto one of our groups. */
export function groupForCategory(category: string): GroupId {
  const c = norm(category)
  for (const [groupId, terms] of RULES) {
    if (terms.some((t) => c.includes(t))) return groupId
  }
  return 'other'
}

/** Categories most people cannot simply switch off. Used to soften slider advice. */
export function isEssentialCategory(category: string): boolean {
  const c = norm(category)
  const essentials = ['rent', 'mortgage', 'condo fee', 'property tax', 'grocer', 'utilit', 'electric', 'hydro', 'water', 'insurance', 'phone', 'internet', 'medical', 'pharmac', 'dental', 'childcare', 'daycare', 'tuition', 'loan', 'debt', 'tax']
  return essentials.some((t) => c.includes(t))
}
