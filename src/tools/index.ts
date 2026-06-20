import { z } from 'zod'
import { config } from '../config'

export type BridgeEntry = {
    handler: (...args: any[]) => Promise<any>
    // Optional so `defineBridge` can be used purely for auto-validation, without MCP/LLM metadata
    description?: string
    args?: z.ZodType
    res: z.ZodType
    // Exposed as an MCP tool by default. Set `false` to hide a handler from MCP clients.
    mcp?: boolean
    // Exposed as an LLM tool by default. Set `false` to hide a handler from LLM tool calling.
    llm?: boolean
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

// How tools are presented to an AI surface:
//  - 'attach_all'  → every eligible entry is attached as its own tool
//  - 'on_demand'   → the model gets the 3 meta-tools and discovers the rest
export const TOOL_MODES = ['attach_all', 'on_demand'] as const

export type ToolMode = (typeof TOOL_MODES)[number]

export function isToolMode(value: string): value is ToolMode {
    return (TOOL_MODES as readonly string[]).includes(value)
}

// Which visibility flag governs a given surface
export type ToolSurface = 'llm' | 'mcp'

// An entry is exposed to a surface unless it explicitly opts out via its flag.
export function isEntryVisible(entry: BridgeEntry | undefined, surface: ToolSurface): boolean {
    if (!entry) return false
    return surface === 'mcp' ? entry.mcp !== false : entry.llm !== false
}

export interface ToLLMToolsOptions {
    format?: LLMToolFormat
    includeResponse?: boolean
    surface?: ToolSurface
}

export interface GetToolsOptions {
    toolMode?: ToolMode
    format?: LLMToolFormat
    surface?: ToolSurface
    includeResponse?: boolean
}

export interface HandleToolCallOptions {
    context?: unknown
    surface?: ToolSurface
}

export interface ToolCall {
    name: string
    arguments: Record<string, unknown>
}

export function defineBridge<T extends BridgeEntries>(entries: T): ExtractHandlers<T> {
    const bridge: any = {}

    for (const [key, entry] of Object.entries(entries)) {
        // Reserved: these names drive the on_demand discovery flow. An entry using one
        // would be shadowed by the meta-tool in handleToolCall and never reachable by name.
        if (isMetaToolName(key))
            throw new Error(`Entry name "${key}" is reserved for a meta-tool — rename the entry.`)

        bridge[key] = async (...handlerArgs: any[]) => {
            if (entry.args) handlerArgs[0] = entry.args.parse(handlerArgs[0])
            return entry.handler(...handlerArgs)
        }
    }

    return bridge
}

/**
 * Bundle an entry's schema and handler into a single, self-contained object.
 * Purely a typing helper — it returns its input unchanged at runtime — but it
 * infers the handler's argument type from `args` and checks the return against
 * `res`, so you never write `z.infer<typeof ...>`. `context` stays `any` so you
 * can annotate it with your own named context type inline.
 */
export function defineEntry<A extends z.ZodType, R extends z.ZodType>(entry: {
    description?: string
    args: A
    res: R
    mcp?: boolean
    llm?: boolean
    handler: (args: z.infer<A>, context: any) => Promise<z.infer<R>>
}): {
    description?: string
    args: A
    res: R
    mcp?: boolean
    llm?: boolean
    handler: (args: z.infer<A>, context: any) => Promise<z.infer<R>>
}
export function defineEntry<R extends z.ZodType>(entry: {
    description?: string
    res: R
    mcp?: boolean
    llm?: boolean
    handler: (args: undefined, context: any) => Promise<z.infer<R>>
}): {
    description?: string
    res: R
    mcp?: boolean
    llm?: boolean
    handler: (args: undefined, context: any) => Promise<z.infer<R>>
}
// `any` is required here: an overload implementation signature must be `any`, and the
// handler's `context: any` is what lets callers annotate it inline (e.g. `_ctx: context.user`) —
// a narrower declared type like `unknown` would reject that annotation.
export function defineEntry(entry: any): any {
    return entry
}

const NO_ARGS_SCHEMA = { type: 'object' as const, properties: {}, additionalProperties: false as const }

export function toToolInputSchema(args?: z.ZodType) {
    if (!args) return { ...NO_ARGS_SCHEMA }
    const s = schemaToJSONSchema(args)
    if (!s || s.type !== 'object') return { ...NO_ARGS_SCHEMA }
    return s
}

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
    const surface = options?.surface || 'llm'

    // Guard against invalid formats slipping in via casts (e.g. from query params)
    if (!isLLMToolFormat(format)) throw new Error(`Invalid LLM tool format: ${format}. Expected one of ${LLM_TOOL_FORMATS.join(', ')}`)

    const tools: unknown[] = []

    for (const [name, entry] of Object.entries(entries)) {
        if (!isEntryVisible(entry, surface)) continue

        const description = entry.description
        const parameters = toToolInputSchema(entry.args)

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

// --- Meta-tools (tool_search → tool_describe → tool_use) ---

export function getMetaTools(options?: { format?: LLMToolFormat }) {
    const format = options?.format || 'openai'

    const searchTool = {
        name: 'tool_search',
        description:
            'Search for available tools by keyword. Returns matching tool names and descriptions. Use tool_describe to get the full schema before calling tool_use.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Case-insensitive search query matched against tool names and descriptions'
                }
            }
        }
    }

    const describeTool = {
        name: 'tool_describe',
        description:
            'Get the full input and output schema for a tool. Call this after tool_search and before tool_use.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'The tool name returned by tool_search (e.g., "user.fetch")'
                }
            },
            required: ['name']
        }
    }

    const useTool = {
        name: 'tool_use',
        description:
            'Execute a tool by name. Use tool_search and tool_describe first to discover tools and their schemas.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'The tool name to execute'
                },
                arguments: {
                    type: 'object',
                    description: 'Arguments matching the input schema from tool_describe'
                }
            },
            required: ['name']
        }
    }

    const tools = [searchTool, describeTool, useTool]

    switch (format) {
        case 'openai':
            return tools.map(t => ({ type: 'function', function: t }))

        case 'anthropic':
            return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))

        default:
            return tools
    }
}

