import { IncomingHttpHeaders } from 'node:http'
import { Request, Response } from 'express'
import { getPatternSpecificity, matchesPattern } from '../helpers'
import { HttpError } from '../httpError'

export type Middleware = {
    pattern: string
    handler: (req: Request, res: Response) => Promise<{ next?: boolean; context?: any } | void>
}

const middlewares: Middleware[] = []

export const createMiddleware = (pattern: string, handler: Middleware['handler']) =>
    middlewares.push({ pattern, handler })

// Run every middleware whose pattern matches `name`, ordered broad → specific. Each
// middleware's returned context is shallow-merged on top of the previous (so a more
// specific middleware wins on a shared key). Returns the merged context, or signals a
// block when a middleware returns `{ next: false }`. Surface-agnostic: the HTTP path
// passes the real Express req/res; tool surfaces pass a synthetic req + throwing res.
export const runMiddlewares = async (
    name: string,
    req: Request,
    res: Response
): Promise<{ blocked: boolean; context: any }> => {
    let context: any = {}

    const matching = middlewares
        .filter(m => matchesPattern(name, m.pattern))
        .sort((a, b) => getPatternSpecificity(a.pattern) - getPatternSpecificity(b.pattern))

    for (const middleware of matching) {
        const result = await middleware.handler(req, res)

        if (result?.next === false) return { blocked: true, context }

        if (result?.context) context = { ...context, ...result.context }
    }

    return { blocked: false, context }
}

// A stand-in for the Express response on tool surfaces (MCP / LLM), which have no real
// HTTP response. A middleware that blocks with `res.status(code).send(msg)` (or `.json`)
// throws an HttpError carrying that status + message — so the surface can report *why*
// access was denied as structured JSON, instead of a meaningless silent stop.
const createToolRes = (): Response => {
    const block = (status: number) => ({
        send: (body: unknown) => {
            throw new HttpError(status, typeof body === 'string' ? body : JSON.stringify(body))
        },
        json: (body: unknown) => {
            throw new HttpError(status, typeof body === 'string' ? body : JSON.stringify(body))
        }
    })

    const res: any = {
        status: (code: number) => block(code),
        setHeader: () => res,
        set: () => res
    }

    return res as Response
}

// Run the middleware chain for a tool call (MCP / LLM). The synthetic request carries the
// forwarded `headers` and the matched entry name as `path` — so path-based middlewares
// (e.g. `req.path.split('/').pop()`) work identically to HTTP. There is no request body:
// MCP can forward nothing else, so middlewares must rely on headers/path alone.
// Blocking via `res.status().send()` throws (caught by the caller and returned as JSON);
// a bare `{ next: false }` with no response throws a generic 403 so access is still denied.
export const runMiddlewaresForTool = async (
    name: string,
    headers?: IncomingHttpHeaders
): Promise<any> => {
    // `path` mirrors HTTP's last-segment convention: on HTTP `req.path` is `/bridge/user.fetch`
    // and handlers do `.split('/').pop()`; here it's the bare entry name, which pops to itself.
    const req = { headers: headers || {}, path: name } as Request
    const res = createToolRes()

    const { blocked, context } = await runMiddlewares(name, req, res)

    if (blocked) throw new HttpError(403, 'Access denied')

    return context
}
