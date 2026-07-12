"""Iteration 7: Username login + change-password + user username field tests."""
import os
import pytest
import requests

with open('/app/frontend/.env') as f:
    for line in f:
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
            break

API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@antrian.id", "password": "admin123"}


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---- Login via username ----
class TestUsernameLogin:
    def test_login_via_username(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin", "password": "admin123"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["email"] == "admin@antrian.id"
        # verify username visible via /auth/me
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {d['access_token']}"}).json()
        assert me.get("username") == "admin"

    def test_login_via_email_still_works(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200

    def test_login_bad_username(self):
        r = requests.post(f"{API}/auth/login", json={"email": "nouser_xxx", "password": "admin123"})
        assert r.status_code == 401


# ---- User create/update with username ----
class TestUserUsername:
    created_id = None

    def test_create_user_without_username(self, admin_headers):
        r = requests.post(f"{API}/users", headers=admin_headers, json={
            "name": "TEST NoUser", "email": "TEST_nouser@x.io", "password": "pass1234", "role": "operator", "branch_id": None
        })
        assert r.status_code == 200, r.text
        assert r.json().get("username") is None
        # cleanup
        requests.delete(f"{API}/users/{r.json()['id']}", headers=admin_headers)

    def test_create_user_with_username_lowercased(self, admin_headers):
        r = requests.post(f"{API}/users", headers=admin_headers, json={
            "name": "TEST WithUser", "email": "TEST_withuser@x.io", "username": "TestUsr7",
            "password": "pass1234", "role": "operator", "branch_id": None
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["username"] == "testusr7"
        TestUserUsername.created_id = d["id"]

    def test_login_with_created_username(self):
        r = requests.post(f"{API}/auth/login", json={"email": "testusr7", "password": "pass1234"})
        assert r.status_code == 200, r.text
        me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).json()
        assert me.get("username") == "testusr7"

    def test_duplicate_username_rejected(self, admin_headers):
        r = requests.post(f"{API}/users", headers=admin_headers, json={
            "name": "TEST Dup", "email": "TEST_dup@x.io", "username": "TESTUSR7",
            "password": "pass1234", "role": "operator", "branch_id": None
        })
        assert r.status_code == 400

    def test_update_user_username(self, admin_headers):
        assert TestUserUsername.created_id
        r = requests.put(f"{API}/users/{TestUserUsername.created_id}", headers=admin_headers, json={
            "name": "TEST WithUser", "email": "TEST_withuser@x.io", "username": "testusr7b",
            "password": "", "role": "operator", "branch_id": None
        })
        assert r.status_code == 200, r.text
        # verify
        users = requests.get(f"{API}/users", headers=admin_headers).json()
        u = next(x for x in users if x["id"] == TestUserUsername.created_id)
        assert u["username"] == "testusr7b"

    def test_update_duplicate_username_rejected(self, admin_headers):
        # try updating our user to 'admin' username -> should 400
        assert TestUserUsername.created_id
        r = requests.put(f"{API}/users/{TestUserUsername.created_id}", headers=admin_headers, json={
            "name": "TEST WithUser", "email": "TEST_withuser@x.io", "username": "admin",
            "password": "", "role": "operator", "branch_id": None
        })
        assert r.status_code == 400

    def test_cleanup_user(self, admin_headers):
        if TestUserUsername.created_id:
            r = requests.delete(f"{API}/users/{TestUserUsername.created_id}", headers=admin_headers)
            assert r.status_code == 200


# ---- Change password ----
class TestChangePassword:
    """Uses a newly created test user; restores password at the end."""

    @pytest.fixture(scope="class")
    def test_user(self, admin_headers):
        r = requests.post(f"{API}/users", headers=admin_headers, json={
            "name": "TEST CP", "email": "TEST_changepw@x.io", "username": "testcp7",
            "password": "origpass1", "role": "operator", "branch_id": None
        })
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        # login and get token
        lr = requests.post(f"{API}/auth/login", json={"email": "testcp7", "password": "origpass1"})
        token = lr.json()["access_token"]
        yield {"id": uid, "token": token, "headers": {"Authorization": f"Bearer {token}"}}
        # cleanup
        requests.delete(f"{API}/users/{uid}", headers=admin_headers)

    def test_change_password_wrong_current(self, test_user):
        r = requests.post(f"{API}/auth/change-password", headers=test_user["headers"],
                          json={"current_password": "WRONG", "new_password": "newpass2"})
        assert r.status_code == 400

    def test_change_password_new_too_short(self, test_user):
        r = requests.post(f"{API}/auth/change-password", headers=test_user["headers"],
                          json={"current_password": "origpass1", "new_password": "abc"})
        assert r.status_code == 400

    def test_change_password_no_auth(self):
        r = requests.post(f"{API}/auth/change-password",
                          json={"current_password": "origpass1", "new_password": "newpass2"})
        assert r.status_code == 401

    def test_change_password_success_and_login(self, test_user):
        r = requests.post(f"{API}/auth/change-password", headers=test_user["headers"],
                          json={"current_password": "origpass1", "new_password": "newpass2"})
        assert r.status_code == 200
        # login with new
        lr = requests.post(f"{API}/auth/login", json={"email": "testcp7", "password": "newpass2"})
        assert lr.status_code == 200
        # old password fails
        lr2 = requests.post(f"{API}/auth/login", json={"email": "testcp7", "password": "origpass1"})
        assert lr2.status_code == 401
        # restore to orig for hygiene (not strictly needed since user is deleted)
        new_token = lr.json()["access_token"]
        requests.post(f"{API}/auth/change-password",
                      headers={"Authorization": f"Bearer {new_token}"},
                      json={"current_password": "newpass2", "new_password": "origpass1"})
