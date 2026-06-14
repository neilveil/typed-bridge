import fs from 'fs'
import path from 'path'
import ts from 'typescript'

// Snippet to inject at the end
const proxySnippet = () => `
type TypedBridgeConfig = {
    host: string
    headers: Record<string, string>
    onResponse: (response: Response) => void
}

export const typedBridgeConfig: TypedBridgeConfig = {
    host: '',
    headers: { 'Content-Type': 'application/json' },
    onResponse: () => {}
}

export const typedBridge = new Proxy(
    {},
    {
        get(_, methodName: string) {
            return async (args: unknown) => {
                const response = await fetch(
                    typedBridgeConfig.host + (typedBridgeConfig.host.endsWith('/') ? '' : '/') + methodName,
                    {
                        method: 'POST',
                        headers: typedBridgeConfig.headers,
                        body: JSON.stringify(args)
                    }
                )

                typedBridgeConfig.onResponse(response)

                if (!response.ok) {
                    const errorText = await response.text()
                    console.error('REQ_FAILED', response.url, errorText)
                    throw new Error(errorText)
                }

                return response.json().catch(error => {
                    console.error('RES_NOT_JSON', response.url, error)
                    throw new Error(error.message)
                })
            }
        }
    }
) as TypedBridge

export default typedBridge
`

/**
 * Transformer #1:
 * Resolve Zod 4 types to plain TypeScript types, and remove zod imports.
 */
