/**
 * Compile-time type test for the generated typed-bridge client.
 *
 * This file is NOT executed — it only needs to pass `tsc --noEmit`.
 * If the generated client has broken types (e.g. leaked Zod internals,
 * wrong arg/return shapes), this file will fail to compile.
 *
 * Run: npx tsc --noEmit --strict test/types.ts
 */

import { typedBridge } from './bridge'

// --- Helper: assert two types are exactly equal ---
type Expect<T extends true> = T
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// --- 1. Correct args are accepted ---

typedBridge['user.fetch']({ id: 1 })
typedBridge['user.create']({ name: 'Alice', email: 'alice@test.com' })
typedBridge['user.update']({ id: 1 })
typedBridge['user.update']({ id: 1, name: 'Bob', email: 'bob@test.com' })
typedBridge['user.fetchAll']()
typedBridge['product.fetch']({ id: 1 })
typedBridge['product.create']({ name: 'Widget', price: 10 })
typedBridge['product.list']()

// --- 2. Return types resolve correctly ---

type UserFetchReturn = Awaited<ReturnType<typeof typedBridge['user.fetch']>>
type _T1 = Expect<Equal<UserFetchReturn, { id: number; name: string; email: string; createdAt: Date }>>

type ProductListReturn = Awaited<ReturnType<typeof typedBridge['product.list']>>
type _T2 = Expect<Equal<ProductListReturn, { id: number; name: string; price: number; createdAt: Date }[]>>

type RemoveReturn = Awaited<ReturnType<typeof typedBridge['user.remove']>>
type _T3 = Expect<Equal<RemoveReturn, { success: boolean }>>

// --- 3. No-arg functions don't accept arguments ---

// @ts-expect-error: fetchAll takes no args
typedBridge['user.fetchAll']({ id: 1 })
// @ts-expect-error: product.list takes no args
typedBridge['product.list']({ page: 1 })

// --- 4. Wrong arg types are rejected ---

// @ts-expect-error: id must be number, not string
typedBridge['user.fetch']({ id: '1' })
// @ts-expect-error: missing required field 'email'
typedBridge['user.create']({ name: 'Alice' })
// @ts-expect-error: price must be number
typedBridge['product.create']({ name: 'Widget', price: '10' })

// --- 5. Complex types: nullable, optional, nested, union, enum ---

typedBridge['order.create']({
    customerId: 1,
    items: [{ productId: 1, quantity: 2, price: 100, discount: null }],
    shippingAddress: { street: '123 Main', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
    billingAddress: null,
    isGift: false,
    giftMessage: null
})

// Optional + nullable field
typedBridge['order.create']({
    customerId: 1,
    items: [{ productId: 1, quantity: 1, price: 50, discount: 10, notes: 'Gift wrap' }],
    shippingAddress: { street: '1 St', city: 'LA', state: 'CA', zip: '90001', country: 'US' },
    billingAddress: { street: '2 St', city: 'LA', state: 'CA', zip: '90002', country: 'US' },
    couponCode: 'SAVE10',
    scheduledDate: new Date(),
    isGift: true,
    giftMessage: 'Happy birthday!'
})

// Enum literal types
typedBridge['order.statusFilter']({ status: 'pending' })
typedBridge['order.statusFilter']({ status: 'shipped' })
// @ts-expect-error: invalid enum value
typedBridge['order.statusFilter']({ status: 'unknown' })

// Union type (string | number)
typedBridge['order.tag']({ orderId: 1, tag: 'vip' })
typedBridge['order.tag']({ orderId: 1, tag: 42 })
// @ts-expect-error: tag can't be boolean
typedBridge['order.tag']({ orderId: 1, tag: true })

// Discriminated union return type
type ResolveReturn = Awaited<ReturnType<typeof typedBridge['order.resolve']>>
type _T4 = Expect<
    Equal<
        ResolveReturn,
        | { status: 'found'; order: { id: number; customerName: string; orderStatus: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'; total: number } }
        | { status: 'not_found' }
    >
>

// --- 6. No leaked Zod internals (email field is string, not ZodEmail) ---

type CreateArgs = Parameters<typeof typedBridge['user.create']>[0]
type _T5 = Expect<Equal<CreateArgs['email'], string>>

type UpdateArgs = Parameters<typeof typedBridge['user.update']>[0]
type _T6 = Expect<Equal<UpdateArgs['email'], string | undefined>>

// --- 7. Only known bridge keys are accessible ---

// @ts-expect-error: nonexistent route
typedBridge['user.nonexistent']({ id: 1 })
