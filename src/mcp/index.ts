import { randomUUID } from 'node:crypto'
import { IncomingHttpHeaders } from 'node:http'
import { Application, Request, Response } from 'express'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Bridge, BridgeEntries, getMetaTools, handleToolCall, isEntryVisible, toToolInputSchema, ToolMode } from '../tools'

type HeadersRef = { current: IncomingHttpHeaders }

type Session = {
    transport: StreamableHTTPServerTransport
    server: Server
    lastActivity: number
    headersRef: HeadersRef
}

const SESSION_TTL_MS = 30 * 60 * 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const MAX_SESSIONS = 1000

// The 3 meta-tools, shaped for MCP's { name, description, inputSchema } listing.
const metaToolsForMCP = () =>
    (getMetaTools({ format: 'json-schema' }) as { name: string; description: string; parameters: unknown }[]).map(
        tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })
    )

function createMCPServer(
    bridge: Bridge,
    entries: BridgeEntries,
    headersRef: HeadersRef,
    toolMode: ToolMode = 'on_demand'
): Server {
    const server = new Server({ name: 'typed-bridge', version: '1.0.0' }, { capabilities: { tools: {} } })

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        // on_demand: hand the model the 3 meta-tools and let it discover the rest
        if (toolMode === 'on_demand') return { tools: metaToolsForMCP() }

        // attach_all: one tool per entry visible to MCP (respects `mcp: false`)
        const tools = Object.entries(entries)
            .filter(([, entry]) => isEntryVisible(entry, 'mcp'))
            .map(([name, entry]) => ({
                name,
                description: entry.description,
                inputSchema: toToolInputSchema(entry.args)
            }))

        return { tools }
    })

    server.setRequestHandler(CallToolRequestSchema, async request => {
        const { name, arguments: args } = request.params

        try {
            // Mode-agnostic dispatch: meta-tool names run discovery, anything else runs the
            // entry directly. The client's forwarded headers drive the middleware chain, which
            // builds the handler context. Visibility (`mcp: false`) and the output limit are
            // enforced inside.
            const result = await handleToolCall(
                bridge,
                entries,
                { name, arguments: (args as Record<string, unknown>) || {} },
                { surface: 'mcp', headers: headersRef.current }
            )

            return { content: [{ type: 'text' as const, text: JSON.stringify(result) ?? '' }] }
        } catch (error: unknown) {
            // Surface the error message as JSON so the model knows *why* a call was denied
            // (e.g. an auth middleware's message) instead of seeing an opaque stop.
            const message = error instanceof Error ? error.message : String(error)
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true }
        }
    })

    return server
}

export function mountMCP(
    app: Application,
    bridge: Bridge,
    entries: BridgeEntries,
    path: string = '/mcp',
    toolMode: ToolMode = 'on_demand'
) {
    const sessions = new Map<string, Session>()

    // Evict sessions idle for longer than SESSION_TTL_MS
    const sweepInterval = setInterval(() => {
        const now = Date.now()
        for (const [id, session] of sessions) {
            if (now - session.lastActivity > SESSION_TTL_MS) {
                session.server.close().catch(() => {})
                sessions.delete(id)
            }
        }
    }, SWEEP_INTERVAL_MS)
    sweepInterval.unref()

    const handler = async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined

        let transport: StreamableHTTPServerTransport

        if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!
            session.lastActivity = Date.now()
            session.headersRef.current = req.headers
            transport = session.transport
        } else if (!sessionId && req.method === 'POST') {
            const headersRef: HeadersRef = { current: req.headers }
            const server = createMCPServer(bridge, entries, headersRef, toolMode)

            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (id: string) => {
                    // Bound memory: evict the least-recently-active session when at capacity
                    if (sessions.size >= MAX_SESSIONS) evictOldestSession(sessions)

                    sessions.set(id, { transport, server, lastActivity: Date.now(), headersRef })
                    transport.onclose = () => sessions.delete(id)
                }
            })

            await server.connect(transport)
        } else {
            res.status(400).json({ error: 'Invalid or missing session' })
            return
        }

        await transport.handleRequest(req as any, res as any, req.body)
    }

    app.post(path, handler as any)
    app.get(path, handler as any)
    app.delete(path, async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined
        if (!sessionId || !sessions.has(sessionId)) {
            res.status(400).json({ error: 'Invalid or missing session' })
            return
        }

        const session = sessions.get(sessionId)!
        sessions.delete(sessionId)
        await session.server.close().catch(() => {})
        res.status(200).end()
    })
}

function evictOldestSession(sessions: Map<string, Session>): void {
    let oldestId: string | undefined
    let oldestSession: Session | undefined

    for (const [id, session] of sessions) {
        if (!oldestSession || session.lastActivity < oldestSession.lastActivity) {
            oldestId = id
            oldestSession = session
        }
    }

    if (oldestId && oldestSession) {
        oldestSession.server.close().catch(() => {})
        sessions.delete(oldestId)
    }
}
