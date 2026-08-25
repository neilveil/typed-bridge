/**
 * Deterministic tests for tool modes, surfaces, and visibility — no network or LLM.
 * Covers the matrix that the MCP server and consumer LLM loops both rely on:
 *   - getTools: 'on_demand' → 3 meta-tools, 'attach_all' → one tool per visible entry
 *   - handleToolCall: meta-flow vs direct-call dispatch, in both surfaces
 *   - visibility: `mcp: false` hides an entry from the 'mcp' surface only
 *   - MCP transport: stateless request handling over a real HTTP listener
 *
 * Run: `npm run test:mcp`
 */

import express from 'express'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../src/config'
import { mountMCP } from '../src/mcp'
import { createMiddleware } from '../src/middleware'
import { defineBridge, getTools, handleToolCall, toolSearch } from '../src/tools'
import { entries } from '../src/demo/bridge'
// Side-effect import: registers the demo's auth middleware (user.* / product.* / order.*),
// which now runs on tool calls — mirrors how the real server wires it in demo/index.ts.
import '../src/demo/middleware'

const bridge = defineBridge(entries)
const ctx = { requestedAt: Date.now(), userId: 1 }

// Middleware now runs on tool calls too, so executing an entry needs the same headers the
// demo's auth middleware reads over HTTP. user.remove additionally requires the admin header.
const headers = { authorization: 'Bearer 1' }
const adminHeaders = { authorization: 'Bearer 1', 'x-admin': 'true' }

type MCPResponse = {
    status: number
    sessionId: string | null
    body?: {
        result?: { tools?: { name: string }[]; serverInfo?: { version?: string } }
        error?: { code: number; message: string }
    }
}

let passed = 0
let failed = 0

