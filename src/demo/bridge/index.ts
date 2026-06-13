import { defineBridge } from '../..'
import * as user from './user'
import * as userTypes from './user/types'
import * as product from './product'
import * as productTypes from './product/types'
import * as order from './order'
import * as orderTypes from './order/types'

export const entries = {
    'user.fetch': { handler: user.fetch, context: 'user', ...userTypes.fetch },
    'user.create': { handler: user.create, context: 'user', ...userTypes.create },
    'user.update': { handler: user.update, context: 'user', ...userTypes.update },
    'user.remove': { handler: user.remove, context: 'user', ...userTypes.remove, mcp: false }, // destructive, hidden from MCP
    'user.fetchAll': { handler: user.fetchAll, context: 'user', ...userTypes.fetchAll },

    'product.fetch': { handler: product.fetch, context: 'product', ...productTypes.fetch },
    'product.create': { handler: product.create, context: 'product', ...productTypes.create },
    'product.list': { handler: product.list, context: 'product', ...productTypes.list },

    'order.create': { handler: order.create, context: 'order', ...orderTypes.create },
    'order.fetch': { handler: order.fetch, context: 'order', ...orderTypes.fetch },
    'order.update': { handler: order.update, context: 'order', ...orderTypes.update },
    'order.list': { handler: order.list, context: 'order', ...orderTypes.list },
    'order.resolve': { handler: order.resolve, context: 'order', ...orderTypes.resolve },
    'order.statusFilter': { handler: order.statusFilter, context: 'order', ...orderTypes.statusFilter },
    'order.tag': { handler: order.tag, context: 'order', ...orderTypes.tag },
    'order.primitives': { handler: order.primitives, ...orderTypes.primitives }
}

export default defineBridge(entries)
