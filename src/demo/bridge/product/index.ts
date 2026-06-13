import { z } from '../../..'
import * as types from './types'

type Product = z.infer<typeof types.list.res>[number]

let nextId = 4

const products: Product[] = [
    { id: 1, name: 'Laptop', price: 999, createdAt: new Date() },
    { id: 2, name: 'Keyboard', price: 79, createdAt: new Date() },
    { id: 3, name: 'Monitor', price: 349, createdAt: new Date() }
]

type Context = { requestedAt: number; userId: number }

export const fetch = async (
    args: z.infer<typeof types.fetch.args>,
    _context: Context
): Promise<z.infer<typeof types.fetch.res>> => {
    const product = products.find(p => p.id === args.id)
    if (!product) throw new Error(`Product with ID ${args.id} not found`)

    return product
}

export const create = async (
    args: z.infer<typeof types.create.args>,
    _context: Context
): Promise<z.infer<typeof types.create.res>> => {
    const product: Product = {
        id: nextId++,
        name: args.name,
        price: args.price,
        createdAt: new Date()
    }

    products.push(product)
    return product
}

export const list = async (): Promise<z.infer<typeof types.list.res>> => {
    return products
}
