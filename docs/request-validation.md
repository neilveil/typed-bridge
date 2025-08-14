# Request validation with Typed Bridge Middleware

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
