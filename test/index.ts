import bridge, { typedBridgeConfig } from './bridge'

typedBridgeConfig.host = 'http://localhost:8080/bridge'
typedBridgeConfig.headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer 123'
}

let passed = 0
let failed = 0

const test = async (name: string, fn: () => Promise<void>) => {
    try {
        await fn()
        passed++
        console.log(`  ✅ ${name}`)
    } catch (error: any) {
        failed++
        console.error(`  ❌ ${name}: ${error.message}`)
    }
}

const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message)
}

const expectError = async (fn: () => Promise<any>, expectedSubstring?: string) => {
    try {
        await fn()
        throw new Error('Expected an error but none was thrown')
    } catch (error: any) {
        if (expectedSubstring && !error.message.includes(expectedSubstring)) {
            throw new Error(`Expected error containing "${expectedSubstring}", got: "${error.message}"`)
        }
    }
}

const main = async () => {
    console.log('\n--- User routes ---\n')

    await test('user.fetchAll returns users', async () => {
        const users = await bridge['user.fetchAll']()
        assert(users.length >= 3, `Expected at least 3 users, got ${users.length}`)
        assert(typeof users[0].id === 'number', `Expected numeric id`)
        assert(typeof users[0].name === 'string', `Expected string name`)
    })

    await test('user.fetch returns a user by id', async () => {
        const user = await bridge['user.fetch']({ id: 1 })
        assert(user.id === 1, `Expected id 1, got ${user.id}`)
        assert(typeof user.name === 'string', `Expected string name`)
    })

    await test('user.create adds a new user', async () => {
        const user = await bridge['user.create']({ name: 'Alice', email: 'alice@example.com' })
        assert(user.name === 'Alice', `Expected name "Alice", got "${user.name}"`)
        assert(user.email === 'alice@example.com', `Expected email "alice@example.com"`)
        assert(typeof user.id === 'number', `Expected numeric id`)
    })

    await test('user.update modifies an existing user', async () => {
        const user = await bridge['user.update']({ id: 1, name: 'Neil Updated' })
        assert(user.name === 'Neil Updated', `Expected name "Neil Updated", got "${user.name}"`)
    })

    await test('user.fetch not found throws error', async () => {
        await expectError(() => bridge['user.fetch']({ id: 999 }), 'User with ID 999 not found')
    })

    await test('user.fetch zod validation rejects id < 1', async () => {
        await expectError(() => bridge['user.fetch']({ id: 0 }))
    })

    await test('user.remove requires admin header', async () => {
        await expectError(() => bridge['user.remove']({ id: 999 }), 'Admin access required')
    })

    await test('user.remove works with admin header', async () => {
        const created = await bridge['user.create']({ name: 'ToRemove', email: 'remove@test.com' })
        typedBridgeConfig.headers['X-Admin'] = 'true'
        const result = await bridge['user.remove']({ id: created.id })
        delete typedBridgeConfig.headers['X-Admin']
        assert(result.success === true, `Expected success: true`)
    })

    console.log('\n--- Product routes ---\n')

    await test('product.list returns products', async () => {
        const products = await bridge['product.list']()
        assert(products.length >= 3, `Expected at least 3 products, got ${products.length}`)
    })

    await test('product.fetch returns a product by id', async () => {
        const product = await bridge['product.fetch']({ id: 1 })
        assert(product.id === 1, `Expected id 1, got ${product.id}`)
        assert(typeof product.name === 'string', `Expected string name`)
    })

    await test('product.create adds a new product', async () => {
        const product = await bridge['product.create']({ name: 'Mouse', price: 29 })
        assert(product.name === 'Mouse', `Expected "Mouse", got "${product.name}"`)
        assert(product.price === 29, `Expected price 29, got ${product.price}`)
    })

    await test('product.fetch not found throws error', async () => {
        await expectError(() => bridge['product.fetch']({ id: 999 }), 'Product with ID 999 not found')
    })

    await test('product.fetch zod validation rejects id < 1', async () => {
        await expectError(() => bridge['product.fetch']({ id: 0 }))
    })

    console.log('\n--- Order routes (complex Zod types) ---\n')

    let createdOrderId: number

    await test('order.create with nested objects, arrays, nullable, optional', async () => {
        const order = await bridge['order.create']({
            customerId: 1,
            items: [
                { productId: 1, quantity: 2, price: 999, notes: 'Gift wrap', discount: 50 },
                { productId: 2, quantity: 1, price: 79, discount: null }
            ],
            shippingAddress: { street: '123 Main St', city: 'NYC', state: 'NY', zip: '10001' },
            billingAddress: null,
            couponCode: 'SAVE10',
            isGift: true,
            giftMessage: 'Happy birthday!'
        })
        assert(typeof order.id === 'number', `Expected numeric id`)
        assert(order.status === 'pending', `Expected status "pending"`)
        assert(order.total === 2077, `Expected total 2077, got ${order.total}`)
        assert(order.items.length === 2, `Expected 2 items`)
        assert(order.items[0].notes === 'Gift wrap', `Expected notes`)
        assert(order.items[1].discount === null, `Expected null discount`)
        createdOrderId = order.id
    })

    await test('order.fetch returns full order with all nested types', async () => {
        const order = await bridge['order.fetch']({ id: createdOrderId })
        assert(order.customerId === 1, `Expected customerId 1`)
        assert(order.shippingAddress.city === 'NYC', `Expected city "NYC"`)
        assert(order.billingAddress === null, `Expected null billingAddress`)
        assert(order.isGift === true, `Expected isGift true`)
        assert(order.giftMessage === 'Happy birthday!', `Expected giftMessage`)
        assert(order.updatedAt === null, `Expected null updatedAt`)
    })

    await test('order.create with optional fields omitted', async () => {
        const order = await bridge['order.create']({
            customerId: 2,
            items: [{ productId: 3, quantity: 1, price: 349, discount: null }],
            shippingAddress: { street: '456 Oak Ave', city: 'LA', state: 'CA', zip: '90001' },
            billingAddress: { street: '789 Elm St', city: 'LA', state: 'CA', zip: '90002' },
            isGift: false,
            giftMessage: null
        })
        assert(order.status === 'pending', `Expected status "pending"`)
        assert(order.items[0].notes === undefined, `Expected undefined notes`)
    })

    await test('order.update with optional nested object', async () => {
        const result = await bridge['order.update']({
            id: createdOrderId,
            status: 'shipped',
            shippingAddress: { street: '999 New St', city: 'SF', state: 'CA', zip: '94101' }
        })
        assert(result.status === 'shipped', `Expected status "shipped"`)
    })

    await test('order.list returns created orders', async () => {
        const orders = await bridge['order.list']()
        assert(orders.length >= 2, `Expected at least 2 orders, got ${orders.length}`)
    })

    await test('order.fetch not found throws error', async () => {
        await expectError(() => bridge['order.fetch']({ id: 999 }), 'Order with ID 999 not found')
    })

    await test('order.fetch zod validation rejects id < 1', async () => {
        await expectError(() => bridge['order.fetch']({ id: 0 }))
    })

    await test('order.primitives returns all resolved primitive types', async () => {
        const res = await bridge['order.primitives']({ key: 'test' })
        assert(res.str === 'hello', `Expected str "hello"`)
        assert(res.num === 42, `Expected num 42`)
        assert(res.bool === true, `Expected bool true`)
        assert(typeof res.date === 'string', `Expected date serialized as string`)
        assert(res.nul === null, `Expected nul null`)
        assert(res.undef === undefined || !('undef' in res), `Expected undef undefined`)
        assert(res.whatever === 'literally anything', `Expected any value`)
        assert(res.optStr === 'present', `Expected optStr "present"`)
        assert(res.nullStr === null, `Expected nullStr null`)
        assert(res.defStr === 'default value', `Expected defStr "default value"`)
        assert(res.optNullStr === null, `Expected optNullStr null`)
        assert(Array.isArray(res.tags) && res.tags.length === 3, `Expected 3 tags`)
        assert(Array.isArray(res.scores) && res.scores.length === 3, `Expected 3 scores`)
        assert(Array.isArray(res.optDates) && res.optDates.length === 1, `Expected 1 optDate`)
        assert(res.nested.a === 1, `Expected nested.a === 1`)
        assert(res.nested.b === 'nested', `Expected nested.b === "nested"`)
        assert(res.nested.c.d === true, `Expected nested.c.d === true`)
        assert(Array.isArray(res.nested.c.e) && res.nested.c.e[0] === 'deep', `Expected nested.c.e[0] === "deep"`)
    })

    console.log('\n--- Middleware ---\n')

    await test('unauthorized request is rejected', async () => {
        const savedAuth = typedBridgeConfig.headers['Authorization']
        delete typedBridgeConfig.headers['Authorization']

        await expectError(() => bridge['user.fetch']({ id: 1 }), 'Unauthorized')

        typedBridgeConfig.headers['Authorization'] = savedAuth
    })

    console.log('\n--- Custom routes ---\n')

    await test('health endpoint returns status OK', async () => {
        const res = await fetch('http://localhost:8080/bridge/health')
        const data = await res.json() as any
        assert(data.status === 'OK', `Expected status "OK", got "${data.status}"`)
    })

    await test('custom /status route returns uptime', async () => {
        const res = await fetch('http://localhost:8080/status')
        const data = await res.json() as any
        assert(data.status === 'ok', `Expected status "ok", got "${data.status}"`)
        assert(typeof data.uptime === 'number', `Expected numeric uptime`)
    })

    console.log('\n--- onResponse callback ---\n')

    await test('onResponse is called on every request', async () => {
        let callbackFired = false
        typedBridgeConfig.onResponse = () => {
            callbackFired = true
        }

        await bridge['user.fetchAll']()
        assert(callbackFired, 'onResponse callback was not called')

        typedBridgeConfig.onResponse = () => {}
    })

    // Summary
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`)
    process.exit(failed > 0 ? 1 : 0)
}

main()
