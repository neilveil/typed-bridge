# Typed Bridge - Strictly typed server functions for typescript apps 🚀

[![Downloads](https://img.shields.io/npm/dm/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge) [![Version](https://img.shields.io/npm/v/typed-bridge.svg)](https://www.npmjs.com/package/typed-bridge)

**Strictly Typed | Production Ready | No Configuration Server**

Typed Bridge allows you to build **typed server functions** with a argument validation layer in between which is tightly coupled with typescript apps like React, React Native, Vue, Angular etc.

## 📦 Installation

Install `typed-bridge` via npm:

```bash
npm i typed-bridge
```

## Typed Bridge components:

- **Bridge file**: Main bridge file from which types are exported for front-end.
- **Paths**: Server function path like `user.fetch`, similar to routes.
- **Server functions**: Actual server function which holds the business logic, similar to controller.
- **Arguments**: Server function arguments.
- **Validation layer**: Validation layer validates server arguments before calling the function.
- **Context**: Context parsed from requests for server functions.
- **Context Parser**: Context parser parse the context from requests.

### Server setup

`server.ts`

```ts
import { createApp, startServer } from 'typed-bridge'

const app = createApp()
const server = startServer(app, 8080)
```

### Create Bridge

`bridge/index.ts`

```ts
import * as user from './user.bridge'

export default {
  'user.fetch': user.fetch,
  'user.update': user.update
}
```

`bridge/user.bridge.ts`

```ts
export const fetch = async (
  args: { id: number },
  context: { name: string; authorization: string }
): { id: number; name: string } => {
  return { id: args.id, name: 'Typed Bridge' }
}

export const update = async () => {}
```

`server.ts`

```ts
import { createBridge } from 'typed-bridge'

const contextParser = (req, res, next) => {}

app.use('/bridge', createBridge(bridge))
```

### Call typed bridge functions from front-end

Generate bridge file

`package.json`

```json
{
  "scripts": {
    "gen-typed-bridge": "typed-bridge gen-typed-bridge --src ./src/bridge/index.ts --dest ./bridge.ts"
  }
}
```

**src**: Typed bridge source file path
**dest**: Typed bridge output file path

Import generated `bridge.ts` file in front-end & call server functions. Usage example:

```ts
import bridge from './bridge'

// Need to be set once
// Set typed bridge server host
bridgeConfig.host = 'http://localhost:8080/bridge'
// Set headers (optional)
bridgeConfig.headers = { authorization: 'Basic mydemotoken==' }

..

const user = await bridge['user.fetch']({ id: 1 })
```

> Generated Typed Bridge file can also be hosted publicly as it doesn't contains any code, only the server functions schema. Every time front-end server is started, it can be automatically synced using tools like [clone-kit](https://www.npmjs.com/package/clone-kit).

## Typed Bridge config

```ts
import { tbConfig } from 'typed-bridge'

tbConfig.logs.request = true // Enable request logging
tbConfig.logs.response = true // Enable response logging
tbConfig.logs.error = true // Enable error logging

tbConfig.idPrefix = '' // Request id prefix (useful in tracing request in microservice architecture)
tbConfig.responseDelay = 0 // Custom response delay in milliseconds
tbConfig.gracefulShutdown = false // Wait for processes to complete after shutdown
```

## To do

- Zod setup docs
- Integrate with existing express app docs
- Fix local ip logging issue
- Fix gen command

## Developer

Developed & maintained by [neilveil](https://github.com/neilveil). Give a star to support my work.
