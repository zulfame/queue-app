"""Backend tests for multi-branch feature.
Run sequentially (no xdist) because tests share state across a test branch.
"""
import os
import json
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@antrian.id"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def default_branch():
    r = requests.get(f"{API}/branches")
    assert r.status_code == 200
    branches = r.json()
    assert len(branches) >= 1
    kp = next((b for b in branches if b["name"] == "Kantor Pusat"), branches[0])
    assert "ticker_text" in kp
    assert "promo_media" in kp
    return kp


@pytest.fixture(scope="module")
def env_state(auth_headers, default_branch):
    """Create test branch + service + counter; cleanup at module end."""
    # Create test branch
    r = requests.post(f"{API}/branches", headers=auth_headers,
                      json={"name": "TEST_Cabang_B", "address": "Jl. Testing 2", "active": True,
                            "ticker_text": "TB_TICKER", "promo_media": []})
    assert r.status_code == 200
    branch = r.json()
    # Service in B
    rs = requests.post(f"{API}/services", headers=auth_headers,
                       json={"name": "TEST_SvcB", "prefix": "T", "description": "", "icon": "users",
                             "active": True, "branch_id": branch["id"]})
    assert rs.status_code == 200
    svc = rs.json()
    # Counter in B
    rc = requests.post(f"{API}/counters", headers=auth_headers,
                       json={"name": "TEST_LokB", "service_ids": [], "active": True,
                             "branch_id": branch["id"]})
    assert rc.status_code == 200
    ctr = rc.json()
    yield {"branch": branch, "svc": svc, "ctr": ctr, "default": default_branch}
    # Cleanup
    requests.delete(f"{API}/branches/{branch['id']}", headers=auth_headers)


# ---------- Auth / access tests ----------
def test_list_branches_public(default_branch):
    r = requests.get(f"{API}/branches")
    assert r.status_code == 200

def test_create_branch_requires_auth():
    r = requests.post(f"{API}/branches", json={"name": "X"})
    assert r.status_code == 401

def test_update_branch_requires_auth(default_branch):
    r = requests.put(f"{API}/branches/{default_branch['id']}", json={"name": "X"})
    assert r.status_code == 401

def test_delete_branch_requires_auth(default_branch):
    r = requests.delete(f"{API}/branches/{default_branch['id']}")
    assert r.status_code == 401


# ---------- Branch isolation ----------
def test_services_counters_branch_filter(env_state):
    b = env_state["branch"]; svc = env_state["svc"]; ctr = env_state["ctr"]
    d = env_state["default"]
    svcs_b = requests.get(f"{API}/services?branch_id={b['id']}").json()
    assert all(s.get("branch_id") == b["id"] for s in svcs_b)
    assert any(s["id"] == svc["id"] for s in svcs_b)
    svcs_a = requests.get(f"{API}/services?branch_id={d['id']}").json()
    assert not any(s["id"] == svc["id"] for s in svcs_a)
    ctrs_b = requests.get(f"{API}/counters?branch_id={b['id']}").json()
    assert any(c["id"] == ctr["id"] for c in ctrs_b)
    ctrs_a = requests.get(f"{API}/counters?branch_id={d['id']}").json()
    assert not any(c["id"] == ctr["id"] for c in ctrs_a)


def test_queue_state_filtered_and_settings(env_state):
    b = env_state["branch"]
    r = requests.get(f"{API}/queue/state?branch_id={b['id']}")
    assert r.status_code == 200
    d = r.json()
    assert all(s.get("branch_id") == b["id"] for s in d["services"])
    assert all(c.get("branch_id") == b["id"] for c in d["counters"])
    assert d["settings"].get("branch_name") == b["name"]
    assert d["settings"].get("ticker_text") == "TB_TICKER"


def test_ticket_isolation_and_numbering(auth_headers, env_state):
    b = env_state["branch"]; svc = env_state["svc"]; d = env_state["default"]
    requests.post(f"{API}/queue/reset?branch_id={b['id']}", headers=auth_headers)
    rt = requests.post(f"{API}/tickets", json={"service_id": svc["id"]})
    assert rt.status_code == 200
    t = rt.json()
    assert t["branch_id"] == b["id"]
    assert t["number"] == 1
    assert t["code"] == "T-001"
    # Not in default branch state
    state_a = requests.get(f"{API}/queue/state?branch_id={d['id']}").json()
    ids_a = {x["id"] for x in state_a["waiting"] + state_a["serving"] + state_a["skipped"]}
    assert t["id"] not in ids_a
    # In branch B state
    state_b = requests.get(f"{API}/queue/state?branch_id={b['id']}").json()
    assert any(x["id"] == t["id"] for x in state_b["waiting"])


