import type { Database } from 'bun:sqlite'
import { faker } from '@faker-js/faker'

// Row count for each collection.
export const TARGET_COUNT = 10_000

// Fixed seed so a fresh database always produces the exact same "random" data.
const FAKER_SEED = 42
// Anchor date for faker.date.past(), keeping reseeded data byte-identical.
const REF_DATE = '2026-09-11T00:00:00.000Z'

const CATEGORIES = [
  'electronics',
  'clothing',
  'home',
  'sports',
  'books',
  'toys',
  'beauty',
  'grocery',
] as const

// Weighted so the lifecycle middle (shipped/delivered) dominates.
const ORDER_STATUSES = [
  'delivered',
  'delivered',
  'delivered',
  'shipped',
  'shipped',
  'processing',
  'pending',
  'cancelled',
] as const

interface SeedOrder {
  userId: number
  status: string
  createdAt: Date
  items: { productId: number; quantity: number }[]
}

export function seedDatabase(db: Database): {
  users: number
  products: number
  orders: number
  orderItems: number
} {
  faker.seed(FAKER_SEED)

  const insertUser = db.prepare(
    'INSERT INTO users (id, name, username, email, phone, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertProduct = db.prepare(
    'INSERT INTO products (id, name, category, price_cents, stock, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertOrder = db.prepare(
    'INSERT INTO orders (id, user_id, status, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)',
  )

  // usernames and emails are UNIQUE in the schema; faker can collide at this
  // volume, so the row id is appended to any repeat.
  const usedUsernames = new Set<string>()
  const usedEmails = new Set<string>()

  let orderItems = 0

  db.transaction(() => {
    for (let id = 1; id <= TARGET_COUNT; id++) {
      const firstName = faker.person.firstName()
      const lastName = faker.person.lastName()

      let username = faker.internet.username({ firstName, lastName }).toLowerCase()
      if (usedUsernames.has(username)) username = `${username}.${id}`
      usedUsernames.add(username)

      let email = faker.internet.email({ firstName, lastName }).toLowerCase()
      if (usedEmails.has(email)) email = email.replace('@', `.${id}@`)
      usedEmails.add(email)

      insertUser.run(
        id,
        `${firstName} ${lastName}`,
        username,
        email,
        faker.phone.number(),
        `${faker.location.city()}, ${faker.location.country()}`,
        faker.date.past({ years: 3, refDate: REF_DATE }).toISOString(),
      )
    }

    // Prices are kept around so order totals can be derived from the real
    // product prices below.
    const productPrices = new Array<number>(TARGET_COUNT)
    for (let id = 1; id <= TARGET_COUNT; id++) {
      const priceCents = faker.number.int({ min: 99, max: 99_999 })
      productPrices[id - 1] = priceCents
      insertProduct.run(
        id,
        faker.commerce.productName(),
        faker.helpers.arrayElement(CATEGORIES),
        priceCents,
        faker.number.int({ min: 0, max: 500 }),
        faker.number.float({ min: 3, max: 5, fractionDigits: 1 }),
        faker.date.past({ years: 3, refDate: REF_DATE }).toISOString(),
      )
    }

    // Generated first, then sorted by date so order ids run chronologically.
    const orders: SeedOrder[] = Array.from({ length: TARGET_COUNT }, () => {
      const itemCount = faker.number.int({ min: 1, max: 4 })
      const productIds = new Set<number>()
      while (productIds.size < itemCount) {
        productIds.add(faker.number.int({ min: 1, max: TARGET_COUNT }))
      }
      return {
        userId: faker.number.int({ min: 1, max: TARGET_COUNT }),
        status: faker.helpers.arrayElement(ORDER_STATUSES),
        createdAt: faker.date.past({ years: 2, refDate: REF_DATE }),
        items: [...productIds].map((productId) => ({
          productId,
          quantity: faker.number.int({ min: 1, max: 5 }),
        })),
      }
    }).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    orders.forEach((order, i) => {
      const id = i + 1
      // Totals are derived from real product prices, so they always add up.
      const totalCents = order.items.reduce(
        (sum, item) => sum + item.quantity * productPrices[item.productId - 1],
        0,
      )
      insertOrder.run(id, order.userId, order.status, totalCents, order.createdAt.toISOString())
      for (const item of order.items) {
        insertItem.run(id, item.productId, item.quantity, productPrices[item.productId - 1])
        orderItems++
      }
    })
  })()

  return { users: TARGET_COUNT, products: TARGET_COUNT, orders: TARGET_COUNT, orderItems }
}
