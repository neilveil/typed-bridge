import { $z } from '../../..'

export const fetch = {
    args: $z.object({
        id: $z.number().min(1)
    }),
    res: $z.object({
        id: $z.number(),
        name: $z.string(),
        price: $z.number(),
        createdAt: $z.date()
    })
}

export const create = {
    args: $z.object({
        name: $z.string().min(1),
        price: $z.number().min(0)
    }),
    res: $z.object({
        id: $z.number(),
        name: $z.string(),
        price: $z.number(),
        createdAt: $z.date()
    })
}
