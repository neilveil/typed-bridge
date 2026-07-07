import type { ToolSurface } from '../tools'

interface config {
    logs: {
        request: boolean
        response: boolean
        error: boolean
        argsOnError: boolean
        contextOnError: boolean
    }
    responseDelay: number
    // Max serialized (JSON) length of a tool result returned over the MCP and LLM tool
    // surfaces. Oversized results are rejected (not truncated) so the model can narrow
    // its query instead of receiving invalid JSON. Defaults to 100_000; set 0 to disable.
    // HTTP is never capped.
    maxToolOutputChars: number
    // The `tool_script` meta-tool: lets a model run a JS snippet in a WASM sandbox that can
    // call bridge tools via `callTool(name, args)`. Tool results inside the script are NOT
    // capped by maxToolOutputChars — only the script's final return value is — so the model
    // can fetch large data, reduce it in the sandbox, and return just the small projection.
    script: {
        // On by default. The sandbox is a hard boundary and every callTool still runs
        // visibility + middleware, so this is safe to default-on. Set false to disable.
        enabled: boolean
        // Hard wall-clock cap for a single script run (ms); runaway loops are interrupted.
        timeoutMs: number
        // Max memory the sandbox may allocate (bytes). Must exceed the largest intermediate
        // data a script holds, since that data lives in the WASM heap during the run.
        memoryBytes: number
        // Which AI surfaces expose `tool_script`. Defaults to both.
        surfaces: ToolSurface[]
    }
}

export const config: config = {
    logs: {
        request: true,
        response: true,
        error: true,
        argsOnError: true,
        contextOnError: true
    },
    responseDelay: 0,
    maxToolOutputChars: 100_000,
    script: {
        enabled: true,
        timeoutMs: 5000,
        memoryBytes: 64 * 1024 * 1024,
        surfaces: ['llm', 'mcp']
    }
}
