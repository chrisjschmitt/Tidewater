import {
  freeAfterExpenses,
  groupSummaries,
  totalExpenses,
  totalGoalContributions,
  totalIncome,
  unallocated,
} from './budget'
import {
  ETM_SERIES_NOTE,
  exampleQuestions,
  formatEtmChatSnapshot,
  replyActualSpend,
  replyForecast,
  replyPlanVsActual,
  replyReimbursable,
  type EtmChatSnapshot,
} from './etmChat'
import { appGuideContext, replyAppGuide } from './appGuide'
import { money, monthsToText, percent } from './format'
import { monthsToTarget } from './goals'
import { DEFAULT_MODELS, activeConfig, type Settings } from './storage'
import type { Budget } from './types'

export type { EtmChatSnapshot } from './etmChat'
export { exampleQuestions }

export const EXAMPLE_QUESTIONS = exampleQuestions()

/** A compact, human-readable snapshot used by both the local and cloud answers. */
export function budgetSummaryText(b: Budget): string {
  const income = totalIncome(b)
  const spend = totalExpenses(b)
  const goals = totalGoalContributions(b)
  const left = unallocated(b)
  const groups = groupSummaries(b)

  const lines = [
    `Monthly income: ${money(income)}`,
    `Monthly planned spending: ${money(spend)}`,
    `Monthly goal contributions: ${money(goals)}`,
    `Unallocated each month: ${money(left)}`,
    '',
    'Spending by group:',
    ...groups.map(
      (g) => `- ${g.group.name}: ${money(g.total)} (${percent(g.share)}) — ${g.lines
        .slice(0, 6)
        .map((l) => `${l.name} ${money(l.amount)}`)
        .join(', ')}`,
    ),
  ]

  if (b.goals.length > 0) {
    lines.push('', 'Goals:')
    for (const g of b.goals) {
      const months = monthsToTarget(g)
      lines.push(
        `- ${g.name} (${g.kind}): ${money(g.current)} of ${money(g.target)}, ${money(g.monthly)}/mo at ${g.annualRate}% — ${
          Number.isFinite(months) ? monthsToText(months) : 'not on track at this contribution'
        }`,
      )
    }
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are the assistant inside Tidewater, a personal budgeting app built around an abundance mindset.
Your voice is calm, warm, and never judgemental. You never shame the user for how they spend.
You focus on what the user already has and how it can serve the life they want, rather than on restriction.
You also help the user use Tidewater itself (dashboard, import, goals, and — when the how-to says so — Expenses, Forecast, and Reimbursable). Use the how-to notes you are given; do not invent screens or buttons.
Answer in 2-4 short paragraphs or a short list. Use the numbers you are given; do not invent figures.
Amounts are Canadian dollars per month unless stated otherwise.`

// ---------------------------------------------------------------------------
// Local, offline answers
// ---------------------------------------------------------------------------

interface Intent {
  test: RegExp
  reply: (b: Budget, q: string, etm?: EtmChatSnapshot | null) => string
}

/**
 * First match wins, so order matters and compound questions lose detail: asking
 * where to cut back for a $2,000 trip matches `reduce` here and never reaches
 * the affordability intent that would use the amount. Answering those properly
 * needs scoring across intents rather than this ordered list. See the README.
 */

const PLAN_INTENTS: Intent[] = [
  {
    test: /(where|what).*(money|spend|go)|biggest|largest|most/i,
    reply: (b) => {
      const groups = groupSummaries(b)
      if (groups.length === 0) return 'There is no spending in your plan yet.'
      const top = groups.slice(0, 3)
      const detail = top
        .map((g) => `${g.group.name} at ${money(g.total)} (${percent(g.share)} of your spending)`)
        .join(', then ')
      const biggestLine = top[0].lines[0]
      return `Most of your money flows to ${detail}.\n\nInside ${top[0].group.name}, the single largest piece is ${biggestLine.name} at ${money(biggestLine.amount)}. That is normal and it is buying you something real — shelter, mobility, or time.\n\nIf you want to shift the shape of your month, small changes in the second and third groups usually feel easier than touching the first.`
    },
  },
  {
    test: /(balance|fix|trim|cut|reduce|save more|over budget|too much)/i,
    reply: (b) => {
      const left = unallocated(b)
      const flexible = b.expenses
        .filter((l) => !l.essential)
        .sort((a, z) => z.amount - a.amount)
        .slice(0, 4)
      if (left >= 0) {
        return `You are not actually short — you have ${money(left)} unspoken for each month.\n\nIf you want more breathing room anyway, the most flexible places in your plan are ${flexible
          .map((l) => `${l.name} (${money(l.amount)})`)
          .join(', ')}. Trimming each by ten percent would free about ${money(
          flexible.reduce((s, l) => s + l.amount * 0.1, 0),
        )} a month.\n\nOnly do it if the trade feels worth it. Money spent on things you love is not a leak.`
      }
      const gap = Math.abs(left)
      const suggestions = flexible.map((l) => {
        const share = flexible.reduce((s, x) => s + x.amount, 0)
        const cut = share > 0 ? (l.amount / share) * gap : 0
        return `${l.name}: ${money(l.amount)} → ${money(Math.max(0, l.amount - cut))}`
      })
      return `Your plan is about ${money(gap)} beyond what arrives each month. That is a solvable gap, not a failure.\n\nOne gentle way to close it, spread across your most flexible categories so no single part of your life takes the hit:\n\n${suggestions
        .map((s) => `• ${s}`)
        .join('\n')}\n\nYou could also lower a goal contribution for a few months instead. Goals should stretch you, not strain you.`
    },
  },
  {
    test: /(keep|left|leftover|remaining|surplus|savings rate|how much.*left)/i,
    reply: (b) => {
      const income = totalIncome(b)
      const left = unallocated(b)
      const free = freeAfterExpenses(b)
      const rate = income > 0 ? free / income : 0
      return `After everyday spending you hold on to ${money(free)} a month, which is ${percent(
        rate,
      )} of what comes in.\n\nOf that, ${money(totalGoalContributions(b))} is already promised to your goals, leaving ${money(
        left,
      )} completely unclaimed.\n\nUnclaimed money is not idle money — it is flexibility. It is what makes an unexpected month feel ordinary.`
    },
  },
  {
    test: /(goal|rrsp|retire|down payment|vacation|when will|how long)/i,
    reply: (b) => {
      if (b.goals.length === 0)
        return 'You have not set a goal yet. Add one in the Goals panel — a trip, a home, retirement, or anything you would like your surplus to become. I will show you how it grows.'
      return b.goals
        .map((g) => {
          const months = monthsToTarget(g)
          if (!Number.isFinite(months))
            return `${g.name}: at ${money(g.monthly)} a month this does not reach ${money(
              g.target,
            )} within forty years. Raising the contribution even slightly changes that a lot.`
          if (g.kind === 'debt')
            return `${g.name}: paying ${money(g.monthly)} a month clears this in ${monthsToText(months)}.`
          return `${g.name}: at ${money(g.monthly)} a month with ${g.annualRate}% growth, you reach ${money(
            g.target,
          )} in ${monthsToText(months)}.`
        })
        .join('\n\n')
    },
  },
  {
    test: /(afford|can i buy|should i buy|\$\s?\d)/i,
    reply: (b, q) => {
      const match = q.replace(/,/g, '').match(/\$?\s?(\d{2,7}(?:\.\d+)?)/)
      const amount = match ? Number.parseFloat(match[1]) : 0
      const left = unallocated(b)
      if (!amount) return 'Tell me the amount and I will show you what it would take.'
      if (left <= 0)
        return `Right now every dollar is already assigned, so ${money(
          amount,
        )} would need to come from somewhere else in the plan — or from time. Setting aside even ${money(
          amount / 12,
        )} a month gets you there in a year.`
      const months = amount / left
      return `Yes, with a little patience. You have ${money(left)} unclaimed each month, so ${money(
        amount,
      )} takes about ${monthsToText(months)} without touching anything else you enjoy.\n\nIf you would rather have it sooner, ${money(
        amount / 6,
      )} a month gets you there in six months.`
    },
  },
  {
    test: /(more|treat|enjoy|fun|spend more|room)/i,
    reply: (b) => {
      const left = unallocated(b)
      const joy = groupSummaries(b).find((g) => g.group.id === 'joy')
      if (left <= 0)
        return 'Your plan is fully committed at the moment. That is not a reason to feel restricted — it means everything you have is already pointed at something you chose.'
      return `You have ${money(left)} a month that is not spoken for.\n\nYour Joy & Connection spending is currently ${money(
        joy?.total ?? 0,
      )}. Adding even ${money(Math.min(left, 100))} there is a reasonable, well-earned choice — meals with people you like, a class, a weekend away.\n\nThis is what the surplus is for. You do not have to save all of it.`
    },
  },
  {
    test: /(how am i doing|overall|summary|health|status)/i,
    reply: (b) => {
      const income = totalIncome(b)
      const left = unallocated(b)
      return `You bring in ${money(income)} a month and your plan spends ${money(
        totalExpenses(b),
      )}, with ${money(totalGoalContributions(b))} going to goals.\n\nThat leaves ${money(
        left,
      )}. ${left >= 0 ? 'Your needs are covered and your future is getting funded — that is a genuinely good position.' : 'The plan is slightly ahead of your income, which is a numbers problem, not a character problem.'}`
    },
  },
]

const GUIDE_INTENTS: Intent[] = [
  {
    test: /how do i|how to (use|import|unlock|add|set|open|enable|backup|restore|change|erase)|where (is|do i find|can i find)|help me (use|with) (the |this )?app|using (the |this )?app|how does (this |the )?app work|what (does|do) (the )?(forecast|expenses?|reimbursable|budget|month[- ]?end|transactions?|accounts?|import|settings) tab|(month[- ]?end|forecast|reimbursable|budget|transactions|accounts|import|settings) tab/i,
    reply: (_b, q) =>
      replyAppGuide(q) ??
      'I can help with using Tidewater. Try how to import, how to add a goal, or how to use Expenses.',
  },
]

const ETM_INTENTS: Intent[] = __ETM_AVAILABLE__
  ? [
      {
        test: /\breimburs/i,
        reply: (b, q, etm) => replyReimbursable(b, etm, q),
      },
      {
        test: /(histor(?:y|ical|ically).{0,40}spend|spend(?:ing)? on |spent on |what (did|have) i spend|how much (did|have) i (actually )?spend|actual (spend|spending)|spent (this|last|so far|in)|where did (my|the) money go)/i,
        reply: (b, q, etm) => replyActualSpend(b, etm, q),
      },
      {
        test: /\bforecast\b|set-aside|set aside|overlay|remain(?:ing)? (?:this|the) month|household vs vacation/i,
        reply: (b, _q, etm) => replyForecast(b, etm),
      },
      {
        test: /(compare|compared|vs\.? actual|against (?:the )?plan|over (?:the )?plan|under (?:the )?plan|budget vs|plan vs)/i,
        reply: (b, _q, etm) => replyPlanVsActual(b, etm),
      },
    ]
  : []

const INTENTS: Intent[] = [...GUIDE_INTENTS, ...ETM_INTENTS, ...PLAN_INTENTS]

export function localAnswer(question: string, budget: Budget, etm?: EtmChatSnapshot | null): string {
  const intent = INTENTS.find((i) => i.test.test(question))
  if (intent) return intent.reply(budget, question, etm)
  return `I can answer from your plan, or help you use Tidewater. Here is where the plan stands:\n\n${budgetSummaryText(
    budget,
  )}\n\nTry asking about where your money goes, how to import, or how to use Expenses.`
}

/** System context sent to an optional cloud provider. Snapshot is totals only. */
export function assistantSystemContext(budget: Budget, etm?: EtmChatSnapshot | null): string {
  const guide = appGuideContext()
  if (__ETM_AVAILABLE__ && etm) {
    return `${SYSTEM_PROMPT}\n\n${guide}\n\n${ETM_SERIES_NOTE}\n\nThe user's current typical-month plan:\n${budgetSummaryText(budget)}\n\nSpending and forecast snapshot (derived totals and classifications only; not the vault, not transactions, not merchants):\n${formatEtmChatSnapshot(etm)}`
  }
  return `${SYSTEM_PROMPT}\n\n${guide}\n\nThe user's current budget:\n${budgetSummaryText(budget)}`
}

