# Typed Bridge — Strictly Typed Server Functions for TypeScript 🚀

[![Downloads](https://img.shields.io/npm/dm/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge)
[![Version](https://img.shields.io/npm/v/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge)
[![License](https://img.shields.io/npm/l/typed-bridge.svg)](https://github.com/neilveil/typed-bridge/blob/main/license.txt)

**End-to-End Type Safety • Framework Agnostic • Zero Config**

Typed Bridge lets you define **strictly typed server functions** for TypeScript apps — React, Vue, Angular, React Native, and more, without the boilerplate of REST or GraphQL. It automatically generates a client bridge, ensuring your types stay in sync from backend to frontend.

---

## ✨ Features

- ✅ **End-to-end type safety** between client & server
- ✅ **Auto-generated client bridge** for your front-end
- ✅ **In-built graceful shutdown** and error handling
- ✅ **Framework agnostic** — works with any front-end framework
- ✅ **Middleware support** for authentication, validation, logging
- ✅ **Context sharing** between middleware and handlers
- ✅ **Real-time request/response logging** for debugging
- ✅ **Auto import `.env` variables** for config management

---

## ⚡ Quick Start

### 1. Install

```bash
npm i typed-bridge
```

### Back-end Setup

#### 1. Setup Server

Create Server `server.ts`

```typescript
import { createBridge } from 'typed-bridge'
import bridge from './bridge'

// Create and start the server
createBridge(bridge, 8080, '/bridge')
```

#### 2. Create Bridge File

Define Bridge Routes `bridge/index.ts`

```typescript
import * as user from './user'

export default {
    'user.fetch': user.fetch,
    'user.update': user.update,
    'user.fetchAll': user.fetchAll
}
```

#### 3. Declare Functions

Add Handler Functions `bridge/user/index.ts`

```typescript
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
    const user = users.find(user => user.id === args.id)
    if (!user) {
        throw new Error(`User with ID ${args.id} not found`)
    }
    return user
}

export const update = async (args: { id: number; name?: string; email?: string }): Promise<User> => {
    const user = users.find(user => user.id === args.id)
    if (!user) {
        throw new Error(`User with ID ${args.id} not found`)
    }

    if (args.name) user.name = args.name
    if (args.email) user.email = args.email

    return user
}

export const fetchAll = async (): Promise<User[]> => {
    return users
}
```

### Front-end setup

#### Add Typed Bridge Client Generation Script (back-end: `package.json`)

```json
{
    "scripts": {
        "gen:typed-bridge-client": "typed-bridge gen-typed-bridge-client --src ./src/bridge/index.ts --dest ./bridge.ts"
    }
}
```

#### 2. Generate Bridge File

```bash
npm run gen:typed-bridge-client
```

#### 3. Use in Frontend

Import generated `bridge.ts` file from back-end in front-end & call server functions. Usage example:

```typescript
import bridge, { bridgeConfig } from './bridge'

bridgeConfig.host = 'http://localhost:8080/bridge'
bridgeConfig.headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer 123'
}
bridgeConfig.onResponse = res => {
    // Custom response handling
}

const user = await bridge['user.fetch']({ id: 1 })
```

> [Automatically sync bridge file from back-end to front-end](./docs/auto-bridge-sync.md)

## Middleware setup

Typed Bridge provides a middleware system to add custom logic because calling bridge handler.

```ts
createMiddleware('user.fetch', async (req, res) => {
    console.log('Middleware')
})
```

You can also use glob patterns to match multiple routes.

```ts
createMiddleware('user.*', async (req, res) => {
    console.log('Middleware')
})
```

### Setup Context

Middlewares can return a `context` object that will be merged with the request context.

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

The context object will be merged with the request context.

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

### Request validation with Typed Bridge Middleware

Typed Bridge provides a middleware system to validate request.

```ts
createMiddleware('user.*', async (req, res) => {
    if (req.headers.authorization !== 'Bearer 123') {
        throw new Error('Unauthorized')
    }
})
```

Custom error message can be thrown

```ts
createMiddleware('user.*', async (req, res) => {
    if (req.headers.authorization !== 'Bearer 123') {
        res.status(401).send('Unauthorized')

        // Required to stop the request from being processed, else next middleware or bridge handler will be called
        return { next: false }
    }
})
```

### Setup Zod Validation

#### Declare req/res types

`types.ts`

```ts
import { z } from 'zod'

export const fetch = {
    args: z.object({
        id: z.number().min(1)
    }),
    res: z.object({
        id: z.number(),
        name: z.string()
    })
}

export const userContext = z.object({
    id: z.number()
})
```

#### Use in bridge handler

```ts
import { z } from 'zod'
import * as types from './types'

export const fetch = async (
    args: z.infer<typeof types.fetch.args>,
    context: { id: number }
): Promise<z.infer<typeof types.fetch.res>> => {
    args = types.fetch.args.parse(args)

    console.log(context)

    const user = users.find(user => user.id === args.id)
    if (!user) {
        throw new Error(`User with ID ${args.id} not found`)
    }

    return user
}
```

## Configuration

```typescript
import { tbConfig } from 'typed-bridge'

// Logging Configuration
tbConfig.logs.request = true // Enable request logging
tbConfig.logs.response = true // Enable response logging
tbConfig.logs.error = true // Enable error logging

tbConfig.logs.argsOnError = true // Enable args logging on error
tbConfig.logs.contextOnError = true // Enable context logging on error

// Performance Configuration
tbConfig.responseDelay = 0 // Custom response delay in milliseconds (useful for testing)
```

## Environment File

Typed Bridge automatically imports `.env` variables for you, internally using [`dotenv`](https://www.npmjs.com/package/dotenv).

## Developer

Developed & maintained by [neilveil](https://github.com/neilveil). Give a ⭐ to support this project!

---

[Context for AI IDE](https://raw.githubusercontent.com/neilveil/typed-bridge/refs/heads/main/context.md)
