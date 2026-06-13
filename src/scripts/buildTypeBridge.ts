import path from 'path'
import { rollup } from 'rollup'
import dts from 'rollup-plugin-dts'
import ts from 'typescript'

/**
 * Consumers import `z` from `typed-bridge`, which re-exports typed-bridge's own
 * nested zod (`typed-bridge/node_modules/zod`). When the consumer's bridge has no
 * type annotation, declaration emit must name that nested zod and fails with
 * TS2742 ("cannot be named without a reference to ... This is likely not portable").
 *
 * Aliasing a bare `zod` specifier to typed-bridge's zod makes the inferred types
 * portably nameable, so emit succeeds. The cleaner strips every zod reference
 * afterwards, so this only needs to satisfy the compiler, not the final output.
 */
function resolveTypeRoots(src: string): { baseUrl: string; paths: Record<string, string[]> } {
    // Preserve the consumer's own path aliases (e.g. `@/*`) so handler files resolve
    const configPath = ts.findConfigFile(path.dirname(path.resolve(src)), ts.sys.fileExists, 'tsconfig.json')

    let baseUrl = process.cwd()
    let paths: Record<string, string[]> = {}

    if (configPath) {
        const read = ts.readConfigFile(configPath, ts.sys.readFile)
        const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath))
        baseUrl = parsed.options.baseUrl || path.dirname(configPath)
        paths = { ...(parsed.options.paths || {}) }
    }

    try {
        const zodDir = path.dirname(require.resolve('zod/package.json'))
        paths = { ...paths, zod: [zodDir], 'zod/*': [path.join(zodDir, '*')] }
    } catch {
        // zod not resolvable — fall back to default behaviour
    }

    return { baseUrl, paths }
}

export default async function build(src = '', dest = '') {
    const { baseUrl, paths } = resolveTypeRoots(src)

    const bundle = await rollup({
        input: src,
        plugins: [dts({ respectExternal: false, compilerOptions: { baseUrl, paths } })],
        onwarn(warning, warn) {
            if (warning.code === 'UNRESOLVED_IMPORT') return
            warn(warning)
        }
    })

    await bundle.write({
        file: dest,
        format: 'es'
    })
}