const resolveZodTypesTransformer: ts.TransformerFactory<ts.SourceFile> = context => {
    return sourceFile => {
        const zodKeywordMap: Record<string, ts.KeywordTypeSyntaxKind> = {
            ZodNumber: ts.SyntaxKind.NumberKeyword,
            ZodString: ts.SyntaxKind.StringKeyword,
            ZodBoolean: ts.SyntaxKind.BooleanKeyword,
            ZodBigInt: ts.SyntaxKind.BigIntKeyword,
            ZodUndefined: ts.SyntaxKind.UndefinedKeyword,
            ZodVoid: ts.SyntaxKind.VoidKeyword,
            ZodAny: ts.SyntaxKind.AnyKeyword,
            ZodUnknown: ts.SyntaxKind.UnknownKeyword,
            ZodNever: ts.SyntaxKind.NeverKeyword,
            // Zod 4 branded string types
            ZodEmail: ts.SyntaxKind.StringKeyword,
            ZodURL: ts.SyntaxKind.StringKeyword,
            ZodUUID: ts.SyntaxKind.StringKeyword,
            ZodEmoji: ts.SyntaxKind.StringKeyword,
            ZodNanoID: ts.SyntaxKind.StringKeyword,
            ZodCUID: ts.SyntaxKind.StringKeyword,
            ZodCUID2: ts.SyntaxKind.StringKeyword,
            ZodULID: ts.SyntaxKind.StringKeyword,
            ZodIPv4: ts.SyntaxKind.StringKeyword,
            ZodIPv6: ts.SyntaxKind.StringKeyword,
            ZodCIDRv4: ts.SyntaxKind.StringKeyword,
            ZodCIDRv6: ts.SyntaxKind.StringKeyword,
            ZodBase64: ts.SyntaxKind.StringKeyword,
            ZodBase64URL: ts.SyntaxKind.StringKeyword,
            ZodJWT: ts.SyntaxKind.StringKeyword,
            // Zod 4 branded number types
            ZodInt: ts.SyntaxKind.NumberKeyword,
            ZodFloat32: ts.SyntaxKind.NumberKeyword,
            ZodFloat64: ts.SyntaxKind.NumberKeyword
        }

        function getZodRef(node: ts.TypeNode): { name: string; typeArgs?: ts.NodeArray<ts.TypeNode> } | null {
            if (
                ts.isTypeReferenceNode(node) &&
                ts.isQualifiedName(node.typeName) &&
                ts.isIdentifier(node.typeName.left) &&
(/^z(\$\d+)?$/.test(node.typeName.left.text) ||
                    /^zod(\$\d+)?$/.test(node.typeName.left.text) ||
                    /^zod_/.test(node.typeName.left.text))
            ) {
                return { name: node.typeName.right.text, typeArgs: node.typeArguments }
            }
            return null
        }

        function unwrapReadonlyTuple(node: ts.TypeNode): ts.TupleTypeNode | null {
            if (ts.isTupleTypeNode(node)) return node
            if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword && ts.isTupleTypeNode(node.type))
                return node.type
            return null
        }

        function resolveZodType(node: ts.TypeNode): ts.TypeNode {
            const ref = getZodRef(node)
            if (!ref) return node

            const { name, typeArgs } = ref

            if (name === 'infer' && typeArgs?.length === 1) return resolveZodType(typeArgs[0])

            const keyword = zodKeywordMap[name]
            if (keyword !== undefined) return ts.factory.createKeywordTypeNode(keyword)
            if (name === 'ZodNull') return ts.factory.createLiteralTypeNode(ts.factory.createNull())
            if (name === 'ZodDate') return ts.factory.createTypeReferenceNode('Date')

            if (name === 'ZodObject' && typeArgs && typeArgs.length >= 1 && ts.isTypeLiteralNode(typeArgs[0]))
                return resolveShape(typeArgs[0])

            if (name === 'ZodArray' && typeArgs && typeArgs.length >= 1)
                return ts.factory.createArrayTypeNode(resolveZodType(typeArgs[0]))

            if (name === 'ZodOptional' && typeArgs && typeArgs.length >= 1)
                return ts.factory.createUnionTypeNode([
                    resolveZodType(typeArgs[0]),
                    ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)
                ])

            if (name === 'ZodNullable' && typeArgs && typeArgs.length >= 1)
                return ts.factory.createUnionTypeNode([
                    resolveZodType(typeArgs[0]),
                    ts.factory.createLiteralTypeNode(ts.factory.createNull())
                ])

            if (name === 'ZodDefault' && typeArgs && typeArgs.length >= 1) return resolveZodType(typeArgs[0])

            if (name === 'ZodLiteral' && typeArgs && typeArgs.length >= 1) return typeArgs[0]

            // v4: ZodRecord<ZodString, ZodNumber> -> Record<string, number>
            if (name === 'ZodRecord' && typeArgs && typeArgs.length >= 2)
                return ts.factory.createTypeReferenceNode('Record', [resolveZodType(typeArgs[0]), resolveZodType(typeArgs[1])])

            // v4: ZodEnum<{pending: "pending", confirmed: "confirmed", ...}>
            if (name === 'ZodEnum' && typeArgs && typeArgs.length >= 1 && ts.isTypeLiteralNode(typeArgs[0])) {
                const types: ts.TypeNode[] = []
                for (const member of typeArgs[0].members) {
                    if (ts.isPropertySignature(member) && member.type) types.push(member.type)
                }
                if (types.length > 0) return ts.factory.createUnionTypeNode(types)

                // ZodEnum<{[x: string]: string}> -> string (dynamic enum with index signature)
                if (typeArgs[0].members.some(m => ts.isIndexSignatureDeclaration(m)))
                    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
            }

            // v4: ZodDiscriminatedUnion<[ZodObject<...>, ...], "disc">
            if (name === 'ZodDiscriminatedUnion' && typeArgs && typeArgs.length >= 1) {
                const tuple = unwrapReadonlyTuple(typeArgs[0])
                if (tuple) return ts.factory.createUnionTypeNode(tuple.elements.map(e => resolveZodType(e)))
            }

            // v4: ZodUnion<readonly [ZodString, ZodNumber]>
            if (name === 'ZodUnion' && typeArgs && typeArgs.length >= 1) {
                const tuple = unwrapReadonlyTuple(typeArgs[0])
                if (tuple) return ts.factory.createUnionTypeNode(tuple.elements.map(e => resolveZodType(e)))
            }

            return node
        }

        function resolveShape(shape: ts.TypeLiteralNode): ts.TypeLiteralNode {
            const members = shape.members.map(member => {
                if (ts.isPropertySignature(member) && member.type) {
                    const ref = getZodRef(member.type)
                    if (ref && ref.name === 'ZodOptional' && ref.typeArgs && ref.typeArgs.length >= 1) {
                        return ts.factory.updatePropertySignature(
                            member,
                            member.modifiers,
                            member.name,
                            ts.factory.createToken(ts.SyntaxKind.QuestionToken),
                            resolveZodType(ref.typeArgs[0])
                        )
                    }
                    return ts.factory.updatePropertySignature(
                        member,
                        member.modifiers,
                        member.name,
                        member.questionToken,
                        resolveZodType(member.type)
                    )
                }
                return member
            })
            return ts.factory.createTypeLiteralNode(members)
        }

        function typeVisitor(node: ts.Node): ts.Node {
            if (ts.isTypeNode(node)) {
                const ref = getZodRef(node)
                if (ref) return resolveZodType(node)
            }
            return ts.visitEachChild(node, typeVisitor, context)
        }

        const updatedStatements: ts.Statement[] = []
        for (const stmt of sourceFile.statements) {
            if (
                ts.isImportDeclaration(stmt) &&
                ts.isStringLiteral(stmt.moduleSpecifier) &&
                (stmt.moduleSpecifier.text === 'zod' || stmt.moduleSpecifier.text.startsWith('zod/') || stmt.moduleSpecifier.text === 'typed-bridge')
            ) {
                continue
            }
            const transformed = ts.visitEachChild(stmt, typeVisitor, context)
            updatedStatements.push(transformed as ts.Statement)
        }
        return ts.factory.updateSourceFile(sourceFile, ts.factory.createNodeArray(updatedStatements))
    }
}

