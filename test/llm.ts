/**
 * LLM integration tests using OpenAI gpt-4o-mini.
 * Requires OPENAI_API_KEY. Non-deterministic — may occasionally flake due to LLM behavior.
 * Run separately: `npm run test:llm`
 *
 * Exercises the `on_demand` tool mode end-to-end: the model is handed the 3 meta-tools
 * (`tool_search`, `tool_describe`, `tool_use`) via `getTools`, and every call is dispatched
 * through the mode-agnostic `handleToolCall`.
 */

import 'dotenv/config'
import OpenAI from 'openai'
import { defineBridge, getTools, handleToolCall } from '../src/tools'
import { entries } from '../src/demo/bridge'

const openai = new OpenAI()
const bridge = defineBridge(entries)
const tools = getTools(entries, { toolMode: 'on_demand', format: 'openai' }) as OpenAI.Chat.ChatCompletionTool[]

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
            if (tc.type !== 'function') continue

            const toolCall = {
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments)
            }
            toolCallNames.push(tc.function.name)

            let result: unknown
            try {
                result = await handleToolCall(bridge, entries, toolCall, { context: authContext })
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
        lastAssistantMessage: (messages.filter(m => m.role === 'assistant').pop()?.content as string) || '',
        toolCalls: toolCallNames
    }
}

async function main() {
    console.log('\n--- LLM Integration Tests (OpenAI gpt-4o-mini) ---\n')

    // Test 1: discover + use — the core on_demand flow
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

    // Test 2: keyword search surfaces the right tools and excludes unrelated ones
    await test('tool_search by keyword finds user tools, not product/order', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            `You are a helpful assistant. Use the provided tools.
Search for tools with query="user". After searching, list the exact tool names you found as a comma-separated list. Do NOT call tool_use.`,
            'Search for user tools and list their names.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_search'), 'Expected tool_search call')
        assert(lastAssistantMessage.includes('user.fetch'), 'Expected user.fetch in response')
        assert(lastAssistantMessage.includes('user.create'), 'Expected user.create in response')
        assert(!lastAssistantMessage.includes('product.fetch'), 'Should NOT include product tools')
        assert(!lastAssistantMessage.includes('order.create'), 'Should NOT include order tools')
    })

    // Test 3: describe before use — the model must inspect the output schema.
    // Asking for the exact fields a tool *returns* (incl. createdAt) is not guessable
    // from the search description, so the model has to call tool_describe.
    await test('tool_describe is used to read a tool output schema', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            `You are a helpful assistant. Use the provided tools.
You do NOT know any tool's schema from memory. To answer, you MUST call tool_search to find the tool, then tool_describe to read its schema. Never guess. Do NOT call tool_use.
List every field name the tool RETURNS in its response.`,
            'For the "create a new product" tool, list every field it returns in its response.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_describe'), 'Expected tool_describe call')
        const lower = lastAssistantMessage.toLowerCase()
        assert(
            lower.includes('createdat') && lower.includes('price'),
            `Expected response fields (createdAt, price), got: ${lastAssistantMessage.slice(0, 200)}`
        )
    })

    // Test 4: write op + auth context flows through tool_use
    await test('LLM creates a new user via tool_use with auth context', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            'You are a helpful assistant. Use the provided tools to answer questions.',
            'Create a new user with name "LLM Test User" and email "llm@test.com". Tell me the created user ID.',
            { requestedAt: Date.now(), userId: 1 }
        )

        assert(toolCalls.includes('tool_use'), 'Expected tool_use call')
        assert(/\d+/.test(lastAssistantMessage), 'Expected a numeric user ID in response')
    })

    // Test 5: Zod validation errors surface back to the model
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
            lower.includes('error') ||
                lower.includes('too_small') ||
                lower.includes('>=1') ||
                lower.includes('validation') ||
                lower.includes('minimum'),
            `Expected validation error in response, got: ${lastAssistantMessage.slice(0, 300)}`
        )
    })

    // Test 6: multi-step — create then read back
    await test('LLM performs multi-step: create product then list', async () => {
        const { toolCalls, lastAssistantMessage } = await runConversation(
            'You are a helpful assistant. Use the provided tools.',
            'First, create a product called "AI Widget" with price 42. Then list all products and tell me the total count.',
            { requestedAt: Date.now(), userId: 1 }
        )

        const toolUseCount = toolCalls.filter(n => n === 'tool_use').length
        assert(toolUseCount >= 2, `Expected at least 2 tool_use calls, got ${toolUseCount}`)
        assert(
            lastAssistantMessage.toLowerCase().includes('ai widget') ||
                lastAssistantMessage.includes('4') ||
                lastAssistantMessage.includes('5'),
            `Expected product info in response`
        )
    })

    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`)
    process.exit(failed > 0 ? 1 : 0)
}

main()
