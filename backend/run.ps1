# Backend ni ishga tushirish (Windows PowerShell)
# Oldin: .env yarating, DATABASE_URL va kerak bo'lsa PORT, CORS_ORIGINS o'rnating.
# Birinchi marta: pip install -r requirements.txt
# Eslatma: Har safar start oldidan migratsiya yuritiladi (alembic upgrade head).

$port = if ($env:PORT) { $env:PORT } else { "10000" }
Write-Host "Running DB migrations (alembic upgrade head)..."
alembic upgrade head
if ($LASTEXITCODE -ne 0) {
  Write-Error "Alembic migration failed. Backend start aborted."
  exit $LASTEXITCODE
}
Write-Host "Starting WMS Backend on port $port (http://localhost:$port, docs: /docs)"
uvicorn app.main:app --host 0.0.0.0 --port $port
