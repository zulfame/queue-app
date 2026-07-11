"""Backend API tests for Antrian (queueing) app."""
import os
import json
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if os.environ.get('REACT_APP_BACKEND_URL') else None
if not BASE_URL:
    # Fallback: read from frontend/.env
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                break

API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@antrian.id"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["user"]["email"] == ADMIN_EMAIL
    return data["access_token"]


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session", autouse=True)
def reset_before(admin_token):
    # reset queue state before tests
    requests.post(f"{API}/queue/reset", headers={"Authorization": f"Bearer {admin_token}"})
    yield


# ----- Auth -----
class TestAuth:
    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong123"})
        assert r.status_code == 401

    def test_auth_me_with_token(self, auth_headers):
        r = requests.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_auth_me_no_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ----- Queue state -----
class TestQueueState:
    def test_queue_state_public(self):
        r = requests.get(f"{API}/queue/state")
        assert r.status_code == 200
        d = r.json()
        assert len(d["services"]) >= 3
        prefixes = {s["prefix"] for s in d["services"]}
        assert {"A", "B", "C"}.issubset(prefixes)
        assert len(d["counters"]) >= 3
        assert "settings" in d


# ----- Tickets -----
class TestTickets:
    def test_create_ticket_sequential(self):
        state = requests.get(f"{API}/queue/state").json()
        svc = next(s for s in state["services"] if s["prefix"] == "A")
        r1 = requests.post(f"{API}/tickets", json={"service_id": svc["id"]})
        assert r1.status_code == 200
        t1 = r1.json()
        assert t1["code"].startswith("A-")
        assert t1["status"] == "waiting"
        r2 = requests.post(f"{API}/tickets", json={"service_id": svc["id"]})
        t2 = r2.json()
        assert t2["number"] == t1["number"] + 1
        assert t2["waiting_ahead"] >= 1


# ----- Call flow -----
class TestCallFlow:
    def test_call_next_no_auth(self):
        state = requests.get(f"{API}/queue/state").json()
        svc = state["services"][0]
        counter = state["counters"][0]
        r = requests.post(f"{API}/queue/call-next", json={"counter_id": counter["id"], "service_id": svc["id"]})
        assert r.status_code == 401

    def test_call_next_flow(self, auth_headers):
        # ensure ticket exists
        state = requests.get(f"{API}/queue/state").json()
        svc = next(s for s in state["services"] if s["prefix"] == "B")
        counter = state["counters"][0]
        t = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
        r = requests.post(f"{API}/queue/call-next", headers=auth_headers,
                         json={"counter_id": counter["id"], "service_id": svc["id"]})
        assert r.status_code == 200
        served = r.json()
        assert served["status"] == "serving"
        assert served["counter_name"] == counter["name"]

        # second call-next -> completes previous, needs new ticket
        t2 = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
        r2 = requests.post(f"{API}/queue/call-next", headers=auth_headers,
                           json={"counter_id": counter["id"], "service_id": svc["id"]})
        assert r2.status_code == 200
        # verify previous ticket now done
        state2 = requests.get(f"{API}/queue/state").json()
        # first served ticket should not be in serving anymore
        serving_ids = {x["id"] for x in state2["serving"]}
        assert served["id"] not in serving_ids

    def test_call_next_empty(self, auth_headers):
        # use a service with no tickets after reset
        requests.post(f"{API}/queue/reset", headers=auth_headers)
        state = requests.get(f"{API}/queue/state").json()
        svc = next(s for s in state["services"] if s["prefix"] == "C")
        counter = state["counters"][1]
        r = requests.post(f"{API}/queue/call-next", headers=auth_headers,
                         json={"counter_id": counter["id"], "service_id": svc["id"]})
        assert r.status_code == 404

    def test_recall_skip_complete(self, auth_headers):
        state = requests.get(f"{API}/queue/state").json()
        svc = next(s for s in state["services"] if s["prefix"] == "A")
        counter = state["counters"][0]
        t = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
        served = requests.post(f"{API}/queue/call-next", headers=auth_headers,
                               json={"counter_id": counter["id"], "service_id": svc["id"]}).json()
        r_recall = requests.post(f"{API}/queue/recall", headers=auth_headers, json={"ticket_id": served["id"]})
        assert r_recall.status_code == 200

        # skip a fresh ticket
        t2 = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
        r_skip = requests.post(f"{API}/queue/skip", headers=auth_headers, json={"ticket_id": t2["id"]})
        assert r_skip.status_code == 200

        # complete
        r_comp = requests.post(f"{API}/queue/complete", headers=auth_headers, json={"ticket_id": served["id"]})
        assert r_comp.status_code == 200


