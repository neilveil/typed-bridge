# Typed Bridge - Strictly Typed Server Functions for TypeScript

[![Downloads](https://img.shields.io/npm/dm/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge)
[![Version](https://img.shields.io/npm/v/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge)
[![License](https://img.shields.io/npm/l/typed-bridge.svg)](https://github.com/neilveil/typed-bridge/blob/main/license.txt)

**End-to-End Type Safety · Framework Agnostic · Zero Config**

Typed Bridge lets you define **strictly typed server functions** and auto-generates a typed client for your frontend. Call server functions like local functions, with full type safety from backend to frontend. No routers, no resolvers, no schema stitching. Just plain TypeScript functions.

---

## Quick Start

### 1. Install

```bash
npm i typed-bridge
```

### 2. Setup Server

Create `server.ts`:

```typescript
import { createBridge } from 'typed-bridge'
import bridge from './bridge'

createBridge(bridge, 8080, '/bridge')
```

### 3. Create Bridge File

Define routes in `bridge/index.ts`:

```typescript
import * as user from './user'

export default {
    'user.fetch': user.fetch,
    'user.update': user.update,
    'user.fetchAll': user.fetchAll
}
```

### 4. Declare Functions

These are just normal async functions. The first argument is what the client sends, the return type is what the client receives. That's it.

`bridge/user/index.ts`:

```typescript
interface User {
    id: number
    name: string
    email: string
}

// Fetch a single user by id
export const fetch = async (args: { id: number }): Promise<User> => {
    return db.users.findById(args.id)
}

// Update user fields
export const update = async (args: { id: number; name?: string; email?: string }): Promise<User> => {
    return db.users.update(args.id, args)
}

// List all users
export const fetchAll = async (): Promise<User[]> => {
    return db.users.findAll()
}
```

### 5. Generate Typed Client

Add the generation script to `package.json`:

```json
{
    "scripts": {
        "gen:typed-bridge-client": "typed-bridge gen-typed-bridge-client --src ./src/bridge/index.ts --dest ./bridge.ts"
    }
}
```

Run it:

```bash
npm run gen:typed-bridge-client
```

### 6. Use in Frontend

Import the generated `bridge.ts` file in your frontend:

```typescript
import bridge, { typedBridgeConfig } from './bridge'

typedBridgeConfig.host = 'http://localhost:8080/bridge'
typedBridgeConfig.headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer 123'
}
typedBridgeConfig.onResponse = res => {
    // Custom response handling
}

const user = await bridge['user.fetch']({ id: 1 })
```

---

## Keeping the Client in Sync

The generated `bridge.ts` file lives in your backend and needs to reach your frontend. Here are common approaches:

**Monorepo**: Import the file directly across packages. Simplest if your repos are co-located.

**Copy script**: Add a build step that copies the file: `cp ../backend/bridge.ts ./src/bridge.ts`

**Serve and fetch**: Host the generated file via Express static and use [clone-kit](https://www.npmjs.com/package/clone-kit) to pull it in your frontend build. [Full guide](./docs/auto-bridge-sync.md)

---

## Middleware

Typed Bridge provides middleware that runs before bridge handlers.

```ts
createMiddleware('user.fetch', async (req, res) => {
    console.log('Middleware for user.fetch')
})
```

Use glob patterns to match multiple routes:

```ts
createMiddleware('user.*', async (req, res) => {
    console.log('Middleware for all user routes')
})
```

Middlewares execute in order of specificity, broader patterns run first:

```
*            → runs first (matches everything)
user.*       → runs second
user.fetch   → runs last (most specific)
```

### Context

Middlewares can return a `context` object that gets merged and passed to the handler:

```ts
createMiddleware('user.*', async (req, res) => {
    return {
        context: {
            a: 1
        }
    }
})

createMiddleware('user.fetch', async (req, res) => {
    return {
        context: {
            b: 2
        }
    }
})
```

The handler receives the merged context:

```ts
type Context = {
    a: number
    b: number
}

export const fetch = async (
    args: { id: number },
    context: Context
): Promise<{ id: number; name: string } | undefined> => {
    console.log(context) // { a: 1, b: 2 }
    return users.find(user => user.id === args.id)
}
```

### Request Validation

Throw errors or send custom responses to block requests:

```ts
createMiddleware('user.*', async (req, res) => {
    if (req.headers.authorization !== 'Bearer 123') {
        throw new Error('Unauthorized')
    }
})
```

For custom status codes:

```ts
createMiddleware('user.*', async (req, res) => {
    if (req.headers.authorization !== 'Bearer 123') {
        res.status(401).send('Unauthorized')

        // Required to stop processing, otherwise the next middleware or handler will run
        return { next: false }
    }
})
```

---

## Zod Validation

Typed Bridge ships with Zod and re-exports it as `z`. Define schemas and use them in handlers:

### 1. Declare Schemas

`types.ts`:

```ts
import { z } from 'typed-bridge'

export const fetch = {
    args: z.object({
        id: z.number().min(1)
    }),
    res: z.object({
        id: z.number(),
        name: z.string()
    })
}
```

### 2. Use in Handler

```ts
import { z } from 'typed-bridge'
import * as types from './types'

export const fetch = async (
    args: z.infer<typeof types.fetch.args>,
    context: { id: number }
): Promise<z.infer<typeof types.fetch.res>> => {
    args = types.fetch.args.parse(args)

    const user = users.find(user => user.id === args.id)
    if (!user) {
        throw new Error(`User with ID ${args.id} not found`)
    }

    return user
}
```

The generated client automatically resolves Zod types to plain TypeScript. Your frontend never depends on Zod.

---

## Configuration

```typescript
import { tbConfig } from 'typed-bridge'

tbConfig.logs.request = true
tbConfig.logs.response = true
tbConfig.logs.error = true

tbConfig.logs.argsOnError = true
tbConfig.logs.contextOnError = true

tbConfig.responseDelay = 0 // Artificial delay in ms (useful for testing loading states)
```

---

## Extending the Server

`createBridge` returns the underlying Express `app` and `server` instances, so you can add custom routes, serve static files, or attach any Express middleware:

```typescript
import { createBridge, onShutdown } from 'typed-bridge'
import path from 'path'
import bridge from './bridge'

const { app, server } = createBridge(bridge, 8080, '/bridge')

// Serve static files
app.use(express.static(path.join(__dirname, 'public')))

// Custom GET endpoint
app.get('/status', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() })
})

// Cleanup on graceful shutdown (SIGINT/SIGTERM)
onShutdown(() => {
    console.log('Server shutting down')
})
```

---

## Typed Bridge vs Alternatives

### vs tRPC

|                        | **Typed Bridge**                              | **tRPC**                                           |
| ---------------------- | --------------------------------------------- | -------------------------------------------------- |
| **Setup**              | Define functions, generate typed client, done | Routers, procedures, adapters                      |
| **Monorepo required?** | No, generated client is a standalone file     | Practically yes, for type inference                |
| **Frontend framework** | Any (React, Vue, Angular, RN, etc.)           | React-first, adapters for others                   |
| **Learning curve**     | Minimal, plain async functions                | Moderate, procedures, context, middleware patterns |
| **Runtime validation** | Zod (built-in)                                | Zod or others via `.input()`                       |

### vs GraphQL

|                    | **Typed Bridge**                                       | **GraphQL**                                                |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| **Setup**          | Define functions, generate typed client, done          | Schema definition, resolvers, codegen                      |
| **Type safety**    | Automatic from function signatures                     | Requires codegen toolchain (e.g. GraphQL Code Generator)   |
| **Overfetching**   | Not applicable, you control what each function returns | Solved by design with field selection                      |
| **Learning curve** | Minimal, plain TypeScript                              | Significant: SDL, resolvers, fragments, queries, mutations |
| **Best for**       | App-specific backends, internal APIs                   | Public APIs, multi-client data graphs                      |

Typed Bridge is for teams that want **type-safe RPCs without the architecture overhead**. You write normal TypeScript functions on the server, and the client just works.

---

## Recommended File Organization

```
src/
  server.ts           Server entry
  middleware.ts        Middleware registrations (side-effect import)
  bridge/
    index.ts          Route map (flat object)
    user/
      index.ts        Handler functions
      types.ts        Zod schemas (optional)
    product/
      index.ts        Handler functions
      types.ts        Zod schemas (optional)
```

### Adding a new route

1. Create handler in `bridge/<module>/index.ts`
2. If using Zod, add schemas in `<module>/types.ts` using `z` from `typed-bridge`
3. Register route in `bridge/index.ts` as `'module.action': module.action`
4. If middleware needed, add `createMiddleware(...)` and import the file in server entry
5. Run `gen:typed-bridge-client` to regenerate the typed client

---

## Developer

Developed & maintained by [neilveil](https://github.com/neilveil). Give a star to support this project!
