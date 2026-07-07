import { IncomingHttpHeaders } from 'node:http'
import { getQuickJS, QuickJSContext, QuickJSDeferredPromise, QuickJSWASMModule } from 'quickjs-emscripten'
import { config } from '../config'
import { Bridge, BridgeEntries, isEntryVisible, toolUse, ToolSurface } from '.'

export type RunScriptContext = {
    context?: unknown
    surface: ToolSurface
    headers?: IncomingHttpHeaders
}

// Guest-side bootstrap installed before the user's code. It wraps the raw string bridge
// (`__callToolRaw`) so the sandbox sees a clean `callTool(name, args)` that takes/returns
// real JS values — all host<->guest marshaling happens as JSON behind the scenes.
const GUEST_PREAMBLE =
    'globalThis.callTool = async (name, args) => JSON.parse(await __callToolRaw(name, JSON.stringify(args === undefined ? {} : args)));'

// The WASM module is expensive to instantiate but safe to reuse across runs, so cache it and
// only pay the load cost on the first script. Each run still gets its own disposable context.
let modulePromise: Promise<QuickJSWASMModule> | null = null

const loadQuickJS = (): Promise<QuickJSWASMModule> => {
    if (!modulePromise) modulePromise = getQuickJS()
    return modulePromise
}

/**
 * Run a model-authored JS snippet in a QuickJS (WASM) sandbox. The snippet may `await
 * callTool(name, args)` to invoke visible bridge tools and should `return` a small value.
 *
 * Tool results fetched inside the script are NOT capped by `maxToolOutputChars` — the large
 * intermediate data lives in the WASM heap and never reaches the model. Only the script's
 * final return value is measured (by the caller). The sandbox has no access to `fs`, `net`,
 * `process`, or host globals; its sole capability is `callTool`.
 */
export async function runScript(
    bridge: Bridge,
    entries: BridgeEntries,
    code: unknown,
    ctx: RunScriptContext
): Promise<unknown> {
    if (typeof code !== 'string' || !code.trim())
        throw new Error('tool_script requires a non-empty "code" string')

    const { timeoutMs, memoryBytes } = config.script

    const quickJS = await loadQuickJS()
    const vm = quickJS.newContext()

    // Every callTool creates a deferred promise. Ones the script fires but never awaits can
    // still be unsettled when we tear the context down; QuickJS aborts (a hard WASM assert) if
    // the runtime is freed while their handles are alive, so we track and dispose them first.
    const pendingDeferreds = new Set<QuickJSDeferredPromise>()

    try {
        // Resource guards: cap the sandbox's memory and stop runaway loops at the deadline.
        vm.runtime.setMemoryLimit(memoryBytes)
        vm.runtime.setMaxStackSize(1024 * 1024)

        const deadline = Date.now() + timeoutMs
        vm.runtime.setInterruptHandler(() => Date.now() > deadline)

        // The only capability handed to the sandbox.
        installCallTool(vm, bridge, entries, ctx, pendingDeferreds)

        // Wrap in an async IIFE so both top-level `await` and a bare `return` work. The trailing
        // newline before `})()` ensures a final line comment in the user code can't swallow it.
        const evalResult = vm.evalCode(`${GUEST_PREAMBLE}\n(async () => { ${code}\n})()`)
        const promiseHandle = vm.unwrapResult(evalResult)

        // Convert the guest promise to a native one; a rejection (thrown script or failed
        // callTool) surfaces here via unwrapResult and propagates to the model.
        const resolvedPromise = vm.resolvePromise(promiseHandle)

        // Pump the job queue so the guest promise can settle. Cases that settle synchronously
        // (a plain return, a thrown error, or an interrupt) have no callTool to drive the queue,
        // so without this pump the native promise would hang. Async callTool settlements pump
        // the queue themselves via `deferred.settled.then(executePendingJobs)`.
        vm.runtime.executePendingJobs()
        promiseHandle.dispose()

        const resolved = await resolvedPromise
        const valueHandle = vm.unwrapResult(resolved)
        const value = vm.dump(valueHandle)
        valueHandle.dispose()

        return value
    } finally {
        // Dispose any callTool deferreds the script left unsettled (fire-and-forget calls) so
        // the context can be freed without tripping QuickJS's "runtime freed with live handles"
        // assertion. dispose() is idempotent, so already-settled deferreds are unaffected.
        for (const deferred of pendingDeferreds) if (deferred.alive) deferred.dispose()

        // Disposing the context frees the entire WASM arena for this run — even any handles we
        // leaked — so nothing accumulates across invocations.
        vm.dispose()
    }
}

// Install `__callToolRaw(name, argsJson)` on the sandbox global. It returns a guest promise
// that settles with the JSON-serialized tool result (or rejects with the error message).
function installCallTool(
    vm: QuickJSContext,
    bridge: Bridge,
    entries: BridgeEntries,
    ctx: RunScriptContext,
    pendingDeferreds: Set<QuickJSDeferredPromise>
): void {
    const callToolRaw = vm.newFunction('__callToolRaw', (nameHandle, argsHandle) => {
        const name = vm.getString(nameHandle)
        const argsJson = argsHandle ? vm.getString(argsHandle) : '{}'

        const deferred = vm.newPromise()
        pendingDeferreds.add(deferred)

        // Settle the guest promise, but only while the context is still alive. If the script
        // fired this call without awaiting it and already returned, `runScript`'s finally has
        // disposed the context — touching it now would throw and crash the process with an
        // unhandled rejection. In that case there's nothing left to settle, so we no-op.
        const settle = (settleGuestPromise: () => void) => {
            pendingDeferreds.delete(deferred)
            if (!vm.alive) return
            try {
                settleGuestPromise()
                // A settled deferred needs the guest job queue pumped so awaiting code resumes.
                if (vm.alive) vm.runtime.executePendingJobs()
            } catch {
                // Context torn down between the alive check and here — safe to ignore.
            }
        }

        // Run the real tool on the host. Per-call output is intentionally NOT limit-checked
        // (enforceLimit: false) — only the script's final return value is capped.
        runToolCall(bridge, entries, name, argsJson, ctx).then(
            result =>
                settle(() => {
                    const resultHandle = vm.newString(JSON.stringify(result) ?? 'null')
                    deferred.resolve(resultHandle)
                    resultHandle.dispose()
                }),
            (error: unknown) =>
                settle(() => {
                    const message = error instanceof Error ? error.message : String(error)
                    const errorHandle = vm.newString(message)
                    deferred.reject(errorHandle)
                    errorHandle.dispose()
                })
        )

        return deferred.handle
    })

    vm.setProp(vm.global, '__callToolRaw', callToolRaw)
    callToolRaw.dispose()
}

// Validate visibility + parse args, then execute through the same boundary as any tool call
// (middleware + handler run), with the output limit disabled for the individual call.
async function runToolCall(
    bridge: Bridge,
    entries: BridgeEntries,
    name: string,
    argsJson: string,
    ctx: RunScriptContext
): Promise<unknown> {
    if (!isEntryVisible(entries[name], ctx.surface)) throw new Error(`Tool not found: ${name}`)

    let args: unknown
    try {
        args = argsJson ? JSON.parse(argsJson) : {}
    } catch {
        throw new Error(`callTool("${name}") received invalid JSON arguments`)
    }

    return toolUse(bridge, name, args, ctx.context, ctx.headers, { enforceLimit: false })
}
