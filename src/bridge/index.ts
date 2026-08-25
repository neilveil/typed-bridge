import chalk from 'chalk'
import compression from 'compression'
import cors from 'cors'
import express, { Application, Request, Response } from 'express'
import { Server } from 'http'
import _path from 'path'
import { tbConfig } from '..'
import { statusOf } from '../error'
import { printStartLogs, printStopLogs } from '../helpers'
import { runMiddlewares } from '../middleware'
import { mountMCP } from '../mcp'
import { Bridge, BridgeEntries, ToolMode } from '../tools'

interface CreateBridgeOptions {
    entries?: BridgeEntries
    // How the MCP server presents tools. 'on_demand' (default) exposes the 3 meta-tools;
    // 'attach_all' lists every visible entry as its own tool.
    toolMode?: ToolMode
    mcp?: boolean | string
}

let shutdownCallback = () => {}

export const onShutdown = (fn: () => void) => (shutdownCallback = fn)

export const createBridge = (
    bridge: Bridge,
    port: number,
    path: string = '/bridge',
    options?: CreateBridgeOptions
): { app: Application; server: Server } => {
    const app = express()

    // cors
    app.use(cors())

    // Compression
    app.use(compression())

    // Body parser
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    // Typed bridge middleware
    let requestId = 0
    let activeRequests = 0
    app.use((req, res, next) => {
        const _req: any = req

        const xForwardedFor = req.headers['x-forwarded-for']

        let ip = Array.isArray(xForwardedFor)
            ? xForwardedFor[0]
            : (xForwardedFor || '').split(', ')[0] || req.socket.remoteAddress || ''

        if (ip === '::1') ip = '127.0.0.1'

        // Set typed bridge header
        res.setHeader('X-Powered-By', 'typed-bridge')

        requestId++
        activeRequests++

        // Bind data
        _req.bind = {
            id: requestId,
            ts: Date.now(),
            args: {},
            ip
        }

        // Log request
        if (tbConfig.logs.request) {
            console.log(
                chalk.blueBright(
                    `REQ | ${new Date().toISOString()} | ${requestId} :: ${req.method} | ${req.path} | ${ip}`
                )
            )
        }

        // Log response
        const startTime = Date.now()
        res.on('finish', () => {
            activeRequests--
            const log = `RES | ${new Date().toISOString()} | ${requestId} :: ${res.statusCode} | ${Date.now() - startTime}ms`
            if (tbConfig.logs.response) console.log(res.statusCode < 400 ? chalk.green(log) : chalk.red(log))
        })

        next()
    })

    // Handle invalid json in post request
    app.use((error: any, req: any, res: any, next: any) => {
        if (error?.type === 'entity.parse.failed') {
            res.status(400).send('Can not parse request!')
        } else next()
    })

    // Custom responseDelay
    if (tbConfig.responseDelay)
        app.use((req, res, next) => {
            setTimeout(next, tbConfig.responseDelay)
        })

    // Server health
    app.get(_path.join(path, 'health'), (req: Request, res: Response) => {
        res.status(200).json({
            status: 'OK',
            activeRequests: activeRequests - 1,
            totalRequests: requestId,
            timestamp: new Date().toISOString()
        })
    })

    // MCP endpoint
    if (options?.mcp && options?.entries) {
        const mcpPath = typeof options.mcp === 'string' ? options.mcp : _path.join(path, 'mcp')
        mountMCP(app, bridge, options.entries, mcpPath, options.toolMode || 'on_demand')
    }

    app.use(path, bridgeHandler(bridge))

    const server = app.listen(port, () => printStartLogs(port))

    let shuttingDown = false
    const shutdown = () => {
        if (shuttingDown) return
        shuttingDown = true

        // Server.close waits for all active connections to be completed & stops accepting new connections
        server.close(() => {
            printStopLogs()
            shutdownCallback()
        })
    }

    process.on('SIGINT', () => shutdown())
    process.on('SIGTERM', () => shutdown())

    return { app, server }
}

const bridgeHandler =
    (bridge: Bridge): any =>
    async (req: Request, res: Response) => {
        let args: any = {}
        let context: any = {}

        try {
            const path = req.path.split('/').pop() || ''
            args = req.body

            if (!path) throw new Error('Bridge not found!')

            const serverFunction = bridge[path]
            if (!serverFunction) {
                const error = 'Bridge not found: ' + path
                if (tbConfig.logs.error) console.error(error)
                return res.status(404).json({ error })
            }

            const { blocked, context: middlewareContext } = await runMiddlewares(path, req, res)

            if (blocked) return

            context = middlewareContext

            res.json((await serverFunction(args, context)) || {})
        } catch (error: any) {
            const id = (req as any).bind?.id

            if (tbConfig.logs.argsOnError) console.error(`ARGS | ${id} ::`, JSON.stringify(args, null, 2))
            if (tbConfig.logs.contextOnError) console.error(`CONTEXT | ${id} ::`, JSON.stringify(context, null, 2))

            if (Array.isArray(error.issues) && error.issues.length) {
                const keyPath = error.issues[0].path.join('/')
                const errorMessage = (keyPath ? keyPath + ': ' : '') + error.issues[0].message
                return res.status(400).send(errorMessage)
            }

            // A refusal the handler chose — not found, forbidden, invalid.
            // Logged as one line rather than a stack trace: it is expected
            // behaviour, and burying real faults under it is how error logs
            // stop being read.
            const status = statusOf(error)

            if (status) {
                if (tbConfig.logs.error) console.error(`REFUSED | ${id} :: ${status} ${error.message}`)

                return res.status(status).json({ error: error.message })
            }

            if (tbConfig.logs.error) console.error(`ERROR | ${id} ::`, error)

            return res.status(500).json({ error: error.message })
        }
    }