# ----- Stats -----
class TestStats:
    def test_stats_auth_required(self):
        r = requests.get(f"{API}/stats")
        assert r.status_code == 401

    def test_stats(self, auth_headers):
        r = requests.get(f"{API}/stats", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ["total", "waiting", "serving", "done", "skipped", "avg_wait_min", "per_service"]:
            assert k in d


# ----- CRUD services/counters/settings -----
class TestCRUD:
    def test_service_crud(self, auth_headers):
        # no auth
        r_no = requests.post(f"{API}/services", json={"name": "TEST_x", "prefix": "Z"})
        assert r_no.status_code == 401
        # create
        r = requests.post(f"{API}/services", headers=auth_headers,
                          json={"name": "TEST_Service", "prefix": "Z", "description": "t", "icon": "users", "active": True})
        assert r.status_code == 200
        sid = r.json()["id"]
        assert r.json()["prefix"] == "Z"
        # update
        r2 = requests.put(f"{API}/services/{sid}", headers=auth_headers,
                          json={"name": "TEST_Updated", "prefix": "Y", "description": "", "icon": "users", "active": True})
        assert r2.status_code == 200
        # delete
        r3 = requests.delete(f"{API}/services/{sid}", headers=auth_headers)
        assert r3.status_code == 200

    def test_counter_crud(self, auth_headers):
        r = requests.post(f"{API}/counters", headers=auth_headers,
                          json={"name": "TEST_Loket", "service_ids": [], "active": True})
        assert r.status_code == 200
        cid = r.json()["id"]
        r2 = requests.delete(f"{API}/counters/{cid}", headers=auth_headers)
        assert r2.status_code == 200

    def test_settings_update(self, auth_headers):
        r_no = requests.put(f"{API}/settings", json={"org_name": "x", "tagline": "", "ticker_text": ""})
        assert r_no.status_code == 401
        r = requests.put(f"{API}/settings", headers=auth_headers,
                        json={"org_name": "QueueFlow", "tagline": "Sistem Antrian Digital", "ticker_text": "Test"})
        assert r.status_code == 200


# ----- WebSocket -----
class TestWebSocket:
    def test_ws_broadcast(self, auth_headers):
        ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"

        async def run():
            events = []
            async with websockets.connect(ws_url) as ws:
                # trigger ticket create
                state = requests.get(f"{API}/queue/state").json()
                svc = next(s for s in state["services"] if s["prefix"] == "A")
                counter = state["counters"][0]

                async def collect():
                    try:
                        while True:
                            msg = await asyncio.wait_for(ws.recv(), timeout=5)
                            events.append(json.loads(msg))
                    except asyncio.TimeoutError:
                        pass

                task = asyncio.create_task(collect())
                await asyncio.sleep(0.5)
                t = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
                await asyncio.sleep(0.5)
                requests.post(f"{API}/queue/call-next", headers=auth_headers,
                              json={"counter_id": counter["id"], "service_id": svc["id"]})
                await asyncio.sleep(1.5)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            return events

        events = asyncio.run(run())
        types = [e.get("type") for e in events]
        assert "update" in types
        assert "call" in types
        call_event = next(e for e in events if e.get("type") == "call")
        assert "ticket" in call_event
