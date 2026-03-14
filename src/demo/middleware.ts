import { createMiddleware } from '..'

// Global middleware — runs for every route (lowest specificity)
createMiddleware('*', async (req, res) => {
    return {
        context: {
            requestedAt: Date.now()
        }
    }
})

// Auth middleware — runs for all user.* routes
createMiddleware('user.*', async (req, res) => {
    const token = req.headers.authorization

    if (!token || !token.startsWith('Bearer ')) {
        res.status(401).send('Unauthorized')
        return { next: false }
    }

    const userId = parseInt(token.split(' ')[1]) || 1

    return {
        context: { userId }
    }
})

// Auth middleware — runs for all product.* routes
createMiddleware('product.*', async (req, res) => {
    const token = req.headers.authorization

    if (!token || !token.startsWith('Bearer ')) {
        res.status(401).send('Unauthorized')
        return { next: false }
    }

    const userId = parseInt(token.split(' ')[1]) || 1

    return {
        context: { userId }
    }
})

// Auth middleware — runs for all order.* routes
createMiddleware('order.*', async (req, res) => {
    const token = req.headers.authorization

    if (!token || !token.startsWith('Bearer ')) {
        res.status(401).send('Unauthorized')
        return { next: false }
    }

    const userId = parseInt(token.split(' ')[1]) || 1

    return {
        context: { userId }
    }
})

// Admin middleware — runs only for user.remove (highest specificity)
createMiddleware('user.remove', async (req, res) => {
    const isAdmin = req.headers['x-admin'] === 'true'

    if (!isAdmin) {
        res.status(403).send('Admin access required')
        return { next: false }
    }

    return {
        context: { isAdmin: true }
    }
})
