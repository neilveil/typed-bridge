import { defineBridge } from '../..'
import * as user from './user'
import * as userTypes from './user/types'
import * as product from './product'
import * as productTypes from './product/types'
import * as order from './order'
import * as orderTypes from './order/types'

export const entries = {
    'user.fetch': { handler: user.fetch, ...userTypes.fetch },
    'user.create': { handler: user.create, ...userTypes.create },
    'user.update': { handler: user.update, ...userTypes.update },
    'user.remove': { handler: user.remove, ...userTypes.remove, mcp: false },
    'user.fetchAll': { handler: user.fetchAll, ...userTypes.fetchAll },

    'product.fetch': { handler: product.fetch, ...productTypes.fetch },
    'product.create': { handler: product.create, ...productTypes.create },
    'product.list': { handler: product.list, ...productTypes.list },

    'order.create': { handler: order.create, ...orderTypes.create },
    'order.fetch': { handler: order.fetch, ...orderTypes.fetch },
    'order.update': { handler: order.update, ...orderTypes.update },
    'order.list': { handler: order.list, ...orderTypes.list },
    'order.resolve': { handler: order.resolve, ...orderTypes.resolve },
    'order.statusFilter': { handler: order.statusFilter, ...orderTypes.statusFilter },
    'order.tag': { handler: order.tag, ...orderTypes.tag },
    'order.primitives': { handler: order.primitives, ...orderTypes.primitives }
}

export default defineBridge(entries)
