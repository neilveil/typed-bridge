import { z } from '../../..'

const userSchema = z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
    createdAt: z.date()
})

export const fetch = {
    description: 'Fetch a user by their unique ID',
    args: z.object({
        id: z.number().min(1).describe('Unique user identifier')
    }),
    res: userSchema
}

export const create = {
    description: 'Create a new user account',
    args: z.object({
        name: z.string().min(1).describe('Full name of the user'),
        email: z.string().email().describe('Email address')
    }),
    res: userSchema
}

export const update = {
    description: 'Update an existing user',
    args: z.object({
        id: z.number().min(1).describe('User ID to update'),
        name: z.string().optional().describe('New name'),
        email: z.string().email().optional().describe('New email')
    }),
    res: userSchema
}

export const remove = {
    description: 'Delete a user by ID',
    args: z.object({
        id: z.number().min(1).describe('User ID to delete')
    }),
    res: z.object({
        success: z.boolean()
    })
}

export const fetchAll = {
    description: 'Fetch all users',
    res: z.array(userSchema)
}