/**
 * Transformer #2:
 * Remove the second parameter from any function type node.
 * (Server context param should not appear in the client bridge.)
 */
const removeSecondParamTransformer: ts.TransformerFactory<ts.SourceFile> = context => {
    return sourceFile => {
        function visitor(node: ts.Node): ts.Node {
            if (ts.isFunctionTypeNode(node) && node.parameters.length > 1) {
                return ts.factory.updateFunctionTypeNode(
                    node,
                    node.typeParameters,
                    ts.factory.createNodeArray([node.parameters[0]]),
                    node.type
                )
            }
            return ts.visitEachChild(node, visitor, context)
        }
        return ts.visitEachChild(sourceFile, visitor, context) as ts.SourceFile
    }
}

/**
 * Transformer #3:
 * Make any parameter typed as `undefined` optional so callers can omit it.
 * e.g. `(_args: undefined) => Promise<...>` → `(_args?: undefined) => Promise<...>`
 */
const optionalUndefinedParamTransformer: ts.TransformerFactory<ts.SourceFile> = context => {
    return sourceFile => {
        function visitor(node: ts.Node): ts.Node {
            if (ts.isFunctionTypeNode(node)) {
                const params = node.parameters.map(param => {
                    if (
                        param.type &&
                        ts.isToken(param.type) &&
                        param.type.kind === ts.SyntaxKind.UndefinedKeyword &&
                        !param.questionToken
                    ) {
                        return ts.factory.updateParameterDeclaration(
                            param,
                            param.modifiers,
                            param.dotDotDotToken,
                            param.name,
                            ts.factory.createToken(ts.SyntaxKind.QuestionToken),
                            param.type,
                            param.initializer
                        )
                    }
                    return param
                })
                return ts.factory.updateFunctionTypeNode(node, node.typeParameters, ts.factory.createNodeArray(params), node.type)
            }
            return ts.visitEachChild(node, visitor, context)
        }
        return ts.visitEachChild(sourceFile, visitor, context) as ts.SourceFile
    }
}

/**
 * Transformer #4:
 * Resolve ExtractHandlers<T> in the _default declaration by unwrapping
 * { handler: fn, ... } entries to just the function type.
 * Also removes helper type definitions and the entries declaration that
 * leak from defineBridge() usage.
 */