const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
        await fn()
        passed++
        console.log(`  ✅ ${name}`)
    } catch (error: unknown) {
        failed++
        console.error(`  ❌ ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message)
}

const expectReject = async (fn: () => Promise<unknown>, substring: string) => {
    let resolved = false
    try {
        await fn()
        resolved = true
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes(substring)) throw new Error(`Expected "${substring}", got: "${message}"`)
        return
    }
    // Thrown outside the catch so the sentinel can't be swallowed, and worded generically so
    // it never accidentally contains the expected substring (which would mask a real failure).
    if (resolved) throw new Error('Expected a rejection, but the call resolved successfully')
}

const totalEntries = Object.keys(entries).length

async function main() {
    console.log('\n--- Tool mode / surface / visibility ---\n')

    // --- getTools: on_demand ---

    await test('on_demand returns the 4 meta-tools (incl. tool_script, enabled by default)', () => {
        const tools = getTools(entries, { toolMode: 'on_demand', format: 'openai' }) as { function: { name: string } }[]
        const names = tools.map(t => t.function.name).sort()
        assert(tools.length === 4, `Expected 4 meta-tools, got ${tools.length}`)
        assert(
            JSON.stringify(names) === JSON.stringify(['tool_describe', 'tool_script', 'tool_search', 'tool_use']),
            `Unexpected meta-tool names: ${names.join(', ')}`
        )
    })

    await test('on_demand default mode matches explicit on_demand', () => {
        const a = getTools(entries, { format: 'openai' }) as unknown[]
        const b = getTools(entries, { toolMode: 'on_demand', format: 'openai' }) as unknown[]
        assert(a.length === 4 && b.length === 4, 'Default toolMode should be on_demand (4 meta-tools)')
    })

    await test('tool_script is dropped from meta-tools when disabled', () => {
        config.script.enabled = false
        try {
            const tools = getTools(entries, { toolMode: 'on_demand', format: 'openai' }) as {
                function: { name: string }
            }[]
            const names = tools.map(t => t.function.name)
            assert(tools.length === 3, `Expected 3 meta-tools when disabled, got ${tools.length}`)
            assert(!names.includes('tool_script'), 'tool_script must not be listed when disabled')
        } finally {
            config.script.enabled = true
        }
    })

    await test('tool_script is hidden on a surface not in config.script.surfaces', () => {
        config.script.surfaces = ['llm']
        try {
            const llm = getTools(entries, { toolMode: 'on_demand', format: 'openai', surface: 'llm' }) as {
                function: { name: string }
            }[]
            const mcp = getTools(entries, { toolMode: 'on_demand', format: 'openai', surface: 'mcp' }) as {
                function: { name: string }
            }[]
            assert(
                llm.some(t => t.function.name === 'tool_script'),
                'tool_script should be listed on llm'
            )
            assert(!mcp.some(t => t.function.name === 'tool_script'), 'tool_script should be hidden on mcp')
        } finally {
            config.script.surfaces = ['llm', 'mcp']
        }
    })

    // --- getTools: attach_all + surface visibility ---

    await test('attach_all (llm surface) attaches every entry as a tool', () => {
        const tools = getTools(entries, { toolMode: 'attach_all', format: 'openai' }) as {
            function: { name: string }
        }[]
        assert(tools.length === totalEntries, `Expected ${totalEntries} tools, got ${tools.length}`)
        assert(
            tools.some(t => t.function.name === 'user.remove'),
            'user.remove is an LLM tool (llm not disabled)'
        )
    })

    await test('attach_all (mcp surface) hides mcp:false entries', () => {
        const tools = getTools(entries, {
            toolMode: 'attach_all',
            format: 'openai',
            surface: 'mcp'
        }) as { function: { name: string } }[]
        assert(tools.length === totalEntries - 1, `Expected ${totalEntries - 1} mcp tools, got ${tools.length}`)
        assert(!tools.some(t => t.function.name === 'user.remove'), 'user.remove must be hidden from MCP')
    })

    // --- toolSearch surface filtering ---

    await test('toolSearch hides user.remove from mcp but not llm', () => {
        const llmHit = toolSearch(entries, 'user.remove', 'llm')
        const mcpHit = toolSearch(entries, 'user.remove', 'mcp')
        assert(
            llmHit.some(r => r.name === 'user.remove'),
            'user.remove should be searchable on llm surface'
        )
        assert(!mcpHit.some(r => r.name === 'user.remove'), 'user.remove must NOT be searchable on mcp surface')
    })

    // --- handleToolCall: on_demand (meta) dispatch ---

    await test('on_demand: tool_search → tool_use executes the entry', async () => {
        const search = (await handleToolCall(bridge, entries, {
            name: 'tool_search',
            arguments: { query: 'user' }
        })) as { name: string }[]
        assert(
            search.some(r => r.name === 'user.fetch'),
            'tool_search should find user.fetch'
        )

        const result = (await handleToolCall(
            bridge,
            entries,
            { name: 'tool_use', arguments: { name: 'user.fetch', arguments: { id: 1 } } },
            { context: ctx, headers }
        )) as { id: number }
        assert(result.id === 1, `Expected user id 1, got ${result.id}`)
    })

    await test('on_demand: tool_describe returns args and response schema', async () => {
        const described = (await handleToolCall(bridge, entries, {
            name: 'tool_describe',
            arguments: { name: 'product.create' }
        })) as {
            name: string
            args: { properties?: Record<string, unknown> }
            response: { properties?: Record<string, unknown> }
        }

        assert(described.name === 'product.create', 'Expected described tool name product.create')
        assert(
            !!described.args.properties?.name && !!described.args.properties?.price,
            'Expected name & price in args schema'
        )
        assert(!!described.response.properties?.createdAt, 'Expected createdAt in response schema')
    })

    await test('on_demand (mcp surface): tool_describe hides mcp:false entry', async () => {
        await expectReject(
            () =>
                handleToolCall(
                    bridge,
                    entries,
                    { name: 'tool_describe', arguments: { name: 'user.remove' } },
                    { surface: 'mcp' }
                ),
            'Tool not found'
        )
    })

    await test('on_demand (mcp surface): tool_use on mcp:false entry is blocked', async () => {
        await expectReject(
            () =>
                handleToolCall(
                    bridge,
                    entries,
                    { name: 'tool_use', arguments: { name: 'user.remove', arguments: { id: 1 } } },
                    { context: ctx, surface: 'mcp' }
                ),
            'Tool not found'
        )
    })

    await test('on_demand (llm surface): tool_use on mcp:false entry is allowed', async () => {
        const created = (await handleToolCall(
            bridge,
            entries,
            { name: 'tool_use', arguments: { name: 'user.create', arguments: { name: 'Temp', email: 't@t.com' } } },
            { context: ctx, headers }
        )) as { id: number }

        const removed = (await handleToolCall(
            bridge,
            entries,
            { name: 'tool_use', arguments: { name: 'user.remove', arguments: { id: created.id } } },
            { context: ctx, surface: 'llm', headers: adminHeaders }
        )) as { success: boolean }
        assert(removed.success === true, 'user.remove should succeed on llm surface')
    })

    // --- handleToolCall: attach_all (direct) dispatch ---

    await test('attach_all: direct entry name executes the handler', async () => {
        const result = (await handleToolCall(
            bridge,
            entries,
            { name: 'product.fetch', arguments: { id: 1 } },
            { context: ctx, headers }
        )) as { id: number }
        assert(result.id === 1, `Expected product id 1, got ${result.id}`)
    })

    await test('attach_all (mcp surface): direct call to mcp:false entry is blocked', async () => {
        await expectReject(
            () =>
                handleToolCall(
                    bridge,
                    entries,
                    { name: 'user.remove', arguments: { id: 1 } },
                    { context: ctx, surface: 'mcp' }
                ),
            'Tool not found'
        )
    })

    // --- execution parity: same validation regardless of path ---

    await test('validation error is identical via direct call and meta tool_use', async () => {
        await expectReject(
            () =>
                handleToolCall(
                    bridge,
                    entries,
                    { name: 'user.fetch', arguments: { id: 0 } },
                    { context: ctx, headers }
                ),
            ''
        )
        await expectReject(
            () =>
                handleToolCall(
                    bridge,
                    entries,
                    { name: 'tool_use', arguments: { name: 'user.fetch', arguments: { id: 0 } } },
                    { context: ctx, headers }
                ),
            ''
        )
    })

    // --- middleware applies to tool calls ---

    await test('tool call without headers is denied by auth middleware', async () => {
        await expectReject(
            () =>
                handleToolCall(bridge, entries, {
                    name: 'tool_use',
                    arguments: { name: 'user.fetch', arguments: { id: 1 } }
                }),
            'Unauthorized'
        )
    })

    await test('direct tool call without headers is denied by auth middleware', async () => {
        await expectReject(
            () => handleToolCall(bridge, entries, { name: 'product.fetch', arguments: { id: 1 } }),
            'Unauthorized'
        )
    })

    await test('user.remove tool call without admin header is denied', async () => {
        const created = (await handleToolCall(
            bridge,
            entries,
            { name: 'user.create', arguments: { name: 'NoAdmin', email: 'na@t.com' } },
            { headers }
        )) as { id: number }

        await expectReject(
            () =>
                handleToolCall(
                    bridge,
                    entries,
                    { name: 'user.remove', arguments: { id: created.id } },
                    { surface: 'llm', headers }
                ),
            'Admin access required'
        )
    })

    await test('admin header allows user.remove tool call', async () => {
        const created = (await handleToolCall(
            bridge,
            entries,
            { name: 'user.create', arguments: { name: 'WithAdmin', email: 'wa@t.com' } },
            { headers }
        )) as { id: number }

        const removed = (await handleToolCall(
            bridge,
            entries,
            { name: 'user.remove', arguments: { id: created.id } },
            { surface: 'llm', headers: adminHeaders }
        )) as { success: boolean }
        assert(removed.success === true, 'user.remove should succeed with admin header')
    })

    // Path-based middleware must work on tool surfaces: the synthetic request exposes the
    // matched entry name as `req.path` (so `req.path.split('/').pop()` resolves it), exactly
    // as it would over HTTP. Without this, path-deriving middlewares would crash on tool calls.
    await test('req.path exposes the entry name to middleware on tool calls', async () => {
        let seenKey: string | undefined
        createMiddleware('product.list', async (req: any) => {
            seenKey = (req.path || '').split('/').pop()
            return {}
        })

        await handleToolCall(bridge, entries, { name: 'product.list', arguments: {} }, { headers })
        assert(seenKey === 'product.list', `Expected req.path-derived key "product.list", got "${seenKey}"`)
    })

    // --- MCP transport: stateless, no sessions ---

    console.log('\n--- MCP transport (stateless) ---\n')

    const { server: httpServer, url } = await startMCPServer()

    await test('POST lists tools with no session handshake', async () => {
        const response = await mcpPost(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
        assert(response.status === 200, `Expected 200, got ${response.status}`)
        assert(!!response.body?.result?.tools?.length, 'Expected a non-empty tool list')
        assert(!response.sessionId, `Stateless mode must not return a session id, got "${response.sessionId}"`)
    })

    await test('initialize reports the real package version, not a hardcoded one', async () => {
        const packageVersion = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')).version
        const response = await mcpPost(url, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } }
        })
        assert(
            response.body?.result?.serverInfo?.version === packageVersion,
            `Expected server version "${packageVersion}", got "${response.body?.result?.serverInfo?.version}"`
        )
    })

    // The old shared-server design would fail here: Protocol.connect() throws once a Server is
    // already bound to a transport, so a second in-flight request would collide with the first.
    await test('concurrent POSTs are each served independently', async () => {
        const responses = await Promise.all(
            [1, 2, 3, 4, 5].map(id => mcpPost(url, { jsonrpc: '2.0', id, method: 'tools/list' }))
        )

        responses.forEach((response, index) => {
            assert(response.status === 200, `Request ${index} got ${response.status}`)
            assert(!!response.body?.result?.tools?.length, `Request ${index} returned no tools`)
        })
    })

    // RFC 7231 requires a 405 to name the methods the resource does accept.
    await test('GET returns 405 with Allow — stateless mode has no standalone stream', async () => {
        const response = await fetch(url, { headers: { accept: 'text/event-stream' } })
        assert(response.status === 405, `Expected 405, got ${response.status}`)
        assert(
            response.headers.get('allow') === 'POST',
            `Expected "Allow: POST", got "${response.headers.get('allow')}"`
        )
    })

    await test('DELETE returns 405 with Allow — there is no session to tear down', async () => {
        const response = await fetch(url, { method: 'DELETE' })
        assert(response.status === 405, `Expected 405, got ${response.status}`)
        assert(
            response.headers.get('allow') === 'POST',
            `Expected "Allow: POST", got "${response.headers.get('allow')}"`
        )
    })

    httpServer.close()

    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`)
    process.exit(failed > 0 ? 1 : 0)
}

