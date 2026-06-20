import { z, defineEntry } from '../../..'
import * as context from '../context'

const productSchema = z.object({
    id: z.number().describe('Product ID'),
    name: z.string().describe('Product name'),
    price: z.number().describe('Product price in dollars'),
    createdAt: z.date().describe('Creation timestamp')
})

type Product = z.infer<typeof productSchema>

let nextId = 4

const products: Product[] = [
    { id: 1, name: 'Laptop', price: 999, createdAt: new Date() },
    { id: 2, name: 'Keyboard', price: 79, createdAt: new Date() },
    { id: 3, name: 'Monitor', price: 349, createdAt: new Date() }
]

export const fetch = defineEntry({
    description: 'Fetch a product by ID',
    args: z.object({
        id: z.number().min(1).describe('Product identifier')
    }),
    res: productSchema,
    handler: async (args, _ctx: context.user) => {
        const product = products.find(p => p.id === args.id)
        if (!product) throw new Error(`Product with ID ${args.id} not found`)

        return product
    }
})

export const create = defineEntry({
    description: 'Create a new product',
    args: z.object({
        name: z.string().min(1).describe('Product name'),
        price: z.number().min(0).describe('Product price in dollars')
    }),
    res: productSchema,
    handler: async (args, _ctx: context.user) => {
        const product: Product = {
            id: nextId++,
            name: args.name,
            price: args.price,
            createdAt: new Date()
        }

        products.push(product)
        return product
    }
})

export const list = defineEntry({
    description: 'List all products',
    res: z.array(productSchema),
    handler: async () => {
        return products
    }
})
