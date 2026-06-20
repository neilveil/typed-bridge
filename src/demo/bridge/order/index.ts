import { z, defineEntry } from '../../..'
import * as context from '../context'

// --- Reusable schemas ---

const addressSchema = z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    country: z.string().default('US') // ZodDefault<ZodString> → string
})

const orderItemSchema = z.object({
    productId: z.number(),
    quantity: z.number().min(1),
    price: z.number(),
    notes: z.string().optional(), // ZodOptional<ZodString> → string?
    discount: z.number().nullable() // ZodNullable<ZodNumber> → number | null
})

const orderStatusEnum = z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'])

const orderSchema = z.object({
    id: z.number(),
    customerId: z.number(),
    status: orderStatusEnum,
    total: z.number(),
    items: z.array(orderItemSchema),
    shippingAddress: addressSchema,
    billingAddress: addressSchema.nullable(),
    isGift: z.boolean(),
    giftMessage: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date().nullable()
})

type Order = z.infer<typeof orderSchema>

let nextId = 1

const orders: Order[] = []

const orderTags: Map<number, (string | number)[]> = new Map()

// --- create ---

export const create = defineEntry({
    description: 'Create a new order',
    args: z.object({
        customerId: z.number().min(1),
        items: z.array(orderItemSchema), // ZodArray<ZodObject> → {...}[]
        shippingAddress: addressSchema, // nested ZodObject
        billingAddress: addressSchema.nullable(), // ZodNullable<ZodObject> → {...} | null
        couponCode: z.string().nullable().optional(), // ZodOptional<ZodNullable<ZodString>> → (string | null)?
        scheduledDate: z.date().optional(), // ZodOptional<ZodDate> → Date?
        isGift: z.boolean(), // ZodBoolean → boolean
        giftMessage: z.string().nullable() // ZodNullable<ZodString> → string | null
    }),
    res: z.object({
        id: z.number(),
        status: orderStatusEnum,
        total: z.number(),
        items: z.array(orderItemSchema),
        createdAt: z.date() // ZodDate → Date
    }),
    handler: async (args, _ctx: context.user) => {
        const items = args.items

        const order: Order = {
            id: nextId++,
            customerId: args.customerId,
            status: 'pending',
            total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
            items,
            // `country` is already defaulted to 'US' by the schema, so the parsed addresses are used as-is
            shippingAddress: args.shippingAddress,
            billingAddress: args.billingAddress,
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
})

// --- fetch ---

export const fetch = defineEntry({
    description: 'Fetch an order by ID',
    args: z.object({
        id: z.number().min(1)
    }),
    res: orderSchema,
    handler: async (args, _ctx: context.user) => {
        const order = orders.find(o => o.id === args.id)
        if (!order) throw new Error(`Order with ID ${args.id} not found`)

        return order
    }
})

// --- update ---

export const update = defineEntry({
    description: 'Update an existing order',
    args: z.object({
        id: z.number().min(1),
        status: orderStatusEnum.optional(),
        shippingAddress: addressSchema.optional(), // ZodOptional<ZodObject> → {...}?
        giftMessage: z.string().nullable().optional()
    }),
    res: z.object({
        id: z.number(),
        status: orderStatusEnum,
        updatedAt: z.date()
    }),
    handler: async (args, _ctx: context.user) => {
        const order = orders.find(o => o.id === args.id)
        if (!order) throw new Error(`Order with ID ${args.id} not found`)

        if (args.status) order.status = args.status
        if (args.shippingAddress) order.shippingAddress = args.shippingAddress
        if (args.giftMessage !== undefined) order.giftMessage = args.giftMessage ?? null
        order.updatedAt = new Date()

        return { id: order.id, status: order.status, updatedAt: order.updatedAt }
    }
})

// --- list ---

export const list = defineEntry({
    description: 'List all orders',
    res: z.array(orderSchema),
    handler: async () => {
        return orders
    }
})

// --- resolve: exercises ZodDiscriminatedUnion + ZodLiteral + ZodEnum ---

export const resolve = defineEntry({
    description: 'Resolve order status — returns found or not_found',
    args: z.object({
        id: z.number().min(1)
    }),
    res: z.discriminatedUnion('status', [
        z.object({
            status: z.literal('found'),
            order: z.object({
                id: z.number(),
                customerName: z.string(),
                orderStatus: orderStatusEnum,
                total: z.number()
            })
        }),
        z.object({
            status: z.literal('not_found')
        })
    ]),
    handler: async (args, _ctx: context.user) => {
        const order = orders.find(o => o.id === args.id)
        if (!order) return { status: 'not_found' as const }

        return {
            status: 'found' as const,
            order: {
                id: order.id,
                customerName: `Customer #${order.customerId}`,
                orderStatus: order.status,
                total: order.total
            }
        }
    }
})

// --- statusFilter: exercises ZodEnum in args and response ---

export const statusFilter = defineEntry({
    description: 'Filter orders by status',
    args: z.object({
        status: orderStatusEnum
    }),
    res: z.object({
        orders: z.array(
            z.object({
                id: z.number(),
                status: orderStatusEnum,
                total: z.number()
            })
        )
    }),
    handler: async (args, _ctx: context.user) => {
        return {
            orders: orders
                .filter(o => o.status === args.status)
                .map(o => ({ id: o.id, status: o.status, total: o.total }))
        }
    }
})

// --- tag: exercises ZodUnion ---

export const tag = defineEntry({
    description: 'Tag an order with a string or numeric label',
    args: z.object({
        orderId: z.number().min(1),
        tag: z.union([z.string(), z.number()])
    }),
    res: z.object({
        orderId: z.number(),
        tag: z.union([z.string(), z.number()]),
        appliedAt: z.date()
    }),
    handler: async (args, _ctx: context.user) => {
        const order = orders.find(o => o.id === args.orderId)
        if (!order) throw new Error(`Order with ID ${args.orderId} not found`)

        const tags = orderTags.get(args.orderId) || []
        tags.push(args.tag)
        orderTags.set(args.orderId, tags)

        return { orderId: args.orderId, tag: args.tag, appliedAt: new Date() }
    }
})

// --- primitives: exercises all remaining keyword types ---

export const primitives = defineEntry({
    description: 'Return all primitive type examples',
    args: z.object({
        key: z.string()
    }),
    res: z.object({
        str: z.string(), // ZodString → string
        num: z.number(), // ZodNumber → number
        bool: z.boolean(), // ZodBoolean → boolean
        date: z.date(), // ZodDate → Date
        nul: z.null(), // ZodNull → null
        undef: z.undefined(), // ZodUndefined → undefined
        unk: z.unknown(), // ZodUnknown → unknown
        whatever: z.any(), // ZodAny → any
        optStr: z.string().optional(), // ZodOptional<ZodString> → string?
        nullStr: z.string().nullable(), // ZodNullable<ZodString> → string | null
        defStr: z.string().default('hello'), // ZodDefault<ZodString> → string
        optNullStr: z.string().nullable().optional(), // ZodOptional<ZodNullable> → (string | null)?
        nullOptStr: z.string().optional().nullable(), // ZodNullable<ZodOptional> → (string | undefined) | null
        tags: z.array(z.string()), // ZodArray<ZodString> → string[]
        scores: z.array(z.number()).nullable(), // ZodNullable<ZodArray<ZodNumber>> → number[] | null
        optDates: z.array(z.date()).optional(), // ZodOptional<ZodArray<ZodDate>> → Date[]?
        nested: z.object({
            a: z.number(),
            b: z.string().optional(),
            c: z.object({
                d: z.boolean(),
                e: z.array(z.string()).nullable()
            })
        })
    }),
    handler: async () => {
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
})
