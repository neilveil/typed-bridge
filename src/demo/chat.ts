import OpenAI from 'openai'
import { Application, Request, Response } from 'express'
import { Bridge, BridgeEntries, getMetaTools, handleMetaToolCall } from '../tools'

const SYSTEM_PROMPT = `You are a helpful assistant with access to a backend API via tools.

You have two tools: tool_search and tool_use.
- Call tool_search first to discover available tools. You can filter by context (e.g., "user", "product", "order").
- Call tool_use to execute a tool, passing the tool name and its arguments.

The backend has user management, product catalog, and order management capabilities.
When the user asks something, search for relevant tools, then use them to fulfill the request.
Present results in a clear, readable format. Use markdown tables for lists of items.`

export function mountChat(app: Application, bridge: Bridge, entries: BridgeEntries) {
    const metaTools = getMetaTools({ format: 'openai' }) as OpenAI.Chat.ChatCompletionTool[]

    // Lazy-init so the server can start without OPENAI_API_KEY
    let openai: OpenAI

    app.post('/chat', async (req: Request, res: Response) => {
        const { messages: clientMessages } = req.body as { messages: { role: string; content: string }[] }

        if (!clientMessages?.length) {
            res.status(400).json({ error: 'messages required' })
            return
        }

        if (!openai) openai = new OpenAI()

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        res.flushHeaders()

        const authContext = { requestedAt: Date.now(), userId: 1 }

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...clientMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        ]

        try {
            let maxTurns = 10

            while (maxTurns-- > 0) {
                const stream = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages,
                    tools: metaTools,
                    tool_choice: 'auto',
                    stream: true
                })

                let assistantContent = ''
                const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()
                let hasToolCalls = false

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta

                    if (delta?.content) {
                        assistantContent += delta.content
                        res.write(`data: ${JSON.stringify({ type: 'text', content: delta.content })}\n\n`)
                    }

                    if (delta?.tool_calls) {
                        hasToolCalls = true
                        for (const tc of delta.tool_calls) {
                            const existing = toolCalls.get(tc.index)
                            if (existing) {
                                existing.arguments += tc.function?.arguments || ''
                            } else {
                                toolCalls.set(tc.index, {
                                    id: tc.id || '',
                                    name: tc.function?.name || '',
                                    arguments: tc.function?.arguments || ''
                                })
                            }
                        }
                    }
                }

                if (!hasToolCalls) {
                    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
                    res.end()
                    return
                }

                // Append assistant message with tool calls
                const assistantMsg: OpenAI.Chat.ChatCompletionMessageParam = {
                    role: 'assistant',
                    content: assistantContent || null,
                    tool_calls: [...toolCalls.values()].map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: tc.name, arguments: tc.arguments }
                    }))
                }
                messages.push(assistantMsg)

                res.write(
                    `data: ${JSON.stringify({ type: 'tool_calls', tools: [...toolCalls.values()].map(tc => tc.name) })}\n\n`
                )

                // Execute each tool call and append results
                for (const [, tc] of toolCalls) {
                    const toolCall = { name: tc.name, arguments: JSON.parse(tc.arguments) }

                    let result: unknown
                    try {
                        result = await handleMetaToolCall(bridge, entries, toolCall, authContext)
                    } catch (error: unknown) {
                        result = { error: error instanceof Error ? error.message : String(error) }
                    }

                    messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
                }
            }

            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
            res.end()
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            res.write(`data: ${JSON.stringify({ type: 'error', content: message })}\n\n`)
            res.end()
        }
    })
}
