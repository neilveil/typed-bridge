import 'dotenv/config'
import { createBridge, onShutdown, tbConfig } from '..'
import bridge, { entries } from './bridge'
import { mountChat } from './chat'
import './middleware'

// Logging
tbConfig.logs.request = true
tbConfig.logs.response = true
tbConfig.logs.error = true
tbConfig.logs.argsOnError = true
tbConfig.logs.contextOnError = true

const { app } = createBridge(bridge, 8080, '/bridge', { entries, mcp: true })

// Extend the server with custom routes
app.get('/status', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() })
})

// LLM Chat endpoint (SSE) — demo of meta-tools pattern
mountChat(app, bridge, entries)

// Graceful shutdown
onShutdown(() => {
    console.log('Cleanup complete')
})
