import { z } from '../../..'

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

// --- create ---

export const create = {
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
    })
}

// --- fetch ---

export const fetch = {
    description: 'Fetch an order by ID',
    args: z.object({
        id: z.number().min(1)
    }),
    res: orderSchema
}

// --- update ---

export const update = {
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
    })
}

// --- resolve: exercises ZodDiscriminatedUnion + ZodLiteral + ZodEnum ---

export const resolve = {
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
    ])
}

// --- statusFilter: exercises ZodEnum in args and response ---

export const statusFilter = {
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
    })
}

// --- tag: exercises ZodUnion ---

export const tag = {
    description: 'Tag an order with a string or numeric label',
    args: z.object({
        orderId: z.number().min(1),
        tag: z.union([z.string(), z.number()])
    }),
    res: z.object({
        orderId: z.number(),
        tag: z.union([z.string(), z.number()]),
        appliedAt: z.date()
    })
}

// --- list ---

export const list = {
    description: 'List all orders',
    res: z.array(orderSchema)
}

// --- primitives: exercises all remaining keyword types ---

export const primitives = {
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
    })
}
