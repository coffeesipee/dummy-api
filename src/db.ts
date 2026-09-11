import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { seedDatabase } from './seed'

// SQLite database file. The location is configurable (e.g. a Coolify/Docker
// persistent volume); defaults to the project directory.
const dbPath = process.env.DB_PATH ?? 'data.db'

// SQLite creates the file but never its parent directory, which is exactly
// what happens when DB_PATH points into a freshly mounted volume folder.
mkdirSync(dirname(resolve(dbPath)), { recursive: true })

const db = new Database(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    stock INTEGER NOT NULL,
    rating REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`)

function countRows(table: 'users' | 'products' | 'orders'): number {
  const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

// Seed once: if the database is empty, generate all dummy data with faker.
if (countRows('users') === 0 && countRows('products') === 0 && countRows('orders') === 0) {
  const started = Date.now()
  const counts = seedDatabase(db)
  console.log(
    `Seeded database with faker: ${counts.users} users, ${counts.products} products, ` +
      `${counts.orders} orders (${counts.orderItems} order items) in ${Date.now() - started}ms`,
  )
}

// --- serialization helpers ---

type Row = Record<string, any>

const mapUser = (u: Row) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
  phone: u.phone,
  city: u.city,
  createdAt: u.created_at,
})

const mapProduct = (p: Row) => ({
  id: p.id,
  name: p.name,
  category: p.category,
  price: p.price_cents / 100,
  stock: p.stock,
  rating: p.rating,
  createdAt: p.created_at,
})

// Applies LIMIT/OFFSET when both page and limit are given; otherwise returns everything.
function runPaginated(sql: string, page?: number, limit?: number): Row[] {
  if (page === undefined || limit === undefined) return db.prepare(sql).all() as Row[]
  return db.prepare(`${sql} LIMIT ? OFFSET ?`).all(limit, (page - 1) * limit) as Row[]
}

const ORDER_ITEM_SELECT = `
  SELECT oi.order_id, oi.quantity, oi.unit_price_cents,
         p.id AS product_id, p.name AS product_name, p.category AS product_category
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id`

function groupItemsByOrderId(itemRows: Row[]): Map<number, any[]> {
  const itemsByOrderId = new Map<number, any[]>()
  for (const row of itemRows) {
    const list = itemsByOrderId.get(row.order_id) ?? []
    list.push({
      productId: row.product_id,
      name: row.product_name,
      category: row.product_category,
      quantity: row.quantity,
      unitPrice: row.unit_price_cents / 100,
      subtotal: (row.unit_price_cents * row.quantity) / 100,
    })
    itemsByOrderId.set(row.order_id, list)
  }
  return itemsByOrderId
}

// Expands raw order rows into the public shape: full user + line items with product info.
function buildOrders(orderRows: Row[], usersById: Map<number, Row>, itemsByOrderId: Map<number, any[]>) {
  return orderRows.map((o) => ({
    id: o.id,
    status: o.status,
    total: o.total_cents / 100,
    createdAt: o.created_at,
    user: mapUser(usersById.get(o.user_id)),
    items: itemsByOrderId.get(o.id) ?? [],
  }))
}

/*
 * Loads a set of orders together with their relations. The scope suffix
 * (e.g. "ORDER BY id LIMIT ? OFFSET ?") is reused inside subqueries so the
 * full 10k-row list never needs one bound parameter per order (SQLite caps
 * those at ~32k).
 */
function loadOrdersScoped(scope: string, params: number[]) {
  const orderRows = db.prepare(`SELECT * FROM orders ${scope}`).all(...params) as Row[]
  if (orderRows.length === 0) return []

  const usersById = new Map(
    (db
      .prepare(`SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE id IN (SELECT id FROM orders ${scope}))`)
      .all(...params) as Row[]
    ).map((row) => [row.id, row]),
  )
  const itemsByOrderId = groupItemsByOrderId(
    db.prepare(`${ORDER_ITEM_SELECT} WHERE oi.order_id IN (SELECT id FROM orders ${scope})`).all(...params) as Row[],
  )
  return buildOrders(orderRows, usersById, itemsByOrderId)
}

// --- public query API used by the routes ---

export function tableCounts() {
  return { users: countRows('users'), products: countRows('products'), orders: countRows('orders') }
}

export function listUsers(page?: number, limit?: number) {
  const rows = runPaginated('SELECT * FROM users ORDER BY id', page, limit)
  return { data: rows.map(mapUser), total: countRows('users') }
}

export function getUser(id: number) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | null
  return row ? mapUser(row) : null
}

export function listProducts(page?: number, limit?: number) {
  const rows = runPaginated('SELECT * FROM products ORDER BY id', page, limit)
  return { data: rows.map(mapProduct), total: countRows('products') }
}

export function getProduct(id: number) {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Row | null
  return row ? mapProduct(row) : null
}

export function listOrders(page?: number, limit?: number) {
  const data =
    page !== undefined && limit !== undefined
      ? loadOrdersScoped('ORDER BY id LIMIT ? OFFSET ?', [limit, (page - 1) * limit])
      : loadOrdersScoped('ORDER BY id', [])
  return { data, total: countRows('orders') }
}

export function getOrder(id: number) {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Row | null
  if (!row) return null

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as Row
  const itemsByOrderId = groupItemsByOrderId(
    db.prepare(`${ORDER_ITEM_SELECT} WHERE oi.order_id = ?`).all(id) as Row[],
  )
  return buildOrders([row], new Map([[user.id, user]]), itemsByOrderId)[0]
}
