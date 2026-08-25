import { readFileSync } from 'node:fs'
import { IncomingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { Application, Request, Response } from 'express'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
    Bridge,
    BridgeEntries,
    getMetaTools,
    handleToolCall,
    isEntryVisible,
    toToolInputSchema,
    ToolMode
} from '../tools'
import { config } from '../config'

// JSON-RPC error codes used for failures we answer at the transport layer, before any Server
// sees the request. -32000 is the spec's "implementation-defined server error" slot.
const METHOD_NOT_ALLOWED = -32000
const INTERNAL_ERROR = -32603

// The package's own version, shown to MCP clients in the initialize handshake. Resolved relative
// to this file so the same path works from src (tsx) and from the published dist build.
const { version: packageVersion } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
    version: string
}

export function mountMCP(
    app: Application,
    bridge: Bridge,
    entries: BridgeEntries,
    path: string = '/mcp',
    toolMode: ToolMode = 'on_demand'
): void {
    // Stateless: every POST carries everything needed to serve it, so it gets its own Server and
    // transport, both disposed once the response closes. Nothing is retained between requests —
    // memory scales with in-flight requests, not with connected clients.
    //
    // A single shared Server is not an option: the SDK's Protocol.connect() throws when the
    // Server is already bound to a transport ("use a separate Protocol instance per
    // connection"), so concurrent requests would collide on it.
    app.post(path, async (req: Request, res: Response) => {
        const server = createMCPServer(bridge, entries, req.headers, toolMode)
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

        // The SDK routes send failures here and drops them when no handler is set. They matter
        // most when a client hangs up mid-call: the tool handler still finishes, its response
        // send then fails, and this is the only trace of it.
        server.onerror = error => {
            if (config.logs.error) console.error('MCP | transport error ::', error)
        }

        // Registered before handleRequest so cleanup is wired even if the response finishes
        // immediately, and so an SSE stream is torn down only once the client goes away.
        // Closing the Server closes the transport with it (Protocol.close), so this covers both.
        res.on('close', () => {
            server.close().catch(() => {})
        })

        try {
            await server.connect(transport)
            await transport.handleRequest(req, res, req.body)
        } catch (error: unknown) {
            // A throw here means the request never reached the JSON-RPC layer, so the transport
            // has not written anything. The cause is ours, not the caller's, and this route
            // answers before any auth middleware — so log it in full and return a fixed message
            // rather than leaking internals to an unauthenticated caller.
            if (config.logs.error) console.error('MCP | request failed ::', error)

            // Mid-stream failures can't carry an error payload anymore — end the response so the
            // client isn't left hanging and the close cleanup above fires right away.
            if (!res.headersSent) res.status(500).json(jsonRpcError(INTERNAL_ERROR, 'Internal server error'))
            else res.end()
        }
    })

    // Stateless mode has no standalone stream to open and no session to tear down, so the
    // spec's GET (server-initiated SSE) and DELETE (session teardown) verbs have nothing to do.
    // RFC 7231 requires a 405 to advertise what the resource does accept.
    const methodNotAllowed = (_req: Request, res: Response) => {
        res.set('Allow', 'POST').status(405).json(jsonRpcError(METHOD_NOT_ALLOWED, 'Method not allowed'))
    }

    app.get(path, methodNotAllowed)
    app.delete(path, methodNotAllowed)
}

// One Server per request. `headers` is the request's own header set — it drives the middleware
// chain that builds the handler context, and never changes for the life of this instance.
function createMCPServer(
    bridge: Bridge,
    entries: BridgeEntries,
    headers: IncomingHttpHeaders,
    toolMode: ToolMode = 'on_demand'
): Server {
    const server = new Server({ name: 'typed-bridge', version: packageVersion }, { capabilities: { tools: {} } })

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        // on_demand: hand the model the meta-tools and let it discover the rest
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
                { surface: 'mcp', headers }
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

// The meta-tools, shaped for MCP's { name, description, inputSchema } listing. Uses the 'mcp'
// surface so tool_script is only listed when enabled for MCP.
const metaToolsForMCP = () =>
    (
        getMetaTools({ format: 'json-schema', surface: 'mcp' }) as {
            name: string
            description: string
            parameters: unknown
        }[]
    ).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters }))

const jsonRpcError = (code: number, message: string) => ({
    jsonrpc: '2.0',
    error: { code, message },
    id: null
})
