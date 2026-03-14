import { $z } from '../../..'

export const fetch = {
    args: $z.object({
        id: $z.number().min(1)
    }),
    res: $z.object({
        id: $z.number(),
        name: $z.string(),
        email: $z.string()
    })
}

export const create = {
    args: $z.object({
        name: $z.string().min(1),
        email: $z.string().email()
    }),
    res: $z.object({
        id: $z.number(),
        name: $z.string(),
        email: $z.string(),
        createdAt: $z.date()
    })
}
