import { createBridge, createMiddleware, tbConfig } from '..'
import bridge from './bridge'

tbConfig.logs.error = true
tbConfig.logs.request = true
tbConfig.logs.response = true
tbConfig.responseDelay = 1000

createBridge(bridge, 8080, '/')

createMiddleware('user.fetch', async (req, res) => {
    console.log('Middleware')
    return {
        next: false
    }
})
