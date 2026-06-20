import { z, defineEntry } from '../../..'
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
        if (!user) throw new Error(`User with ID ${args.id} not found`)

        return user
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