export function toolSearch(entries: BridgeEntries, query?: string, surface: ToolSurface = 'llm') {
    const results: { name: string; description?: string }[] = []
    const q = query?.toLowerCase()

    for (const [name, entry] of Object.entries(entries)) {
        if (!isEntryVisible(entry, surface)) continue

        if (q) {
            const haystack = `${name} ${entry.description || ''}`.toLowerCase()
            if (!haystack.includes(q)) continue
        }

        results.push({ name, description: entry.description })
    }

    return results
}

export function toolDescribe(entries: BridgeEntries, name: string, surface: ToolSurface = 'llm') {
    const entry = entries[name]
    if (!entry || !isEntryVisible(entry, surface)) throw new Error(`Tool not found: ${name}`)

    return {
        name,
        description: entry.description,
        args: toToolInputSchema(entry.args),
        response: schemaToJSONSchema(entry.res)
    }
}

/**
 * Serialize a tool result and enforce `tbConfig.maxToolOutputChars`. Oversized results
 * throw (instead of truncating to invalid JSON) so the model is prompted to narrow its
 * query. Returns the serialized JSON (callers may discard it; it's used only to measure).
 */
export function enforceToolOutputLimit(result: unknown): string {
    const serialized = JSON.stringify(result) ?? ''
    const limit = config.maxToolOutputChars

    if (limit > 0 && serialized.length > limit) {
        throw new Error(
            `Result too large (${serialized.length} chars, limit ${limit}). Narrow the query with filters or pagination.`
        )
    }

    return serialized
}

// The single execution boundary: runs the handler and enforces tbConfig.maxToolOutputChars
// on its result. Every path that actually executes an entry (tool_use, direct call) goes
// through here, so output is capped exactly once. Discovery (search/describe) never does.
export async function toolUse(bridge: Bridge, name: string, args: unknown, context?: unknown) {
    const handler = bridge[name]
    if (!handler) throw new Error(`Tool not found: ${name}`)

    const result = await handler(args, context)
    enforceToolOutputLimit(result)

    return result
}

export async function handleMetaToolCall(
    bridge: Bridge,
    entries: BridgeEntries,
    toolCall: ToolCall,
    context?: unknown,
    surface: ToolSurface = 'llm'
): Promise<unknown> {
    switch (toolCall.name) {
        case 'tool_search':
            return toolSearch(entries, toolCall.arguments?.query as string | undefined, surface)

        case 'tool_describe':
            return toolDescribe(entries, toolCall.arguments?.name as string, surface)

        case 'tool_use': {
            const args = toolCall.arguments as { name: string; arguments?: Record<string, unknown> }

            if (!isEntryVisible(entries[args.name], surface)) throw new Error(`Tool not found: ${args.name}`)

            return toolUse(bridge, args.name, args.arguments || {}, context)
        }

        default:
            throw new Error(
                `Unknown meta-tool: ${toolCall.name}. Expected "tool_search", "tool_describe", or "tool_use".`
            )
    }
}

// The three meta-tool names are reserved; a tool call by any of these runs the
// discovery flow, anything else is treated as a direct entry call.
export const META_TOOL_NAMES = ['tool_search', 'tool_describe', 'tool_use'] as const

export function isMetaToolName(name: string): boolean {
    return (META_TOOL_NAMES as readonly string[]).includes(name)
}

/**
 * Build the tool list for a model, honoring the chosen mode:
 *  - 'attach_all'  → one tool per visible entry (current `toLLMTools` behavior)
 *  - 'on_demand'   → the 3 meta-tools (`tool_search`, `tool_describe`, `tool_use`)
 */
export function getTools(entries: BridgeEntries, options?: GetToolsOptions) {
    const toolMode = options?.toolMode || 'on_demand'
    const format = options?.format || 'openai'

    if (toolMode === 'on_demand') return getMetaTools({ format })

    return toLLMTools(entries, {
        format,
        surface: options?.surface || 'llm',
        includeResponse: options?.includeResponse
    })
}

/**
 * Execute whatever the model called, in either mode. Dispatches on the tool name:
 * a meta-tool name runs the discovery flow, anything else runs that entry directly.
 * Identical handler execution, validation, and output-limit enforcement either way.
 */
export async function handleToolCall(
    bridge: Bridge,
    entries: BridgeEntries,
    toolCall: ToolCall,
    options?: HandleToolCallOptions
): Promise<unknown> {
    const surface = options?.surface || 'llm'
    const context = options?.context

    if (isMetaToolName(toolCall.name)) {
        return handleMetaToolCall(bridge, entries, toolCall, context, surface)
    }

    // Direct entry call (attach_all mode): respect per-surface visibility.
    if (!isEntryVisible(entries[toolCall.name], surface)) throw new Error(`Tool not found: ${toolCall.name}`)

    // `toolUse` enforces tbConfig.maxToolOutputChars on the executed result — the only
    // place output is unbounded. Discovery results (tool_search / tool_describe) are
    // deliberately left uncapped so a blanket search can never deadlock the model's
    // own recovery path.
    return toolUse(bridge, toolCall.name, toolCall.arguments || {}, context)
}
