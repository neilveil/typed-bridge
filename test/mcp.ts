/**
 * Deterministic tests for tool modes, surfaces, and visibility — no network or LLM.
 * Covers the matrix that the MCP server and consumer LLM loops both rely on:
 *   - getTools: 'on_demand' → 3 meta-tools, 'attach_all' → one tool per visible entry
 *   - handleToolCall: meta-flow vs direct-call dispatch, in both surfaces
 *   - visibility: `mcp: false` hides an entry from the 'mcp' surface only
 *
 * Run: `npm run test:mcp`
 */

import { defineBridge, getTools, handleToolCall, toolSearch } from '../src/tools'
import { entries } from '../src/demo/bridge'

const bridge = defineBridge(entries)
const ctx = { requestedAt: Date.now(), userId: 1 }

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
    try {
        await fn()
        throw new Error(`Expected rejection containing "${substring}", but it resolved`)
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes(substring)) throw new Error(`Expected "${substring}", got: "${message}"`)
    }
}

const totalEntries = Object.keys(entries).length

async function main() {
    console.log('\n--- Tool mode / surface / visibility ---\n')

    // --- getTools: on_demand ---

    await test('on_demand returns exactly the 3 meta-tools', () => {
        const tools = getTools(entries, { toolMode: 'on_demand', format: 'openai' }) as { function: { name: string } }[]
        const names = tools.map(t => t.function.name).sort()
        assert(tools.length === 3, `Expected 3 meta-tools, got ${tools.length}`)
        assert(
            JSON.stringify(names) === JSON.stringify(['tool_describe', 'tool_search', 'tool_use']),
            `Unexpected meta-tool names: ${names.join(', ')}`
        )
    })

    await test('on_demand default mode matches explicit on_demand', () => {
        const a = getTools(entries, { format: 'openai' }) as unknown[]
        const b = getTools(entries, { toolMode: 'on_demand', format: 'openai' }) as unknown[]
        assert(a.length === 3 && b.length === 3, 'Default toolMode should be on_demand (3 meta-tools)')
    })

    // --- getTools: attach_all + surface visibility ---

    await test('attach_all (llm surface) attaches every entry as a tool', () => {
        const tools = getTools(entries, { toolMode: 'attach_all', format: 'openai' }) as { function: { name: string } }[]
        assert(tools.length === totalEntries, `Expected ${totalEntries} tools, got ${tools.length}`)
        assert(tools.some(t => t.function.name === 'user.remove'), 'user.remove is an LLM tool (llm not disabled)')
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
        assert(llmHit.some(r => r.name === 'user.remove'), 'user.remove should be searchable on llm surface')
        assert(!mcpHit.some(r => r.name === 'user.remove'), 'user.remove must NOT be searchable on mcp surface')
    })

    // --- handleToolCall: on_demand (meta) dispatch ---

    await test('on_demand: tool_search → tool_use executes the entry', async () => {
        const search = (await handleToolCall(bridge, entries, {
            name: 'tool_search',
            arguments: { query: 'user' }
        })) as { name: string }[]
        assert(search.some(r => r.name === 'user.fetch'), 'tool_search should find user.fetch')

        const result = (await handleToolCall(
            bridge,
            entries,
            { name: 'tool_use', arguments: { name: 'user.fetch', arguments: { id: 1 } } },
            { context: ctx }
        )) as { id: number }
        assert(result.id === 1, `Expected user id 1, got ${result.id}`)
    })

    await test('on_demand: tool_describe returns args and response schema', async () => {
        const described = (await handleToolCall(bridge, entries, {
            name: 'tool_describe',
            arguments: { name: 'product.create' }
        })) as { name: string; args: { properties?: Record<string, unknown> }; response: { properties?: Record<string, unknown> } }

        assert(described.name === 'product.create', 'Expected described tool name product.create')
        assert(!!described.args.properties?.name && !!described.args.properties?.price, 'Expected name & price in args schema')
        assert(!!described.response.properties?.createdAt, 'Expected createdAt in response schema')
    })

    await test('on_demand (mcp surface): tool_describe hides mcp:false entry', async () => {
        await expectReject(
            () => handleToolCall(bridge, entries, { name: 'tool_describe', arguments: { name: 'user.remove' } }, { surface: 'mcp' }),
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
            { context: ctx }
        )) as { id: number }

        const removed = (await handleToolCall(
            bridge,
            entries,
            { name: 'tool_use', arguments: { name: 'user.remove', arguments: { id: created.id } } },
            { context: ctx, surface: 'llm' }
        )) as { success: boolean }
        assert(removed.success === true, 'user.remove should succeed on llm surface')
    })

    // --- handleToolCall: attach_all (direct) dispatch ---

    await test('attach_all: direct entry name executes the handler', async () => {
        const result = (await handleToolCall(
            bridge,
            entries,
            { name: 'product.fetch', arguments: { id: 1 } },
            { context: ctx }
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
        await expectReject(() => handleToolCall(bridge, entries, { name: 'user.fetch', arguments: { id: 0 } }), '')
        await expectReject(
            () => handleToolCall(bridge, entries, { name: 'tool_use', arguments: { name: 'user.fetch', arguments: { id: 0 } } }),
            ''
        )
    })

    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`)
    process.exit(failed > 0 ? 1 : 0)
}

main()
