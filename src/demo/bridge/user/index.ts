import { z } from '../../..'
import * as types from './types'

export interface User {
    id: number
    name: string
    email: string
    createdAt: Date
}

let nextId = 4

const users: User[] = [
    { id: 1, name: 'Neil', email: 'neil@example.com', createdAt: new Date() },
    { id: 2, name: 'John', email: 'john@example.com', createdAt: new Date() },
    { id: 3, name: 'Jane', email: 'jane@example.com', createdAt: new Date() }
]

type Context = { requestedAt: number; userId: number }

export const fetch = async (
    args: z.infer<typeof types.fetch.args>,
    context: Context
): Promise<z.infer<typeof types.fetch.res>> => {
    args = types.fetch.args.parse(args)

    const user = users.find(u => u.id === args.id)
    if (!user) throw new Error(`User with ID ${args.id} not found`)

    return user
}

export const create = async (
    args: z.infer<typeof types.create.args>,
    context: Context
): Promise<z.infer<typeof types.create.res>> => {
    args = types.create.args.parse(args)

    const user: User = {
        id: nextId++,
        name: args.name,
        email: args.email,
        createdAt: new Date()
    }

    users.push(user)
    return user
}

export const update = async (args: { id: number; name?: string; email?: string }, context: Context): Promise<User> => {
    const user = users.find(u => u.id === args.id)
    if (!user) throw new Error(`User with ID ${args.id} not found`)

    if (args.name) user.name = args.name
    if (args.email) user.email = args.email

    return user
}

export const remove = async (
    args: { id: number },
    context: Context & { isAdmin: boolean }
): Promise<{ success: boolean }> => {
    const index = users.findIndex(u => u.id === args.id)
    if (index === -1) throw new Error(`User with ID ${args.id} not found`)

    users.splice(index, 1)
    return { success: true }
}

export const fetchAll = async (): Promise<User[]> => {
    return users
}
