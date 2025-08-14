import { matchesPattern, printStartLogs, printStopLogs } from '@/helpers'
import chalk from 'chalk'
import compression from 'compression'
import cors from 'cors'
import express, { Application, Request, Response } from 'express'
import _path from 'path'
import { tbConfig } from '..'

type Bridge = { [key: string]: (...args: any[]) => Promise<any> }

type Middleware = {
    pattern: string
    handler: (req: Request, res: Response) => Promise<{ next?: boolean; context?: any } | void>
}

const middlewares: Middleware[] = []

export const createMiddleware = (pattern: string, handler: Middleware['handler']) =>
    middlewares.push({ pattern, handler })

let shutdownCallback = () => {}

export const onShutdown = (fn: () => void) => (shutdownCallback = fn)

export const createBridge = (bridge: Bridge, port: number, path: string = '/bridge'): Application => {
    const app = express()

    // cors
    app.use(cors())

    // Compression
    app.use(compression())

    // Body parser
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    // Typed bridge middleware
    let requestId = 1
    app.use((req, res, next) => {
        const _req: any = req

        const xForwardedFor = req.headers['x-forwarded-for']

        let ip = Array.isArray(xForwardedFor)
            ? xForwardedFor[0]
            : (xForwardedFor || '').split(', ')[0] || req.socket.remoteAddress || ''

        if (ip === '::1') ip = '127.0.0.1'

        // Bind data
        _req.bind = {
            id: 0,
            ts: Date.now(),
            args: {},
            ip
        }

        // Set typed bridge header
        res.setHeader('X-Powered-By', 'typed-bridge')

        requestId++

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
    app.use(_path.join(path, 'health'), (req, res) => {
        res.sendStatus(200)
    })

    app.use(path, bridgeHandler(bridge))

    const server = app.listen(port, () => printStartLogs(port))

    let shuttingDown = false
    const shutdown = () => {
        if (shuttingDown) return
        shuttingDown = true

        server.close()
        printStopLogs()
        shutdownCallback()
    }

    process.on('SIGINT', () => shutdown())
    process.on('SIGTERM', () => shutdown())

    return app
}

const bridgeHandler =
    (bridge: Bridge): any =>
    async (req: Request, res: Response) => {
        try {
            const path = req.path.split('/').pop() || ''
            const args = req.body

            if (!path) throw new Error('Bridge not found!')

            const serverFunction = bridge[path]
            if (!serverFunction) {
                const error = 'Bridge not found: ' + path
                if (tbConfig.logs.error) console.error(error)
                return res.status(404).json({ error })
            }

            let context: any = {}

            for (const middleware of middlewares) {
                if (matchesPattern(path, middleware.pattern)) {
                    const result = await middleware.handler(req, res)

                    if (result?.next === false) return

                    if (result?.context) context = { ...context, ...result.context }
                }
            }

            res.json((await serverFunction(args, context)) || {})
        } catch (error: any) {
            if (Array.isArray(error.errors)) {
                const keyPath = error.errors[0].path.join('/')
                const errorMessage = (keyPath ? keyPath + ': ' : '') + error.errors[0].message
                return res.status(400).send(errorMessage)
            }

            if (tbConfig.logs.error) console.error(error)

            return res.status(500).json({ error: error.message })
        }
    }
