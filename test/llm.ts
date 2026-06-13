/**
 * LLM integration tests using OpenAI gpt-4o-mini.
 * Requires OPENAI_API_KEY. Non-deterministic — may occasionally flake due to LLM behavior.
 * Run separately: `npm run test:llm`
 */

import 'dotenv/config'
import OpenAI from 'openai'
import { defineBridge, getMetaTools, handleMetaToolCall } from '../src/tools'
import { entries } from '../src/demo/bridge'

const openai = new OpenAI()
const bridge = defineBridge(entries)
const tools = getMetaTools({ format: 'openai' }) as OpenAI.Chat.ChatCompletionTool[]

let passed = 0
let failed = 0

const test = async (name: string, fn: () => Promise<void>) => {
    try {
        await fn()
        passed++
        console.log(`  ✅ ${name}`)
    } catch (error: unknown) {
        failed++
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  ❌ ${name}: ${message}`)
    }
}

const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message)
}

type Message = OpenAI.Chat.ChatCompletionMessageParam

async function runConversation(
    systemPrompt: string,
    userPrompt: string,
    authContext?: Record<string, unknown>
): Promise<{ messages: Message[]; lastAssistantMessage: string; toolCalls: string[] }> {
    const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ]

    const toolCallNames: string[] = []
    let maxTurns = 10

    while (maxTurns-- > 0) {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            tools,
            tool_choice: 'auto'
        })

        const choice = response.choices[0]
        const msg = choice.message

        messages.push(msg)

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            return {
                messages,
                lastAssistantMessage: msg.content || '',
                toolCalls: toolCallNames
            }
        }

        for (const tc of msg.tool_calls) {
            const toolCall = {
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments)
            }
            toolCallNames.push(tc.function.name)

            let result: unknown
            try {
                result = await handleMetaToolCall(bridge, entries, toolCall, authContext)
            } catch (error: unknown) {
                result = { error: error instanceof Error ? error.message : String(error) }
            }

            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(result)
            })
        }
    }

    return {
        messages,
        lastAssistantMessage: messages.filter(m => m.role === 'assistant').pop()?.content as string || '',
        toolCalls: toolCallNames
    }
}

async function main() {
    console.log('\n--- LLM Integration Tests (OpenAI gpt-4o-mini) ---\n')

    // Test 1: LLM discovers and uses tools via meta-tools
    await test('LLM uses tool_search then tool_use to fetch users', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            'You are a helpful assistant. Use the provided tools to answer questions. Always search for tools first before using them.',
            'List all available users. Tell me their names.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_search'), 'Expected tool_search call')
        assert(toolCalls.includes('tool_use'), 'Expected tool_use call')
        assert(
            lastAssistantMessage.toLowerCase().includes('neil') || lastAssistantMessage.toLowerCase().includes('john'),
            `Expected user names in response, got: ${lastAssistantMessage.slice(0, 200)}`
        )
    })

    // Test 2: Context filtering — LLM only sees user tools when searching 'user' context
    await test('tool_search with context filters correctly', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            `You are a helpful assistant. Use the provided tools.
When searching for tools, use context="user" to find user-related tools.
After searching, tell me the exact tool names you found, as a comma-separated list. Do NOT call tool_use.`,
            'Search for user-related tools and list their names.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_search'), 'Expected tool_search call')
        assert(lastAssistantMessage.includes('user.fetch'), 'Expected user.fetch in response')
        assert(lastAssistantMessage.includes('user.create'), 'Expected user.create in response')
        assert(!lastAssistantMessage.includes('product.fetch'), 'Should NOT include product tools')
        assert(!lastAssistantMessage.includes('order.create'), 'Should NOT include order tools')
    })

    // Test 3: Context filtering — product context
    await test('tool_search with product context returns product tools', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            `You are a helpful assistant. Use the provided tools.
When searching for tools, use context="product" to find product-related tools.
After searching, tell me the exact tool names you found, as a comma-separated list. Do NOT call tool_use.`,
            'Search for product-related tools and list their names.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_search'), 'Expected tool_search call')
        assert(lastAssistantMessage.includes('product.fetch'), 'Expected product.fetch in response')
        assert(lastAssistantMessage.includes('product.list'), 'Expected product.list in response')
        assert(!lastAssistantMessage.includes('user.fetch'), 'Should NOT include user tools')
    })

    // Test 4: LLM creates a user (tests write operations and auth context)
    await test('LLM creates a new user via tool_use with auth context', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            'You are a helpful assistant. Use the provided tools to answer questions.',
            'Create a new user with name "LLM Test User" and email "llm@test.com". Tell me the created user ID.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_use'), 'Expected tool_use call')
        assert(/\d+/.test(lastAssistantMessage), 'Expected a numeric user ID in response')
    })

    // Test 5: Zod validation — LLM sends invalid args, error is returned
    await test('Zod validation error is returned to LLM for invalid args', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            `You are a helpful assistant. Use the provided tools.
IMPORTANT: When calling tool_use for user.fetch, use id=0 (zero) exactly. Do not change the arguments. Report any error you receive back to the user verbatim.`,
            'Fetch user with ID 0. Report exactly what happens.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_use'), 'Expected tool_use call')
        const lower = lastAssistantMessage.toLowerCase()
        assert(
            lower.includes('error') || lower.includes('too_small') || lower.includes('>=1') || lower.includes('validation') || lower.includes('minimum'),
            `Expected validation error in response, got: ${lastAssistantMessage.slice(0, 300)}`
        )
    })

    // Test 6: Multi-step — LLM creates a product then lists all products
    await test('LLM performs multi-step: create product then list', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            'You are a helpful assistant. Use the provided tools.',
            'First, create a product called "AI Widget" with price 42. Then list all products and tell me the total count.',
            { requestedAt: Date.now(), userId: 1 }
        )

        const toolUseCount = toolCalls.filter(n => n === 'tool_use').length
        assert(toolUseCount >= 2, `Expected at least 2 tool_use calls, got ${toolUseCount}`)
        assert(
            lastAssistantMessage.toLowerCase().includes('ai widget') || lastAssistantMessage.includes('4') || lastAssistantMessage.includes('5'),
            `Expected product info in response`
        )
    })

    // Test 7: No context = all tools visible
    await test('tool_search without context returns all tools', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            `You are a helpful assistant. Use the provided tools.
Search for all available tools (do not pass any context filter). Tell me the total number of tools found and list all their names.`,
            'How many tools are available in total? List all of them.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_search'), 'Expected tool_search call')
        assert(
            lastAssistantMessage.includes('16') ||
                (lastAssistantMessage.includes('user.') &&
                    lastAssistantMessage.includes('product.') &&
                    lastAssistantMessage.includes('order.')),
            `Expected all 16 tools or mixed contexts in response, got: ${lastAssistantMessage.slice(0, 300)}`
        )
    })

    // Test 8: Contextless tools (order.primitives) appear in any context search
    await test('contextless tools appear in filtered searches', async () => {
        const { lastAssistantMessage } = await runConversation(
            `You are a helpful assistant. Use the provided tools.
Search for tools with context="product". List ALL tool names you find, including any that have no context. Be exhaustive.`,
            'Search for product context tools and list every single tool name.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(lastAssistantMessage.includes('order.primitives'), 'Expected order.primitives (no context) to appear in product search')
    })

    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`)
    process.exit(failed > 0 ? 1 : 0)
}

main()
