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
    // its query instead of receiving invalid JSON. 0 disables the limit. HTTP is never capped.
    maxToolOutputChars: number
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
    maxToolOutputChars: 0
}
