# SmartUp Sync Background Worker

Runs as a **separate Render Background Worker** service. Periodically syncs products and orders from SmartUp ERP into PostgreSQL.

## Run locally

```bash
cd backend
pip install -r requirements.txt

# Run migrations first
alembic upgrade head

# Set env vars, then:
python worker.py
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection URL (same as web) |
| `SMARTUP_BASE_URL` | Yes | - | SmartUp API base URL (e.g. `https://smartup.online/...`) |
| `SMARTUP_BASIC_USER` | Yes | - | Basic auth username |
| `SMARTUP_BASIC_PASS` | Yes | - | Basic auth password |
| `SMARTUP_PROJECT_CODE` | No | `trade` | Project code for orders |
| `SMARTUP_FILIAL_ID` | No | - | Filial ID for orders |
| `SMARTUP_INVENTORY_EXPORT_URL` | No | (built-in) | Override inventory export URL |
| `SYNC_INTERVAL_SECONDS` | No | `600` | Seconds between sync runs (60–86400). Higher = less DB load on web. |
| `SYNC_ORDERS_DAYS_BACK` | No | `7` | Days of orders to fetch (1–90) |

## Render deployment

1. Create a **Background Worker** (not Web Service).
2. Connect the same repo; use `backend/` as root or set `Root Directory` to `backend`.
3. **Build command**: `pip install -r requirements.txt`
4. **Start command**: `python worker.py`
5. Add env vars from the table above.
6. Use the same `DATABASE_URL` as the web service (or a PostgreSQL addon).

Or use `render.worker.yaml` as a blueprint.

## Idempotency

- Products: `(external_source, external_id)` unique → upsert
- Orders: `source_external_id` unique → create or update
- Sync can be run repeatedly; duplicates are skipped/updated.

## Logging

Structured logs to stdout: start, products synced, orders synced, duration, errors.

## Database

Sync runs are stored in `smartup_sync_runs` with `run_type='full'`:

- `status`: SUCCESS, FAILED, PARTIAL
- `synced_products_count`, `synced_orders_count`
- `started_at`, `finished_at`, `error_message`