const unwrapBridgeEntryTransformer: ts.TransformerFactory<ts.SourceFile> = _context => {
    return sourceFile => {
        const helperTypes = new Set(['Bridge', 'BridgeEntry', 'BridgeEntries', 'ExtractHandlers'])

        // Detect the variable bound to the default export. rollup-plugin-dts names an
        // anonymous `export default defineBridge(...)` as `_default`, but keeps the
        // user's identifier (e.g. `bridge`) when they do `const bridge = ...; export default bridge`.
        let defaultName: string | undefined
        for (const stmt of sourceFile.statements) {
            if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
                defaultName = stmt.expression.text
            }
            if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
                for (const el of stmt.exportClause.elements) {
                    if (el.name.text === 'default') defaultName = (el.propertyName ?? el.name).text
                }
            }
        }

        function resolveHandlers(typeLiteral: ts.TypeLiteralNode): ts.TypeLiteralNode {
            const members = typeLiteral.members.map(member => {
                if (!ts.isPropertySignature(member) || !member.type) return member

                if (ts.isTypeLiteralNode(member.type)) {
                    const handlerProp = member.type.members.find(
                        m =>
                            ts.isPropertySignature(m) &&
                            ts.isIdentifier(m.name) &&
                            m.name.text === 'handler' &&
                            m.type &&
                            ts.isFunctionTypeNode(m.type)
                    )
                    if (handlerProp && ts.isPropertySignature(handlerProp) && handlerProp.type) {
                        return ts.factory.updatePropertySignature(
                            member,
                            member.modifiers,
                            member.name,
                            member.questionToken,
                            handlerProp.type
                        )
                    }
                }

                return member
            })
            return ts.factory.createTypeLiteralNode(members)
        }

        const updatedStatements: ts.Statement[] = []
        for (const stmt of sourceFile.statements) {
            // Remove helper type aliases
            if (ts.isTypeAliasDeclaration(stmt) && helperTypes.has(stmt.name.text)) continue

            // Remove entries declaration
            if (ts.isVariableStatement(stmt)) {
                const decl = stmt.declarationList.declarations[0]
                if (decl && ts.isIdentifier(decl.name) && decl.name.text === 'entries') continue
            }

            // Convert the default-export variable to the TypedBridge type alias
            if (ts.isVariableStatement(stmt)) {
                const decl = stmt.declarationList.declarations[0]
                if (decl && ts.isIdentifier(decl.name) && decl.name.text === defaultName && decl.type) {
                    let resolvedType: ts.TypeNode

                    // `ExtractHandlers` may be a bare identifier (inlined, same package) or a
                    // namespace-qualified reference (e.g. `typed_bridge_dist_tools.ExtractHandlers`)
                    // when typed-bridge is an external dependency in a consumer project.
                    const refName =
                        ts.isTypeReferenceNode(decl.type) &&
                        (ts.isIdentifier(decl.type.typeName)
                            ? decl.type.typeName.text
                            : decl.type.typeName.right.text)

                    if (
                        ts.isTypeReferenceNode(decl.type) &&
                        refName === 'ExtractHandlers' &&
                        decl.type.typeArguments?.length === 1 &&
                        ts.isTypeLiteralNode(decl.type.typeArguments[0])
                    ) {
                        resolvedType = resolveHandlers(decl.type.typeArguments[0])
                    } else {
                        resolvedType = decl.type
                    }

                    updatedStatements.push(
                        ts.factory.createTypeAliasDeclaration(undefined, 'TypedBridge', undefined, resolvedType)
                    )
                    continue
                }
            }

            // Strip entries from named exports
            if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
                const filtered = stmt.exportClause.elements.filter(
                    el => el.name.text !== 'entries' && el.propertyName?.text !== 'entries'
                )
                if (filtered.length === 0) continue
                if (filtered.length !== stmt.exportClause.elements.length) {
                    updatedStatements.push(
                        ts.factory.updateExportDeclaration(
                            stmt,
                            stmt.modifiers,
                            stmt.isTypeOnly,
                            ts.factory.updateNamedExports(stmt.exportClause, filtered),
                            stmt.moduleSpecifier,
                            stmt.attributes
                        )
                    )
                    continue
                }
            }

            updatedStatements.push(stmt)
        }
        return ts.factory.updateSourceFile(sourceFile, ts.factory.createNodeArray(updatedStatements))
    }
}

/**
 * Transformer #5:
 * Remove the rollup default export (`export { X as default }` for any X, or
 * `export default X`). The proxy snippet provides its own default export.
 */
const removeDefaultExportTransformer: ts.TransformerFactory<ts.SourceFile> = _context => {
    return sourceFile => {
        const updatedStatements: ts.Statement[] = []
        for (const stmt of sourceFile.statements) {
            // Drop `export default X` / `export = X`
            if (ts.isExportAssignment(stmt)) continue

            // Filter `... as default` specifiers out of named exports
            if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
                const filtered = stmt.exportClause.elements.filter(el => el.name.text !== 'default')
                if (filtered.length === 0) continue
                if (filtered.length !== stmt.exportClause.elements.length) {
                    updatedStatements.push(
                        ts.factory.updateExportDeclaration(
                            stmt,
                            stmt.modifiers,
                            stmt.isTypeOnly,
                            ts.factory.updateNamedExports(stmt.exportClause, filtered),
                            stmt.moduleSpecifier,
                            stmt.attributes
                        )
                    )
                    continue
                }
            }

            updatedStatements.push(stmt)
        }
        return ts.factory.updateSourceFile(sourceFile, ts.factory.createNodeArray(updatedStatements))
    }
}

