"""Exercise the mounted FastAPI endpoints with isolated authentication and transport."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from bisheng.common.dependencies.user_deps import UserPayload
from bisheng.forgemind.api.router import router
from bisheng.forgemind.domain.service import ControllerUnavailable, request_controller


class RouteTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        self.user = 21
        self.tenant = 4
        self.root = "/api/v1/forgemind/hosts"
        self.uid = "56933ed1-95d5-43ab-aba5-e5d83cc9cff6"
        self.payload = dict(name="demo-host", image="test.qcow2", user_ip="192.0.2.23", cpus=4, memory=8, disk=48, request_id=self.uid)
        self.app = app
        app.dependency_overrides[UserPayload.get_login_user] = lambda: SimpleNamespace(user_id=self.user)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.enterContext(patch.dict("os.environ", dict(FORGEMIND_CONTROLLER="controller", FORGEMIND_OWNER_ID="21", FORGEMIND_TENANT_ID="4")))
        self.enterContext(patch("bisheng.forgemind.api.router.get_current_tenant_id", side_effect=lambda: self.tenant))
        self.transport = self.enterContext(patch("bisheng.forgemind.api.router.request_controller", return_value={"result":[]}))

    def test_owner_list_detail_and_create(self):
        for optional in ({}, {"user_ip": None}):
            data = {k: v for k, v in self.payload.items() if k != "user_ip"}
            self.assertEqual(self.client.post(self.root, json={**data, **optional}).status_code, 200)
            self.assertIsNone(self.transport.call_args.kwargs["user_ip"])
        self.assertTrue(self.client.get(self.root+"/access").json()["data"]["enabled"])
        for method, path, body, action in [
            ("GET", "", None, "list"), ("GET","/summaries",None,"summaries"), ("GET","/options",None,"options"),
            ("GET","/instances/demo-host",None,"detail"), ("GET","/instances/options",None,"detail"), ("POST","",self.payload,"create"),
            ("GET","/requests/"+self.uid,None,"progress"), ("POST","/requests/"+self.uid+"/resume",None,"resume"),
            ("PUT","/instances/demo-host/title",{"uuid":self.uid,"title":"New title"},"rename"),
            ("POST","/instances/demo-host/check",{"uuid":self.uid},"check"), ("POST","/instances/demo-host/connect",{"uuid":self.uid},"connect"),
        ]:
            with self.subTest(action=action):
                r=self.client.request(method,self.root+path,json=body)
                self.assertEqual(r.json()["data"],{"result":[]})
                self.assertEqual(self.transport.call_args.args,(action,))

    def test_other_user_and_tenant_cannot_reach_transport(self):
        for self.user,self.tenant in ((22,4),(21,5)):
            self.assertFalse(self.client.get(self.root+"/access").json()["data"]["enabled"])
            self.assertEqual(self.client.get(self.root).status_code,403)
            self.assertEqual(self.client.post(self.root,json=self.payload).status_code,403)
            self.assertEqual(self.client.put(self.root+"/instances/demo-host/title",json={"uuid":self.uid,"title":"x"}).status_code,403)
        self.transport.assert_not_called()

    def test_invalid_ip_name_and_size(self):
        for overrides in ({"user_ip":"invalid"},{"name":"bad name"},{"cpus":0},{"request_id":"bad"}):
            self.assertEqual(self.client.post(self.root,json=dict(self.payload,**overrides)).status_code,422)
        self.transport.assert_not_called()

    def test_retirement_preview_and_separate_confirmations_require_owner(self):
        host = self.root + "/instances/test-guest"
        revision = "a" * 64
        for path in ("/retirement", "/disposal/destroy", "/disposal/purge"):
            self.assertEqual(self.client.get(host + path).status_code, 200)
            self.assertEqual(self.client.post(host + path, json={"version": "x"}).status_code, 422)
            self.assertEqual(self.client.post(host + path, json={"version": revision, "confirmation": "test-guest"}).status_code, 200)
            self.assertEqual(self.transport.call_args.kwargs["actor"], 21)
        self.user = 22
        self.assertEqual(self.client.post(host + "/disposal/purge", json={"version": revision, "confirmation": "test-guest"}).status_code, 403)

    def test_member_removal_requires_current_tenant_membership(self):
        self.enterContext(patch.dict("os.environ", FORGEMIND_PROJECTS_ENABLED="1"))
        base = "/api/v1/forgemind/members/8/removal"
        with patch("bisheng.forgemind.api.router.tenant_accounts", return_value={}):
            self.transport.return_value = {"error": "unauthorized"}
            self.assertEqual(self.client.get(base).status_code, 403)
            self.transport.assert_called_with("member-removal", user=8, operation="preview", pending_only=True)
            self.transport.return_value = {"result": {"phase": "pending"}}
            self.assertEqual(self.client.get(base).json()["data"]["result"]["phase"], "pending")
        with patch("bisheng.forgemind.api.router.tenant_accounts", return_value={8: {}}):
            self.assertEqual(self.client.post(base, json={"version": "b"*64, "actor": 55}).status_code, 200)
            self.transport.assert_called_with("member-removal", user=8, operation="remove", actor=21, version="b"*64)

    def test_transport_failure_is_sanitized(self):
        self.transport.side_effect=ControllerUnavailable
        self.assertEqual(self.client.get(self.root).status_code,500)
        with patch("subprocess.run",side_effect=OSError("private diagnostic")):
            with self.assertRaises(ControllerUnavailable):
                request_controller("list")

    def test_repository_preparation_gets_the_longer_transport_budget(self):
        with patch("subprocess.run", return_value=SimpleNamespace(stdout='{"result": {}}')) as run:
            for action, operation, timeout in (("project-save", "", 600), ("project-deployment", "prepare", 600),
                    ("project-deployment", "status", 45), ("project-assistant", "connect", 300), ("connect", "", 120)):
                with self.subTest(action=action, operation=operation):
                    request_controller(action, operation=operation)
                    self.assertEqual(run.call_args.kwargs["timeout"], timeout)

    def test_project_routes_native_account_and_ownership(self):
        base = "/api/v1/forgemind"
        data = {"name": "Project", "repository": "org/repo", "version": "", "features": ["read"],
                "members": [{"user": 8, "features": ["read"]}]}
        self.assertEqual(self.client.get(base + "/projects").status_code, 403)
        self.enterContext(patch.dict("os.environ", FORGEMIND_PROJECTS_ENABLED="1"))
        directory = {8: {"user": 8, "name": "Alice", "account": "alice"}}
        with patch("bisheng.forgemind.api.router.tenant_accounts", return_value=directory):
            self.assertEqual(self.client.get(base + "/members").json()["data"]["result"], list(directory.values()))
            self.assertEqual(self.client.put(base + "/projects/example", json=data).status_code, 200)
            self.assertEqual(self.transport.call_args.args, ("project-save",))
            self.assertNotIn("features", self.transport.call_args.kwargs["change"])
            verify = dict(operation="deploy", version="0" * 64)
            endpoint = base + "/projects/example/members/"
            self.assertEqual(self.client.post(endpoint + "8/deployment", json=verify).status_code, 200)
            self.assertEqual(self.transport.call_args.args, ("project-deployment",))
            self.assertEqual(self.client.post(endpoint + "9/deployment", json=verify).status_code, 403)
            self.assertEqual(self.client.post(base + "/projects/example/invites/8").status_code, 200)
            self.transport.reset_mock()
            data["members"][0]["user"] = 9
            self.assertEqual(self.client.put(base + "/projects/example", json=data).status_code, 403)
            self.assertEqual(self.client.post(base + "/projects/example/invites/9").status_code, 403)
            self.tenant = 2
            self.assertEqual(self.client.get(base + "/projects").status_code, 403)
            self.transport.assert_not_called()

    def test_project_deletion_requires_enabled_tenant_owner_and_confirmed_version(self):
        from bisheng.common.middleware.admin_scope import requires_expected_management_tenant
        url = "/api/v1/forgemind/projects/project-" + "c" * 24
        revision = "a" * 64
        self.assertTrue(requires_expected_management_tenant("DELETE", url))
        self.assertFalse(requires_expected_management_tenant("GET", url + "/deletion"))
        self.assertEqual(self.client.get(url + "/deletion").status_code, 403)
        self.enterContext(patch.dict("os.environ", FORGEMIND_PROJECTS_ENABLED="1"))
        for self.user, self.tenant in ((22, 4), (21, 5)):
            self.assertEqual(self.client.get(url + "/deletion").status_code, 403)
            self.assertEqual(self.client.request("DELETE", url, json={"version": revision}).status_code, 403)
        self.user, self.tenant = 21, 4
        self.assertEqual(self.client.request("DELETE", url, json={"version": ""}).status_code, 422)
        self.transport.assert_not_called()
        self.assertEqual(self.client.get(url + "/deletion").status_code, 200)
        self.transport.assert_called_with("project-deletion", project=url.rsplit("/", 1)[1], operation="preview")
        self.assertEqual(self.client.request("DELETE", url, json={"version": revision, "actor": 22}).status_code, 200)
        self.transport.assert_called_with("project-deletion", project=url.rsplit("/", 1)[1],
                                         operation="delete", version=revision, actor=21)

    def test_disable_hook_filters_tenant_and_surfaces_failure(self):
        import asyncio
        from bisheng.forgemind.domain.service import revoke_project_user
        self.enterContext(patch.dict("os.environ", FORGEMIND_PROJECTS_ENABLED="1"))
        with patch("bisheng.forgemind.domain.service.request_controller", return_value={"result": {"revoked": True}}) as controller:
            asyncio.run(revoke_project_user(8, 5))
            controller.assert_not_called()
            asyncio.run(revoke_project_user(8, 4))
            controller.assert_called_once_with("project-revoke-user", user=8)
            controller.return_value = {"error": "unavailable"}
            with self.assertRaises(ControllerUnavailable):
                asyncio.run(revoke_project_user(8))


if __name__ == "__main__":
    unittest.main()