def test_call_next_in_test_branch(auth_headers, env_state):
    b = env_state["branch"]; svc = env_state["svc"]; ctr = env_state["ctr"]
    # Ensure a waiting ticket exists
    state_b = requests.get(f"{API}/queue/state?branch_id={b['id']}").json()
    if not state_b["waiting"]:
        requests.post(f"{API}/tickets", json={"service_id": svc["id"]})
    r = requests.post(f"{API}/queue/call-next", headers=auth_headers,
                      json={"counter_id": ctr["id"], "service_id": svc["id"]})
    assert r.status_code == 200, r.text
    served = r.json()
    assert served["branch_id"] == b["id"]
    assert served["status"] == "serving"


# ---------- Stats ----------
def test_stats_branch_filter(auth_headers, env_state):
    b = env_state["branch"]
    r = requests.get(f"{API}/stats?branch_id={b['id']}", headers=auth_headers)
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 1


def test_stats_overview(auth_headers, env_state):
    b = env_state["branch"]; d = env_state["default"]
    r = requests.get(f"{API}/stats/overview", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    ids = [x["id"] for x in data["branches"]]
    assert d["id"] in ids
    assert b["id"] in ids
    tb = next(x for x in data["branches"] if x["id"] == b["id"])
    assert tb["serving"] >= 1 or tb["total"] >= 1


def test_reset_only_target_branch(auth_headers, env_state):
    b = env_state["branch"]; d = env_state["default"]
    # Ticket in default branch
    state_a = requests.get(f"{API}/queue/state?branch_id={d['id']}").json()
    svc_a = state_a["services"][0]
    requests.post(f"{API}/tickets", json={"service_id": svc_a["id"]})
    a_before = requests.get(f"{API}/queue/state?branch_id={d['id']}").json()
    a_before_ct = len(a_before["waiting"]) + len(a_before["serving"])
    # Reset branch B
    r = requests.post(f"{API}/queue/reset?branch_id={b['id']}", headers=auth_headers)
    assert r.status_code == 200
    state_b = requests.get(f"{API}/queue/state?branch_id={b['id']}").json()
    assert len(state_b["waiting"]) + len(state_b["serving"]) + len(state_b["skipped"]) == 0
    a_after = requests.get(f"{API}/queue/state?branch_id={d['id']}").json()
    a_after_ct = len(a_after["waiting"]) + len(a_after["serving"])
    assert a_after_ct == a_before_ct  # Untouched


# ---------- WebSocket ----------
def test_ws_broadcast_includes_branch_id(auth_headers, env_state):
    b = env_state["branch"]; svc = env_state["svc"]; ctr = env_state["ctr"]
    ws_url = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"

    async def run():
        events = []
        async with websockets.connect(ws_url) as ws:
            async def collect():
                try:
                    while True:
                        msg = await asyncio.wait_for(ws.recv(), timeout=6)
                        events.append(json.loads(msg))
                except asyncio.TimeoutError:
                    pass
            task = asyncio.create_task(collect())
            await asyncio.sleep(0.4)
            requests.post(f"{API}/tickets", json={"service_id": svc["id"]})
            await asyncio.sleep(0.5)
            requests.post(f"{API}/queue/call-next", headers=auth_headers,
                          json={"counter_id": ctr["id"], "service_id": svc["id"]})
            await asyncio.sleep(1.5)
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass
        return events

    events = asyncio.run(run())
    updates = [e for e in events if e.get("type") == "update"]
    calls = [e for e in events if e.get("type") == "call"]
    assert updates, f"no update events: {events}"
    assert calls, f"no call events: {events}"
    assert any(e.get("branch_id") == b["id"] for e in updates), f"update missing branch_id: {updates}"
    assert any(e.get("branch_id") == b["id"] for e in calls), f"call missing branch_id: {calls}"


# ---------- Destructive test (run LAST) ----------
def test_z_delete_last_branch_rejected(auth_headers):
    """Runs last (alphabetical). Deletes ONLY sacrificial branches leaving Kantor Pusat."""
    # Get current
    branches = requests.get(f"{API}/branches").json()
    # If we somehow only have 1 branch already, try delete directly
    if len(branches) == 1:
        r = requests.delete(f"{API}/branches/{branches[0]['id']}", headers=auth_headers)
        assert r.status_code == 400
        return
    # Otherwise, delete all except Kantor Pusat (or the first branch)
    keep = next((b for b in branches if b["name"] == "Kantor Pusat"), branches[0])
    for b in branches:
        if b["id"] == keep["id"]:
            continue
        # Only delete TEST_ prefixed or sacrificial ones to be safe
        if b["name"].startswith("TEST_") or b["name"].startswith("Cabang"):
            requests.delete(f"{API}/branches/{b['id']}", headers=auth_headers)
    # Now try to delete keep
    remaining = requests.get(f"{API}/branches").json()
    if len(remaining) == 1:
        r = requests.delete(f"{API}/branches/{keep['id']}", headers=auth_headers)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"
    else:
        pytest.skip(f"Cannot reduce to 1 branch safely; {len(remaining)} remain")
