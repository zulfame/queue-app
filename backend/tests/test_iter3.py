"""Backend tests for iteration 3: seeder v2, users CRUD, RBAC, restore, recap, settings branding."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip()
                break
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api"

ADMIN = ("admin@antrian.id", "admin123")
OP_PUSAT = ("operator.pusat@antrian.id", "operator123")
OP_CABANG = ("operator.cabang@antrian.id", "operator123")


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_login():
    return login(*ADMIN)


@pytest.fixture(scope="module")
def admin_h(admin_login):
    return hdr(admin_login["access_token"])


@pytest.fixture(scope="module")
def op_pusat_login():
    return login(*OP_PUSAT)


@pytest.fixture(scope="module")
def op_cabang_login():
    return login(*OP_CABANG)


@pytest.fixture(scope="module")
def op_pusat_h(op_pusat_login):
    return hdr(op_pusat_login["access_token"])


@pytest.fixture(scope="module")
def op_cabang_h(op_cabang_login):
    return hdr(op_cabang_login["access_token"])


@pytest.fixture(scope="module")
def branches():
    r = requests.get(f"{API}/branches")
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def branch_pusat(branches):
    return next(b for b in branches if b["name"] == "Kantor Pusat")


@pytest.fixture(scope="module")
def branch_cabang(branches):
    return next(b for b in branches if b["name"] == "Kantor Cabang")


# ---------- Seeder v2 ----------
class TestSeederV2:
    def test_branches_seeded(self, branches):
        names = {b["name"] for b in branches}
        assert "Kantor Pusat" in names
        assert "Kantor Cabang" in names

    def test_operator_users_seeded(self, admin_h, branch_pusat, branch_cabang):
        r = requests.get(f"{API}/users", headers=admin_h)
        assert r.status_code == 200
        users = r.json()
        by_email = {u["email"]: u for u in users}
        assert "operator.pusat@antrian.id" in by_email
        assert "operator.cabang@antrian.id" in by_email
        assert by_email["operator.pusat@antrian.id"]["role"] == "operator"
        assert by_email["operator.pusat@antrian.id"]["branch_id"] == branch_pusat["id"]
        assert by_email["operator.cabang@antrian.id"]["branch_id"] == branch_cabang["id"]

    def test_operator_can_login(self, op_pusat_login, op_cabang_login):
        assert op_pusat_login["user"]["role"] == "operator"
        assert op_cabang_login["user"]["role"] == "operator"
        assert op_pusat_login["user"].get("branch_id")


# ---------- Users CRUD ----------
class TestUsersCRUD:
    def test_operator_forbidden(self, op_pusat_h):
        r = requests.get(f"{API}/users", headers=op_pusat_h)
        assert r.status_code == 403

    def test_no_auth_forbidden(self):
        r = requests.get(f"{API}/users")
        assert r.status_code == 401

    def test_create_and_verify(self, admin_h, branch_cabang):
        payload = {"name": "TEST_User1", "email": "TEST_user1@x.io", "password": "secret6", "role": "operator", "branch_id": branch_cabang["id"]}
        r = requests.post(f"{API}/users", headers=admin_h, json=payload)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["email"] == "test_user1@x.io"
        assert u["role"] == "operator"
        assert u["branch_id"] == branch_cabang["id"]
        assert "password_hash" not in u
        # duplicate email
        r2 = requests.post(f"{API}/users", headers=admin_h, json=payload)
        assert r2.status_code == 400
        # short password
        payload2 = {**payload, "email": "TEST_user2@x.io", "password": "123"}
        r3 = requests.post(f"{API}/users", headers=admin_h, json=payload2)
        assert r3.status_code == 400
        # cleanup
        requests.delete(f"{API}/users/{u['id']}", headers=admin_h)

    def test_update_and_delete(self, admin_h, branch_pusat):
        r = requests.post(f"{API}/users", headers=admin_h, json={"name": "TEST_ToDel", "email": "TEST_del@x.io", "password": "abcdef", "role": "operator", "branch_id": branch_pusat["id"]})
        uid = r.json()["id"]
        # update
        r2 = requests.put(f"{API}/users/{uid}", headers=admin_h, json={"name": "TEST_Updated", "email": "TEST_del@x.io", "role": "operator", "branch_id": branch_pusat["id"]})
        assert r2.status_code == 200
        # delete
        r3 = requests.delete(f"{API}/users/{uid}", headers=admin_h)
        assert r3.status_code == 200

    def test_cannot_delete_self(self, admin_h, admin_login):
        uid = admin_login["user"]["id"]
        r = requests.delete(f"{API}/users/{uid}", headers=admin_h)
        assert r.status_code == 400

    def test_cannot_delete_last_admin(self, admin_h):
        # Find all admins
        users = requests.get(f"{API}/users", headers=admin_h).json()
        admins = [u for u in users if u["role"] == "admin"]
        if len(admins) == 1:
            r = requests.delete(f"{API}/users/{admins[0]['id']}", headers=admin_h)
            # deleting self -> 400 too; either way non-200
            assert r.status_code == 400


# ---------- RBAC on queue actions ----------
class TestRBAC:
    def test_operator_cannot_call_other_branch_counter(self, op_cabang_h, branch_pusat):
        # Get a counter in Kantor Pusat
        counters = requests.get(f"{API}/counters?branch_id={branch_pusat['id']}").json()
        services = requests.get(f"{API}/services?branch_id={branch_pusat['id']}").json()
        assert counters and services
        r = requests.post(f"{API}/queue/call-next", headers=op_cabang_h,
                         json={"counter_id": counters[0]["id"], "service_id": services[0]["id"]})
        assert r.status_code == 403

    def test_operator_can_call_own_branch(self, op_cabang_h, admin_h, branch_cabang):
        counters = requests.get(f"{API}/counters?branch_id={branch_cabang['id']}").json()
        services = requests.get(f"{API}/services?branch_id={branch_cabang['id']}").json()
        # reset & create a ticket for own branch
        requests.post(f"{API}/queue/reset?branch_id={branch_cabang['id']}", headers=admin_h)
        t = requests.post(f"{API}/tickets", json={"service_id": services[0]["id"]}).json()
        r = requests.post(f"{API}/queue/call-next", headers=op_cabang_h,
                         json={"counter_id": counters[0]["id"], "service_id": services[0]["id"]})
        assert r.status_code == 200, r.text
        assert r.json()["called_by"]  # nama petugas

    def test_operator_skip_other_branch_forbidden(self, op_cabang_h, admin_h, branch_pusat):
        # create a ticket in Pusat via admin
        services = requests.get(f"{API}/services?branch_id={branch_pusat['id']}").json()
        t = requests.post(f"{API}/tickets", json={"service_id": services[0]["id"]}).json()
        r = requests.post(f"{API}/queue/skip", headers=op_cabang_h, json={"ticket_id": t["id"]})
        assert r.status_code == 403
        # cleanup - complete via admin
        requests.post(f"{API}/queue/complete", headers=admin_h, json={"ticket_id": t["id"]})


# ---------- Restore / priority ----------
class TestRestore:
    def test_restore_flow_and_priority(self, admin_h, op_cabang_h, branch_cabang):
        # reset branch
        requests.post(f"{API}/queue/reset?branch_id={branch_cabang['id']}", headers=admin_h)
        services = requests.get(f"{API}/services?branch_id={branch_cabang['id']}").json()
        counters = requests.get(f"{API}/counters?branch_id={branch_cabang['id']}").json()
        svc = services[0]
        ctr = counters[0]
        # t1
        t1 = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
        # call t1 (serving)
        called = requests.post(f"{API}/queue/call-next", headers=op_cabang_h,
                              json={"counter_id": ctr["id"], "service_id": svc["id"]}).json()
        assert called["id"] == t1["id"]
        # skip t1
        r = requests.post(f"{API}/queue/skip", headers=op_cabang_h, json={"ticket_id": t1["id"]})
        assert r.status_code == 200
        # add t2, t3 waiting
        t2 = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
        t3 = requests.post(f"{API}/tickets", json={"service_id": svc["id"]}).json()
        # restore t1
        r = requests.post(f"{API}/queue/restore", headers=op_cabang_h, json={"ticket_id": t1["id"]})
        assert r.status_code == 200
        rt = r.json()
        assert rt["status"] == "waiting"
        assert rt["priority"] is True
        # call-next should pick t1 first (priority) even though t2/t3 were older
        called2 = requests.post(f"{API}/queue/call-next", headers=op_cabang_h,
                               json={"counter_id": ctr["id"], "service_id": svc["id"]}).json()
        assert called2["id"] == t1["id"], f"expected {t1['id']} got {called2['id']}"

    def test_restore_non_skipped_400(self, admin_h, op_cabang_h, branch_cabang):
        requests.post(f"{API}/queue/reset?branch_id={branch_cabang['id']}", headers=admin_h)
        services = requests.get(f"{API}/services?branch_id={branch_cabang['id']}").json()
        t = requests.post(f"{API}/tickets", json={"service_id": services[0]["id"]}).json()
        r = requests.post(f"{API}/queue/restore", headers=op_cabang_h, json={"ticket_id": t["id"]})
        assert r.status_code == 400


# ---------- Recap ----------
class TestRecap:
    def test_recap_has_operator_name(self, admin_h, op_cabang_h, branch_cabang):
        # create + call in branch cabang
        requests.post(f"{API}/queue/reset?branch_id={branch_cabang['id']}", headers=admin_h)
        services = requests.get(f"{API}/services?branch_id={branch_cabang['id']}").json()
        counters = requests.get(f"{API}/counters?branch_id={branch_cabang['id']}").json()
        t = requests.post(f"{API}/tickets", json={"service_id": services[0]["id"]}).json()
        requests.post(f"{API}/queue/call-next", headers=op_cabang_h,
                     json={"counter_id": counters[0]["id"], "service_id": services[0]["id"]})
        time.sleep(0.3)
        r = requests.get(f"{API}/recap?branch_id={branch_cabang['id']}", headers=admin_h)
        assert r.status_code == 200
        logs = r.json()["logs"]
        assert any(l.get("action") == "call" and l.get("operator_name") for l in logs)
        # ticket_code + service_name + counter_name present
        call_log = next(l for l in logs if l["action"] == "call")
        for k in ("ticket_code", "service_name", "counter_name", "operator_name"):
            assert call_log.get(k), f"missing {k}"

    def test_operator_recap_scoped_to_own_branch(self, op_cabang_h, branch_pusat):
        # even if we pass branch_id=pusat, operator should see only own branch
        r = requests.get(f"{API}/recap?branch_id={branch_pusat['id']}", headers=op_cabang_h)
        assert r.status_code == 200
        logs = r.json()["logs"]
        # all logs must not belong to pusat
        assert all(l.get("branch_id") != branch_pusat["id"] for l in logs)


# ---------- Settings branding ----------
class TestSettingsBranding:
    def test_get_settings_has_branding(self):
        r = requests.get(f"{API}/settings")
        assert r.status_code == 200
        s = r.json()
        assert "primary_color" in s
        assert "logo_url" in s

    def test_operator_cannot_update_settings(self, op_pusat_h):
        r = requests.put(f"{API}/settings", headers=op_pusat_h,
                        json={"org_name": "x", "primary_color": "#000000", "logo_url": ""})
        assert r.status_code == 403

    def test_admin_updates_branding_and_visible_in_state(self, admin_h):
        current = requests.get(f"{API}/settings").json()
        payload = {
            "org_name": current.get("org_name", "QueueFlow"),
            "tagline": current.get("tagline", ""),
            "ticker_text": current.get("ticker_text", ""),
            "promo_media": current.get("promo_media", []),
            "primary_color": "#16a34a",
            "logo_url": "https://example.com/logo.png",
        }
        r = requests.put(f"{API}/settings", headers=admin_h, json=payload)
        assert r.status_code == 200
        s = requests.get(f"{API}/settings").json()
        assert s["primary_color"] == "#16a34a"
        assert s["logo_url"] == "https://example.com/logo.png"
        st = requests.get(f"{API}/queue/state").json()
        assert st["settings"]["primary_color"] == "#16a34a"
        assert st["settings"]["logo_url"] == "https://example.com/logo.png"
        # restore
        payload["primary_color"] = "#4f46e5"
        payload["logo_url"] = ""
        requests.put(f"{API}/settings", headers=admin_h, json=payload)


# ---------- Seeder idempotency ----------
class TestIdempotency:
    def test_no_duplicates(self, admin_h):
        branches = requests.get(f"{API}/branches").json()
        names = [b["name"] for b in branches]
        assert names.count("Kantor Pusat") == 1
        assert names.count("Kantor Cabang") == 1
        users = requests.get(f"{API}/users", headers=admin_h).json()
        emails = [u["email"] for u in users]
        assert emails.count("operator.pusat@antrian.id") == 1
        assert emails.count("operator.cabang@antrian.id") == 1