// ---------------------------------------------------------------------------
// Optional cloud answers (bring your own key)
// ---------------------------------------------------------------------------

export async function cloudAnswer(
  question: string,
  budget: Budget,
  settings: Settings,
  etm?: EtmChatSnapshot | null,
): Promise<string> {
  const context = assistantSystemContext(budget, etm)
  const config = activeConfig(settings)
  if (!config) throw new Error('No provider is configured.')

  if (settings.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.model || DEFAULT_MODELS.anthropic,
        max_tokens: 700,
        system: context,
        messages: [{ role: 'user', content: question }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic returned ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? 'No answer came back.'
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODELS.openai,
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: question },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI returned ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? 'No answer came back.'
}

export async function answer(
  question: string,
  budget: Budget,
  settings: Settings,
  etm?: EtmChatSnapshot | null,
): Promise<{ text: string; usedCloud: boolean }> {
  const config = activeConfig(settings)
  if (config?.apiKey && settings.cloudAcknowledged) {
    try {
      return { text: await cloudAnswer(question, budget, settings, etm), usedCloud: true }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const hint = /404|not_found|does not exist/i.test(detail)
        ? `\n\nThat usually means the model id “${config.model}” is no longer offered. Open Settings and choose one of the recommended models.`
        : ''
      return {
        text: `I could not reach your assistant provider (${detail}).${hint}\n\nHere is what I can tell you from your own data instead:\n\n${localAnswer(
          question,
          budget,
          etm,
        )}`,
        usedCloud: false,
      }
    }
  }
  return { text: localAnswer(question, budget, etm), usedCloud: false }
}
