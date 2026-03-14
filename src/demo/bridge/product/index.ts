import { z } from '../../..'
import * as types from './types'

export interface Product {
    id: number
    name: string
    price: number
    createdAt: Date
}

let nextId = 4

const products: Product[] = [
    { id: 1, name: 'Laptop', price: 999, createdAt: new Date() },
    { id: 2, name: 'Keyboard', price: 79, createdAt: new Date() },
    { id: 3, name: 'Monitor', price: 349, createdAt: new Date() }
]

type Context = { requestedAt: number; userId: number }

export const fetch = async (
    args: z.infer<typeof types.fetch.args>,
    context: Context
): Promise<z.infer<typeof types.fetch.res>> => {
    args = types.fetch.args.parse(args)

    const product = products.find(p => p.id === args.id)
    if (!product) throw new Error(`Product with ID ${args.id} not found`)

    return product
}

export const create = async (
    args: z.infer<typeof types.create.args>,
    context: Context
): Promise<z.infer<typeof types.create.res>> => {
    args = types.create.args.parse(args)

    const product: Product = {
        id: nextId++,
        name: args.name,
        price: args.price,
        createdAt: new Date()
    }

    products.push(product)
    return product
}

export const list = async (): Promise<Product[]> => {
    return products
}
