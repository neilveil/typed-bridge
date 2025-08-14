## Add middleware

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

## Related docs

- [Setup context for bridge handler](./context-setup.md)
- [Adding middleware to validate request](./request-validation.md)
