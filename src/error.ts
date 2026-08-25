// The status a handler meant.
//
// Without this, every throw from a handler becomes a 500 — so "you cannot see
// this" is indistinguishable from "the server fell over", to the caller, to the
// logs, and to whatever is watching the error rate. Refusing a request is
// normal behaviour, not a fault, and it should not read as one.
export class BridgeError extends Error {
    readonly status: number

    constructor(message: string, status = 400) {
        super(message)
        this.name = 'BridgeError'
        this.status = status
    }
}

// The three refusals almost every bridge needs, named so a handler reads as the
// decision it is making rather than as a number.
export const notFound = (message = 'Not found') => new BridgeError(message, 404)
export const forbidden = (message = 'Forbidden') => new BridgeError(message, 403)
export const badRequest = (message = 'Bad request') => new BridgeError(message, 400)

// Anything carrying a usable HTTP status, whether or not it came from this
// class — a handler may throw an error from a library that already has one.
export const statusOf = (error: unknown): number | null => {
    const status = (error as { status?: unknown } | null)?.status

    return typeof status === 'number' && status >= 400 && status <= 599 ? status : null
}
