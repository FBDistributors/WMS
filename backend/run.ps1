# Backend ni ishga tushirish (Windows PowerShell)
# Oldin: .env yarating, DATABASE_URL va kerak bo'lsa PORT, CORS_ORIGINS o'rnating.
# Birinchi marta: pip install -r requirements.txt; alembic upgrade head

$port = if ($env:PORT) { $env:PORT } else { "10000" }
Write-Host "Starting WMS Backend on port $port (http://localhost:$port, docs: /docs)"
uvicorn app.main:app --host 0.0.0.0 --port $port
