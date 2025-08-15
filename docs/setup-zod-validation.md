# Setup Zod Validation

## Declare req/res types

`types.ts`

```ts
import { $z } from 'typed-bridge'

export const fetch = {
    args: $z.object({
        id: $z.number().min(1)
    }),
    res: $z.object({
        id: $z.number(),
        name: $z.string()
    })
}

export const userContext = $z.object({
    id: $z.number()
})
```

## User in bridge handler

```ts
import { $z } from 'typed-bridge'
import * as types from './types'

export const fetch = async (
    args: $z.infer<typeof types.fetch.args>,
    context: { id: number }
): Promise<$z.infer<typeof types.fetch.res>> => {
    args = types.fetch.args.parse(args)

    console.log(context)

    const user = users.find(user => user.id === args.id)
    if (!user) {
        throw new Error(`User with ID ${args.id} not found`)
    }

    return user
}
```
