#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "📦 Setting up Mreso Transport Visualizer in $PROJECT_DIR"

echo ""
echo "1️⃣  Setting up PostgreSQL..."
sudo service postgresql start
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='mreso'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER mreso WITH PASSWORD 'mreso';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='mreso_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE mreso_db OWNER mreso;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE mreso_db TO mreso;" 2>/dev/null || true
echo "   ✅ PostgreSQL ready (user: mreso, db: mreso_db)"

echo ""
echo "2️⃣  Starting Redis..."
sudo service redis-server start
echo "   ✅ Redis running"

echo ""
echo "3️⃣  Installing Python dependencies..."
cd "$PROJECT_DIR/backend"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
[ -f .env ] || cp .env.example .env
echo "   ✅ Python env ready"

echo ""
echo "4️⃣  Installing frontend dependencies..."
cd "$PROJECT_DIR/frontend"
npm install --silent
[ -f .env ] || cp .env.example .env
echo "   ✅ npm packages installed"

echo ""
echo "════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo "  Run: bash $PROJECT_DIR/scripts/start.sh"
echo "════════════════════════════════════════"