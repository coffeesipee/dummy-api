import { Elysia, t } from 'elysia'
import { cors } from '@elysiajs/cors'
import { getOrder, getProduct, getUser, listOrders, listProducts, listUsers, tableCounts } from './db'

const PORT = Number(process.env.PORT ?? 3000)

// Query shape shared by every paginated endpoint: ?page=1&limit=10
const paginatedQuery = t.Object({
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 10 })),
})

const idParams = t.Object({ id: t.Numeric({ minimum: 1 }) })

function paginationMeta(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit)
  return {
    page,
    limit,
    totalItems: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}

const app = new Elysia()
  .use(cors())
  .get('/', () => ({
    name: 'Dummy Shop API',
    description: 'Public dummy API with related users, products and orders. All data is fake.',
    baseUrl: `http://localhost:${PORT}`,
    counts: tableCounts(),
    endpoints: {
      users: ['GET /users', 'GET /users/all', 'GET /users/:id'],
      products: ['GET /products', 'GET /products/all', 'GET /products/:id'],
      orders: ['GET /orders', 'GET /orders/all', 'GET /orders/:id'],
      pagination: 'Add ?page=N&limit=N to /users, /products and /orders (defaults: page=1, limit=10)',
    },
  }))

  // --- users ---
  .get(
    '/users',
    ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 10
      const { data, total } = listUsers(page, limit)
      return { data, meta: paginationMeta(page, limit, total) }
    },
    { query: paginatedQuery },
  )
  .get('/users/all', () => {
    const { data } = listUsers()
    return { data, meta: { count: data.length } }
  })
  .get(
    '/users/:id',
    ({ params, set }) => {
      const user = getUser(params.id)
      if (!user) {
        set.status = 404
        return { error: 'User not found' }
      }
      return { data: user }
    },
    { params: idParams },
  )

  // --- products ---
  .get(
    '/products',
    ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 10
      const { data, total } = listProducts(page, limit)
      return { data, meta: paginationMeta(page, limit, total) }
    },
    { query: paginatedQuery },
  )
  .get('/products/all', () => {
    const { data } = listProducts()
    return { data, meta: { count: data.length } }
  })
  .get(
    '/products/:id',
    ({ params, set }) => {
      const product = getProduct(params.id)
      if (!product) {
        set.status = 404
        return { error: 'Product not found' }
      }
      return { data: product }
    },
    { params: idParams },
  )

  // --- orders (each order embeds its user and line items with product info) ---
  .get(
    '/orders',
    ({ query }) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 10
      const { data, total } = listOrders(page, limit)
      return { data, meta: paginationMeta(page, limit, total) }
    },
    { query: paginatedQuery },
  )
  .get('/orders/all', () => {
    const { data } = listOrders()
    return { data, meta: { count: data.length } }
  })
  .get(
    '/orders/:id',
    ({ params, set }) => {
      const order = getOrder(params.id)
      if (!order) {
        set.status = 404
        return { error: 'Order not found' }
      }
      return { data: order }
    },
    { params: idParams },
  )

app.listen(PORT)

console.log(`🦊 Dummy Shop API is running at http://localhost:${app.server?.port}`)
