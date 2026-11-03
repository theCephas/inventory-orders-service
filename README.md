# Inventory & Orders Service

A small inventory and ordering backend:

- a **NestJS API** (TypeScript, PostgreSQL, TypeORM) for auth, products and orders, and
- a **Go reporting service** that produces order summaries, called only by the API.

The core of the system is order placement: stock is reserved inside a single transaction with row
locks, so concurrent orders can never oversell a product.

```mermaid
flowchart LR
    client([Client]) -- "HTTPS + JWT" --> api["NestJS API<br/>:3000 /api/v1"]
    api -- "read / write<br/>(app role)" --> db[(PostgreSQL 16)]
    api -- "GET /v1/summary<br/>X-Internal-Api-Key" --> rep["Go reporting service<br/>:8080 (internal only)"]
    rep -- "SELECT only<br/>(reporting_reader role)" --> db
```

- Clients only talk to the API. The reporting service has no published port; in Docker it is
  reachable only from the API over the compose network.
- The API enforces users and roles. The reporting service trusts only the shared internal API key.
- The reporting service connects as `reporting_reader`, a role that can `SELECT` from `orders`,
  `order_items` and `products` and nothing else (not even `users`).

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Quick start with Docker](#2-quick-start-with-docker-recommended)
3. [Try it: login → place an order → report](#3-try-it-login--place-an-order--report)
4. [Running locally without Docker](#4-running-locally-without-docker)
5. [Running the tests](#5-running-the-tests)
6. [Configuration](#6-configuration)
7. [API overview](#7-api-overview)
8. [Data model](#8-data-model)
9. [Key design decisions and trade-offs](#9-key-design-decisions-and-trade-offs)
10. [Assumptions](#10-assumptions)
11. [Project layout](#11-project-layout)
12. [Troubleshooting](#12-troubleshooting)
13. [What I'd improve with more time](#13-what-id-improve-with-more-time)

---

## 1. Prerequisites

Pick **one** of the two setups.

**A. Docker (recommended).** Everything runs in containers; nothing else is needed to start the system.

| Tool | Version | Check with |
| --- | --- | --- |
| Docker Engine or Docker Desktop | 24+ | `docker --version` |
| Docker Compose v2 (bundled with Docker Desktop) | 2.20+ | `docker compose version` |

To also run the API test suites from your machine, add Node.js and Yarn from the table below.

**B. Local toolchain (no Docker).**

| Tool | Version | Check with | Used for |
| --- | --- | --- | --- |
| Node.js | 20 LTS or newer | `node -v` | API |
| Yarn (classic) | 1.22.x | `yarn -v` | API dependencies and scripts (`npm i -g yarn`) |
| PostgreSQL | 16 | `psql --version` | Database (with `psql` on your `PATH`) |
| Go | 1.22 or newer | `go version` | Reporting service |

**Optional:** [`jq`](https://jqlang.github.io/jq/) for the copy-paste examples in section 3.
You can do the same walkthrough in Swagger at <http://localhost:3000/docs> instead.

**Ports used on your machine:** `3000` (API) and `5432` (PostgreSQL). Stop anything else using
them first, or see [Troubleshooting](#12-troubleshooting).

---

## 2. Quick start with Docker (recommended)

```bash
git clone https://github.com/theCephas/inventory-orders-service.git
cd inventory-orders-service

# 1. Create your env file. The defaults work as-is for local use.
cp .env.example .env

# 2. Build and start Postgres, the API and the reporting service.
#    The API applies database migrations automatically on start-up.
docker compose up --build -d

# 3. Wait until the API answers (first build takes a few minutes).
curl http://localhost:3000/api/v1/health        # → {"status":"ok"}

# 4. Seed the admin account and 5 sample products. Safe to run more than once.
docker compose exec api yarn seed:prod
```

You now have:

| What | Where |
| --- | --- |
| API | <http://localhost:3000/api/v1> |
| Swagger UI | <http://localhost:3000/docs> |
| Seeded admin | `admin@example.com` / `admin-password` (from `SEED_ADMIN_*` in `.env`) |
| PostgreSQL | `localhost:5432`, user `inventory` / `inventory`, databases `inventory_orders` and `inventory_orders_test` |

What happens on the first `docker compose up`:

1. **postgres** starts. On its *first* initialisation only, the scripts in
   [`docker/postgres/init/`](docker/postgres/init) create the `inventory_orders_test` database
   and the `reporting_reader` login role.
2. **api** runs `migration:run` (creates the schema and grants `reporting_reader` its `SELECT`
   permissions), then starts listening on port 3000.
3. **reporting-service** builds. Its Dockerfile runs `go vet` and `go test` before compiling, so
   the image is only produced if the tests pass. It then listens on port 8080 inside the network.

Useful commands:

```bash
docker compose logs -f api                  # follow API logs
docker compose ps                           # service status
docker compose down                         # stop (keeps data)
docker compose down -v                      # stop and delete all data (re-runs init scripts next time)
```

---

## 3. Try it: login → place an order → report

These commands assume the Docker quick start is running and `jq` is installed.

```bash
API=http://localhost:3000/api/v1

# Log in as the seeded admin
ADMIN_TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-password"}' | jq -r .accessToken)

# Register and log in as a customer
curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"jane@example.com","password":"correct-horse"}' | jq
CUSTOMER_TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"jane@example.com","password":"correct-horse"}' | jq -r .accessToken)

# List products and pick the first one
curl -s "$API/products?limit=5" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq
PRODUCT_ID=$(curl -s "$API/products" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq -r '.data[0].id')

# Place an order (duplicate lines are merged; prices come from the server)
ORDER=$(curl -s -X POST $API/orders -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}]}")
echo "$ORDER" | jq
ORDER_ID=$(echo "$ORDER" | jq -r .id)

# Stock has gone down by 2
curl -s "$API/products/$PRODUCT_ID" -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq .stockQuantity

# Ordering more than is in stock → 409 with { productId, requested, available }
curl -s -X POST $API/orders -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1000}]}" | jq

# Admin moves the order along: pending → confirmed
curl -s -X PATCH $API/orders/$ORDER_ID/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"confirmed"}' | jq .status

# Order summary for the year (served by the Go service via the API)
curl -s "$API/reports/summary?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Stop the reporting service: the same request now returns 503
docker compose stop reporting-service
curl -s "$API/reports/summary?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
docker compose start reporting-service
```

> The report covers orders created in the date range, so if you are running this in a different
> year, change `from` and `to` to include today.

---

## 4. Running locally without Docker

Requires the tools in [Prerequisites B](#1-prerequisites) and a running PostgreSQL 16. Step 1
must run as a Postgres superuser: with Homebrew or Postgres.app that is your own macOS user (as
below), and on Linux use `sudo -u postgres psql -d postgres` instead.

**1. Create the databases and roles** (one time):

```bash
psql -d postgres <<'SQL'
CREATE ROLE inventory LOGIN PASSWORD 'inventory' CREATEROLE;
CREATE DATABASE inventory_orders OWNER inventory;
CREATE DATABASE inventory_orders_test OWNER inventory;
-- Login role for the Go reporting service. Its table permissions are granted by a migration.
CREATE ROLE reporting_reader LOGIN PASSWORD 'reporting';
ALTER ROLE reporting_reader SET default_transaction_read_only = on;
SQL
```

These match the defaults in `.env.example`. If you change any password, change `.env` to match.

**2. Configure, install, migrate and seed the API:**

```bash
cp .env.example .env
cd api
yarn install --frozen-lockfile
yarn migration:run          # creates the schema and grants reporting_reader SELECT access
yarn seed                   # admin + 5 sample products
yarn start:dev              # http://localhost:3000/api/v1, Swagger at /docs
```

**3. Run the reporting service** in a second terminal (from the repo root):

```bash
cd reporting-service
export DATABASE_URL=postgres://reporting_reader:reporting@localhost:5432/inventory_orders
export INTERNAL_API_KEY=$(grep '^INTERNAL_API_KEY=' ../.env | cut -d= -f2-)   # must match the API's
go run ./cmd/server         # listens on :8080; the API's REPORTING_SERVICE_URL points here
```

Check it directly: `curl -H "X-Internal-Api-Key: $INTERNAL_API_KEY" "localhost:8080/v1/summary?from=2026-01-01&to=2026-12-31"`.

The walkthrough in [section 3](#3-try-it-login--place-an-order--report) works the same way. To
see the 503, stop the Go service with `Ctrl+C` instead of `docker compose stop`.

---

## 5. Running the tests

### API: unit tests (no database needed)

```bash
cd api
yarn install --frozen-lockfile   # if you haven't already
yarn test
```

These cover the order service rules (total from the price snapshot, merging duplicate lines,
no writes on insufficient stock, status transitions), the roles guard, and the error filters.

### API: end-to-end tests (real PostgreSQL)

The e2e suites boot the whole Nest app and hit it over HTTP against a **separate test database**
(`TEST_DATABASE_URL`, default `inventory_orders_test`). Migrations are applied automatically
before the run, and each suite truncates the tables first. As a safety net, the run refuses to
start if the database name doesn't end in `_test`.

```bash
# With Docker: only Postgres needs to be running (it already has the test database)
docker compose up -d postgres

# Without Docker: your local Postgres from section 4

cd api
yarn test:e2e
```

What they cover:

| Suite | Highlights |
| --- | --- |
| `auth.e2e-spec.ts` | register/login/me, a role in the register body is rejected, duplicate email is 409, the same error for wrong password and unknown email, seeded admin login |
| `products.e2e-spec.ts` | 401/403 role checks, CRUD, soft delete visibility, `includeInactive`, pagination limits, validation |
| `orders.e2e-spec.ts` | full customer flow with stock and total checks, 409 leaves stock unchanged, customer A gets 404 for B's order, cancel restores stock, status transitions, **concurrency** (below) |
| `reports.e2e-spec.ts` | proxying against a fake reporting service: key forwarding, admin only, 400 pass-through, **503 on timeout, on service down, and on a rejected key** |

The concurrency tests fire real simultaneous requests:

- two orders for the last unit → exactly one `201` and one `409`, and final stock is `0`;
- 20 orders for 5 units → exactly 5 succeed, and every rejection is the service's own
  "Insufficient stock" error (not the database `CHECK` fallback), which proves the row lock is
  doing the work;
- 10 orders listing the same two products in opposite orders → all succeed, with no deadlock;
- a cancellation racing a new order for the same stock → stock stays consistent.

To run one suite, use its file path: `yarn test:e2e test/orders.e2e`.

### Go reporting service

```bash
cd reporting-service
go test ./...
```

No database needed: the handler tests are table-driven and use a fake store behind the
`SummaryStore` interface. They cover the API key, date validation, `from > to`, the query
timeout (504), store errors, the response body and the health check.

Without Go installed, use Docker either way:

```bash
docker run --rm -v "$PWD/reporting-service:/src" -w /src golang:1.22-alpine go test ./...
# or simply build the image, which runs go vet and go test first:
docker compose build reporting-service
```

### Lint

```bash
cd api && yarn lint                       # ESLint + Prettier, with no-explicit-any as an error
cd reporting-service && go vet ./...
```

---

## 6. Configuration

All configuration comes from environment variables. Copy `.env.example` to `.env`; the defaults are
for local development only. The API validates its variables at start-up and refuses to boot,
listing every problem, if any are missing or invalid.

| Variable | Used by | Default in `.env.example` | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | docker-compose | `inventory` / `inventory` / `inventory_orders` | Postgres container credentials |
| `NODE_ENV` | API | `development` | `development`, `production` or `test` |
| `PORT` | API | `3000` | |
| `DATABASE_URL` | API, migrations, seed | `postgres://inventory:inventory@localhost:5432/inventory_orders` | Overridden inside Docker to use the `postgres` host |
| `JWT_SECRET` | API | placeholder | **Min 32 characters.** Generate one with `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | API | `1h` | Any [`ms`](https://github.com/vercel/ms) duration |
| `INTERNAL_API_KEY` | API and Go service | placeholder | **Min 32 characters.** Must be identical for both services |
| `REPORTING_DB_PASSWORD` | Postgres init script, Go service | `reporting` | Password of the read-only `reporting_reader` role |
| `REPORTING_SERVICE_URL` | API | `http://localhost:8080` | Overridden inside Docker to `http://reporting-service:8080` |
| `REPORTING_TIMEOUT_MS` | API | `3000` | Timeout for calls to the reporting service |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed script | `admin@example.com` / `admin-password` | The only way to create an admin |
| `TEST_DATABASE_URL` | e2e tests | `.../inventory_orders_test` | Must end in `_test`; it is truncated by the tests |

The Go service reads `DATABASE_URL`, `INTERNAL_API_KEY`, `PORT` (default `8080`) and
`QUERY_TIMEOUT_MS` (default `5000`). docker-compose sets these for it.

---

## 7. API overview

Base path: `/api/v1`. Full interactive docs: **<http://localhost:3000/docs>** (click *Authorize*
and paste an `accessToken` to call protected endpoints).

Every route needs a `Bearer` token unless it is marked *public*.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/health` | public | `{ "status": "ok" }` |
| POST | `/auth/register` | public | Always creates a `customer`; a `role` field is rejected with 400 |
| POST | `/auth/login` | public | `{ accessToken }`; the same 401 for an unknown email and a wrong password |
| GET | `/auth/me` | authenticated | The current user, never the password hash |
| GET | `/products` | authenticated | Active products; admins may add `?includeInactive=true` |
| GET | `/products/:id` | authenticated | Inactive products are 404 for customers |
| POST | `/products` | admin | Duplicate SKU → 409 |
| PATCH | `/products/:id` | admin | Partial update; `{ "isActive": true }` restores a soft-deleted product |
| DELETE | `/products/:id` | admin | Soft delete → 204 |
| POST | `/orders` | customer | `{ items: [{ productId, quantity }] }`, 1 to 50 items |
| GET | `/orders` | authenticated | Customers see their own; admins see all and may filter by `?status=&userId=` |
| GET | `/orders/:id` | authenticated | Another customer's order is **404**, not 403 |
| PATCH | `/orders/:id/cancel` | owner (if `pending`) or admin | Restores stock in the same transaction |
| PATCH | `/orders/:id/status` | admin | `pending → confirmed → shipped`, and `pending`/`confirmed → cancelled`; anything else → 409 |
| GET | `/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | admin | Proxied to the Go service; 503 if it is down or slow |

**Lists** accept `?page=1&limit=20` (`limit` max 100) and return
`{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 42 } }`.

**Errors** always have the same shape:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Insufficient stock",
  "details": { "productId": "…", "requested": 4, "available": 3 },
  "path": "/api/v1/orders",
  "timestamp": "2026-11-05T10:00:00.000Z"
}
```

Validation failures are 400 with `details.errors` listing each problem. Postgres errors are mapped
in a filter (unique → 409, foreign key → 409, check → 409); anything unexpected is a generic 500,
with the full error logged on the server only.

**Report response** (dates are inclusive UTC calendar days; revenue excludes cancelled orders; top 5
products by units sold):

```json
{
  "from": "2026-01-01",
  "to": "2026-12-31",
  "totalOrders": 42,
  "revenueCents": 1234500,
  "ordersByStatus": { "pending": 3, "confirmed": 30, "shipped": 5, "cancelled": 4 },
  "topProducts": [
    { "productId": "…", "name": "Mechanical Keyboard", "unitsSold": 12, "revenueCents": 107988 }
  ]
}
```

---

## 8. Data model

| Table | Key columns | Constraints |
| --- | --- | --- |
| `users` | `email` (stored lowercase), `password_hash`, `role` (`admin`/`customer`) | unique `email` |
| `products` | `sku`, `name`, `price_cents`, `stock_quantity`, `is_active` | unique `sku`; `CHECK (price_cents >= 0)`; `CHECK (stock_quantity >= 0)` |
| `orders` | `user_id`, `status` (`pending`/`confirmed`/`shipped`/`cancelled`), `total_cents` | FK → `users` `ON DELETE RESTRICT`; indexes on `user_id` and `created_at` |
| `order_items` | `order_id`, `product_id`, `quantity`, `unit_price_cents` | FK → `orders` `ON DELETE CASCADE`; FK → `products` `ON DELETE RESTRICT`; `CHECK (quantity > 0)`; unique (`order_id`, `product_id`) |

All IDs are UUIDs and every table has `created_at`; mutable tables also have `updated_at`. The
schema is defined by hand-written migrations in
[`api/src/database/migrations`](api/src/database/migrations) (`synchronize` is off), with every
constraint explicitly named. TypeORM's schema diff against the entities reports no drift.

Why it looks like this:

- **Money is integer cents.** No floating-point rounding. Totals are summed in integers and
  checked against the 32-bit column range before insert.
- **`unit_price_cents` is a snapshot.** Changing a product's price later never rewrites past
  orders, and the order total is always computed by the server from these snapshots. Any price
  the client sends is rejected by validation.
- **Products are soft-deleted** (`is_active = false`). Order history references them, so deleting
  the row would either fail (`RESTRICT`) or lose history.
- **`CHECK (stock_quantity >= 0)` is the last line of defence.** The application already prevents
  overselling under a row lock, but if a bug ever slipped through, the database would still
  refuse negative stock.
- **Duplicate product lines are merged** before insert, and the unique (`order_id`, `product_id`)
  constraint guarantees one line per product.

---

## 9. Key design decisions and trade-offs

**Pessimistic row locks rather than optimistic versioning.**
Placing an order runs in one transaction:

1. merge duplicate lines;
2. `SELECT … FOR UPDATE` the products, **ordered by id**;
3. validate everything (missing → 404, inactive → 422, short on stock → 409 with
   `{ productId, requested, available }`) before writing anything;
4. decrement stock, snapshot prices, insert the order and its items.

Ordering the locks by id means two orders touching the same products always queue in the same
order instead of deadlocking. Cancelling locks the order row first, then its products in the same
id order. Stock is a hot, contended row (a popular product, a flash sale), and that is where
optimistic concurrency does badly: most attempts would fail their version check and need retries,
and the client would see failures unrelated to real stock levels. Locks serialise only orders for
the *same* products, for a few milliseconds, and the 409 always reports the true available
quantity. The trade-off is holding locks for the length of the transaction, which is kept short
(no network calls inside it). The concurrency e2e tests confirm the behaviour, and they fail if
the lock is removed.

**Orders are cancelled, never deleted.** There is no `DELETE /orders`. Cancelling is the "delete":
it restores stock in the same transaction and keeps the audit trail, so revenue and history stay
accurate. Customers can cancel their own *pending* orders; admins can cancel *pending* or
*confirmed* ones. Cancelling through `PATCH /orders/:id/status` restores stock too.

**The Go service reads the database directly instead of consuming events.**
This is the simplest thing that gives correct, up-to-date numbers. Both summary queries run in one
read-only `REPEATABLE READ` transaction, so the totals and the top products come from the same
snapshot. Risk is contained by a dedicated `reporting_reader` role with `SELECT` on three tables
only and `default_transaction_read_only = on`. The cost is coupling: the reporting service depends
on the API's schema, and it adds read load to the primary. An outbox or event stream feeding a
reporting store (or at least a read replica) would decouple them. I'd only take on that extra
moving part once the load or the team structure called for it.

**404 instead of 403 for other users' orders.** Returning 403 would confirm that an order ID
exists. Customers' queries are filtered by owner, so someone else's order is indistinguishable
from a missing one.

**TypeORM rather than Prisma.** TypeORM is the Nest-native choice and has first-class pessimistic
locking (`lock: { mode: 'pessimistic_write' }`), which the core order flow depends on. Prisma has
no built-in `SELECT … FOR UPDATE` and would need raw SQL for exactly the part that matters most.
TypeORM's main downside, migrations that drift from the entities, is handled by writing migrations
by hand with named constraints and keeping `synchronize` off.

**Other decisions worth knowing:**

- **Authentication is on by default.** A global JWT guard protects every route; public routes opt
  out with `@Public()`. Forgetting a decorator therefore fails closed.
- **Login gives no hints.** It returns the same 401 and takes the same time whether the email is
  unknown or the password is wrong (a dummy bcrypt comparison runs for unknown emails).
- **Report errors are mapped deliberately.** The reporting service's 400s (bad dates) are passed
  through. Anything else (down, more than 3 s, wrong key, 5xx) becomes a 503 with a clear message,
  and the cause is logged.
- **Migrations run when the API container starts.** They are idempotent, which keeps
  `docker compose up` to one command. In a real deployment they would be a separate release step.

---

## 10. Assumptions

- **Single currency.** All prices and totals are in one currency's minor units (cents).
- **No payments.** An order is a stock reservation, not a charge.
- **Stock is reserved when the order is placed** (status `pending`) and released only by cancelling.
  Shipping doesn't change stock again.
- **Admins are created by the seed script only.** Registration always creates customers, and there
  is no endpoint for changing roles.
- **Admins don't place orders.** `POST /orders` is for customers (an admin gets 403).
- **Emails are case-insensitive.** They are trimmed and lowercased before storing and on login.
- **Report dates are calendar days in UTC, inclusive at both ends.** "Orders" in a report means
  orders *created* in that range, whatever their current status.
- **Quantities are 1 to 1000 per line**, with 1 to 50 lines per order. These are sanity limits that
  keep totals well inside the integer range.

---

## 11. Project layout

```
.
├── api/                         NestJS API
│   ├── src/
│   │   ├── auth/                register/login/me, JWT strategy, global guards, decorators
│   │   ├── users/               user entity and service (no public CRUD)
│   │   ├── products/            product CRUD with soft delete
│   │   ├── orders/              transactional placement, cancel, status transitions
│   │   ├── reports/             HTTP client for the Go service (timeout → 503)
│   │   ├── common/              error filters, pagination DTOs, @CurrentUser
│   │   ├── config/              environment validation (Joi)
│   │   └── database/            data source, migrations, seed
│   └── test/                    e2e suites and helpers (test app, DB reset, auth)
├── reporting-service/           Go 1.22 service
│   ├── cmd/server/              main: config, pgx pool, HTTP server, graceful shutdown
│   └── internal/
│       ├── config/              environment parsing
│       ├── httpapi/             handlers, API-key middleware, table-driven tests
│       └── store/               summary SQL (read-only transaction)
├── docker/postgres/init/        first-boot scripts: test database, reporting_reader role
├── docker-compose.yml
└── .env.example
```

---

## 12. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `port is already allocated` / `EADDRINUSE` on 3000 or 5432 | Something else is using the port (often a local Postgres). Stop it, or change the left side of the port mapping in `docker-compose.yml` (e.g. `'5433:5432'`) and the URLs in `.env` to match. Without Docker, start the API on another port with `PORT=3001 yarn start:dev`. |
| `database "inventory_orders_test" does not exist`, or the reporting service can't log in | The init scripts only run on a brand-new volume. Run `docker compose down -v && docker compose up --build -d` (this deletes local data). |
| `GET /reports/summary` returns 503 | The reporting service is down, slow, or has a different `INTERNAL_API_KEY`. Check `docker compose logs reporting-service api`. A key mismatch is logged by the API as `responded with 401`. |
| API exits with `Config validation error` | A variable in `.env` is missing or invalid. The message lists each one (for example, `JWT_SECRET` must be at least 32 characters). |
| `Refusing to run e2e tests against non-test database` | `TEST_DATABASE_URL` must point at a database whose name ends in `_test`. |
| Report numbers are all zero | The range doesn't include any orders. Dates are UTC and `to` is inclusive; widen the range. |

---

## 13. What I'd improve with more time

- **Refresh tokens, logout and token revocation.** Today, access tokens are short-lived and
  stateless.
- **Rate limiting** on `/auth/login` and `/auth/register`.
- **Idempotency keys on `POST /orders`**, so a retried request can't place the same order twice.
- **An outbox or event-driven reporting store**, to decouple the Go service from the API's schema
  and take reporting load off the primary database.
- **Cursor pagination** for large lists. Offset pagination slows down on deep pages.
- **OpenTelemetry tracing** across the API and the reporting service, with request IDs in logs.
- **CI with GitHub Actions** running lint, unit tests, e2e tests against a Postgres service
  container, and `go vet` / `go test`.
- **A broader test matrix**: Go integration tests against a real database, and load tests for
  order placement.
- **A role-management endpoint** for admins, instead of seed-only admin creation.
- **Product-specific contention controls**, such as a per-request lock timeout, so a burst on one
  product fails fast instead of queueing.
