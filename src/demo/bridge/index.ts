import * as user from './user'
import * as product from './product'
import * as order from './order'

export default {
    'user.fetch': user.fetch,
    'user.create': user.create,
    'user.update': user.update,
    'user.remove': user.remove,
    'user.fetchAll': user.fetchAll,

    'product.fetch': product.fetch,
    'product.create': product.create,
    'product.list': product.list,

    'order.create': order.create,
    'order.fetch': order.fetch,
    'order.update': order.update,
    'order.list': order.list,
    'order.resolve': order.resolve,
    'order.statusFilter': order.statusFilter,
    'order.tag': order.tag,
    'order.primitives': order.primitives
}
