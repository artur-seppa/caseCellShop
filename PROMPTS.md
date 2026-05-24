# AI Prompts Used During Development

This file documents the AI-assisted development process for the CaseCellShop challenge.

> **Tool**: Claude Sonnet 4.6 via Claude Code CLI / VSCode extension  
> **Context**: TOTVS Backend Technical Challenge

---

## Phase 1 — Project Inception

### Prompt 1 — Architecture Review (Fastify)
> "olhando o projeto, eu gostaria que tivesse algo mais no sentido de adonis, acho a arquitetura muito mais apresentavel. Nao precisamos trocar o fastify por ele, mas vamos deixar algo mais aparentado, com validations, exceptions..."

**What was generated:**
- Exception class hierarchy (`HttpException` → `NotFoundException`, `ConflictException`, `UnprocessableEntityException`)
- `BaseController` with typed response helpers (`ok()`, `created()`, `accepted()`)
- AJV `setSchemaErrorFormatter` for structured validation errors matching VineJS output format
- Controller classes with AdonisJS naming conventions (`index`, `show`, `store`)

---

### Prompt 2 — Switch to AdonisJS
> "Cara estou desenvolvendo esse app para um case do totvs, mas penso se nao seria bom eu utilizar mesmo adonis pois ele facilita muita coisa e permite desenvolver mais rapido... Podemos criar o adonis em outro diretorio separado e vamos utilizar as skills e claude.md para entregar isso, vendo a docs e boas praticas de adonis"

**What was generated:**
- New AdonisJS v6 project in `casecellshop-adonis/`
- Full architecture based on `solucao.md`:
  - Lucid migrations for `products`, `stocks`, `orders`
  - `CheckoutService`, `ProductService`, `IdempotencyService`
  - BullMQ worker with `app.getEnvironment() === 'web'` guard
  - Dedicated IORedis connection (`bullmq_connection.ts`) with `maxRetriesPerRequest: null`
  - adonis-autoswagger configuration
  - prom-client metrics

---

## Phase 2 — Debugging Critical Issues

### Prompt 3 — BullMQ Redis Connection Error
```
BullMQ: Your redis options maxRetriesPerRequest must be null
```
**Resolution prompted by:** Error message at runtime + Claude analysis  
**Fix**: Created separate `start/bullmq_connection.ts` using raw `ioredis.Redis` instead of AdonisJS Redis service. The `@adonisjs/redis` service doesn't expose `maxRetriesPerRequest: null` which is required by BullMQ's blocking commands (`BRPOPLPUSH`, `BLPOP`).

---

### Prompt 4 — Worker Crashing During db:seed
```
Worker running during db:seed context, failing because HTTP bindings unavailable
```
**Resolution**: Changed worker guard from `if (!app.inTest)` to `if (app.getEnvironment() === 'web')` — this ensures the worker only starts in the HTTP server context, not during migrations, seeds, or tests.

---

### Prompt 5 — IORedis Import Error
```
'typeof import("ioredis")' has no construct signatures
```
**Fix**: Changed from default import `import IORedis from 'ioredis'` to named import `import { Redis } from 'ioredis'`. The `ioredis` package's default export is not a constructor in ESM — use the named `Redis` class.

---

### Prompt 6 — AdonisJS Secret Type
```
Type 'Secret<string>' is not assignable to type 'string | undefined'
```
**Fix**: AdonisJS wraps sensitive env vars in a `Secret<T>` container. Must call `.release()` to extract the raw string: `rawPassword ? rawPassword.release() : undefined`.

---

### Prompt 7 — Header Validation Failure
```
The idempotency-key field must be defined (422 on all checkout requests)
```
**Root cause**: `request.validateUsing()` validates body + params + query only. Headers are NOT included.  
**Fix**: Headers must be validated separately:
```typescript
const headers = await checkoutHeaderValidator.validate(request.headers())
const body    = await request.validateUsing(checkoutValidator)
```

---

### Prompt 8 — Timestamps Returned as null
```json
{ "createdAt": null, "updatedAt": null }
```
**Root cause**: `new Date().toISOString()` produces ISO 8601 with Z suffix (`2026-05-23T14:45:43.699Z`). Lucid's SQLite adapter expects SQL format without timezone (`2026-05-23 14:45:43.699`).  
**Fix**: Use Luxon: `DateTime.now().toSQL({ includeOffset: false })` everywhere timestamps are manually written.

---

### Prompt 9 — BullMQ v5 jobId Colon Error
```
Custom Id cannot contain :
```
**Fix**: Changed `billing:${orderId}` to `billing-${orderId}`. BullMQ v5 reserves `:` in job IDs for internal key namespacing.

---

## Phase 3 — Tests & Polish

### Prompt 10 — Seeder Customer IDs with Invalid ULID Chars
Tests failing with 422 because the hardcoded `CUSTOMER_ID = '01JVMN0000000000000CUSTOMER1'` contains `U` and `O` — both excluded from the Crockford Base32 alphabet used in ULIDs (`0-9`, `A-H`, `J`, `K`, `M`, `N`, `P-T`, `V-Z`).

**Fix**: Changed to `'01JVMN000000000000000TEST01'` (valid Crockford chars only) and relaxed the `customerId` validator to accept any non-empty string (not ULID-only) since customer IDs come from external auth systems.

---

### Prompt 11 — Redis Cache Leaking Between Tests
Products test returning 0 items despite seeding — because `truncateTables()` cleared the DB but not Redis. The products list cache key persisted from a prior test.

**Fix**: Added Redis key flushing (`products:*`, `lock:*`, `idem:*`) to `truncateTables()` in the test helper.

---

### Prompt 12 — Recovery Worker
> Implementing the recovery job mentioned in `solucao.md` — re-enqueue orphaned PENDING orders every 5 minutes.

**What was generated**: `start/recovery_worker.ts` that:
- Runs every 5 minutes via `setInterval`
- Runs once on startup via `setImmediate` (handles crash-recovery gap)
- Queries `orders WHERE status='PENDING' AND created_at < NOW() - 5min`
- Checks BullMQ for existing active jobs before re-enqueuing
- Only active in `web` environment

---

## Key Architectural Decisions (AI-assisted analysis)

| Decision | Rationale surfaced via AI |
|----------|--------------------------|
| ULID over UUID | Lexicographic sort = implicit chronological order |
| Atomic SQL `WHERE quantity >= N` | Database-level serialization avoids app-level locks |
| Redis NX for idempotency | Stripe pattern — atomic check-and-set prevents TOCTOU |
| BullMQ exponential backoff | ERP 5xx errors are transient; exponential prevents thundering herd |
| `app.getEnvironment() === 'web'` guard | Prevents worker/scheduler from running during migrations/tests/CLI commands |
| Price in cents (integer) | Avoids IEEE 754 floating-point rounding in financial calculations |
| Separate IORedis connection for BullMQ | BullMQ requires `maxRetriesPerRequest: null`; incompatible with AdonisJS Redis service semantics |
