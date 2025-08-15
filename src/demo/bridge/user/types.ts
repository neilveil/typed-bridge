import { z } from 'zod'

export const fetch = {
    args: z.object({
        id: z.number().min(1)
    }),
    res: z.object({
        id: z.number(),
        name: z.string()
    })
}

export const userContext = z.object({
    id: z.number()
})
