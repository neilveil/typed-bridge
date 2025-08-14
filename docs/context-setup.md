# Setup context

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
