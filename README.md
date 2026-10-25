# Warehouse & Procurement ERP

A working procurement and warehouse system: suppliers, items and stock, requisitions,
purchase orders, goods receipts, a stock ledger, reorder alerts, a procurement dashboard and
an audit trail. FastAPI + PostgreSQL on the back end, React + TypeScript on the front end.

## What is built

| Area | Status | Notes |
| --- | --- | --- |
| Supplier management | Done | CRUD, contact details, lead time, payment terms, active flag, open-order totals |
| Items and SKUs | Done | Category, unit of measure, reorder point and quantity, unit cost, preferred supplier |
| Warehouses and stock | Done | Per-warehouse on-hand, append-only movement ledger with running balance |
| Requisitions | Done | Draft → submitted → approved / rejected → converted to a purchase order |
| Purchase orders | Done | Draft → submitted → approved → sent → partially received → received, plus cancelled |
| Goods receipts | Done | Partial and full receipts, over-receipt refused, one transaction (see below) |
| Stock adjustments and issues | Done | Ledger types RECEIPT, ADJUSTMENT, ISSUE; issues cannot take stock below zero |
| Reorder alerts | Done | At or below reorder point, suggested quantity net of stock on order |
| Dashboard | Done | Open PO value, awaiting approval, low stock, receipts this week, spend by supplier |
| Audit trail | Done | Actor, action, summary, before and after, for every mutating call |
| Auth and roles | Done | JWT bearer tokens, bcrypt passwords, permission checks on each endpoint |

## The receiving transaction

`POST /api/goods-receipts` runs as one database transaction (`backend/app/services/receiving.py`):

1. Lock the purchase order row (`SELECT … FOR UPDATE`). Every receipt against one order is serialised here.
2. Lock the PO lines and re-check each requested quantity against what is still outstanding.
3. Insert the goods receipt and its lines, advance each line's `received_qty`.
4. Write one ledger row per line and update `stock_levels` (rows locked in item order).
5. Set the PO to `partially_received` or `received`, and write the audit entries.
6. Commit. On any exception the whole unit rolls back: no receipt, no stock change, no ledger row.

The test suite proves three things against real PostgreSQL: a forced failure mid-receipt leaves
no partial state, over-receipt is refused, and eight concurrent receipts against a line ordered
for 10 units post exactly 10 units.

## Run it with Docker

Requires Docker with Compose v2.

```bash
cp .env.example .env          # optional; defaults work for a local demo
docker compose up --build
```

Open http://localhost:5200. The first start creates the schema and loads demo data
(`SEED_DEMO=true`). The API is internal to the compose network; nginx proxies `/api`.

Stop with `docker compose down`. Remove the database volume as well with `docker compose down -v`.

## Run it locally (development)

You need Python 3.11+, Node 20+ and a PostgreSQL 14+ server you can reach.

```bash
# 1. Database
createdb warehouse_erp
createdb warehouse_erp_test        # used by the test suite only

# 2. API on port 8200
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+psycopg://localhost:5432/warehouse_erp
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8200 --reload
# Tables are created and demo data is seeded on first start.

# 3. Web app on port 5200 (proxies /api to 8200)
cd ../frontend
npm ci
npm run dev
```

Open http://localhost:5200.

### Tests

```bash
cd backend
TEST_DATABASE_URL=postgresql+psycopg://localhost:5432/warehouse_erp_test ./.venv/bin/python -m pytest -q
```

The suite drops and recreates the schema of the test database. It never touches `warehouse_erp`.

### Frontend checks

```bash
cd frontend
npm run typecheck     # TypeScript, strict mode
npm run build         # typecheck + production bundle to dist/
```

## Demo accounts

These accounts are fictional and exist for evaluation only. Change or remove them before any real use
(`backend/app/seed.py`).

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@erp.test | admin1234 |
| Buyer | buyer@erp.test | buyer1234 |
| Warehouse clerk | clerk@erp.test | clerk1234 |

## Role matrix

Enforced in the API (`backend/app/security.py`). The UI hides actions a role cannot take,
but the server is the authority.

| Permission | Admin | Buyer | Warehouse clerk |
| --- | :---: | :---: | :---: |
| View suppliers, items, stock, orders, receipts, alerts, dashboard | ✔ | ✔ | ✔ |
| Create and edit suppliers | ✔ | ✔ | |
| Create and edit items | ✔ | ✔ | |
| Create and edit warehouses | ✔ | | |
| Post stock adjustments and issues | ✔ | | ✔ |
| Create, edit and submit requisitions | ✔ | ✔ | ✔ |
| Approve, reject and convert requisitions | ✔ | ✔ | |
| Create, edit, submit, recall, send and cancel purchase orders | ✔ | ✔ | |
| Approve purchase orders | ✔ | | |
| Post goods receipts | ✔ | | ✔ |
| Read the audit log | ✔ | ✔ | |

Purchase orders need an admin to approve them. Buyers prepare and send them.

## Project layout

```
backend/
  app/
    main.py          FastAPI app, error mapping, router registration
    models.py        SQLAlchemy models and constraints (non-negative stock, received ≤ ordered)
    schemas.py       Pydantic request models with validation
    views.py         ORM → response shaping
    security.py      Password hashing, JWT, role → permission map
    deps.py          Current user and permission dependency
    services/
      receiving.py   Goods receipt transaction (locks, rollback, audit)
      stock.py       Ledger writes with row locks and balance checks
      procurement.py Requisition and PO state machines
      audit.py       Audit entry helper
    routers/         One module per area
    seed.py          Demo data, idempotent
  tests/             pytest suite against real PostgreSQL
frontend/
  src/pages/         One module per area (list, detail and form pages)
  src/components/    Layout, shared UI, line editor
  src/lib/           API client, auth context, types, formatters
  nginx.conf         Static SPA + /api proxy for the container
docker-compose.yml   db, api, web
.env.example         Configuration reference
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg://localhost:5432/warehouse_erp` | API database |
| `JWT_SECRET` | dev value | Signing key. Set a long random value outside local use |
| `JWT_TTL_MINUTES` | `480` | Token lifetime |
| `SEED_DEMO` | `true` | Load demo users and data when the database has no users |
| `CORS_ORIGINS` | `http://localhost:5200,…` | Browser origins allowed to call the API directly |
| `WEB_PORT` | `5200` | Host port for the web container |

## Known limitations

- The schema is created with `create_all` on startup. There are no Alembic migrations yet, so
  schema changes after the first release will need a migration tool.
- There is no password reset, user administration screen, or SSO. Users are created by the seed.
- Money is stored as `NUMERIC(12,2)` and reported as floats in JSON. Totals are computed in
  Decimal on the server. Multi-currency is not supported.
- Authentication tokens are stored in `localStorage`. Fine for an internal tool, but a
  hardened deployment would move them to HttpOnly cookies.
- Reorder suggestions are per item across all warehouses, not per warehouse.
