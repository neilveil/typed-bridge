import { badRequest, defineEntry, forbidden, notFound, z } from '../../..'
import * as context from '../context'

const userSchema = z.object({
    id: z.number().describe('User ID'),
    name: z.string().describe('Full name'),
    email: z.string().describe('Primary email address'),
    createdAt: z.date().describe('Account creation timestamp')
})

type User = z.infer<typeof userSchema>

let nextId = 4

const users: User[] = [
    { id: 1, name: 'Neil', email: 'neil@example.com', createdAt: new Date() },
    { id: 2, name: 'John', email: 'john@example.com', createdAt: new Date() },
    { id: 3, name: 'Jane', email: 'jane@example.com', createdAt: new Date() }
]

export const fetch = defineEntry({
    description: 'Fetch a user by their unique ID',
    args: z.object({
        id: z.number().min(1).describe('Unique user identifier')
    }),
    res: userSchema,
    handler: async (args, _ctx: context.user) => {
        const user = users.find(u => u.id === args.id)

        // `notFound` rather than a bare Error: a missing record is a normal
        // answer, and a 500 would report it as the server falling over
        if (!user) throw notFound(`User with ID ${args.id} not found`)

        return user
    }
})

// Exists to exercise the refusal statuses end to end — one entry per shape,
// so the demo covers what a handler can decide rather than only what it can
// return
export const refuse = defineEntry({
    description: 'Refuse a call with a chosen status, to exercise error mapping',
    args: z.object({ as: z.enum(['notFound', 'forbidden', 'badRequest', 'unhandled']) }),
    res: z.object({ never: z.boolean() }),
    handler: async args => {
        if (args.as === 'notFound') throw notFound('Nothing here')
        if (args.as === 'forbidden') throw forbidden('Not yours')
        if (args.as === 'badRequest') throw badRequest('Malformed')

        // No status on it, so it must still come back as a 500 — a real fault
        // must not start looking like a refusal
        throw new Error('Something actually broke')
    }
})

export const create = defineEntry({
    description: 'Create a new user account',
    args: z.object({
        name: z.string().min(1).describe('Full name of the user'),
        email: z.email().describe('Email address')
    }),
    res: userSchema,
    handler: async (args, _ctx: context.user) => {
        const user: User = {
            id: nextId++,
            name: args.name,
            email: args.email,
            createdAt: new Date()
        }

        users.push(user)
        return user
    }
})

export const update = defineEntry({
    description: 'Update an existing user',
    args: z.object({
        id: z.number().min(1).describe('User ID to update'),
        name: z.string().optional().describe('New name'),
        email: z.email().optional().describe('New email')
    }),
    res: userSchema,
    handler: async (args, _ctx: context.user) => {
        const user = users.find(u => u.id === args.id)
        if (!user) throw new Error(`User with ID ${args.id} not found`)

        if (args.name) user.name = args.name
        if (args.email) user.email = args.email

        return user
    }
})

export const remove = defineEntry({
    description: 'Delete a user by ID',
    args: z.object({
        id: z.number().min(1).describe('User ID to delete')
    }),
    res: z.object({
        success: z.boolean().describe('Whether the user was removed')
    }),
    // Hidden from MCP clients; still an LLM tool and an HTTP route.
    mcp: false,
    handler: async (args, _ctx: context.admin) => {
        const index = users.findIndex(u => u.id === args.id)
        if (index === -1) throw new Error(`User with ID ${args.id} not found`)

        users.splice(index, 1)
        return { success: true }
    }
})

export const fetchAll = defineEntry({
    description: 'Fetch all users',
    res: z.array(userSchema),
    handler: async () => {
        return users
    }
})
