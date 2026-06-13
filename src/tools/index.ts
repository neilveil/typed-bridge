import { z } from 'zod'

export type BridgeEntry = {
    handler: (...args: any[]) => Promise<any>
    // Optional so `defineBridge` can be used purely for auto-validation, without MCP/LLM metadata
    description?: string
    context?: string
    args?: z.ZodType
    res: z.ZodType
}

export type BridgeEntries = Record<string, BridgeEntry>

export type ExtractHandlers<T extends BridgeEntries> = {
    [K in keyof T]: T[K] extends { handler: infer H } ? H : never
}

export type Bridge = Record<string, (...args: any[]) => Promise<any>>

export const LLM_TOOL_FORMATS = ['openai', 'anthropic', 'json-schema'] as const

export type LLMToolFormat = (typeof LLM_TOOL_FORMATS)[number]

export function isLLMToolFormat(value: string): value is LLMToolFormat {
    return (LLM_TOOL_FORMATS as readonly string[]).includes(value)
}

export interface ToLLMToolsOptions {
    format?: LLMToolFormat
    includeResponse?: boolean
}

export interface ToolCall {
    name: string
    arguments: Record<string, unknown>
}

export function defineBridge<T extends BridgeEntries>(entries: T): ExtractHandlers<T> {
    const bridge: any = {}

    for (const [key, entry] of Object.entries(entries)) {
        bridge[key] = async (...handlerArgs: any[]) => {
            if (entry.args) handlerArgs[0] = entry.args.parse(handlerArgs[0])
            return entry.handler(...handlerArgs)
        }
    }

    return bridge
}

const NO_ARGS_SCHEMA = { type: 'object' as const, properties: {}, additionalProperties: false as const }

export function schemaToJSONSchema(schema: z.ZodType) {
    const jsonSchema: any = z.toJSONSchema(schema, {
        unrepresentable: 'any',
        override: (ctx: any) => {
            // z.date() is unrepresentable in JSON Schema — emit ISO 8601 string
            if (ctx.zodSchema?._zod?.def?.type === 'date') {
                ctx.jsonSchema.type = 'string'
                ctx.jsonSchema.format = 'date-time'
            }
        }
    })

    delete jsonSchema['$schema']

    return jsonSchema
}

// --- Direct tool generation (attach all tools to LLM) ---

export function toLLMTools(entries: BridgeEntries, options?: ToLLMToolsOptions) {
    const format = options?.format || 'openai'
    const includeResponse = options?.includeResponse || false

    // Guard against invalid formats slipping in via casts (e.g. from query params)
    if (!isLLMToolFormat(format)) throw new Error(`Invalid LLM tool format: ${format}. Expected one of ${LLM_TOOL_FORMATS.join(', ')}`)

    const tools: unknown[] = []

    for (const [name, entry] of Object.entries(entries)) {
        const description = entry.description
        const parameters = entry.args ? schemaToJSONSchema(entry.args) : NO_ARGS_SCHEMA

        let response: unknown
        if (includeResponse) response = schemaToJSONSchema(entry.res)

        switch (format) {
            case 'openai':
                tools.push({
                    type: 'function',
                    function: { name, description, parameters, ...(response ? { response } : {}) }
                })
                break

            case 'anthropic':
                tools.push({
                    name,
                    description,
                    input_schema: parameters,
                    ...(response ? { output_schema: response } : {})
                })
                break

            case 'json-schema':
                tools.push({ name, description, parameters, ...(response ? { response } : {}) })
                break

            default: {
                const exhaustiveCheck: never = format
                throw new Error(`Unhandled LLM tool format: ${exhaustiveCheck}`)
            }
        }
    }

    return tools
}

// --- Meta-tools (expose only tool_search + tool_use to LLM) ---

export function getMetaTools(options?: { format?: LLMToolFormat }) {
    const format = options?.format || 'openai'

    const searchTool = {
        name: 'tool_search',
        description:
            'Search for available tools. Returns tool names, descriptions, and parameter schemas. Call this before tool_use to discover what tools are available and what arguments they accept.',
        parameters: {
            type: 'object',
            properties: {
                context: {
                    type: 'string',
                    description: 'Filter tools by context/category (e.g., "user", "order"). Omit to see all available tools.'
                }
            }
        }
    }

    const useTool = {
        name: 'tool_use',
        description:
            'Execute a tool by name. Use tool_search first to discover available tools and their parameter schemas.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'The tool name returned by tool_search (e.g., "user.fetch")'
                },
                arguments: {
                    type: 'object',
                    description: 'Arguments to pass to the tool, matching the parameter schema from tool_search'
                }
            },
            required: ['name']
        }
    }

    switch (format) {
        case 'openai':
            return [
                { type: 'function', function: searchTool },
                { type: 'function', function: useTool }
            ]

        case 'anthropic':
            return [
                { name: searchTool.name, description: searchTool.description, input_schema: searchTool.parameters },
                { name: useTool.name, description: useTool.description, input_schema: useTool.parameters }
            ]

        default:
            return [searchTool, useTool]
    }
}

// Contextless tools (entry.context undefined) always appear regardless of filter,
// so utility tools remain discoverable in any context search.
export function toolSearch(entries: BridgeEntries, context?: string) {
    const results: unknown[] = []

    for (const [name, entry] of Object.entries(entries)) {
        if (context && entry.context && entry.context !== context) continue

        results.push({
            name,
            description: entry.description,
            context: entry.context,
            parameters: entry.args ? schemaToJSONSchema(entry.args) : NO_ARGS_SCHEMA
        })
    }

    return results
}

export async function toolUse(bridge: Bridge, name: string, args: unknown, context?: unknown) {
    const handler = bridge[name]
    if (!handler) throw new Error(`Tool not found: ${name}`)

    return handler(args, context)
}

export async function handleMetaToolCall(
    bridge: Bridge,
    entries: BridgeEntries,
    toolCall: ToolCall,
    context?: unknown
): Promise<unknown> {
    switch (toolCall.name) {
        case 'tool_search':
            return toolSearch(entries, toolCall.arguments?.context as string | undefined)

        case 'tool_use': {
            const args = toolCall.arguments as { name: string; arguments?: Record<string, unknown> }
            return toolUse(bridge, args.name, args.arguments || {}, context)
        }

        default:
            throw new Error(`Unknown meta-tool: ${toolCall.name}. Expected "tool_search" or "tool_use".`)
    }
}
