import { IncomingHttpHeaders } from 'node:http'
import { z } from 'zod'
import { config } from '../config'
import { runMiddlewaresForTool } from '../middleware'
import { runScript } from './script'

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
    // Request headers forwarded to the middleware chain. MCP supplies the client's
    // forwarded headers automatically; LLM/direct callers pass them in (e.g. `req.headers`).
    headers?: IncomingHttpHeaders
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
        if (isMetaToolName(key)) throw new Error(`Entry name "${key}" is reserved for a meta-tool — rename the entry.`)

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
    if (!isLLMToolFormat(format))
        throw new Error(`Invalid LLM tool format: ${format}. Expected one of ${LLM_TOOL_FORMATS.join(', ')}`)

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

// --- Meta-tools (tool_search → tool_describe → tool_use, plus tool_script) ---

// The shape every meta-tool is authored in, before it's reshaped per LLM format.
type MetaToolDef = {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export function getMetaTools(options?: { format?: LLMToolFormat; surface?: ToolSurface }): unknown[] {
    const format = options?.format || 'openai'
    const surface = options?.surface || 'llm'

    const searchTool: MetaToolDef = {
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

    const describeTool: MetaToolDef = {
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

    const useTool: MetaToolDef = {
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

    const tools = [searchTool, describeTool, useTool, ...scriptToolDefs(surface, 'on_demand')]

    return formatMetaTools(tools, format)
}

/**
 * `tool_script`, ready to append to whichever list the caller is building — empty when the
 * sandbox is disabled or off this surface.
 *
 * Unlike the three discovery tools, this one belongs to both modes. It is not a way to find
 * tools; it is the only way past `maxToolOutputChars`, and `attach_all` callers hit that cap
 * on exactly the same entries.
 */
export function scriptToolDefs(surface: ToolSurface, toolMode: ToolMode): MetaToolDef[] {
    // Opt-out via config.script.enabled, and only on the configured surfaces.
    if (!config.script.enabled || !config.script.surfaces.includes(surface)) return []

    return [
        {
            name: 'tool_script',
            description: scriptToolDescription(toolMode),
            parameters: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description:
                            'JavaScript to run. May use `await callTool(name, args)` and should `return` a small value.'
                    }
                },
                required: ['code']
            }
        }
    ]
}

// The discovery sentence has to match the mode: in attach_all, tool_search and tool_describe
// are not listed, so naming them would send the model after tools it cannot call.
function scriptToolDescription(toolMode: ToolMode): string {
    const discovery =
        toolMode === 'on_demand'
            ? 'Discover tool names and schemas with tool_search and tool_describe first.'
            : 'Use the names and schemas of the tools listed alongside this one.'

    const { maxToolCalls } = config.script
    const budget = maxToolCalls > 0 ? ` At most ${maxToolCalls} callTool invocations per run.` : ''

    return (
        'Run a JavaScript snippet in a sandbox to process data across multiple tools in one step. ' +
        'Inside the code you can `await callTool(name, args)` as many times as needed and `return` a value. ' +
        'Tool results fetched here are NOT size-limited, so use this to fetch large data and ' +
        'filter/aggregate/join it down to the small result you actually need — only your returned value is ' +
        'sent back (and is size-limited). ' +
        discovery +
        budget +
        ' Example: ' +
        "`const users = await callTool('user.fetchAll', {}); return users.filter(u => u.active).length`"
    )
}

function formatMetaTools(tools: MetaToolDef[], format: LLMToolFormat): unknown[] {
    switch (format) {
        case 'openai':
            return tools.map(tool => ({ type: 'function', function: tool }))

        case 'anthropic':
            return tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters
            }))

        default:
            return tools
    }
}

