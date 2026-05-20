# Mreso Transport Visualizer

Real-time Grenoble transport dashboard — trams, parking, vélos, weather.

## Stack
- **Backend**: Python 3.10 + FastAPI + SQLAlchemy + Alembic
- **Frontend**: React 18 + Vite + MapLibre GL + Recharts
- **DB**: PostgreSQL 14
- **Cache**: Redis 6
- **Scheduler**: APScheduler (background data collection)

## Architecture (concentric circles)
1. 🚊 **Trams** — schedule-interpolated positions animated on map, delay probability, reliability score
2. 🅿️ **Parking** — real-time availability, zone grouping, occupancy over time, congestion detection
3. 🚲 **Vélos** (next phase)
4. 🌩️ **Weather** (final phase)

## Prerequisites Check
```bash
node -v        # need >= 18
npm -v         # need >= 8
python3 --version  # need >= 3.10
redis-cli --version
psql --version
pip3 --version
```

## Setup

### 1. Database
```bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER mreso WITH PASSWORD 'mreso';"
sudo -u postgres psql -c "CREATE DATABASE mreso_db OWNER mreso;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE mreso_db TO mreso;"
```

### 2. Redis
```bash
sudo service redis-server start
```

### 3. Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### 4. Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173

## Running both at once (from project root)
```bash
bash scripts/start.sh
```