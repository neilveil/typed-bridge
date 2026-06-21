// Error carrying an explicit HTTP status code. When thrown from a bridge handler
// or middleware, createBridge responds with the given status instead of 500.
// Useful for auth/permission failures (401/403), not-found (404), etc.
export class HttpError extends Error {
    status: number

    constructor(status: number, message: string) {
        super(message)
        this.name = 'HttpError'
        this.status = status
    }
}

// Convenience constructor for `throw httpError(403, 'Denied')`.
export const httpError = (status: number, message: string) => new HttpError(status, message)
