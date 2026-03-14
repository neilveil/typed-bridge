import { $z } from '../../..'

// --- Reusable schemas ---

const addressSchema = $z.object({
    street: $z.string(),
    city: $z.string(),
    state: $z.string(),
    zip: $z.string(),
    country: $z.string().default('US')              // ZodDefault<ZodString> → string
})

const orderItemSchema = $z.object({
    productId: $z.number(),
    quantity: $z.number().min(1),
    price: $z.number(),
    notes: $z.string().optional(),                   // ZodOptional<ZodString> → string?
    discount: $z.number().nullable()                 // ZodNullable<ZodNumber> → number | null
})

// --- create ---

export const create = {
    args: $z.object({
        customerId: $z.number().min(1),
        items: $z.array(orderItemSchema),            // ZodArray<ZodObject> → {...}[]
        shippingAddress: addressSchema,              // nested ZodObject
        billingAddress: addressSchema.nullable(),    // ZodNullable<ZodObject> → {...} | null
        couponCode: $z.string().nullable().optional(), // ZodOptional<ZodNullable<ZodString>> → (string | null)?
        scheduledDate: $z.date().optional(),         // ZodOptional<ZodDate> → Date?
        isGift: $z.boolean(),                        // ZodBoolean → boolean
        giftMessage: $z.string().nullable()          // ZodNullable<ZodString> → string | null
    }),
    res: $z.object({
        id: $z.number(),
        status: $z.string(),
        total: $z.number(),
        items: $z.array(orderItemSchema),
        createdAt: $z.date()                         // ZodDate → Date
    })
}

// --- fetch ---

export const fetch = {
    args: $z.object({
        id: $z.number().min(1)
    }),
    res: $z.object({
        id: $z.number(),
        customerId: $z.number(),
        status: $z.string(),
        total: $z.number(),
        items: $z.array(orderItemSchema),
        shippingAddress: addressSchema,
        billingAddress: addressSchema.nullable(),
        isGift: $z.boolean(),
        giftMessage: $z.string().nullable(),
        createdAt: $z.date(),
        updatedAt: $z.date().nullable()              // ZodNullable<ZodDate> → Date | null
    })
}

// --- update ---

export const update = {
    args: $z.object({
        id: $z.number().min(1),
        status: $z.string().optional(),
        shippingAddress: addressSchema.optional(),   // ZodOptional<ZodObject> → {...}?
        giftMessage: $z.string().nullable().optional()
    }),
    res: $z.object({
        id: $z.number(),
        status: $z.string(),
        updatedAt: $z.date()
    })
}

// --- primitives: exercises all remaining keyword types ---

export const primitives = {
    args: $z.object({
        key: $z.string()
    }),
    res: $z.object({
        str: $z.string(),                            // ZodString → string
        num: $z.number(),                            // ZodNumber → number
        bool: $z.boolean(),                          // ZodBoolean → boolean
        date: $z.date(),                             // ZodDate → Date
        nul: $z.null(),                              // ZodNull → null
        undef: $z.undefined(),                       // ZodUndefined → undefined
        unk: $z.unknown(),                           // ZodUnknown → unknown
        whatever: $z.any(),                          // ZodAny → any
        optStr: $z.string().optional(),              // ZodOptional<ZodString> → string?
        nullStr: $z.string().nullable(),             // ZodNullable<ZodString> → string | null
        defStr: $z.string().default('hello'),        // ZodDefault<ZodString> → string
        optNullStr: $z.string().nullable().optional(), // ZodOptional<ZodNullable> → (string | null)?
        nullOptStr: $z.string().optional().nullable(), // ZodNullable<ZodOptional> → (string | undefined) | null
        tags: $z.array($z.string()),                 // ZodArray<ZodString> → string[]
        scores: $z.array($z.number()).nullable(),    // ZodNullable<ZodArray<ZodNumber>> → number[] | null
        optDates: $z.array($z.date()).optional(),    // ZodOptional<ZodArray<ZodDate>> → Date[]?
        nested: $z.object({
            a: $z.number(),
            b: $z.string().optional(),
            c: $z.object({
                d: $z.boolean(),
                e: $z.array($z.string()).nullable()
            })
        })
    })
}