// Boots a bare express app carrying only the MCP endpoint, on an OS-assigned port so parallel
// test runs never collide.
async function startMCPServer() {
    const app = express()
    app.use(express.json())
    mountMCP(app, bridge, entries, '/mcp', 'on_demand')

    const server = app.listen(0)
    await new Promise<void>(resolve => server.once('listening', () => resolve()))

    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an assigned TCP port')

    return { server, url: `http://127.0.0.1:${address.port}/mcp` }
}

async function mcpPost(url: string, payload: Record<string, unknown>): Promise<MCPResponse> {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            // The spec requires both types on POST; the transport answers 406 without them.
            accept: 'application/json, text/event-stream',
            authorization: 'Bearer 1'
        },
        body: JSON.stringify(payload)
    })

    return {
        status: response.status,
        sessionId: response.headers.get('mcp-session-id'),
        body: parseMCPBody(await response.text())
    }
}

// The transport replies over SSE unless JSON-only mode is enabled, so the JSON-RPC payload
// arrives as a `data:` frame rather than a bare body.
function parseMCPBody(raw: string): MCPResponse['body'] {
    const dataLine = raw.split('\n').find(line => line.startsWith('data:'))
    const json = dataLine ? dataLine.slice('data:'.length).trim() : raw.trim()

    try {
        return JSON.parse(json)
    } catch {
        return undefined
    }
}

main()
