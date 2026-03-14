/* eslint-disable */
interface User {
    id: number;
    name: string;
    email: string;
    createdAt: Date;
}
declare const _default: {
    'user.fetch': (args: {
        id: number;
    }) => Promise<{
        id: number;
        name: string;
    }>;
    'user.update': (args: {
        id: number;
        name?: string;
        email?: string;
    }) => Promise<User>;
    'user.fetchAll': () => Promise<User[]>;
    'user.longRunningTask': () => Promise<void>;
};

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
