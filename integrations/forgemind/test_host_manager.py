import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from xml.etree import ElementTree as ET

from host_manager import Manager, Problem


class HostManagerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.name = "build-a"
        self.uid = str(uuid4())
        self.db = self.base / "hub.db"
        with sqlite3.connect(self.db) as db:
            db.executescript("""
                CREATE TABLE keys(kind,name,created_at);
                CREATE TABLE seen(kind,name,seen_at);
                INSERT INTO keys VALUES ('worker','build-a','then'),('worker','external','then'),('source','other','then');
                INSERT INTO seen VALUES ('worker','build-a','now'),('source','external','wrong');
            """)
        self.m = Manager(dict(state=str(self.base), hub_db=str(self.db), status_cli=["autoloop"],
                              bindings={self.name: {"uuid": self.uid, "ssh_config": "profile"}}))
        self.xml = f"""<domain><name>{self.name}</name><uuid>{self.uid}</uuid><vcpu>4</vcpu>
            <memory unit="KiB">8388608</memory><devices><disk device="disk"><target dev="vda"/></disk>
            <interface><mac address="00:11:22:33:44:55"/><source network="default"/></interface></devices></domain>"""

    def virsh(self, command, *args, **kwargs):
        return {"list": self.uid if "--uuid" in args else self.name, "dumpxml": self.xml,
                "domstate": "running", "domblkinfo": "Capacity: 51539607552",
                "net-dhcp-leases": "lease mac ipv4 192.0.2.78/24", "desc": ""}[command]

    def test_source_filter_left_join_and_native_status(self):
        with patch("host_manager.run", return_value='{"agents":[{"worker":"build-a","online":true}]}'):
            a, b = self.m.dispatch({"action":"list"})
        self.assertEqual((a["name"], a["online"]), (self.name, True))
        self.assertEqual((b["name"], b["seen"], b["online"]), ("external", None, None))
        with patch("host_manager.run", side_effect=OSError):
            self.assertEqual(len(self.m.listing()), 2)

    def test_persistent_configuration_and_live_fields(self):
        with patch.object(self.m, "virsh", side_effect=self.virsh):
            data = self.m.dispatch({"action":"detail", "name":self.name})
            self.assertEqual((data["cpus"], data["memory"], data["disk"]), (4, 8, 48))
            self.assertEqual((data["user_ip"], data["platform_ip"]), (None, "192.0.2.78"))
            root = ET.fromstring(self.xml)
            ET.SubElement(ET.SubElement(root, "metadata"), "{urn:forgemind:worker:network:1}user-network", address="198.51.100.7")
            self.xml = ET.tostring(root, encoding="unicode")
            self.assertEqual(self.m.details(self.name)["user_ip"], "198.51.100.7")
            self.assertIsNone(self.m.details("external"))
            with self.assertRaisesRegex(Problem, "not_registered"):
                self.m.details("other")

    def test_maintenance_requires_pinned_uuid(self):
        with patch.object(self.m, "virsh", side_effect=self.virsh), patch("host_manager.run", return_value=self.name):
            req = dict(name=self.name, uuid=self.uid, title="Development")
            self.assertTrue(self.m.maintain("check", req)["ok"])
            self.assertEqual(self.m.maintain("rename", req)["uuid"], self.uid)
            with self.assertRaisesRegex(Problem, "identity_changed"):
                self.m.maintain("rename", dict(req, uuid=str(uuid4())))
            with self.assertRaisesRegex(Problem, "invalid"):
                self.m.maintain("rename", dict(req, title=" "))
            self.m.cfg["bindings"] = {}
            with self.assertRaisesRegex(Problem, "identity_changed"):
                self.m.maintain("rename", req)

    def test_create_idempotency_and_validation(self):
        req = dict(name="build-new", request_id=str(uuid4()), cpus=4, memory=8, disk=48,
                   image="worker.qcow2", user_ip="198.51.100.7")
        options = dict(images=[dict(id="worker.qcow2", minimum=48)], networks=["198.51.100.0/24"])
        with patch.object(self.m, "virsh", return_value=""), patch.object(self.m, "options", return_value=options), patch("host_manager.subprocess.Popen") as spawn:
            for overrides, reason in [({"name":self.name},"conflict"), ({"disk":47},"invalid"),
                                      ({"user_ip":"192.0.2.7"},"invalid_address")]:
                with self.assertRaisesRegex(Problem, reason):
                    self.m.start(dict(req, **overrides))
            self.assertEqual(self.m.start(req)["phase"], "starting")
            self.assertEqual(self.m.start(req)["request_id"], req["request_id"])
            spawn.assert_called_once()
            with self.assertRaisesRegex(Problem, "conflict"):
                self.m.start(dict(req, user_ip="198.51.100.8"))
            with self.assertRaisesRegex(Problem, "missing_request"):
                self.m.progress(str(uuid4()))

    def test_partial_create_resumes_same_instance_and_pins_host(self):
        name, rid = "build-new", str(uuid4())
        job = dict(name=name, request_id=rid, image="worker.qcow2", user_ip="198.51.100.7", cpus=2, memory=8, disk=48, phase="starting")
        self.m.job_path(rid).write_text(json.dumps(job))
        self.m.cfg.update(create_script="/opt/create", pool="images", hypervisor_public_key="/public",
                          management_identity="/key", uplink="lan0")
        def remote(*cmd, **kwargs):
            return f"{name} 192.0.2.78 ssh-ed25519 AQAB" if "--access" in cmd else ""
        with patch.object(self.m, "virsh", side_effect=lambda cmd,*args: {"list":"", "vol-path":"/images/a", "domuuid":self.uid}[cmd]), \
                patch.object(self.m, "remote", side_effect=remote) as commands, \
                patch.object(self.m,"workers",side_effect=lambda n: [] if not self.m.binding(n) else [{"seen":"2099-01-01T00:00:00Z"}]), \
                patch.object(self.m,"reserve_platform_address"), patch.object(self.m,"enroll",side_effect=[OSError(), None]):
            self.m.build(rid)
            self.assertEqual(self.m.progress(rid)["phase"], "failed")
            self.assertEqual(self.m.binding(name)["uuid"], self.uid)
            self.m.build(rid)
            self.assertEqual(self.m.progress(rid)["phase"], "done")
            self.assertEqual(sum("--user-ip" in c.args for c in commands.call_args_list), 1)
            self.assertIn("StrictHostKeyChecking yes", (self.base/rid/"ssh_config").read_text())

    def test_network_reservation_updates_only_missing_view(self):
        entry = '<network><ip><dhcp><host mac="00:11:22:33:44:55" ip="192.0.2.78"/></dhcp></ip></network>'
        def virsh(cmd, *args, **kwargs):
            if cmd == "dumpxml":
                return self.xml
            if cmd == "net-dumpxml":
                return entry if "--inactive" in args else "<network/>"
            return ""
        with patch.object(self.m, "virsh", side_effect=virsh) as calls:
            self.m.reserve_platform_address(self.uid,"192.0.2.78")
            update = next(c for c in calls.call_args_list if c.args[0] == "net-update")
            self.assertIn("--live",update.args)
            self.assertNotIn("--config",update.args)
            with self.assertRaisesRegex(Problem, "address_in_use"):
                self.m.reserve_platform_address(self.uid,"192.0.2.79")

    def test_detail_failure_distinct_from_external_and_bad_action(self):
        with patch.object(self.m, "virsh", side_effect=subprocess.TimeoutExpired("virsh", 5)):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.m.details(self.name)
        with self.assertRaisesRegex(Problem, "invalid"):
            self.m.dispatch({"action":"shell"})


if __name__ == "__main__":
    unittest.main()
