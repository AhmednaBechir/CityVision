#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$PROJECT_DIR/backend"
FRONTEND="$PROJECT_DIR/frontend"

echo "═══════════════════════════════════════════════════"
echo "  Grenoble Transport Visualizer — Starting up"
echo "═══════════════════════════════════════════════════"

# Check services
if ! pgrep -x "redis-server" > /dev/null; then
  echo "⚡ Starting Redis..."
  sudo service redis-server start
fi

if ! pg_isready -U mreso -d mreso_db -q 2>/dev/null; then
  echo "⚡ Starting PostgreSQL..."
  sudo service postgresql start
fi

# Backend
echo ""
echo "🚀 Starting Backend (port 8000)..."
cd "$BACKEND"
source venv/bin/activate
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

# Frontend
echo "🚀 Starting Frontend (port 5173)..."
cd "$FRONTEND"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Backend:  http://localhost:8000"
echo "  ✅ Frontend: http://localhost:5173"
echo "  ✅ API docs: http://localhost:8000/docs"
echo "═══════════════════════════════════════════════════"
echo "  Press Ctrl+C to stop all services"
echo ""

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
