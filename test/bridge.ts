/* eslint-disable */
interface User {
    id: number;
    name: string;
    email: string;
    createdAt: Date;
}
interface Product {
    id: number;
    name: string;
    price: number;
    createdAt: Date;
}
interface OrderItem {
    productId: number;
    quantity: number;
    price: number;
    notes?: string;
    discount: number | null;
}
interface Address {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
}
interface Order {
    id: number;
    customerId: number;
    status: string;
    total: number;
    items: OrderItem[];
    shippingAddress: Address;
    billingAddress: Address | null;
    isGift: boolean;
    giftMessage: string | null;
    createdAt: Date;
    updatedAt: Date | null;
}
declare const _default: {
    'user.fetch': (args: {
        id: number;
    }) => Promise<{
        id: number;
        name: string;
        email: string;
    }>;
    'user.create': (args: {
        name: string;
        email: string;
    }) => Promise<{
        id: number;
        name: string;
        email: string;
        createdAt: Date;
    }>;
    'user.update': (args: {
        id: number;
        name?: string;
        email?: string;
    }) => Promise<User>;
    'user.remove': (args: {
        id: number;
    }) => Promise<{
        success: boolean;
    }>;
    'user.fetchAll': () => Promise<User[]>;
    'product.fetch': (args: {
        id: number;
    }) => Promise<{
        id: number;
        name: string;
        price: number;
        createdAt: Date;
    }>;
    'product.create': (args: {
        name: string;
        price: number;
    }) => Promise<{
        id: number;
        name: string;
        price: number;
        createdAt: Date;
    }>;
    'product.list': () => Promise<Product[]>;
    'order.create': (args: {
        customerId: number;
        items: {
            productId: number;
            quantity: number;
            price: number;
            notes?: string;
            discount: number | null;
        }[];
        shippingAddress: {
            street: string;
            city: string;
            state: string;
            zip: string;
            country: string;
        };
        billingAddress: {
            street: string;
            city: string;
            state: string;
            zip: string;
            country: string;
        } | null;
        couponCode?: string | null;
        scheduledDate?: Date;
        isGift: boolean;
        giftMessage: string | null;
    }) => Promise<{
        id: number;
        status: string;
        total: number;
        items: {
            productId: number;
            quantity: number;
            price: number;
            notes?: string;
            discount: number | null;
        }[];
        createdAt: Date;
    }>;
    'order.fetch': (args: {
        id: number;
    }) => Promise<{
        id: number;
        customerId: number;
        status: string;
        total: number;
        items: {
            productId: number;
            quantity: number;
            price: number;
            notes?: string;
            discount: number | null;
        }[];
        shippingAddress: {
            street: string;
            city: string;
            state: string;
            zip: string;
            country: string;
        };
        billingAddress: {
            street: string;
            city: string;
            state: string;
            zip: string;
            country: string;
        } | null;
        isGift: boolean;
        giftMessage: string | null;
        createdAt: Date;
        updatedAt: Date | null;
    }>;
    'order.update': (args: {
        id: number;
        status?: string;
        shippingAddress?: {
            street: string;
            city: string;
            state: string;
            zip: string;
            country: string;
        };
        giftMessage?: string | null;
    }) => Promise<{
        id: number;
        status: string;
        updatedAt: Date;
    }>;
    'order.list': () => Promise<Order[]>;
    'order.primitives': (args: {
        key: string;
    }) => Promise<{
        str: string;
        num: number;
        bool: boolean;
        date: Date;
        nul: null;
        undef: undefined;
        unk: unknown;
        whatever: any;
        optStr?: string;
        nullStr: string | null;
        defStr: string;
        optNullStr?: string | null;
        nullOptStr: (string | undefined) | null;
        tags: string[];
        scores: number[] | null;
        optDates?: Date[];
        nested: {
            a: number;
            b?: string;
            c: {
                d: boolean;
                e: string[] | null;
            };
        };
    }>;
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
