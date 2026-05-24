# CaseCellShop API

**TOTVS Backend Technical Challenge** — Async checkout system for a mobile phone case e-commerce.

Built with **AdonisJS v6** · **SQLite** · **Redis** · **BullMQ** · **TypeScript**

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [API Endpoints](#api-endpoints)
- [Business Rules](#business-rules)
- [Design Decisions & Trade-offs](#design-decisions--trade-offs)
- [Monitoring & Observability](#monitoring--observability)
- [Testing](#testing)
- [Limitations](#limitations)
- [Environment Variables](#environment-variables)

---

## Architecture Overview

```
┌─────────────┐    HTTP     ┌─────────────────────────────────────┐
│   Client    │ ──────────► │  AdonisJS v6 (HTTP Server)          │
└─────────────┘             │                                     │
                            │  Controllers → Services → DB/Redis  │
                            │                                     │
                            │  POST /checkout                     │
                            │   1. Idempotency check (Redis NX)   │
                            │   2. Atomic stock reservation (SQL) │
                            │   3. Insert PENDING order           │
                            │   4. Enqueue BullMQ job             │
                            │   5. Return 202 Accepted            │
                            └──────────────┬──────────────────────┘
                                           │ BullMQ Queue (checkout)
                                           ▼
                            ┌─────────────────────────────────────┐
                            │  BullMQ Worker — Payment Saga       │
                            │                                     │
                            │  Step 1: process-payment            │
                            │    → PAYMENT_PROCESSING             │
                            │    → success: enqueue Step 2        │
                            │    → card declined: PAYMENT_FAILED  │
                            │    → gateway error: retry (3x)      │
                            │                                     │
                            │  Step 2: process-billing (ERP)      │
                            │    → BILLING                        │
                            │    → success: CONFIRMED             │
                            │    → 4xx: FAILED (reservation out)  │
                            │    → 5xx: retry (5x, exponential)   │
                            │                                     │
                            │  On exhaustion: reservation out     │
                            └─────────────────────────────────────┘
```

### State Machine

```
                    ┌─► PAYMENT_FAILED  (card declined / gateway exhausted)
                    │
PENDING ──► PAYMENT_PROCESSING ──► BILLING ──► CONFIRMED
                                      │
                                      └─► FAILED  (ERP error, reservation released)

PENDING ──► EXPIRED  (reservation TTL reached before worker ran)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | AdonisJS v6 (API kit) |
| Language | TypeScript 6 |
| Database | SQLite (via better-sqlite3 + Lucid ORM) |
| Cache | Redis 7 (via @adonisjs/redis + ioredis) |
| Queue | BullMQ 5 (backed by Redis) |
| Validation | VineJS |
| IDs | ULID (lexicographically sortable) |
| Timestamps | Luxon DateTime |
| Docs | adonis-autoswagger (OpenAPI 3.0) |
| Metrics | prom-client → Prometheus |
| Traces | @adonisjs/otel (OpenTelemetry → Jaeger) |
| Tests | Japa (built-in AdonisJS test runner) |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Redis 7 running on `localhost:6379`

### Option A — Docker (recommended)

```bash
cd casecellshop-adonis
npm run infra:up        # docker compose up -d
                        # starts Redis · Redis Commander · Prometheus · Jaeger
```

Equivalent to running `docker compose up -d` directly.

### Option B — System Redis

```bash
# Ubuntu/Debian
sudo systemctl start redis
```

### Install & Run

```bash
npm install
node ace migration:run
node ace db:seed
npm run dev             # http://localhost:3333
```

### Reset database

```bash
npm run db:fresh        # rollback + migrate + seed
```

> **⚠️ Important — also flush Redis when resetting the DB.**
> The idempotency cache (TTL 24 h) and the product cache live in Redis.
> If you reset SQLite without flushing Redis, old order IDs remain cached
> and a repeat `Idempotency-Key` returns a 202 referencing an order that
> no longer exists in the database (404 on `GET /orders/:id`).

```bash
docker exec casecellshop-adonis-redis redis-cli FLUSHALL
npm run db:fresh
```

---

## API Endpoints

Interactive docs: **`http://localhost:3333/docs`**  
OpenAPI JSON: `http://localhost:3333/swagger`

### `GET /api/v1/products`

List the product catalogue. Results are cached in Redis for **5 minutes**.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number (1-based). Formula: `offset = (page − 1) × limit` |
| `limit` | number | `50` | Items per page (max 100) |

**Response:**
```json
{
  "data": [
    {
      "id": "01JVPRD000000000000PRDC001",
      "name": "Capinha Silicone Premium iPhone 15",
      "description": "Capinha de silicone macio anti-impacto para iPhone 15",
      "category": "silicone",
      "price": 3990,
      "imageUrl": null,
      "createdAt": "2026-05-23T14:00:00.000+00:00",
      "updatedAt": "2026-05-23T14:00:00.000+00:00"
    }
  ],
  "total": 10,
  "meta": { "fromCache": false, "page": 1, "perPage": 50 }
}
```

---

### `GET /api/v1/products/:id`

Get a single product by ULID.

---

### `POST /api/v1/checkout`

Place an order. Returns **202 Accepted** immediately. The ERP billing happens asynchronously — poll `GET /orders/:id` for the final status.

#### Seed data (copy-paste ready for Swagger "Try it out")

**Customers** — use any of these as `customerId`:

| Name | customerId |
|------|-----------|
| Alice | `01JVMN00000000000000TEST01` |
| Bob | `01JVMN00000000000000TEST02` |
| Charlie | `01JVMN00000000000000TEST03` |

**Products** — use any of these as `productId`:

| Product | productId | Price |
|---------|-----------|-------|
| Capinha Silicone Premium iPhone 15 | `01JVPRD000000000000PRDC001` | R$ 39,90 |
| Capa Couro Genuíno Samsung Galaxy S24 | `01JVPRD000000000000PRDC002` | R$ 129,90 |
| Capinha Crystal Clear iPhone 14 | `01JVPRD000000000000PRDC003` | R$ 29,90 |
| Capa Rugged Militar Motorola Edge 40 | `01JVPRD000000000000PRDC004` | R$ 89,90 |
| Capinha Silicone Xiaomi 13T | `01JVPRD000000000000PRDC005` | R$ 44,90 |

> All products are seeded with **50 units** in stock.

#### Idempotency-Key header (required)

```
Idempotency-Key: <your-unique-string>   # max 255 chars — any format works
```

Generate a fresh value **per purchase attempt**. The same key will always return the same `202` (idempotent replay, no side effects). Keys expire after **24 hours**.

Quick ways to generate a key:
```bash
# Using Node.js
node -e "const {ulid} = require('ulid'); console.log(ulid())"

# Using uuidgen (Linux/Mac)
uuidgen

# Any random string works too:
# "my-test-order-001", "checkout-2026-05-23-001", etc.
```

For Swagger UI "Try it out", just type any unique string — e.g. `test-order-001`. Change it for each new checkout attempt to avoid idempotent replay.

#### Request

```
Idempotency-Key: test-order-001
Content-Type: application/json
```

```json
{
  "customerId": "01JVMN00000000000000TEST01",
  "productId": "01JVPRD000000000000PRDC001",
  "quantity": 1
}
```

**Response `202`:**
```json
{
  "orderId": "01JVSAMPLE00000000ORDERID01",
  "status": "PENDING",
  "message": "Order received. Payment is being processed.",
  "links": { "status": "/orders/01JVSAMPLE00000000ORDERID01" }
}
```

**Error responses:**
- `409 Conflict` — Insufficient stock or request already in progress
- `404 Not Found` — Unknown `productId`
- `422 Unprocessable Entity` — Validation error (missing fields, missing `Idempotency-Key` header)

---

### `GET /api/v1/orders/:id`

Poll the order status after checkout.

**Response `200`:**
```json
{
  "id": "01JVSAMPLE00000000ORDERID01",
  "customerId": "alice",
  "productId": "01JVPRD000000000000PRDC001",
  "productName": "Capinha Silicone Premium iPhone 15",
  "quantity": 2,
  "unitPrice": 3990,
  "totalAmount": 7980,
  "status": "CONFIRMED",
  "erpJobId": "billing-01JVSAMPLE00000000ORDERID01",
  "failureReason": null,
  "idempotencyKey": "my-key-123",
  "createdAt": "2026-05-23T14:00:00.000+00:00",
  "updatedAt": "2026-05-23T14:00:15.000+00:00"
}
```

---

### `GET /health`

```json
{ "status": "ok", "timestamp": "2026-05-23T14:00:00.000Z" }
```

### `GET /metrics`

Prometheus metrics (prom-client format).

### `GET /docs` · `GET /swagger`

Swagger UI / OpenAPI 3.0 JSON.

---

## Business Rules

### Atomic Stock Reservation

Stock is controlled via **reservations** rather than direct decrements. A reservation is created inside a transaction using a single `INSERT … SELECT` that checks availability inline:

```sql
-- Available = physical stock − active (non-released, non-expired) reservations
INSERT INTO stock_reservations (id, order_id, product_id, quantity, expires_at, ...)
SELECT ?, ?, ?, ?, ?, ...
FROM stocks s
WHERE s.product_id = ?
  AND (
    s.quantity - COALESCE(
      (SELECT SUM(r.quantity)
       FROM stock_reservations r
       WHERE r.product_id = s.product_id
         AND r.released_at IS NULL
         AND r.expires_at > ?),
      0
    )
  ) >= ?
```

If available stock is insufficient, the `SELECT` returns 0 rows → 0 rows inserted → the transaction rolls back → `409 Insufficient stock`. Because the check and the insert are a **single SQL statement**, there is no TOCTOU race window.

Reservations are held for **15 minutes** while payment/billing processes. On success, the reservation is released and a permanent stock decrement is applied. On failure or timeout, the reservation is released and the stock returns to the pool.

> **SQLite note**: WAL mode lets readers and writers run concurrently. The single-statement INSERT…SELECT is serialised by SQLite's write lock, giving correct oversell prevention. On PostgreSQL, replace with `SELECT … FOR UPDATE` on `stocks` or `SERIALIZABLE` isolation.

### Idempotency (Stripe pattern)

Every checkout request must include an `Idempotency-Key` header. The service:

1. Checks Redis for a cached response (`SET NX` → 24h TTL)
2. If found → returns the original `202` (no side effects)
3. Acquires an in-flight lock (`SET NX` → 30s TTL) to prevent double-clicks
4. Executes the transaction
5. Stores the response in Redis

### Async ERP Billing — Two-Step Saga

The BullMQ worker runs two sequential job types per checkout:

1. **`process-payment`** — simulates the payment gateway
2. **`process-billing`** — simulates the ERP faturamento call

Configurable via env vars:

| Env Var | Default | Description |
|---------|---------|-------------|
| `ERP_FAILURE_RATE` | `0` | % of ERP billing calls that fail (0–100) |
| `PAYMENT_FAILURE_RATE` | `0` | % of payment gateway calls that fail (0–100) |

Failure behaviour:

| Scenario | Retries | Final status | Reservation |
|----------|---------|-------------|-------------|
| Payment: card declined (4xx) | None | `PAYMENT_FAILED` | Held (customer may retry) |
| Payment: gateway error (5xx) | 3x exponential | `PAYMENT_FAILED` | Released on exhaustion |
| ERP billing: business error (4xx) | None | `FAILED` | Released |
| ERP billing: technical error (5xx) | 5x exponential | `FAILED` | Released on exhaustion |
| All good | — | `CONFIRMED` | Released, stock permanently decremented |

### Recovery Job

A background job runs every **5 minutes** to detect orders stuck in `PENDING` for more than 5 minutes (orphaned if the server crashed after inserting the order but before enqueuing the BullMQ job). It re-enqueues them automatically.

---

## Design Decisions & Trade-offs

### Why AdonisJS?

AdonisJS provides batteries-included DI (via `@inject()`), first-class VineJS validation, Lucid ORM with typed migrations, and a clean separation between controllers/services. This matches the target architecture in `solucao.md` without requiring manual boilerplate.

### Why SQLite?

The challenge requires a simple local setup. SQLite with WAL mode supports concurrent reads and serializes writes — sufficient for demonstrating the atomic stock pattern. In production, swap to PostgreSQL by changing the `connections` block in `config/database.ts` and installing `pg`.

### Why ULID instead of UUID?

ULIDs are lexicographically sortable (the first 10 chars encode milliseconds), meaning `ORDER BY id` is implicitly chronological — no extra `created_at` index needed for most queries. They're also URL-safe and Crockford Base32 encoded (no ambiguous chars).

### Why BullMQ instead of raw setTimeout?

BullMQ persists jobs in Redis, survives process restarts, supports exponential backoff, and provides job visibility (status, retry count). A raw `setTimeout` would lose all pending billing work if the process crashes.

### Idempotency Key: Any String vs. ULID-only

The `Idempotency-Key` header accepts **any string** (1–255 chars) rather than enforcing ULID format. This follows how Stripe, Adyen, and other payment APIs work — clients choose their own key format (UUID, ULID, timestamp, etc.). The uniqueness guarantee is enforced by the Redis NX lock, not by the format.

### Price in Cents

All prices are stored as integers (cents) to avoid floating-point rounding errors in currency calculations. `R$ 39,90` is stored as `3990`.

---

## Monitoring & Observability

Three complementary layers provide full visibility into the system: structured logs, business metrics, and distributed traces.

### Stack overview

```bash
npm run infra:up   # docker compose up -d → Redis + Prometheus + Jaeger + Redis Commander
npm run dev        # start the API server
```

| Tool | URL | Purpose |
|------|-----|---------|
| Prometheus | http://localhost:9090 | Scrapes `/metrics` every 5 s — query counters and histograms here |
| Jaeger | http://localhost:16686 | OTel distributed trace UI — full request span tree |
| Redis Commander | http://localhost:8081 | Browse Redis keys (cache, BullMQ jobs) |

---

### Layer 1 — Structured Logs (pino)

Every log line carries `requestId` (ULID from `X-Request-Id`) and `orderId` where applicable. In development, logs are rendered with color via **pino-pretty**. The `otelLoggingPreset()` helper automatically injects `trace_id` and `span_id` into each line, linking logs directly to their Jaeger trace.

```
[16:30:01.123] INFO (casecellshop): checkout.accepted
  requestId: "01HVXXXXXXXXXXXXXXXXXXXXXX"
  orderId:   "01HVXXXXXXXXXXXXXXXXXXXXXX"
  trace_id:  "dd6005b5e5d28a8a677f9cbf5afd99b0"
  span_id:   "7a6390457ddbb367"
```

In production (`NODE_ENV=production`) logs are emitted as plain JSON to stdout, ready for ingestion into any log aggregator (Loki, Datadog, CloudWatch, etc.).

---

### Layer 2 — Prometheus Metrics (`GET /metrics`)

Business and runtime metrics are exposed in Prometheus text format. Prometheus scrapes this endpoint every 5 seconds and Grafana visualises the time series.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `casecellshop_checkout_total` | Counter | `status` | Checkout outcomes: `accepted`, `stock_unavailable`, `product_not_found`, `idempotent_replay`, `error` |
| `casecellshop_checkout_duration_seconds` | Histogram | — | End-to-end checkout latency (p50 / p95 / p99) |
| `casecellshop_cache_operations_total` | Counter | `result`, `key_type` | Cache hits and misses per key type |
| `casecellshop_queue_depth` | Gauge | `queue` | BullMQ waiting + delayed jobs |
| `casecellshop_jobs_processed_total` | Counter | `queue`, `job_name`, `result` | Worker outcomes: `completed`, `card_declined`, `erp_declined`, `failed` |
| `casecellshop_nodejs_*` | Various | — | Default Node.js metrics (GC, heap, event loop lag) |

#### Querying metrics in Prometheus UI

1. Open **http://localhost:9090**
2. Type any query in the **Expression** box and click **Execute**
3. Switch between **Table** (current value) and **Graph** (time series)

**Key queries:**

```promql
# --- Cache ---

# All hit/miss counters
casecellshop_cache_operations_total

# Only cache misses
casecellshop_cache_operations_total{result="miss"}

# Cache hit rate over the last 5 min (0 = all miss, 1 = all hit)
rate(casecellshop_cache_operations_total{result="hit"}[5m])
  /
rate(casecellshop_cache_operations_total[5m])

# --- Checkout ---

# Checkout outcomes (accepted, stock_unavailable, error, …)
casecellshop_checkout_total

# p95 checkout latency
histogram_quantile(0.95, rate(casecellshop_checkout_duration_seconds_bucket[5m]))

# --- Worker ---

# BullMQ job results (completed, card_declined, erp_declined, failed)
casecellshop_jobs_processed_total
```

> **Quick check without Prometheus:** `curl -s http://localhost:3333/metrics | grep casecellshop_cache` shows the raw counter values instantly.

---

### Layer 3 — OpenTelemetry Traces → Jaeger

Every HTTP request, SQL query, and Redis operation is automatically instrumented by `@adonisjs/otel`. Spans are exported via OTLP HTTP to Jaeger, where you can visualise the full call graph of each request.

#### Setup

```bash
# 1. Start all services (includes Jaeger)
npm run infra:up    # or: docker compose up -d

# 2. .env already has OTEL_EXPORTER_OTLP_ENDPOINT uncommented:
#    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# 3. Start the server
npm run dev
```

#### Viewing traces

1. Open **http://localhost:16686**
2. **Service** → `casecellshop` → **Find Traces**

Each trace shows the complete span tree — HTTP handler → service → SQL queries → Redis calls — with timing on each span. The `trace_id` in every log line matches the trace ID shown in Jaeger, so you can jump from a log entry directly to its full trace.

Example trace for `POST /api/v1/checkout`:

```
POST /api/v1/checkout                                     210 ms
  ├─ CorrelationMiddleware                                  0.1 ms
  ├─ CheckoutController.store                             209 ms
  │    ├─ redis GET  idempotency:<key>                       3 ms
  │    ├─ redis SET NX  idempotency:<key>:lock               2 ms
  │    ├─ INSERT stock_reservations … SELECT               12 ms
  │    ├─ INSERT orders                                      8 ms
  │    ├─ BullMQ enqueue process-payment                     5 ms
  │    └─ redis SET  idempotency:<key> (cache response)      2 ms
  └─ OtelMiddleware (status 202)                            0.1 ms
```

> **Without Jaeger** (no `OTEL_EXPORTER_OTLP_ENDPOINT` set), spans are printed to the terminal via `ConsoleSpanExporter` — no extra setup needed to see OTel output.

---

### Correlation IDs

Every request receives an `X-Request-Id` header (ULID) generated by `CorrelationMiddleware`. This ID is:
- Bound to `ctx.logger` so every log line in that request carries `requestId`
- Included as an attribute on the root OTel span
- Returned to the client in the response headers

The `trace_id` injected by `otelLoggingPreset()` links each log line to its Jaeger trace, making it possible to go from a log entry → full distributed trace in one click.

### Runbook: Stuck Orders

If orders are stuck in `PENDING` indefinitely:

1. **Check BullMQ queue depth**: `GET /metrics` → `casecellshop_queue_depth`
2. **Check Redis connectivity**: `redis-cli ping`
3. **Check worker logs**: grep `orderId` in application logs
4. **Manual recovery**: The recovery worker re-enqueues automatically within 5 min — or trigger immediately by restarting the server process
5. **Escalation**: If Redis is down, orders accumulate in DB as PENDING — the recovery worker will flush them on next Redis reconnect

---

## Testing

```bash
npm test                    # all suites
npm run test:unit           # unit tests only
npm run test:functional     # functional/integration tests only
```

### Test Coverage

**Unit tests** (`tests/unit/`):
- `IdempotencyService`: lock acquisition, concurrent locking, TTL behavior

**Functional tests** (`tests/functional/`):

| Suite | Test |
|-------|------|
| Products | List all, single product, 404 |
| Products | Pagination: page 1 vs page 2 (no overlapping IDs), empty page beyond total |
| Products | Validation: `page=0` → 422, `limit=101` → 422 |
| Products | Redis cache hit on second request |
| Checkout | Happy path 202, stock decrement, 409 insufficient stock |
| Checkout | Idempotent replay (same orderId, no double-decrement) |
| Checkout | 404 unknown product, 422 missing header, 422 invalid body |
| Checkout | **Concurrent oversell prevention** (5 requests, stock=1 → exactly 1 wins) |
| Orders | Status polling, CONFIRMED/FAILED states, failure_reason |
| Orders | Full flow: checkout → order retrieval |

### Key Test: Oversell Prevention

The most important concurrency test sends 5 simultaneous checkout requests for a product with `quantity=1`. Exactly 1 should succeed (202) and 4 should fail (409). The atomic SQL `WHERE quantity >= N` ensures SQLite serializes the writes correctly.

---

## Limitations

1. **SQLite in production** — Not suitable for high concurrency or distributed deployments. Swap to PostgreSQL for production.

2. **Single process** — Worker and HTTP server share the same process. For higher throughput, extract the worker to a separate process/container.

3. **In-memory SQLite for tests** — Tests use the same SQLite file as dev (`tmp/db.sqlite3`). A proper CI setup would use a separate test DB (`:memory:` or separate file path via `DB_PATH` env var).

4. **No real authentication** — The `customerId` field is accepted as any string. In production, this would come from a JWT decoded by an auth middleware.

5. **No rate limiting** — The API has no rate limiting. In production, add `@fastify/rate-limit` or similar at the load balancer level.

6. **Recovery job granularity** — The 5-minute recovery interval means an orphaned order could remain PENDING for up to 10 minutes (5 min threshold + 5 min interval). Acceptable for the challenge; adjust thresholds for production SLAs.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development`, `production`, `test` |
| `PORT` | `3333` | HTTP server port |
| `HOST` | `localhost` | HTTP server host |
| `APP_KEY` | *(required)* | AdonisJS encryption key (generate with `node ace generate:key`) |
| `APP_URL` | `http://localhost:3333` | Public URL |
| `LOG_LEVEL` | `info` | Pino log level |
| `REDIS_HOST` | `127.0.0.1` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *(optional)* | Redis password |
| `SESSION_DRIVER` | `cookie` | AdonisJS session driver |
| `ERP_FAILURE_RATE` | `0` | Simulated ERP failure rate (0–100) |
| `APP_NAME` | `casecellshop` | Service name (used in logs and OTel `service.name`) |
| `APP_VERSION` | `0.0.1` | Service version (used in OTel `service.version`) |
| `APP_ENV` | `development` | Deployment environment (used in OTel `deployment.environment`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(unset)* | OTLP HTTP endpoint for traces — e.g. `http://localhost:4318` for Jaeger |

---

## Project Structure

```
casecellshop-adonis/
├── app/
│   ├── controllers/          # HTTP handlers (thin — delegate to services)
│   │   ├── checkout_controller.ts
│   │   ├── products_controller.ts
│   │   └── orders_controller.ts
│   ├── exceptions/           # Typed exception classes
│   │   ├── handler.ts        # Global exception → HTTP response mapper
│   │   ├── stock_unavailable_exception.ts
│   │   ├── product_not_found_exception.ts
│   │   ├── order_not_found_exception.ts
│   │   └── idempotency_conflict_exception.ts
│   ├── middleware/
│   │   └── correlation_middleware.ts   # X-Request-Id header
│   ├── models/               # Lucid ORM models
│   ├── services/             # Business logic
│   │   ├── checkout_service.ts        # Core checkout orchestration
│   │   ├── idempotency_service.ts     # Redis NX lock + cache
│   │   └── product_service.ts         # Cache-aside + stampede lock
│   └── validators/           # VineJS schemas
├── config/                   # AdonisJS config files
├── database/
│   ├── migrations/           # Lucid migrations
│   └── seeders/
│       └── main_seeder.ts    # 10 products + stocks
├── start/
│   ├── routes.ts             # Route definitions
│   ├── kernel.ts             # Middleware registration
│   ├── bullmq_connection.ts  # Dedicated IORedis connection
│   ├── queue.ts              # BullMQ Queue instance
│   ├── worker.ts             # BullMQ Worker (ERP billing simulation)
│   ├── recovery_worker.ts    # Orphaned order recovery (every 5 min)
│   └── metrics.ts            # prom-client metrics registry
└── tests/
    ├── unit/
    └── functional/
```
