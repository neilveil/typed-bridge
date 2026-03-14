import { $z } from '../../..'
import * as types from './types'

export interface OrderItem {
    productId: number
    quantity: number
    price: number
    notes?: string
    discount: number | null
}

export interface Address {
    street: string
    city: string
    state: string
    zip: string
    country: string
}

export interface Order {
    id: number
    customerId: number
    status: string
    total: number
    items: OrderItem[]
    shippingAddress: Address
    billingAddress: Address | null
    isGift: boolean
    giftMessage: string | null
    createdAt: Date
    updatedAt: Date | null
}

let nextId = 1

const orders: Order[] = []

type Context = { requestedAt: number; userId: number }

export const create = async (
    args: $z.infer<typeof types.create.args>,
    context: Context
): Promise<$z.infer<typeof types.create.res>> => {
    args = types.create.args.parse(args)

    const items = args.items.map(item => ({
        ...item,
        price: item.price,
        discount: item.discount
    }))

    const order: Order = {
        id: nextId++,
        customerId: args.customerId,
        status: 'pending',
        total: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
        items,
        shippingAddress: { ...args.shippingAddress, country: args.shippingAddress.country ?? 'US' },
        billingAddress: args.billingAddress ? { ...args.billingAddress, country: args.billingAddress.country ?? 'US' } : null,
        isGift: args.isGift,
        giftMessage: args.giftMessage,
        createdAt: new Date(),
        updatedAt: null
    }

    orders.push(order)

    return {
        id: order.id,
        status: order.status,
        total: order.total,
        items: order.items,
        createdAt: order.createdAt
    }
}

export const fetch = async (
    args: $z.infer<typeof types.fetch.args>,
    context: Context
): Promise<$z.infer<typeof types.fetch.res>> => {
    args = types.fetch.args.parse(args)

    const order = orders.find(o => o.id === args.id)
    if (!order) throw new Error(`Order with ID ${args.id} not found`)

    return order
}

export const update = async (
    args: $z.infer<typeof types.update.args>,
    context: Context
): Promise<$z.infer<typeof types.update.res>> => {
    args = types.update.args.parse(args)

    const order = orders.find(o => o.id === args.id)
    if (!order) throw new Error(`Order with ID ${args.id} not found`)

    if (args.status) order.status = args.status
    if (args.shippingAddress) order.shippingAddress = { ...args.shippingAddress, country: args.shippingAddress.country ?? 'US' }
    if (args.giftMessage !== undefined) order.giftMessage = args.giftMessage ?? null
    order.updatedAt = new Date()

    return { id: order.id, status: order.status, updatedAt: order.updatedAt }
}

export const list = async (): Promise<Order[]> => {
    return orders
}

export const primitives = async (
    args: $z.infer<typeof types.primitives.args>
): Promise<$z.infer<typeof types.primitives.res>> => {
    args = types.primitives.args.parse(args)

    return {
        str: 'hello',
        num: 42,
        bool: true,
        date: new Date(),
        nul: null,
        undef: undefined,
        unk: { anything: true },
        whatever: 'literally anything',
        optStr: 'present',
        nullStr: null,
        defStr: 'default value',
        optNullStr: null,
        nullOptStr: undefined,
        tags: ['a', 'b', 'c'],
        scores: [1, 2, 3],
        optDates: [new Date()],
        nested: {
            a: 1,
            b: 'nested',
            c: {
                d: true,
                e: ['deep']
            }
        }
    }
}