/**
 * Transformer #6:
 * Drop every top-level statement that is not reachable from the `TypedBridge`
 * alias. When typed-bridge is an external dependency, rollup leaves behind stray
 * imports (e.g. `import * as ... from 'typed-bridge/dist/tools'`) and inlined
 * context types (e.g. `adminContext`) that the resolved client no longer needs.
 */
const pruneUnreachableTransformer: ts.TransformerFactory<ts.SourceFile> = _context => {
    return sourceFile => {
        const statements = sourceFile.statements

        const typedBridge = statements.find(
            (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'TypedBridge'
        )
        if (!typedBridge) return sourceFile

        const namesOf = (stmt: ts.Statement): string[] => {
            if (
                ts.isTypeAliasDeclaration(stmt) ||
                ts.isInterfaceDeclaration(stmt) ||
                ts.isClassDeclaration(stmt) ||
                ts.isEnumDeclaration(stmt) ||
                ts.isFunctionDeclaration(stmt)
            ) {
                return stmt.name ? [stmt.name.text] : []
            }
            if (ts.isVariableStatement(stmt)) {
                return stmt.declarationList.declarations.flatMap(d => (ts.isIdentifier(d.name) ? [d.name.text] : []))
            }
            if (ts.isImportDeclaration(stmt) && stmt.importClause) {
                const names: string[] = []
                const clause = stmt.importClause
                if (clause.name) names.push(clause.name.text)
                if (clause.namedBindings) {
                    if (ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text)
                    else for (const el of clause.namedBindings.elements) names.push(el.name.text)
                }
                return names
            }
            return []
        }

        const declarers = new Map<string, ts.Statement>()
        for (const stmt of statements) for (const n of namesOf(stmt)) if (!declarers.has(n)) declarers.set(n, stmt)

        const refsOf = (node: ts.Node): Set<string> => {
            const acc = new Set<string>()
            const visit = (n: ts.Node) => {
                if (ts.isTypeReferenceNode(n)) {
                    let tn: ts.EntityName = n.typeName
                    while (ts.isQualifiedName(tn)) tn = tn.left
                    acc.add(tn.text)
                }
                if (ts.isTypeQueryNode(n)) {
                    let en: ts.EntityName = n.exprName
                    while (ts.isQualifiedName(en)) en = en.left
                    acc.add(en.text)
                }
                ts.forEachChild(n, visit)
            }
            visit(node)
            return acc
        }

        const keep = new Set<ts.Statement>([typedBridge])
        const queue: ts.Statement[] = [typedBridge]
        while (queue.length) {
            const cur = queue.shift()!
            for (const name of refsOf(cur)) {
                const d = declarers.get(name)
                if (d && !keep.has(d)) {
                    keep.add(d)
                    queue.push(d)
                }
            }
        }

        return ts.factory.updateSourceFile(
            sourceFile,
            ts.factory.createNodeArray(statements.filter(s => keep.has(s)))
        )
    }
}

/**
 * Main cleaner function.
 *  1. Ensures top comment is present.
 *  2. Transforms code with the above transformers.
 *  3. Writes the final file output.
 */
export default function cleanTsFile(src: string) {
    const sourceCode = fs.readFileSync(src, 'utf-8')

    // Parse the source
    const sourceFile = ts.createSourceFile(
        path.basename(src),
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    )

    // Run the transformers
    const result = ts.transform(sourceFile, [
        unwrapBridgeEntryTransformer,
        resolveZodTypesTransformer,
        removeSecondParamTransformer,
        optionalUndefinedParamTransformer,
        removeDefaultExportTransformer,
        pruneUnreachableTransformer
    ])

    // Print final code
    const header = `/* This file is auto-generated by typed-bridge. Do not edit. */`
    const printer = ts.createPrinter()
    const transformedCode = header + '\n' + printer.printFile(result.transformed[0]).concat(proxySnippet())

    // Write back to the same file
    fs.writeFileSync(src, transformedCode, 'utf-8')
}
