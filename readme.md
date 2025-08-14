# Typed Bridge - Strictly typed server functions for typescript apps 🚀

[![Downloads](https://img.shields.io/npm/dm/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge) [![Version](https://img.shields.io/npm/v/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge)

**Strictly Typed | Production Ready | No Configuration Server**

Typed Bridge allows you to build **typed server functions** which is tightly coupled with typescript apps like React, React Native, Vue, Angular etc.

## ✨ Features

- ✅ End-to-end type safety between client & server
- ✅ Auto-generated client bridge for your front-end
- ✅ Zero config server setup
- ✅ In-built graceful shutdown
- ✅ Framework agnostic

## ⚡ Quick Start

### Install

```bash
npm i typed-bridge
```

### Back-end setup

#### Setup server

`server.ts`

```ts
import { createBridge } from 'typed-bridge'
import bridge from './bridge'

createBridge(bridge, 8080, '/bridge')
```

#### Create a bridge file

`bridge/index.ts`

```ts
export default {
    'user.fetch': user.fetch,
    'user.update': user.update,
    'user.fetchAll': user.fetchAll
}
```

#### Declare functions

`bridge/user/index.ts`

```ts
const users = [
    { id: 1, name: 'Neil' },
    { id: 2, name: 'John' },
    { id: 3, name: 'Jane' }
]

export const fetch = async (args: { id: number }): Promise<{ id: number; name: string }> => {
    return users.find(user => user.id === args.id)
}

export const update = async (args: { id: number; name: string }): Promise<void> => {
    const user = users.find(user => user.id === args.id)
    if (!user) throw new Error('User not found')
    user.name = args.name
}

export const fetchAll = async (): Promise<{ id: number; name: string }[]> => {
    return users
}
```

### Front-end setup

#### Setup bridge generator script in back-end `package.json`

```json
{
    "scripts": {
        "gen-typed-bridge": "typed-bridge gen-typed-bridge --src ./src/bridge/index.ts --dest ./bridge.ts"
    }
}
```

- **src**: Typed bridge source file path
- **dest**: Typed bridge output file path

#### Generate bridge file

```bash
npm run gen-typed-bridge
```

#### Front-end usage

Import generated `build/bridge.ts` file from back-end in front-end & call server functions. Usage example:

```ts
import bridge from './bridge'

bridgeConfig.host = 'http://localhost:8080/bridge'

const user = await bridge['user.fetch']({ id: 1 })
```

## Docs

- [Configuration](./docs/configuration.md)
- [Add middleware](./docs/add-middleware.md)
- [Setup context for bridge handler](./docs/context-setup.md)
- [Setup request validation](./docs/request-validation.md)
- [Automatically sync bridge file from back-end to front-end](./docs/auto-bridge-sync.md)
- [Setup `type-bridge` docs in your cursor rules](./docs/type-bridge-cursor-rule.md)

Demo Project: [https://github.com/neilveil/typed-bridge-demo](https://github.com/neilveil/typed-bridge-demo)

## Developer

Developed & maintained by [neilveil](https://github.com/neilveil). Give a star to support my work.
