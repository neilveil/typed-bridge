interface User {
    id: number
    name: string
    email: string
    createdAt: Date
}

const users: User[] = [
    { id: 1, name: 'Neil', email: 'neil@example.com', createdAt: new Date() },
    { id: 2, name: 'John', email: 'john@example.com', createdAt: new Date() },
    { id: 3, name: 'Jane', email: 'jane@example.com', createdAt: new Date() }
]

export const fetch = async (args: { id: number }): Promise<User> => {
    const user = users.find(user => user.id === args.id)
    if (!user) {
        throw new Error(`User with ID ${args.id} not found`)
    }
    return user
}

export const update = async (args: { id: number; name?: string; email?: string }): Promise<User> => {
    const user = users.find(user => user.id === args.id)
    if (!user) {
        throw new Error(`User with ID ${args.id} not found`)
    }

    if (args.name) user.name = args.name
    if (args.email) user.email = args.email

    return user
}

export const fetchAll = async (): Promise<User[]> => {
    return users
}
