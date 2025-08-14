const users = [
    { id: 1, name: 'Neil' },
    { id: 2, name: 'John' },
    { id: 3, name: 'Jane' }
]

export const fetch = async (args: { id: number }): Promise<{ id: number; name: string } | undefined> => {
    return users.find(user => user.id === args.id)
}

export const update = async (args: { id: number; name: string }): Promise<void> => {
    const user = users.find(user => user.id === args.id)
    if (!user) throw new Error('User not found')
    user.name = args.name
}

export const fetchAll = async (): Promise<{ id: number; name: string }[]> => {
    return users
}
