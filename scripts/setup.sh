#!/usr/bin/env bash
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "1) PostgreSQL"
sudo service postgresql start
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='mreso'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER mreso WITH PASSWORD 'mreso';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='mreso_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE mreso_db OWNER mreso;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE mreso_db TO mreso;" 2>/dev/null || true

echo "2) Redis"
sudo service redis-server start

echo "3) Python venv"
cd "$DIR/backend"
python3 -m venv venv
source venv/bin/activate
pip install -q -r requirements.txt

echo "4) Frontend"
cd "$DIR/frontend"
npm install --silent
echo "Done. Run: bash scripts/start.sh"