# Dummy Shop API (Elysia + SQLite)

A public dummy REST API built with [Elysia](https://elysia.dev) on Bun, backed by SQLite (`bun:sqlite`, no ORM). All data is fake, but fully related: every order belongs to a real user and every line item references a real product, with order totals derived from actual product prices.

## Run it

```bash
bun install
bun run start        # or: bun run dev (watch mode)
```

The SQLite file (`data.db`) is created and seeded automatically on first start with [faker](https://fakerjs.dev) (`@faker-js/faker`, fixed seed `42`): **10,000 users, 10,000 products, 10,000 orders** (~25k order items) in about a second. Because the seed is fixed, deleting the database and restarting reproduces the exact same data. CORS is open, so any browser/frontend can call it.

## Endpoints

| Method | Path             | Description                                  |
| ------ | ---------------- | -------------------------------------------- |
| GET    | `/`              | API info + endpoint list                     |
| GET    | `/users`         | Users, paginated (`?page=&limit=`)           |
| GET    | `/users/all`     | All users, no pagination                     |
| GET    | `/users/:id`     | Single user                                  |
| GET    | `/products`      | Products, paginated (`?page=&limit=`)        |
| GET    | `/products/all`  | All products, no pagination                  |
| GET    | `/products/:id`  | Single product                               |
| GET    | `/orders`        | Orders, paginated (`?page=&limit=`)          |
| GET    | `/orders/all`    | All orders, no pagination                    |
| GET    | `/orders/:id`    | Single order                                 |

Pagination defaults: `page=1`, `limit=10` (max 100). Unknown ids return `404`.

## Response shapes

Paginated list (`GET /products?page=2&limit=5`):

```json
{
  "data": [ { "id": 6, "name": "Rustic Concrete Shoes", "category": "sports", "price": 399.63, "stock": 301, "rating": 3.7, "createdAt": "2024-05-02T11:20:35.481Z" } ],
  "meta": { "page": 2, "limit": 5, "totalItems": 10000, "totalPages": 2000, "hasNextPage": true, "hasPrevPage": true }
}
```

Full list (`GET /users/all`):

```json
{ "data": [ ... ], "meta": { "count": 10000 } }
```

Order (`GET /orders/9999`) — embeds the buyer and the line items with product details:

```json
{
  "data": {
    "id": 9999,
    "status": "shipped",
    "total": 6460.57,
    "createdAt": "2026-09-10T23:22:25.186Z",
    "user": { "id": 1323, "name": "Shany Ortiz", "email": "shany_ortiz@hotmail.com", "...": "..." },
    "items": [
      { "productId": 6449, "name": "Rustic Concrete Shoes", "category": "sports", "quantity": 5, "unitPrice": 399.63, "subtotal": 1998.15 }
    ]
  }
}
```

## Data model

```
users (10,000) ──< orders (10,000) ──< order_items (~25,000) >── products (10,000)
```

Prices are stored in cents (integers) and converted to decimals in responses; order `total` is the exact sum of `unitPrice × quantity`.

## Reset the data

Delete `data.db` and restart — the database reseeds itself (deterministically, same data every time).

## Deploy to Coolify

The repo ships with a `Dockerfile` (Bun image, port 3000, health check via `GET /`).

1. Push this repo to your Git host (GitHub / GitLab / Gitea — whatever your Coolify is connected to).
2. In Coolify: **Project → Add Resource → Application**, pick the repo and branch. Coolify auto-detects the Dockerfile build pack.
3. **Port**: `3000` (the app reads `PORT` from the environment, so changing the port in the UI works too).
4. **Health check path**: `/`.
5. Add a domain (FQDN) and let Coolify issue the HTTPS certificate.

**Database persistence (optional):** container filesystems reset on every deploy. Since the faker seed is fixed, a redeploy simply reseeds the exact same 10k rows — usually fine for a dummy API. If you still want the file to survive deploys, add a persistent volume and point the app at it:

- **Volumes**: mount at `/app/data`
- **Environment variable**: `DB_PATH=/app/data/data.db`

## Reset the data (local)

Delete `data.db` and restart — the database reseeds itself.
