#!/usr/bin/env bash
# One-shot setup for Mreso Transport Visualizer on WSL/Ubuntu
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "📦 Setting up Mreso Transport Visualizer in $PROJECT_DIR"

# ── 1. PostgreSQL ────────────────────────────────────────────────────────────
echo ""
echo "1️⃣  Setting up PostgreSQL..."
sudo service postgresql start
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='mreso'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER mreso WITH PASSWORD 'mreso';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='mreso_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE mreso_db OWNER mreso;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE mreso_db TO mreso;" 2>/dev/null || true
echo "   ✅ PostgreSQL ready (user: mreso, db: mreso_db)"

# ── 2. Redis ─────────────────────────────────────────────────────────────────
echo ""
echo "2️⃣  Starting Redis..."
sudo service redis-server start
echo "   ✅ Redis running"

# ── 3. Python venv + deps ────────────────────────────────────────────────────
echo ""
echo "3️⃣  Installing Python dependencies..."
cd "$PROJECT_DIR/backend"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo "   ✅ Python env ready"

# Copy .env if needed
[ -f .env ] || cp .env.example .env && echo "   📄 .env created from template"

# ── 4. DB migrations ─────────────────────────────────────────────────────────
echo ""
echo "4️⃣  Running Alembic migrations..."
# Tables are auto-created by SQLAlchemy on startup, but run alembic for future migrations
alembic upgrade head 2>/dev/null || echo "   ℹ️  No pending migrations (tables will be created on first run)"

# ── 5. Frontend ───────────────────────────────────────────────────────────────
echo ""
echo "5️⃣  Installing frontend dependencies..."
cd "$PROJECT_DIR/frontend"
npm install --silent
[ -f .env ] || cp .env.example .env && echo "   📄 .env created from template"
echo "   ✅ npm packages installed"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo ""
echo "  To start everything:"
echo "    bash $PROJECT_DIR/scripts/start.sh"
echo ""
echo "  Or manually:"
echo "    cd backend && source venv/bin/activate && uvicorn app.main:app --reload"
echo "    cd frontend && npm run dev"
echo "═══════════════════════════════════════════════════"
