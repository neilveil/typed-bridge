import { z } from '../../..'
import * as types from './types'

type User = z.infer<typeof types.fetchAll.res>[number]

let nextId = 4

const users: User[] = [
    { id: 1, name: 'Neil', email: 'neil@example.com', createdAt: new Date() },
    { id: 2, name: 'John', email: 'john@example.com', createdAt: new Date() },
    { id: 3, name: 'Jane', email: 'jane@example.com', createdAt: new Date() }
]

type Context = { requestedAt: number; userId: number }

export const fetch = async (
    args: z.infer<typeof types.fetch.args>,
    _context: Context
): Promise<z.infer<typeof types.fetch.res>> => {
    const user = users.find(u => u.id === args.id)
    if (!user) throw new Error(`User with ID ${args.id} not found`)

    return user
}

export const create = async (
    args: z.infer<typeof types.create.args>,
    _context: Context
): Promise<z.infer<typeof types.create.res>> => {
    const user: User = {
        id: nextId++,
        name: args.name,
        email: args.email,
        createdAt: new Date()
    }

    users.push(user)
    return user
}

export const update = async (
    args: z.infer<typeof types.update.args>,
    _context: Context
): Promise<z.infer<typeof types.update.res>> => {
    const user = users.find(u => u.id === args.id)
    if (!user) throw new Error(`User with ID ${args.id} not found`)

    if (args.name) user.name = args.name
    if (args.email) user.email = args.email

    return user
}

export const remove = async (
    args: z.infer<typeof types.remove.args>,
    _context: Context & { isAdmin: boolean }
): Promise<z.infer<typeof types.remove.res>> => {
    const index = users.findIndex(u => u.id === args.id)
    if (index === -1) throw new Error(`User with ID ${args.id} not found`)

    users.splice(index, 1)
    return { success: true }
}

export const fetchAll = async (): Promise<z.infer<typeof types.fetchAll.res>> => {
    return users
}
