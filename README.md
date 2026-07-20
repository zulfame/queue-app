# QueueFlow — Digital Queue Management System

A full-stack digital queue/antrian management system.

- **Backend:** FastAPI (`backend/server.py`, exposes `server:app`) — all routes are prefixed with `/api`.
- **Frontend:** React (CRACO), served as a static build.
- **Database:** MongoDB.

## Running

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001
```

**Frontend**
```bash
cd frontend
yarn install
yarn build
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required/Optional | Default Value | Description |
| --- | --- | --- | --- |
| `MONGO_URL` | Optional | `mongodb://localhost:27017` | MongoDB connection string. |
| `DB_NAME` | Optional | `test_database` | MongoDB database name. |
| `JWT_SECRET` | Required | `change-me-in-production` | Secret used to sign JWT auth tokens. Set a strong value in production. |
| `ADMIN_EMAIL` | Optional | `admin@antrian.id` | Email of the admin account seeded on startup. |
| `ADMIN_PASSWORD` | Optional | `admin123` | Password of the admin account seeded on startup. |
| `CORS_ORIGINS` | Optional | `*` | Comma-separated list of allowed CORS origins. |
| `LOCAL_STORAGE_DIR` | Optional | `/app/data` | Directory used for any files that must persist. |

### Frontend (`frontend/.env`)

| Variable | Required/Optional | Default Value | Description |
| --- | --- | --- | --- |
| `REACT_APP_BACKEND_URL` | Required | - | Base URL of the backend. The frontend calls `${REACT_APP_BACKEND_URL}/api`. |

## Default Admin

On startup the backend idempotently seeds an admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (password stored hashed with bcrypt).
