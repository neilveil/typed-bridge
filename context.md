# **Using `typed-bridge` to Build a Backend**

## **What is `typed-bridge`?**

`typed-bridge` is an open‑source TypeScript package that lets you define **strictly typed server functions** and automatically generate a matching **typed client** for your frontend.
It removes the boilerplate of REST/GraphQL by letting you call server functions like local functions — while keeping **end‑to‑end type safety** between backend and frontend.
It’s framework‑agnostic, works with any frontend (React, Vue, Angular, RN, etc.), supports middleware for auth/validation/logging, and has built‑in graceful shutdown and request logging.

**Why use it?**

- Prevents API spec drift between backend and frontend
- Strong TypeScript type checking across the stack
- Simple middleware for auth, validation, and context sharing
- No need to hand‑roll REST/GraphQL routes

---

## **How to Start a Server**

```ts
// src/server.ts
import { createBridge, tbConfig } from 'typed-bridge'
import bridge from './bridge/index.js'
import './middleware/auth.js' // optional middleware

// Optional logging
tbConfig.logs.request = true
tbConfig.logs.response = true
tbConfig.logs.error = true

createBridge(bridge, 8080, '/bridge')
console.log(`Bridge running at http://localhost:8080/bridge`)
```

---

## **How to Define Routes**

```ts
// src/bridge/index.ts
import * as user from './user/index.js'

export default {
    'user.fetch': user.fetch,
    'user.update': user.update,
    'user.fetchAll': user.fetchAll
}
```

---

## **How to Write Handlers**

```ts
// src/bridge/user/index.ts
export interface User {
    id: number
    name: string
    email: string
    createdAt: Date
}

const users: User[] = [
    { id: 1, name: 'Neil', email: 'neil@example.com', createdAt: new Date() },
    { id: 2, name: 'John', email: 'john@example.com', createdAt: new Date() },
    { id: 3, name: 'Jane', email: 'jane@example.com', createdAt: new Date() }
]

export const fetch = async (args: { id: number }): Promise<User> => {
    const user = users.find(u => u.id === args.id)
    if (!user) throw new Error(`User ${args.id} not found`)
    return user
}

export const update = async (args: { id: number; name?: string; email?: string }): Promise<User> => {
    const user = users.find(u => u.id === args.id)
    if (!user) throw new Error(`User ${args.id} not found`)
    if (args.name) user.name = args.name
    if (args.email) user.email = args.email
    return user
}

export const fetchAll = async (): Promise<User[]> => users
```

---

## **How to Add Middleware**

```ts
// src/middleware/auth.ts
import { createMiddleware } from 'typed-bridge'

createMiddleware('user.*', async (req, res) => {
    if (req.headers.authorization !== 'Bearer 123') {
        res.status(401).send('Unauthorized')
        return { next: false } // Stop processing
    }
    return { context: { userId: 999 } }
})
```

---

## **How to Validate with `$z` (Zod)**

```ts
// src/bridge/user/types.ts
import { $z } from 'typed-bridge'

export const fetch = {
    args: $z.object({ id: $z.number().min(1) }),
    res: $z.object({
        id: $z.number(),
        name: $z.string(),
        email: $z.string().email(),
        createdAt: $z.date()
    })
}
```

```ts
// src/bridge/user/index.ts (validated version)
import { $z } from 'typed-bridge'
import * as types from './types.js'

export const fetch = async (
    args: $z.infer<typeof types.fetch.args>,
    context: { userId?: number }
): Promise<$z.infer<typeof types.fetch.res>> => {
    args = types.fetch.args.parse(args)
    const user = users.find(u => u.id === args.id)
    if (!user) throw new Error(`User ${args.id} not found`)
    return user
}
```

---

## **How to Generate a Typed Client**

```bash
npm run gen:typed-bridge-client
# => creates ./bridge.ts
```

---

## **How to Use the Generated Client (Frontend)**

```ts
import bridge, { bridgeConfig } from '../path-to-backend/bridge'

bridgeConfig.host = 'http://localhost:8080/bridge'
bridgeConfig.headers = { 'Content-Type': 'application/json', Authorization: 'Bearer 123' }

const user = await bridge['user.fetch']({ id: 1 })
console.log(user)
```

---

## **How to Add a New Route (Checklist)**

1. Create handler in `src/bridge/<module>/index.ts`
2. Add `'module.method': handler` to `src/bridge/index.ts`
3. (If validating) add types in `src/bridge/<module>/types.ts`
4. Run `npm run gen:typed-bridge-client` to refresh the client

---

## **Environment Variables**

Typed Bridge automatically imports `.env` variables for you, internally using [`dotenv`](https://www.npmjs.com/package/dotenv`). This means any environment variables defined in a `.env` file at the root of your project will be available to your application without additional setup.
