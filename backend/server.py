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


async def require_admin(request: Request) -> dict:
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Hanya admin yang dapat melakukan aksi ini")
    return user


def ensure_branch_access(user: dict, branch_id: Optional[str]):
    if user.get("role") == "operator" and user.get("branch_id") and branch_id and user["branch_id"] != branch_id:
        raise HTTPException(status_code=403, detail="Anda tidak memiliki akses ke antrian cabang ini")


async def log_call(action: str, ticket: dict, user: dict):
    branch = await db.branches.find_one({"id": ticket.get("branch_id")}, {"_id": 0, "name": 1})
    await db.call_logs.insert_one({
        "id": str(uuid.uuid4()),
        "at": now_iso(),
        "date": today_str(),
        "action": action,
        "ticket_id": ticket["id"],
        "ticket_code": ticket["code"],
        "service_name": ticket.get("service_name"),
        "counter_name": ticket.get("counter_name"),
        "branch_id": ticket.get("branch_id"),
        "branch_name": (branch or {}).get("name", ""),
        "operator_id": user["id"],
        "operator_name": user.get("name", user.get("email", "")),
    })


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
    printer_name: str = ""
    print_header: str = ""
    print_footer: str = ""


class SettingsInput(BaseModel):
    org_name: str
    tagline: str = ""
    ticker_text: str = ""
    promo_media: List[PromoItem] = []
    primary_color: str = "#4f46e5"
    logo_url: str = ""
    footer_text: str = ""


class SurveyInput(BaseModel):
    ticket_id: str
    rating: int = 0
    feedback: str = ""
    photo: str = ""


class RestoreInput(BaseModel):
    data: dict


