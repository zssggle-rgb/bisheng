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

    def test_transport_failure_is_sanitized(self):
        self.transport.side_effect=ControllerUnavailable
        self.assertEqual(self.client.get(self.root).status_code,500)
        with patch("subprocess.run",side_effect=OSError("private diagnostic")):
            with self.assertRaises(ControllerUnavailable):
                request_controller("list")


if __name__ == "__main__":
    unittest.main()
