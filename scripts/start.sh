#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

pgrep -x redis-server > /dev/null || sudo service redis-server start
pg_isready -h localhost -U mreso -d mreso_db -q || sudo service postgresql start

cd "$DIR/backend"
source venv/bin/activate
uvicorn app.main:app --reload --port 8000 &
B=$!

cd "$DIR/frontend"
npm run dev &
F=$!

echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo "Docs:     http://localhost:8000/docs"
trap "kill $B $F 2>/dev/null" INT TERM
wait