from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import json
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field
from typing import List, Optional

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=15), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------- WebSocket manager ----------
class ConnectionManager:
    def __init__(self):
        self.connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, message: dict):
        data = json.dumps(message)
        dead = []
        for ws in self.connections:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


@api_router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ---------- Models ----------
class LoginInput(BaseModel):
    email: str
    password: str


class ServiceInput(BaseModel):
    name: str
    prefix: str
    description: str = ""
    icon: str = "users"
    active: bool = True
    branch_id: Optional[str] = None


class CounterInput(BaseModel):
    name: str
    service_ids: List[str] = []
    active: bool = True
    branch_id: Optional[str] = None


class PromoItem(BaseModel):
    type: str = "image"
    url: str


class BranchInput(BaseModel):
    name: str
    address: str = ""
    active: bool = True
    ticker_text: str = ""
    promo_media: List[PromoItem] = []


class SettingsInput(BaseModel):
    org_name: str
    tagline: str = ""
    ticker_text: str = ""
    promo_media: List[PromoItem] = []


class TicketInput(BaseModel):
    service_id: str


class CallNextInput(BaseModel):
    counter_id: str
    service_id: str


class TicketActionInput(BaseModel):
    ticket_id: str


# ---------- Auth ----------
@api_router.post("/auth/login")
async def login(body: LoginInput, request: Request):
    email = body.email.strip().lower()
    identifier = f"{request.client.host}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        locked_at = datetime.fromisoformat(attempt["last_at"])
        if datetime.now(timezone.utc) - locked_at < timedelta(minutes=15):
            raise HTTPException(status_code=429, detail="Terlalu banyak percobaan. Coba lagi dalam 15 menit.")
        await db.login_attempts.delete_one({"identifier": identifier})

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_at": now_iso()}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Email atau password salah")

    await db.login_attempts.delete_one({"identifier": identifier})
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    from fastapi.responses import JSONResponse
    resp = JSONResponse({
        "access_token": access,
        "user": {"id": user["id"], "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "admin")},
    })
    resp.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=900, path="/")
    resp.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")
    return resp


@api_router.post("/auth/refresh")
async def refresh_token(request: Request):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(user["id"], user["email"])
        from fastapi.responses import JSONResponse
        resp = JSONResponse({"access_token": access})
        resp.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=900, path="/")
        return resp
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


@api_router.post("/auth/logout")
async def logout():
    from fastapi.responses import JSONResponse
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("access_token", path="/")
    resp.delete_cookie("refresh_token", path="/")
    return resp


@api_router.get("/auth/me")
async def me(request: Request):
    user = await get_current_user(request)
    return user


# ---------- Services ----------
@api_router.get("/services")
async def list_services(branch_id: Optional[str] = None):
    q = {"branch_id": branch_id} if branch_id else {}
    return await db.services.find(q, {"_id": 0}).sort("created_at", 1).to_list(200)


@api_router.post("/services")
async def create_service(body: ServiceInput, request: Request):
    await get_current_user(request)
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["prefix"] = doc["prefix"].strip().upper()[:2]
    doc["created_at"] = now_iso()
    await db.services.insert_one({**doc})
    await manager.broadcast({"type": "update"})
    return doc


@api_router.put("/services/{service_id}")
async def update_service(service_id: str, body: ServiceInput, request: Request):
    await get_current_user(request)
    doc = body.model_dump()
    doc["prefix"] = doc["prefix"].strip().upper()[:2]
    res = await db.services.update_one({"id": service_id}, {"$set": doc})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Layanan tidak ditemukan")
    await manager.broadcast({"type": "update"})
    return {"ok": True}


@api_router.delete("/services/{service_id}")
async def delete_service(service_id: str, request: Request):
    await get_current_user(request)
    await db.services.delete_one({"id": service_id})
    await manager.broadcast({"type": "update"})
    return {"ok": True}


# ---------- Counters (loket) ----------
@api_router.get("/counters")
async def list_counters(branch_id: Optional[str] = None):
    q = {"branch_id": branch_id} if branch_id else {}
    return await db.counters.find(q, {"_id": 0}).sort("created_at", 1).to_list(200)


@api_router.post("/counters")
async def create_counter(body: CounterInput, request: Request):
    await get_current_user(request)
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.counters.insert_one({**doc})
    await manager.broadcast({"type": "update"})
    return doc


