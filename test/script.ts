/**
 * Deterministic tests for the `tool_script` sandbox — no network or LLM.
 * Covers the core promise of the feature: per-call tool results are uncapped inside the
 * sandbox, only the script's final return is size-limited, and the sandbox stays inside the
 * same visibility + middleware + resource-limit boundaries as any other tool call.
 *
 * Run: `npm run test:script`
 */

import { config } from '../src/config'
import { defineBridge, handleToolCall } from '../src/tools'
import { entries } from '../src/demo/bridge'
// Side-effect import: registers the demo's auth middleware, which runs on tool calls too.
import '../src/demo/middleware'

const bridge = defineBridge(entries)
const headers = { authorization: 'Bearer 1' }
const context = { requestedAt: Date.now(), userId: 1 }

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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (substring && !message.includes(substring)) throw new Error(`Expected "${substring}", got: "${message}"`)
        return
    }
    throw new Error('Expected a rejection, but the call resolved successfully')
}

// Run a tool_script through the full public dispatch path.
const runScriptTool = (code: string, options?: { surface?: 'llm' | 'mcp'; headers?: Record<string, string> }) =>
    handleToolCall(
        bridge,
        entries,
        { name: 'tool_script', arguments: { code } },
        { context, surface: options?.surface || 'llm', headers: options?.headers ?? headers }
    )

