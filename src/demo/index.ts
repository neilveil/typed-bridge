import { createBridge, onShutdown, tbConfig } from '..'
import bridge from './bridge'
import './middleware'

// Logging
tbConfig.logs.request = true
tbConfig.logs.response = true
tbConfig.logs.error = true
tbConfig.logs.argsOnError = true
tbConfig.logs.contextOnError = true

const { app } = createBridge(bridge, 8080, '/bridge')

// Extend the server with custom routes
app.get('/status', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() })
})

// Graceful shutdown
onShutdown(() => {
    console.log('Cleanup complete')
})
