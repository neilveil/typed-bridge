import { z, defineEntry } from '../../..'
import * as context from '../context'

const eventSchema = z.object({
    id: z.number().describe('Event ID'),
    userId: z.number().describe('User who triggered the event'),
    type: z.enum(['view', 'click', 'purchase']).describe('Event type'),
    amount: z.number().describe('Associated amount in dollars (0 for non-purchase events)'),
    createdAt: z.date().describe('When the event occurred')
})

type Event = z.infer<typeof eventSchema>

const EVENT_TYPES = ['view', 'click', 'purchase'] as const

// A deliberately large seed dataset. Serialized it comfortably exceeds a small
// maxToolOutputChars, so fetching it whole via tool_use is rejected — while tool_script can
// pull it into the sandbox and return only an aggregate.
const events: Event[] = Array.from({ length: 600 }, (_, index) => {
    const type = EVENT_TYPES[index % EVENT_TYPES.length]

    return {
        id: index + 1,
        userId: (index % 25) + 1,
        type,
        amount: type === 'purchase' ? (index % 500) + 1 : 0,
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 3600_000)
    }
})

export const events_list = defineEntry({
    description: 'List all raw analytics events (large dataset)',
    res: z.array(eventSchema),
    handler: async (_args, _ctx: context.user) => {
        return events
    }
})