class UserInput(BaseModel):
    name: str
    email: str
    password: Optional[str] = None
    role: str = "operator"
    branch_id: Optional[str] = None


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
        "user": {"id": user["id"], "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "admin"), "branch_id": user.get("branch_id")},
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


# ---------- Users (kelola pengguna) ----------
@api_router.get("/users")
async def list_users(request: Request):
    await require_admin(request)
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(500)


@api_router.post("/users")
async def create_user(body: UserInput, request: Request):
    await require_admin(request)
    email = body.email.strip().lower()
    if not body.password or len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    doc = {
        "id": str(uuid.uuid4()), "name": body.name, "email": email,
        "password_hash": hash_password(body.password),
        "role": body.role if body.role in ("admin", "operator") else "operator",
        "branch_id": body.branch_id if body.role == "operator" else None,
        "created_at": now_iso(),
    }
    await db.users.insert_one({**doc})
    doc.pop("password_hash")
    return doc


@api_router.put("/users/{user_id}")
async def update_user(user_id: str, body: UserInput, request: Request):
    await require_admin(request)
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    email = body.email.strip().lower()
    dup = await db.users.find_one({"email": email, "id": {"$ne": user_id}})
    if dup:
        raise HTTPException(status_code=400, detail="Email sudah digunakan pengguna lain")
    update = {
        "name": body.name, "email": email,
        "role": body.role if body.role in ("admin", "operator") else "operator",
        "branch_id": body.branch_id if body.role == "operator" else None,
    }
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
        update["password_hash"] = hash_password(body.password)
    await db.users.update_one({"id": user_id}, {"$set": update})
    return {"ok": True}


@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    admin = await require_admin(request)
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus akun sendiri")
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    if target.get("role") == "admin" and await db.users.count_documents({"role": "admin"}) <= 1:
        raise HTTPException(status_code=400, detail="Minimal harus ada satu admin")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


# ---------- Services ----------
@api_router.get("/services")
async def list_services(branch_id: Optional[str] = None):
    q = {"branch_id": branch_id} if branch_id else {}
    return await db.services.find(q, {"_id": 0}).sort("created_at", 1).to_list(200)


@api_router.post("/services")
async def create_service(body: ServiceInput, request: Request):
    await require_admin(request)
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["prefix"] = doc["prefix"].strip().upper()[:2]
    doc["created_at"] = now_iso()
    await db.services.insert_one({**doc})
    await manager.broadcast({"type": "update"})
    return doc


@api_router.put("/services/{service_id}")
async def update_service(service_id: str, body: ServiceInput, request: Request):
    await require_admin(request)
    doc = body.model_dump()
    doc["prefix"] = doc["prefix"].strip().upper()[:2]
    res = await db.services.update_one({"id": service_id}, {"$set": doc})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Layanan tidak ditemukan")
    await manager.broadcast({"type": "update"})
    return {"ok": True}


@api_router.delete("/services/{service_id}")
async def delete_service(service_id: str, request: Request):
    await require_admin(request)
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
    await require_admin(request)
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.counters.insert_one({**doc})
    await manager.broadcast({"type": "update"})
    return doc


@api_router.put("/counters/{counter_id}")
async def update_counter(counter_id: str, body: CounterInput, request: Request):
    await require_admin(request)
    res = await db.counters.update_one({"id": counter_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Loket tidak ditemukan")
    await manager.broadcast({"type": "update"})
    return {"ok": True}


@api_router.delete("/counters/{counter_id}")
async def delete_counter(counter_id: str, request: Request):
    await require_admin(request)
    await db.counters.delete_one({"id": counter_id})
    await manager.broadcast({"type": "update"})
    return {"ok": True}


# ---------- Settings ----------
@api_router.get("/settings")
async def get_settings():
    s = await db.settings.find_one({"id": "main"}, {"_id": 0})
    if s:
        s.setdefault("promo_media", [])
        s.setdefault("primary_color", "#4f46e5")
        s.setdefault("logo_url", "")
        s.setdefault("footer_text", "")
    return s or {"id": "main", "org_name": "Antrian Digital", "tagline": "", "ticker_text": "", "promo_media": [], "primary_color": "#4f46e5", "logo_url": "", "footer_text": ""}


@api_router.put("/settings")
async def update_settings(body: SettingsInput, request: Request):
    await require_admin(request)
    await db.settings.update_one({"id": "main"}, {"$set": body.model_dump()}, upsert=True)
    await manager.broadcast({"type": "update"})
    return {"ok": True}


# ---------- Branches (kantor cabang) ----------
@api_router.get("/branches")
async def list_branches():
    return await db.branches.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)


@api_router.post("/branches")
async def create_branch(body: BranchInput, request: Request):
    await require_admin(request)
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = now_iso()
    await db.branches.insert_one({**doc})
    await manager.broadcast({"type": "update"})
    return doc


@api_router.put("/branches/{branch_id}")
async def update_branch(branch_id: str, body: BranchInput, request: Request):
    await require_admin(request)
    res = await db.branches.update_one({"id": branch_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cabang tidak ditemukan")
    await manager.broadcast({"type": "update", "branch_id": branch_id})
    return {"ok": True}


@api_router.delete("/branches/{branch_id}")
async def delete_branch(branch_id: str, request: Request):
    await require_admin(request)
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
        "priority": False,
        "counter_id": None,
        "counter_name": None,
        "called_by": None,
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
        "primary_color": g.get("primary_color", "#4f46e5"),
        "logo_url": g.get("logo_url", ""),
        "footer_text": g.get("footer_text", ""),
        "print_header": (branch or {}).get("print_header", ""),
        "print_footer": (branch or {}).get("print_footer", ""),
    }
    return {"services": services, "counters": counters, "serving": serving, "waiting": waiting, "skipped": skipped, "settings": settings}


@api_router.post("/queue/call-next")
async def call_next(body: CallNextInput, request: Request):
    user = await get_current_user(request)
    counter = await db.counters.find_one({"id": body.counter_id}, {"_id": 0})
    if not counter:
        raise HTTPException(status_code=404, detail="Loket tidak ditemukan")
    ensure_branch_access(user, counter.get("branch_id"))
    today = today_str()
    await db.tickets.update_many(
        {"date": today, "counter_id": body.counter_id, "status": "serving"},
        {"$set": {"status": "done", "finished_at": now_iso()}},
    )
    ticket = await db.tickets.find_one_and_update(
        {"date": today, "service_id": body.service_id, "status": "waiting"},
        {"$set": {"status": "serving", "counter_id": counter["id"], "counter_name": counter["name"], "called_at": now_iso(), "called_by": user.get("name", user.get("email", "")), "called_by_id": user["id"]}},
        sort=[("priority", -1), ("created_at", 1)],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not ticket:
        await manager.broadcast({"type": "update", "branch_id": counter.get("branch_id")})
        raise HTTPException(status_code=404, detail="Tidak ada antrian menunggu untuk layanan ini")
    await log_call("call", ticket, user)
    await manager.broadcast({"type": "call", "ticket": ticket, "branch_id": ticket.get("branch_id")})
    return ticket


@api_router.post("/queue/recall")
async def recall(body: TicketActionInput, request: Request):
    user = await get_current_user(request)
    ticket = await db.tickets.find_one({"id": body.ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    ensure_branch_access(user, ticket.get("branch_id"))
    await log_call("recall", ticket, user)
    await manager.broadcast({"type": "call", "ticket": ticket, "branch_id": ticket.get("branch_id")})
    return ticket


@api_router.post("/queue/skip")
async def skip(body: TicketActionInput, request: Request):
    user = await get_current_user(request)
    existing = await db.tickets.find_one({"id": body.ticket_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    ensure_branch_access(user, existing.get("branch_id"))
    ticket = await db.tickets.find_one_and_update(
        {"id": body.ticket_id},
        {"$set": {"status": "skipped", "finished_at": now_iso()}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    await log_call("skip", ticket, user)
    await manager.broadcast({"type": "update", "branch_id": ticket.get("branch_id")})
    return {"ok": True}


@api_router.post("/queue/complete")
async def complete(body: TicketActionInput, request: Request):
    user = await get_current_user(request)
    existing = await db.tickets.find_one({"id": body.ticket_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    ensure_branch_access(user, existing.get("branch_id"))
    ticket = await db.tickets.find_one_and_update(
        {"id": body.ticket_id},
        {"$set": {"status": "done", "finished_at": now_iso()}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    await log_call("complete", ticket, user)
    await manager.broadcast({"type": "update", "branch_id": ticket.get("branch_id")})
    return {"ok": True}


@api_router.post("/queue/restore")
async def restore(body: TicketActionInput, request: Request):
    user = await get_current_user(request)
    existing = await db.tickets.find_one({"id": body.ticket_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    ensure_branch_access(user, existing.get("branch_id"))
    if existing.get("status") != "skipped":
        raise HTTPException(status_code=400, detail="Hanya antrian yang terlewati yang dapat diprioritaskan kembali")
    ticket = await db.tickets.find_one_and_update(
        {"id": body.ticket_id},
        {"$set": {"status": "waiting", "priority": True, "finished_at": None, "counter_id": None, "counter_name": None}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    await log_call("restore", ticket, user)
    await manager.broadcast({"type": "update", "branch_id": ticket.get("branch_id")})
    return ticket


@api_router.post("/queue/reset")
async def reset_queue(request: Request, branch_id: Optional[str] = None):
    await require_admin(request)
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
    user = await get_current_user(request)
    if user.get("role") == "operator" and user.get("branch_id"):
        branch_id = user["branch_id"]
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


@api_router.get("/recap")
async def recap(request: Request, branch_id: Optional[str] = None, date: Optional[str] = None):
    user = await get_current_user(request)
    if user.get("role") == "operator" and user.get("branch_id"):
        branch_id = user["branch_id"]
    q = {"date": date or today_str()}
    if branch_id:
        q["branch_id"] = branch_id
    logs = await db.call_logs.find(q, {"_id": 0}).sort("at", -1).to_list(1000)
    ticket_ids = list({l["ticket_id"] for l in logs})
    tickets = await db.tickets.find({"id": {"$in": ticket_ids}}, {"_id": 0, "id": 1, "survey": 1}).to_list(2000)
    surveys = {t["id"]: t.get("survey") for t in tickets}
    for l in logs:
        l["survey"] = surveys.get(l["ticket_id"])
    return {"logs": logs}


@api_router.get("/recap/export")
async def recap_export(request: Request, branch_id: Optional[str] = None, date: Optional[str] = None):
    user = await get_current_user(request)
    if user.get("role") == "operator" and user.get("branch_id"):
        branch_id = user["branch_id"]
    d = date or today_str()
    q = {"date": d}
    if branch_id:
        q["branch_id"] = branch_id
    logs = await db.call_logs.find(q, {"_id": 0}).sort("at", 1).to_list(5000)
    ticket_ids = list({l["ticket_id"] for l in logs})
    tickets = await db.tickets.find({"id": {"$in": ticket_ids}}, {"_id": 0, "id": 1, "survey": 1}).to_list(5000)
    surveys = {t["id"]: t.get("survey") or {} for t in tickets}
    action_labels = {"call": "Panggil", "recall": "Panggil Ulang", "skip": "Lewati", "complete": "Selesai", "restore": "Prioritaskan"}

    import io
    from openpyxl import Workbook
    from fastapi.responses import StreamingResponse
    wb = Workbook()
    ws = wb.active
    ws.title = "Rekap"
    ws.append(["Waktu", "Tiket", "Layanan", "Loket", "Petugas", "Aksi", "Cabang", "Rating", "Saran"])
    for l in logs:
        sv = surveys.get(l["ticket_id"], {})
        ws.append([
            l["at"][11:19], l["ticket_code"], l.get("service_name", ""), l.get("counter_name", "") or "-",
            l.get("operator_name", ""), action_labels.get(l["action"], l["action"]), l.get("branch_name", ""),
            sv.get("rating", "") or "", sv.get("feedback", "") or "",
        ])
    for col, w in zip("ABCDEFGHI", [10, 10, 22, 14, 20, 14, 20, 8, 40]):
        ws.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="rekap_{d}.xlsx"'},
    )


# ---------- Survey kepuasan ----------
@api_router.post("/surveys")
async def submit_survey(body: SurveyInput, request: Request):
    user = await get_current_user(request)
    ticket = await db.tickets.find_one({"id": body.ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Tiket tidak ditemukan")
    ensure_branch_access(user, ticket.get("branch_id"))
    rating = max(0, min(5, body.rating))
    survey = {"rating": rating, "feedback": body.feedback, "photo": body.photo, "at": now_iso(), "by": user.get("name", user.get("email", ""))}
    await db.tickets.update_one({"id": body.ticket_id}, {"$set": {"survey": survey}})
    return {"ok": True, "survey": survey}


# ---------- Database backup & restore ----------
BACKUP_COLLECTIONS = ["branches", "services", "counters", "tickets", "users", "settings", "call_logs", "sequences", "meta"]


@api_router.get("/db/backup")
async def db_backup(request: Request):
    await require_admin(request)
    from fastapi.responses import JSONResponse
    dump = {"exported_at": now_iso(), "data": {}}
    for c in BACKUP_COLLECTIONS:
        dump["data"][c] = await db[c].find({}, {"_id": 0}).to_list(100000)
    return JSONResponse(dump, headers={"Content-Disposition": f'attachment; filename="backup_{today_str()}.json"'})


@api_router.post("/db/restore")
async def db_restore(body: RestoreInput, request: Request):
    await require_admin(request)
    restored = {}
    for c, docs in body.data.items():
        if c not in BACKUP_COLLECTIONS or not isinstance(docs, list):
            continue
        await db[c].delete_many({})
        if docs:
            await db[c].insert_many([{**d} for d in docs])
        restored[c] = len(docs)
    await manager.broadcast({"type": "update"})
    return {"ok": True, "restored": restored}


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

    # Seed v2: cabang kedua + akun operator per cabang (sekali saja)
    if first_branch and await db.meta.find_one({"key": "seed_v2_done"}) is None:
        base = now_iso()
        branch2 = {
            "id": str(uuid.uuid4()), "name": "Kantor Cabang", "address": "Jl. Merdeka No. 10",
            "active": True,
            "ticker_text": "Selamat datang di Kantor Cabang. Mohon menunggu nomor antrian Anda dipanggil. Terima kasih.",
            "promo_media": [
                {"type": "image", "url": "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"},
                {"type": "image", "url": "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"},
            ],
            "created_at": base,
        }
        await db.branches.insert_one({**branch2})
        await db.services.insert_many([
            {"id": str(uuid.uuid4()), "name": "Teller", "prefix": "A", "description": "Setor, tarik tunai & transaksi umum", "icon": "banknote", "active": True, "branch_id": branch2["id"], "created_at": base},
            {"id": str(uuid.uuid4()), "name": "Customer Service", "prefix": "B", "description": "Informasi & layanan pelanggan", "icon": "users", "active": True, "branch_id": branch2["id"], "created_at": base + "a"},
        ])
        await db.counters.insert_many([
            {"id": str(uuid.uuid4()), "name": "Loket 1", "service_ids": [], "active": True, "branch_id": branch2["id"], "created_at": base},
            {"id": str(uuid.uuid4()), "name": "Loket 2", "service_ids": [], "active": True, "branch_id": branch2["id"], "created_at": base + "a"},
        ])
        for email, name, bid in [
            ("operator.pusat@antrian.id", "Operator Pusat", first_branch["id"]),
            ("operator.cabang@antrian.id", "Operator Cabang", branch2["id"]),
        ]:
            if await db.users.find_one({"email": email}) is None:
                await db.users.insert_one({
                    "id": str(uuid.uuid4()), "email": email, "name": name,
                    "password_hash": hash_password("operator123"),
                    "role": "operator", "branch_id": bid, "created_at": now_iso(),
                })
        await db.meta.insert_one({"key": "seed_v2_done", "at": now_iso()})

    await db.settings.update_one({"id": "main", "primary_color": {"$exists": False}}, {"$set": {"primary_color": "#4f46e5", "logo_url": ""}})

    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.tickets.create_index([("date", 1), ("status", 1), ("branch_id", 1)])
    await db.tickets.create_index("id")
    await db.call_logs.create_index([("date", 1), ("branch_id", 1)])


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
