import { z } from '../../..'

const productSchema = z.object({
    id: z.number(),
    name: z.string(),
    price: z.number(),
    createdAt: z.date()
})

export const fetch = {
    description: 'Fetch a product by ID',
    args: z.object({
        id: z.number().min(1).describe('Product identifier')
    }),
    res: productSchema
}

export const create = {
    description: 'Create a new product',
    args: z.object({
        name: z.string().min(1).describe('Product name'),
        price: z.number().min(0).describe('Product price in dollars')
    }),
    res: productSchema
}

export const list = {
    description: 'List all products',
    res: z.array(productSchema)
}
