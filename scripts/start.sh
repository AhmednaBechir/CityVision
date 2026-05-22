#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "════════════════════════════════════════"
echo "  Grenoble Transport Visualizer"
echo "════════════════════════════════════════"

pgrep -x "redis-server" > /dev/null || sudo service redis-server start
pg_isready -h localhost -U mreso -d mreso_db -q 2>/dev/null || sudo service postgresql start

cd "$PROJECT_DIR/backend"
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

cd "$PROJECT_DIR/frontend"
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

echo "  ✅ Backend:  http://localhost:8000"
echo "  ✅ Frontend: http://localhost:5173"
echo "  ✅ API docs: http://localhost:8000/docs"
echo "  Ctrl+C to stop"
echo ""

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait