/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
interface User {
    id: number
    name: string
    email: string
    createdAt: Date
}
declare const _default: {
    'user.fetch': (args: { id: number }) => Promise<User>
    'user.update': (args: { id: number; name?: string; email?: string }) => Promise<User>
    'user.fetchAll': () => Promise<User[]>
}

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
                    throw new Error(errorText)
                }

                return response.json()
            }
        }
    }
) as typeof _default

export default typedBridge