export function toolSearch(entries: BridgeEntries, query?: string, surface: ToolSurface = 'llm') {
    const visible: { name: string; description?: string }[] = []

    for (const [name, entry] of Object.entries(entries)) {
        if (!isEntryVisible(entry, surface)) continue
        visible.push({ name, description: entry.description })
    }

    const q = query?.trim().toLowerCase()
    if (!q) return visible

    // Tokenize the query so natural, multi-word searches still match. A plain substring
    // match fails on queries like "views analytics last 3 days" because the whole phrase is
    // never a contiguous substring of any tool. Instead we score each tool by how many query
    // tokens appear in its name/description, with a big boost for a full-phrase hit, and
    // return only matching tools ranked best-first.
    //
    // Single-character tokens (stray punctuation splits, lone digits like "3") are dropped:
    // they match almost everything and only add noise to results the model has to sift through.
    const tokens = q.split(/[^a-z0-9]+/).filter(token => token.length > 1)

    return visible
        .map(tool => {
            const name = tool.name.toLowerCase()
            const description = (tool.description || '').toLowerCase()
            const haystack = `${name} ${description}`

            // A full-phrase hit dominates; name hits outweigh description hits so the most
            // on-point tools rank above ones that only mention a token in passing.
            const phraseScore = haystack.includes(q) ? 1000 : 0
            const tokenScore = tokens.reduce((score, token) => {
                if (name.includes(token)) return score + 3
                if (description.includes(token)) return score + 1
                return score
            }, 0)

            return { tool, score: phraseScore + tokenScore }
        })
        .filter(scored => scored.score > 0)
        .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
        .map(scored => scored.tool)
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

// What the caller was doing when the limit tripped. Enough to work out which recourse the
// model actually has, so the error can name it instead of guessing.
export type ToolOutputLimitContext = {
    entry?: BridgeEntry
    surface?: ToolSurface
    // Set when measuring a tool_script return value. The model is already in the sandbox, so
    // the answer is to reduce further there, not to reach for the sandbox again.
    fromScript?: boolean
}

/**
 * Serialize a tool result and enforce `tbConfig.maxToolOutputChars`. Oversized results
 * throw (instead of truncating to invalid JSON) so the model gets a loud failure it can act
 * on rather than a silently shortened payload it cannot detect. Returns the serialized JSON
 * (callers may discard it; it's used only to measure).
 */
export function enforceToolOutputLimit(result: unknown, limitContext?: ToolOutputLimitContext): string {
    const serialized = JSON.stringify(result) ?? ''
    const limit = config.maxToolOutputChars

    if (limit > 0 && serialized.length > limit) {
        const subject = limitContext?.fromScript ? 'Script return value' : 'Result'

        throw new Error(
            `${subject} too large (${serialized.length} chars, limit ${limit}). ${describeRecourse(limitContext)}`
        )
    }

    return serialized
}

/**
 * Name the way out that actually exists for this caller.
 *
 * A fixed "narrow the query" string is wrong whenever the entry declares no `args` — there is
 * nothing to narrow, so the model invents parameters, fails validation, retries, and ends up
 * answering from nothing. When no recourse exists, say so and point at the operator instead of
 * sending the model round the loop again.
 */
function describeRecourse(limitContext?: ToolOutputLimitContext): string {
    if (limitContext?.fromScript)
        return 'Reduce it further inside the script — aggregate, project fewer fields, or return a count.'

    // tool_script is listed in both tool modes, so surface + config settle its availability.
    const surface = limitContext?.surface || 'llm'
    if (config.script.enabled && config.script.surfaces.includes(surface))
        return 'Retry with tool_script: fetch this inside the sandbox, where results are uncapped, and return only the reduced value.'

    if (limitContext?.entry?.args) return 'Narrow the query with filters or pagination.'

    return 'This tool takes no arguments and cannot be narrowed. Ask the operator to raise tbConfig.maxToolOutputChars or enable tool_script.'
}

// The single execution boundary: runs the middleware chain, then the handler, and enforces
// tbConfig.maxToolOutputChars on its result. Every path that actually executes an entry
// (tool_use, direct call) goes through here, so middleware runs and output is capped exactly
// once. Discovery (search/describe) never reaches here, so listing tools needs no auth.
export async function toolUse(
    bridge: Bridge,
    name: string,
    args: unknown,
    context?: unknown,
    headers?: IncomingHttpHeaders,
    // `enforceLimit: false` skips the output cap for this call. Used by `tool_script`, where
    // per-call results stay inside the sandbox and only the script's final return is capped.
    // `entry` and `surface` are only read to word the cap error; they never gate execution.
    options?: { enforceLimit?: boolean; entry?: BridgeEntry; surface?: ToolSurface }
) {
    const handler = bridge[name]
    if (!handler) throw new Error(`Tool not found: ${name}`)

    // Run the same pattern-matched middleware chain as HTTP. The caller-supplied context is
    // the base; middleware-derived context is merged on top (more authoritative, header-derived).
    const middlewareContext = await runMiddlewaresForTool(name, headers)
    const base = context && typeof context === 'object' ? context : {}
    const mergedContext = { ...base, ...middlewareContext }

    const result = await handler(args, mergedContext)
    if (options?.enforceLimit !== false)
        enforceToolOutputLimit(result, { entry: options?.entry, surface: options?.surface })

    return result
}

export async function handleMetaToolCall(
    bridge: Bridge,
    entries: BridgeEntries,
    toolCall: ToolCall,
    context?: unknown,
    surface: ToolSurface = 'llm',
    headers?: IncomingHttpHeaders
): Promise<unknown> {
    switch (toolCall.name) {
        case 'tool_search':
            return toolSearch(entries, toolCall.arguments?.query as string | undefined, surface)

        case 'tool_describe':
            return toolDescribe(entries, toolCall.arguments?.name as string, surface)

        case 'tool_use': {
            const args = toolCall.arguments as { name: string; arguments?: Record<string, unknown> }

            if (!isEntryVisible(entries[args.name], surface)) throw new Error(`Tool not found: ${args.name}`)

            return toolUse(bridge, args.name, args.arguments || {}, context, headers, {
                entry: entries[args.name],
                surface
            })
        }

        case 'tool_script': {
            // Respect the same gating as discovery: disabled or off-surface behaves as "not found".
            if (!config.script.enabled || !config.script.surfaces.includes(surface))
                throw new Error('Tool not found: tool_script')

            // The sandbox runs uncapped internally; only the final return value is limit-checked.
            const value = await runScript(bridge, entries, toolCall.arguments?.code, { context, surface, headers })
            enforceToolOutputLimit(value, { surface, fromScript: true })

            return value
        }

        default:
            throw new Error(
                `Unknown meta-tool: ${toolCall.name}. Expected one of ${META_TOOL_NAMES.map(name => `"${name}"`).join(', ')}.`
            )
    }
}

// The meta-tool names are reserved; a tool call by any of these runs the discovery or
// sandbox flow, anything else is treated as a direct entry call.
export const META_TOOL_NAMES = ['tool_search', 'tool_describe', 'tool_use', 'tool_script'] as const

export function isMetaToolName(name: string): boolean {
    return (META_TOOL_NAMES as readonly string[]).includes(name)
}

/**
 * Build the tool list for a model, honoring the chosen mode:
 *  - 'attach_all'  → one tool per visible entry, plus `tool_script`
 *  - 'on_demand'   → `tool_search`, `tool_describe`, `tool_use`, plus `tool_script`
 *
 * `tool_script` appears in both because it is not a discovery tool. It is the way past
 * `maxToolOutputChars`, which applies identically in either mode — withholding it from
 * `attach_all` left that cap with no way through. Remove it with `tbConfig.script.enabled`.
 */
export function getTools(entries: BridgeEntries, options?: GetToolsOptions): unknown[] {
    const toolMode = options?.toolMode || 'on_demand'
    const format = options?.format || 'openai'
    const surface = options?.surface || 'llm'

    if (toolMode === 'on_demand') return getMetaTools({ format, surface })

    return [
        ...toLLMTools(entries, { format, surface, includeResponse: options?.includeResponse }),
        ...formatMetaTools(scriptToolDefs(surface, 'attach_all'), format)
    ]
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
    const headers = options?.headers

    if (isMetaToolName(toolCall.name)) {
        return handleMetaToolCall(bridge, entries, toolCall, context, surface, headers)
    }

    // Direct entry call (attach_all mode): respect per-surface visibility.
    if (!isEntryVisible(entries[toolCall.name], surface)) throw new Error(`Tool not found: ${toolCall.name}`)

    // `toolUse` runs the middleware chain and enforces tbConfig.maxToolOutputChars on the
    // executed result — the only place output is unbounded. Discovery results (tool_search /
    // tool_describe) are deliberately left uncapped, and skip middleware, so a blanket search
    // can never deadlock the model's own recovery path.
    return toolUse(bridge, toolCall.name, toolCall.arguments || {}, context, headers, {
        entry: entries[toolCall.name],
        surface
    })
}