@api_router.put("/counters/{counter_id}")
async def update_counter(counter_id: str, body: CounterInput, request: Request):
    await get_current_user(request)
    res = await db.counters.update_one({"id": counter_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Loket tidak ditemukan")
    await manager.broadcast({"type": "update"})
    return {"ok": True}


@api_router.delete("/counters/{counter_id}")
async def delete_counter(counter_id: str, request: Request):
    await get_current_user(request)
    await db.counters.delete_one({"id": counter_id})
    await manager.broadcast({"type": "update"})
    return {"ok": True}


# ---------- Settings ----------
@api_router.get("/settings")
async def get_settings():
    s = await db.settings.find_one({"id": "main"}, {"_id": 0})
    if s and "promo_media" not in s:
        s["promo_media"] = []
    return s or {"id": "main", "org_name": "Antrian Digital", "tagline": "", "ticker_text": "", "promo_media": []}


@api_router.put("/settings")
async def update_settings(body: SettingsInput, request: Request):
    await get_current_user(request)
    await db.settings.update_one({"id": "main"}, {"$set": body.model_dump()}, upsert=True)
    await manager.broadcast({"type": "update"})
    return {"ok": True}


# ---------- Branches (kantor cabang) ----------
@api_router.get("/branches")
async def list_branches():
    return await db.branches.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)


@api_router.post("/branches")
async def create_branch(body: BranchInput, request: Request):
    await get_current_user(request)
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.branches.insert_one({**doc})
    await manager.broadcast({"type": "update"})
    return doc


@api_router.put("/branches/{branch_id}")
async def update_branch(branch_id: str, body: BranchInput, request: Request):
    await get_current_user(request)
    res = await db.branches.update_one({"id": branch_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")
    await manager.broadcast({"type": "update", "branch_id": branch_id})
    return {"ok": True}


@api_router.delete("/branches/{branch_id}")
async def delete_branch(branch_id: str, request: Request):
    await get_current_user(request)
    if await db.branches.count_documents({}) <= 1:
        raise HTTPException(status_code=400, detail="Minimal harus ada satu cabang")
    await db.branches.delete_one({"id": branch_id})
    await db.services.delete_many({"branch_id": branch_id})
    await db.counters.delete_many({"branch_id": branch_id})
    await manager.broadcast({"type": "update"})
    return {"ok": True}


# ---------- Tickets ----------
@api_router.post("/tickets")
async def create_ticket(body: TicketInput):
    service = await db.services.find_one({"id": body.service_id, "active": True}, {"_id": 0})
    if not service:
        raise HTTPException(status_code=404, detail="Layanan tidak ditemukan")
    today = today_str()
    seq_doc = await db.sequences.find_one_and_update(
        {"key": f"{service['id']}:{today}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    number = seq_doc["seq"]
    ticket = {
        "id": str(uuid.uuid4()),
        "number": number,
        "code": f"{service['prefix']}-{number:03d}",
        "service_id": service["id"],
        "service_name": service["name"],
        "prefix": service["prefix"],
        "status": "waiting",
        "counter_id": None,
        "counter_name": None,
        "branch_id": service.get("branch_id"),
        "date": today,
        "created_at": now_iso(),
        "called_at": None,
        "finished_at": None,
    }
    await db.tickets.insert_one({**ticket})
    ahead = await db.tickets.count_documents({"date": today, "service_id": service["id"], "status": "waiting", "created_at": {"$lt": ticket["created_at"]}})
    await manager.broadcast({"type": "update", "branch_id": service.get("branch_id")})
    return {**ticket, "waiting_ahead": ahead}


@api_router.get("/queue/state")
async def queue_state(branch_id: Optional[str] = None):
    today = today_str()
    bq = {"branch_id": branch_id} if branch_id else {}
    services = await db.services.find({"active": True, **bq}, {"_id": 0}).sort("created_at", 1).to_list(200)
    counters = await db.counters.find({"active": True, **bq}, {"_id": 0}).sort("created_at", 1).to_list(200)
    serving = await db.tickets.find({"date": today, "status": "serving", **bq}, {"_id": 0}).sort("called_at", -1).to_list(50)
    waiting = await db.tickets.find({"date": today, "status": "waiting", **bq}, {"_id": 0}).sort("created_at", 1).to_list(200)
    skipped = await db.tickets.find({"date": today, "status": "skipped", **bq}, {"_id": 0}).sort("called_at", -1).to_list(10)
    for s in services:
        s["waiting_count"] = sum(1 for t in waiting if t["service_id"] == s["id"])
    g = await db.settings.find_one({"id": "main"}, {"_id": 0}) or {"org_name": "Antrian Digital", "tagline": "", "ticker_text": "", "promo_media": []}
    branch = await db.branches.find_one({"id": branch_id}, {"_id": 0}) if branch_id else None
    settings = {
        "org_name": g.get("org_name", ""),
        "tagline": g.get("tagline", ""),
        "ticker_text": (branch or {}).get("ticker_text") or g.get("ticker_text", ""),
        "promo_media": (branch or {}).get("promo_media") or g.get("promo_media", []),
        "branch_name": (branch or {}).get("name", ""),
    }
    return {"services": services, "counters": counters, "serving": serving, "waiting": waiting, "skipped": skipped, "settings": settings}


@api_router.post("/queue/call-next")
async def call_next(body: CallNextInput, request: Request):
    await get_current_user(request)
    counter = await db.counters.find_one({"id": body.counter_id}, {"_id": 0})
    if not counter:
        raise HTTPException(status_code=404, detail="Loket tidak ditemukan")
    today = today_str()
    await db.tickets.update_many(
        {"date": today, "counter_id": body.counter_id, "status": "serving"},
        {"$set": {"status": "done", "finished_at": now_iso()}},
    )
    ticket = await db.tickets.find_one_and_update(
        {"date": today, "service_id": body.service_id, "status": "waiting"},
        {"$set": {"status": "serving", "counter_id": counter["id"], "counter_name": counter["name"], "called_at": now_iso()}},
        sort=[("created_at", 1)],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not ticket:
        await manager.broadcast({"type": "update", "branch_id": counter.get("branch_id")})
        raise HTTPException(status_code=404, detail="Tidak ada antrian menunggu untuk layanan ini")
    await manager.broadcast({"type": "call", "ticket": ticket, "branch_id": ticket.get("branch_id")})
    return ticket


@api_router.post("/queue/recall")
async def recall(body: TicketActionInput, request: Request):
    await get_current_user(request)
    ticket = await db.tickets.find_one({"id": body.ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    await manager.broadcast({"type": "call", "ticket": ticket, "branch_id": ticket.get("branch_id")})
    return ticket


@api_router.post("/queue/skip")
async def skip(body: TicketActionInput, request: Request):
    await get_current_user(request)
    ticket = await db.tickets.find_one_and_update(
        {"id": body.ticket_id},
        {"$set": {"status": "skipped", "finished_at": now_iso()}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    await manager.broadcast({"type": "update", "branch_id": ticket.get("branch_id")})
    return {"ok": True}


@api_router.post("/queue/complete")
async def complete(body: TicketActionInput, request: Request):
    await get_current_user(request)
    ticket = await db.tickets.find_one_and_update(
        {"id": body.ticket_id},
        {"$set": {"status": "done", "finished_at": now_iso()}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    await manager.broadcast({"type": "update", "branch_id": ticket.get("branch_id")})
    return {"ok": True}


@api_router.post("/queue/reset")
async def reset_queue(request: Request, branch_id: Optional[str] = None):
    await get_current_user(request)
    today = today_str()
    bq = {"branch_id": branch_id} if branch_id else {}
    if branch_id:
        svc_ids = [s["id"] for s in await db.services.find({"branch_id": branch_id}, {"_id": 0, "id": 1}).to_list(200)]
        await db.sequences.delete_many({"key": {"$in": [f"{sid}:{today}" for sid in svc_ids]}})
    else:
        await db.sequences.delete_many({"key": {"$regex": f":{today}$"}})
    await db.tickets.delete_many({"date": today, **bq})
    await manager.broadcast({"type": "update", "branch_id": branch_id})
    return {"ok": True}


# ---------- Stats ----------
@api_router.get("/stats")
async def stats(request: Request, branch_id: Optional[str] = None):
    await get_current_user(request)
    today = today_str()
    bq = {"branch_id": branch_id} if branch_id else {}
    tickets = await db.tickets.find({"date": today, **bq}, {"_id": 0}).to_list(5000)
    total = len(tickets)
    waiting = sum(1 for t in tickets if t["status"] == "waiting")
    serving = sum(1 for t in tickets if t["status"] == "serving")
    done = sum(1 for t in tickets if t["status"] == "done")
    skipped = sum(1 for t in tickets if t["status"] == "skipped")
    wait_times = []
    for t in tickets:
        if t.get("called_at") and t.get("created_at"):
            delta = (datetime.fromisoformat(t["called_at"]) - datetime.fromisoformat(t["created_at"])).total_seconds()
            wait_times.append(delta)
    avg_wait_min = round(sum(wait_times) / len(wait_times) / 60, 1) if wait_times else 0
    services = await db.services.find(bq, {"_id": 0}).to_list(200)
    per_service = []
    for s in services:
        st = [t for t in tickets if t["service_id"] == s["id"]]
        per_service.append({"name": s["name"], "prefix": s["prefix"], "total": len(st), "waiting": sum(1 for t in st if t["status"] == "waiting"), "done": sum(1 for t in st if t["status"] == "done")})
    return {"total": total, "waiting": waiting, "serving": serving, "done": done, "skipped": skipped, "avg_wait_min": avg_wait_min, "per_service": per_service}


@api_router.get("/stats/overview")
async def stats_overview(request: Request):
    await get_current_user(request)
    today = today_str()
    branches = await db.branches.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)
    tickets = await db.tickets.find({"date": today}, {"_id": 0, "branch_id": 1, "status": 1}).to_list(10000)
    result = []
    for b in branches:
        bt = [t for t in tickets if t.get("branch_id") == b["id"]]
        result.append({
            "id": b["id"], "name": b["name"], "active": b.get("active", True),
            "total": len(bt),
            "waiting": sum(1 for t in bt if t["status"] == "waiting"),
            "serving": sum(1 for t in bt if t["status"] == "serving"),
            "done": sum(1 for t in bt if t["status"] == "done"),
        })
    return {"branches": result}


# ---------- Seeding ----------
async def seed():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@antrian.id").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Administrator", "role": "admin", "created_at": now_iso(),
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    if await db.services.count_documents({}) == 0:
        base = now_iso()
        await db.services.insert_many([
            {"id": str(uuid.uuid4()), "name": "Teller", "prefix": "A", "description": "Setor, tarik tunai & transaksi umum", "icon": "banknote", "active": True, "created_at": base},
            {"id": str(uuid.uuid4()), "name": "Customer Service", "prefix": "B", "description": "Pembukaan rekening, informasi & keluhan", "icon": "users", "active": True, "created_at": base + "a"},
            {"id": str(uuid.uuid4()), "name": "Prioritas", "prefix": "C", "description": "Nasabah prioritas, lansia & difabel", "icon": "star", "active": True, "created_at": base + "b"},
        ])
    if await db.counters.count_documents({}) == 0:
        base = now_iso()
        await db.counters.insert_many([
            {"id": str(uuid.uuid4()), "name": "Loket 1", "service_ids": [], "active": True, "created_at": base},
            {"id": str(uuid.uuid4()), "name": "Loket 2", "service_ids": [], "active": True, "created_at": base + "a"},
            {"id": str(uuid.uuid4()), "name": "Loket 3", "service_ids": [], "active": True, "created_at": base + "b"},
        ])
    if await db.settings.find_one({"id": "main"}) is None:
        await db.settings.insert_one({
            "id": "main", "org_name": "QueueFlow",
            "tagline": "Sistem Antrian Digital",
            "ticker_text": "Selamat datang. Mohon menunggu nomor antrian Anda dipanggil. Siapkan dokumen yang diperlukan agar pelayanan lebih cepat. Terima kasih.",
            "promo_media": [],
        })
    await db.settings.update_one(
        {"id": "main", "promo_media": {"$exists": False}},
        {"$set": {"promo_media": [
            {"type": "image", "url": "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"},
            {"type": "image", "url": "https://images.unsplash.com/photo-1521791136064-7986c2920216?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"},
            {"type": "image", "url": "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"},
        ]}},
    )

    if await db.branches.count_documents({}) == 0:
        g = await db.settings.find_one({"id": "main"}) or {}
        await db.branches.insert_one({
            "id": str(uuid.uuid4()), "name": "Kantor Pusat", "address": "",
            "active": True,
            "ticker_text": g.get("ticker_text", ""),
            "promo_media": g.get("promo_media", []),
            "created_at": now_iso(),
        })
    first_branch = await db.branches.find_one({}, {"_id": 0}, sort=[("created_at", 1)])
    if first_branch:
        orphan_q = {"$or": [{"branch_id": {"$exists": False}}, {"branch_id": None}]}
        await db.services.update_many(orphan_q, {"$set": {"branch_id": first_branch["id"]}})
        await db.counters.update_many(orphan_q, {"$set": {"branch_id": first_branch["id"]}})
        await db.tickets.update_many(orphan_q, {"$set": {"branch_id": first_branch["id"]}})

    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.tickets.create_index([("date", 1), ("status", 1), ("branch_id", 1)])
    await db.tickets.create_index("id")


@app.on_event("startup")
async def on_startup():
    await seed()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