async function main() {
    console.log('\n--- tool_script sandbox ---\n')

    // --- core: callTool returns real objects, script returns a projection ---

    await test('script fetches a tool and returns a computed projection', async () => {
        const result = (await runScriptTool(`
            const events = await callTool('analytics.events', {})
            const purchases = events.filter(e => e.type === 'purchase')
            return { total: events.length, purchases: purchases.length }
        `)) as { total: number; purchases: number }

        assert(result.total === 600, `Expected 600 events, got ${result.total}`)
        assert(result.purchases === 200, `Expected 200 purchases, got ${result.purchases}`)
    })

    await test('script can call multiple tools and join their results', async () => {
        const result = (await runScriptTool(`
            const products = await callTool('product.list', {})
            const events = await callTool('analytics.events', {})
            const revenue = events.filter(e => e.type === 'purchase').reduce((sum, e) => sum + e.amount, 0)
            return { productCount: products.length, revenue }
        `)) as { productCount: number; revenue: number }

        assert(result.productCount >= 3, `Expected at least 3 products, got ${result.productCount}`)
        assert(result.revenue > 0, `Expected positive revenue, got ${result.revenue}`)
    })

    // --- the whole point: per-call results are uncapped, only the return is capped ---

    await test('a large tool result exceeds the limit via tool_use but is usable inside tool_script', async () => {
        const original = config.maxToolOutputChars
        config.maxToolOutputChars = 5000
        try {
            // Direct fetch of the big dataset is rejected — it blows the (lowered) cap.
            await expectReject(
                () =>
                    handleToolCall(
                        bridge,
                        entries,
                        { name: 'tool_use', arguments: { name: 'analytics.events', arguments: {} } },
                        { context, headers }
                    ),
                'too large'
            )

            // The same fetch inside a script is fine — only the small return is measured.
            const count = (await runScriptTool(`
                const events = await callTool('analytics.events', {})
                return events.length
            `)) as number
            assert(count === 600, `Expected 600 events from inside the sandbox, got ${count}`)
        } finally {
            config.maxToolOutputChars = original
        }
    })

    await test('an oversized script return value is still rejected by the output limit', async () => {
        const original = config.maxToolOutputChars
        config.maxToolOutputChars = 5000
        try {
            await expectReject(() => runScriptTool(`return await callTool('analytics.events', {})`), 'too large')
        } finally {
            config.maxToolOutputChars = original
        }
    })

    await test('an oversized script return says to reduce inside the script, not to retry with tool_script', async () => {
        const original = config.maxToolOutputChars
        config.maxToolOutputChars = 5000
        try {
            // The model is already in the sandbox; sending it back to tool_script would loop.
            await expectReject(
                () => runScriptTool(`return await callTool('analytics.events', {})`),
                'Reduce it further inside the script'
            )
        } finally {
            config.maxToolOutputChars = original
        }
    })

    // --- call budget ---

    await test('a script exceeding maxToolCalls is rejected on the call that crosses the budget', async () => {
        const original = config.script.maxToolCalls
        config.script.maxToolCalls = 3
        try {
            await expectReject(
                () =>
                    runScriptTool(`
                        for (let index = 0; index < 10; index++) await callTool('product.fetch', { id: 1 })
                        return 'never reached'
                    `),
                'exceeded maxToolCalls'
            )
        } finally {
            config.script.maxToolCalls = original
        }
    })

    await test('a script can catch the budget error and still return what it gathered', async () => {
        const original = config.script.maxToolCalls
        config.script.maxToolCalls = 3
        try {
            // Rejecting the offending call rather than killing the run is what makes this
            // possible — the script keeps the results it already has.
            const fetched = (await runScriptTool(`
                const products = []
                try {
                    for (let index = 0; index < 10; index++) {
                        products.push(await callTool('product.fetch', { id: 1 }))
                    }
                } catch (error) {
                    return products.length
                }
                return products.length
            `)) as number
            assert(fetched === 3, `Expected 3 products before the budget tripped, got ${fetched}`)
        } finally {
            config.script.maxToolCalls = original
        }
    })

    await test('a failed callTool rejects with a real Error, so error.message works in the sandbox', async () => {
        // Recovering from a failed call is the point of rejecting one rather than killing the
        // run. A bare string rejection would leave the idiomatic `error.message` undefined.
        const message = (await runScriptTool(`
            try {
                await callTool('product.fetch', { id: 'not-a-number' })
                return 'no rejection'
            } catch (error) {
                return { isError: error instanceof Error, message: error.message }
            }
        `)) as { isError: boolean; message: string }
        assert(message.isError, 'callTool should reject with an Error instance')
        assert(typeof message.message === 'string' && message.message.length > 0, 'error.message must be readable')
    })

    await test('maxToolCalls set to 0 disables the budget', async () => {
        const original = config.script.maxToolCalls
        config.script.maxToolCalls = 0
        try {
            const count = (await runScriptTool(`
                let calls = 0
                for (let index = 0; index < 8; index++) {
                    await callTool('product.fetch', { id: 1 })
                    calls++
                }
                return calls
            `)) as number
            assert(count === 8, `Expected 8 uncapped calls, got ${count}`)
        } finally {
            config.script.maxToolCalls = original
        }
    })

    // --- visibility + middleware still apply to callTool ---

    await test('callTool cannot reach an mcp:false entry on the mcp surface', async () => {
        await expectReject(
            () => runScriptTool(`return await callTool('user.remove', { id: 1 })`, { surface: 'mcp' }),
            'Tool not found: user.remove'
        )
    })

    await test('callTool is denied by auth middleware when headers are missing', async () => {
        await expectReject(
            () => runScriptTool(`return await callTool('user.fetch', { id: 1 })`, { headers: {} }),
            'Unauthorized'
        )
    })

    await test('a Zod validation error inside callTool surfaces to the script', async () => {
        await expectReject(() => runScriptTool(`return await callTool('user.fetch', { id: 0 })`), '')
    })

    // --- resource limits ---

    await test('an infinite loop is stopped by the timeout', async () => {
        const original = config.script.timeoutMs
        config.script.timeoutMs = 200
        try {
            await expectReject(() => runScriptTool(`while (true) {}`), '')
        } finally {
            config.script.timeoutMs = original
        }
    })

    await test('runaway memory allocation is stopped by the memory limit', async () => {
        const original = config.script.memoryBytes
        config.script.memoryBytes = 2 * 1024 * 1024
        try {
            await expectReject(() => runScriptTool(`let s = 'x'; while (true) { s += s }`), '')
        } finally {
            config.script.memoryBytes = original
        }
    })

    // --- gating ---

    await test('tool_script call is rejected when disabled', async () => {
        config.script.enabled = false
        try {
            await expectReject(() => runScriptTool(`return 1`), 'Tool not found: tool_script')
        } finally {
            config.script.enabled = true
        }
    })

    await test('tool_script call is rejected on a surface not in config.script.surfaces', async () => {
        config.script.surfaces = ['llm']
        try {
            await expectReject(() => runScriptTool(`return 1`, { surface: 'mcp' }), 'Tool not found: tool_script')
        } finally {
            config.script.surfaces = ['llm', 'mcp']
        }
    })

    // --- input validation ---

    await test('empty code is rejected', async () => {
        await expectReject(() => runScriptTool(`   `), 'non-empty')
    })

    await test('a thrown error inside the script surfaces to the caller', async () => {
        await expectReject(() => runScriptTool(`throw new Error('boom')`), 'boom')
    })

    // --- regressions ---

    await test('a fire-and-forget callTool that outlives the script does not crash', async () => {
        // The script starts a tool call but never awaits it and returns immediately, so the
        // context is disposed while the host call is still in flight. Its late settlement must
        // not touch the disposed VM (which would throw an unhandled rejection).
        const result = (await runScriptTool(`callTool('analytics.events', {}); return 'done'`)) as string
        assert(result === 'done', `Expected "done", got ${result}`)
        // Give the leaked host promise time to settle against the now-disposed context.
        await new Promise(resolve => setTimeout(resolve, 50))
    })

    await test('code ending in a line comment still runs', async () => {
        const result = (await runScriptTool(`return 42 // the answer`)) as number
        assert(result === 42, `Expected 42, got ${result}`)
    })

    // --- reserved name ---

    await test('defineBridge rejects an entry named tool_script', () => {
        let threw = false
        try {
            defineBridge({
                tool_script: entries['analytics.events']
            })
        } catch (error: unknown) {
            threw = true
            const message = error instanceof Error ? error.message : String(error)
            assert(message.includes('reserved'), `Expected a "reserved" error, got: ${message}`)
        }
        assert(threw, 'Expected defineBridge to reject the reserved name')
    })

    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`)
    process.exit(failed > 0 ? 1 : 0)
}

main()
