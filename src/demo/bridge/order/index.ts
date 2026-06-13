import { z } from '../../..'
import * as types from './types'

type Order = z.infer<typeof types.list.res>[number]

let nextId = 1

const orders: Order[] = []

type Context = { requestedAt: number; userId: number }

export const create = async (
    args: z.infer<typeof types.create.args>,
    _context: Context
): Promise<z.infer<typeof types.create.res>> => {
    const items = args.items

    const order: Order = {
        id: nextId++,
        customerId: args.customerId,
        status: 'pending',
        total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
        items,
        shippingAddress: { ...args.shippingAddress, country: args.shippingAddress.country ?? 'US' },
        billingAddress: args.billingAddress
            ? { ...args.billingAddress, country: args.billingAddress.country ?? 'US' }
            : null,
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
    args: z.infer<typeof types.fetch.args>,
    _context: Context
): Promise<z.infer<typeof types.fetch.res>> => {
    const order = orders.find(o => o.id === args.id)
    if (!order) throw new Error(`Order with ID ${args.id} not found`)

    return order
}

export const update = async (
    args: z.infer<typeof types.update.args>,
    _context: Context
): Promise<z.infer<typeof types.update.res>> => {
    const order = orders.find(o => o.id === args.id)
    if (!order) throw new Error(`Order with ID ${args.id} not found`)

    if (args.status) order.status = args.status
    if (args.shippingAddress)
        order.shippingAddress = { ...args.shippingAddress, country: args.shippingAddress.country ?? 'US' }
    if (args.giftMessage !== undefined) order.giftMessage = args.giftMessage ?? null
    order.updatedAt = new Date()

    return { id: order.id, status: order.status, updatedAt: order.updatedAt }
}

export const list = async (): Promise<z.infer<typeof types.list.res>> => {
    return orders
}

export const resolve = async (
    args: z.infer<typeof types.resolve.args>,
    _context: Context
): Promise<z.infer<typeof types.resolve.res>> => {
    const order = orders.find(o => o.id === args.id)
    if (!order) return { status: 'not_found' }

    return {
        status: 'found',
        order: {
            id: order.id,
            customerName: `Customer #${order.customerId}`,
            orderStatus: order.status,
            total: order.total
        }
    }
}

export const statusFilter = async (
    args: z.infer<typeof types.statusFilter.args>,
    _context: Context
): Promise<z.infer<typeof types.statusFilter.res>> => {
    return {
        orders: orders
            .filter(o => o.status === args.status)
            .map(o => ({ id: o.id, status: o.status, total: o.total }))
    }
}

const orderTags: Map<number, (string | number)[]> = new Map()

export const tag = async (
    args: z.infer<typeof types.tag.args>,
    _context: Context
): Promise<z.infer<typeof types.tag.res>> => {
    const order = orders.find(o => o.id === args.orderId)
    if (!order) throw new Error(`Order with ID ${args.orderId} not found`)

    const tags = orderTags.get(args.orderId) || []
    tags.push(args.tag)
    orderTags.set(args.orderId, tags)

    return { orderId: args.orderId, tag: args.tag, appliedAt: new Date() }
}

export const primitives = async (
    // Kept for signature/validation; underscore-prefixing would leak into the generated client
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    args: z.infer<typeof types.primitives.args>
): Promise<z.infer<typeof types.primitives.res>> => {
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
