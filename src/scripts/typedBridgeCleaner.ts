import fs from 'fs'
import path from 'path'
import ts from 'typescript'

// Snippet to inject at the end
const proxySnippet = () => `
type typedBridgeConfig = {
    host: string
    headers: { [key: string]: string }
    onResponse: (res: Response) => void
}

export const typedBridgeConfig: typedBridgeConfig = {
    host: '',
    headers: { 'Content-Type': 'application/json' },
    onResponse: (res: Response) => {}
}

export const typedBridge = new Proxy(
    {},
    {
        get(_, methodName: string) {
            return async (args: any) => {
                const response = await fetch(
                    typedBridgeConfig.host + (typedBridgeConfig.host.endsWith('/') ? '' : '/') + methodName,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...typedBridgeConfig.headers
                        },
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
) as typeof _default

export default typedBridge
`

/**
 * Transformer #1:
 * Resolve zod types to plain TypeScript types, and remove zod imports.
 * Handles both Zod 3 (zod.TypeOf<ZodObject<S,UK,CA,Output,Input>>) and
 * Zod 4 (zod.infer<ZodObject<Shape, UK>>) patterns.
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
        }

        function getZodRef(node: ts.TypeNode): { name: string; typeArgs?: ts.NodeArray<ts.TypeNode> } | null {
            if (
                ts.isTypeReferenceNode(node) &&
                ts.isQualifiedName(node.typeName) &&
                ts.isIdentifier(node.typeName.left) &&
                (node.typeName.left.text === 'zod' || node.typeName.left.text.startsWith('zod_'))
            ) {
                return { name: node.typeName.right.text, typeArgs: node.typeArguments }
            }
            return null
        }

        function resolveZodType(node: ts.TypeNode): ts.TypeNode {
            const ref = getZodRef(node)
            if (!ref) return node

            const { name, typeArgs } = ref

            if ((name === 'infer' || name === 'TypeOf') && typeArgs?.length === 1)
                return resolveZodType(typeArgs[0])

            const keyword = zodKeywordMap[name]
            if (keyword !== undefined) return ts.factory.createKeywordTypeNode(keyword)
            if (name === 'ZodNull') return ts.factory.createLiteralTypeNode(ts.factory.createNull())
            if (name === 'ZodDate') return ts.factory.createTypeReferenceNode('Date')

            if (name === 'ZodObject' && typeArgs) {
                if (typeArgs.length >= 4) return resolveZodType(typeArgs[3])
                if (typeArgs.length >= 1 && ts.isTypeLiteralNode(typeArgs[0])) return resolveShape(typeArgs[0])
            }

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

            return node
        }

        function resolveShape(shape: ts.TypeLiteralNode): ts.TypeLiteralNode {
            const members = shape.members.map(member => {
                if (ts.isPropertySignature(member) && member.type) {
                    const ref = getZodRef(member.type)
                    if (ref && ref.name === 'ZodOptional' && ref.typeArgs && ref.typeArgs.length >= 1) {
                        return ts.factory.updatePropertySignature(
                            member, member.modifiers, member.name,
                            ts.factory.createToken(ts.SyntaxKind.QuestionToken),
                            resolveZodType(ref.typeArgs[0])
                        )
                    }
                    return ts.factory.updatePropertySignature(
                        member, member.modifiers, member.name,
                        member.questionToken, resolveZodType(member.type)
                    )
                }
                return member
            })
            return ts.factory.createTypeLiteralNode(members)
        }

        function typeVisitor(node: ts.Node): ts.Node {
            if (ts.isTypeNode(node)) {
                const ref = getZodRef(node)
                if (ref && (ref.name === 'infer' || ref.name === 'TypeOf')) return resolveZodType(node)
            }
            return ts.visitEachChild(node, typeVisitor, context)
        }

        const updatedStatements: ts.Statement[] = []
        for (const stmt of sourceFile.statements) {
            if (
                ts.isImportDeclaration(stmt) &&
                ts.isStringLiteral(stmt.moduleSpecifier) &&
                (stmt.moduleSpecifier.text === 'zod' || stmt.moduleSpecifier.text.startsWith('zod/'))
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
 * Remove "export { _default as default }" if it exists.
 */
const removeDefaultExportTransformer: ts.TransformerFactory<ts.SourceFile> = context => {
    return sourceFile => {
        function visitor(node: ts.Node): ts.Node | undefined {
            // Look for `export { _default as default }` and drop it
            if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
                const [el] = node.exportClause.elements
                if (
                    node.exportClause.elements.length === 1 &&
                    el.propertyName?.text === '_default' &&
                    el.name.text === 'default'
                ) {
                    return undefined
                }
            }
            return ts.visitEachChild(node, visitor, context)
        }

        const updatedStatements: ts.Statement[] = []
        for (const stmt of sourceFile.statements) {
            const newStmt = ts.visitNode(stmt, visitor)
            if (newStmt) updatedStatements.push(newStmt as ts.Statement)
        }
        return ts.factory.updateSourceFile(sourceFile, ts.factory.createNodeArray(updatedStatements))
    }
}

/**
 * Main cleaner function.
 *  1. Ensures top comment is present.
 *  2. Transforms code with the above transformers.
 *  3. Writes the final file output.
 */
export default function cleanTsFile(src: string) {
    let sourceCode = fs.readFileSync(src, 'utf-8')

    // Parse the source
    const sourceFile = ts.createSourceFile(
        path.basename(src),
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    )

    // Run the transformers
    const result = ts.transform(sourceFile, [resolveZodTypesTransformer, removeSecondParamTransformer, removeDefaultExportTransformer])

    // Print final code
    const eslintDisable = `/* eslint-disable */`
    const printer = ts.createPrinter()
    const transformedCode = eslintDisable + '\n' + printer.printFile(result.transformed[0]).concat(proxySnippet())

    // Write back to the same file
    fs.writeFileSync(src, transformedCode, 'utf-8')
}
