#!/usr/bin/env python3
"""Fixed-command SSH entry point on the Autoloop controller. Standard library only."""
import contextlib
from datetime import datetime
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import time
from uuid import UUID
import xml.etree.ElementTree as ET


class Problem(Exception):
    """A stable, non-sensitive error for display by the client."""


def run(argv, timeout=12):
    return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=timeout).stdout.strip()


def save(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as out:
        try:
            json.dump(value, out)
            out.flush()
            os.fsync(out.fileno())
            os.replace(out.name, path)
        finally:
            Path(out.name).unlink(missing_ok=True)


class Manager:
    def __init__(self, config):
        self.cfg = config
        self.state = Path(config["state"]).expanduser()
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)

    def remote(self, *args, timeout=12):
        cmd = ["ssh", "-T", "-oBatchMode=yes", "-oStrictHostKeyChecking=yes",
               "-oConnectTimeout=4", self.cfg["hypervisor"], shlex.join(["env", "LC_ALL=C", *args])]
        return run(cmd, timeout)

    def virsh(self, *args, write=False):
        mode = [] if write else ["--readonly"]
        return self.remote("virsh", *mode, "-c", "qemu:///system", *args)

    def workers(self, name=None):
        db_path = Path(self.cfg["hub_db"]).expanduser().resolve().as_uri()
        query = ("SELECT k.name,k.created_at,s.seen_at FROM keys k LEFT JOIN seen s "
                 "ON s.name=k.name AND s.kind=k.kind WHERE k.kind='worker'")
        if name is not None:
            query += " AND k.name=?"
        with contextlib.closing(sqlite3.connect(db_path + "?mode=ro", uri=True, timeout=3)) as db:
            rows = db.execute(query + " ORDER BY k.name", () if name is None else (name,)).fetchall()
        return [dict(name=n, created=c, seen=s) for n, c, s in rows]

    def listing(self):
        rows = self.workers()
        try:
            agents = json.loads(run([*self.cfg["status_cli"], "status", "--json"]))["agents"]
            online = {a["worker"]: a["online"] for a in agents if isinstance(a.get("online"), bool)}
        except (KeyError, ValueError, OSError, subprocess.SubprocessError):
            online = {}
        now = time.time()
        for row in rows:
            row["online"] = online.get(row["name"])
            if row["online"] is None and row["seen"]:
                # Autoloop host/state.ts only lists rule-bound agents. For an
                # unassigned worker use its Hub stamp and the same 2 min + SEEN_EVERY window.
                with contextlib.suppress(ValueError, TypeError):
                    stamp = datetime.fromisoformat(row["seen"].replace("Z", "+00:00"))
                    if stamp.tzinfo is not None:
                        row["online"] = now - stamp.timestamp() <= 180
        return rows

    def binding(self, name):
        path = self.state / ("instance-" + name + ".json")
        if path.is_file():
            return json.loads(path.read_text())
        binding = self.cfg.get("bindings", {}).get(name, {})
        if "receipt" not in binding:
            return binding
        receipt = json.loads(Path(binding["receipt"]).expanduser().read_text())
        vm = receipt["vm"]
        if receipt["hub_worker"] != name or vm["domain"] != name:
            raise Problem("identity_changed")
        return dict(binding, uuid=str(UUID(vm["uuid"])), image=Path(receipt["image"]).name)

    def summaries(self):
        # One SSH session for all cards. The Hub list renders independently.
        names = [r["name"] for r in self.workers()
                 if re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}", r["name"])]
        targets = {name: self.binding(name).get("uuid", name) for name in names}
        script = """
import json, subprocess, sys, xml.etree.ElementTree as ET
cmd = ['virsh', '--readonly', '-c', 'qemu:///system']
domains = set(subprocess.check_output([*cmd, 'list', '--all', '--name'], text=True).splitlines())
uids = set(subprocess.check_output([*cmd, 'list', '--all', '--uuid'], text=True).splitlines())
result = {}
for name, target in json.loads(sys.argv[1]).items():
    if target not in domains and target not in uids:
        continue
    proc = subprocess.run([*cmd, 'dumpxml', '--inactive', target], capture_output=True, text=True)
    if proc.returncode == 0:
        root = ET.fromstring(proc.stdout)
        net = root.find('metadata/{urn:forgemind:worker:network:1}user-network')
        result[name] = {'title': root.findtext('title') or name, 'user_ip': net.get('address') if net is not None else None}
print(json.dumps(result))
"""
        return json.loads(self.remote("python3", "-c", script, json.dumps(targets), timeout=30))

    def instance(self, name, expected=None):
        if not self.workers(name):
            raise Problem("not_registered")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}", name):
            return None
        binding = self.binding(name)
        target = binding.get("uuid", name)
        # list --all includes powered-off and partially enrolled domains.
        if target not in self.virsh("list", "--all", "--uuid" if binding.get("uuid") else "--name").splitlines():
            return None
        root = ET.fromstring(self.virsh("dumpxml", "--inactive", target))
        if expected and (root.findtext("uuid") != expected or binding.get("uuid") != expected):
            raise Problem("identity_changed")
        return root

    def details(self, name):
        root = self.instance(name)
        if root is None:
            return None
        uid = root.findtext("uuid")
        network = root.find("metadata/{urn:forgemind:worker:network:1}user-network")
        memory = root.find("memory")
        units = {"b": 1, "bytes": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3,
                 "KB": 1000, "MB": 1000**2, "GB": 1000**3}
        state = self.virsh("domstate", uid)
        disk = next((d.find("target").get("dev") for d in root.findall("devices/disk")
                     if d.get("device") == "disk" and d.find("target") is not None), None)
        capacity = None
        if disk:
            info = self.virsh("domblkinfo", uid, disk)
            match = re.search(r"^Capacity:\s*(\d+)", info, re.M)
            capacity = int(match[1]) / 1024**3 if match else None
        platform_ip = None
        for nic in root.findall("devices/interface"):
            source, mac = nic.find("source"), nic.find("mac")
            if source is None or mac is None or source.get("network") != "default":
                continue
            leases = self.virsh("net-dhcp-leases", "default", "--mac", mac.get("address"))
            for line in leases.splitlines():
                fields = line.split()
                if "ipv4" in fields:
                    platform_ip = fields[fields.index("ipv4") + 1].split("/")[0]
                    break
        binding = self.binding(name)
        return dict(uuid=uid, title=root.findtext("title") or name, power=state,
                    cpus=int(root.findtext("vcpu")), memory=int(memory.text) * units[memory.get("unit", "KiB")] / 1024**3,
                    disk=capacity, user_ip=network.get("address") if network is not None else None,
                    platform_ip=platform_ip, image=binding.get("image"),
                    mutable=binding.get("uuid") == uid, connection=bool(binding.get("ssh_config")) and binding.get("uuid") == uid)

    def options(self):
        images = []
        for item in self.cfg["images"]:
            try:
                xml = ET.fromstring(self.virsh("vol-dumpxml", "--pool", self.cfg["pool"], item["file"]))
            except subprocess.CalledProcessError as exc:
                if "Storage volume not found" in exc.stderr:
                    continue
                raise
            images.append({"id": item["file"], "label": item["label"],
                           "minimum": (int(xml.findtext("capacity")) + 1024**3 - 1) // 1024**3})
        links = json.loads(self.remote("ip", "-j", "-4", "addr", "show", "dev", self.cfg["uplink"])) if self.cfg.get("uplink") else []
        networks = [str(ipaddress.ip_interface(f"{a['local']}/{a['prefixlen']}").network)
                    for link in links for a in link["addr_info"] if a.get("scope") == "global"]
        return dict(images=images, networks=networks)

    def enroll(self, name, ssh_config):
        args = [sys.executable, self.cfg["connect_script"], name, "--ssh-config", ssh_config,
                "--hub-host", self.cfg["hub_address"], "--cli", self.cfg["enroll_cli"]]
        if self.cfg.get("model_settings"):
            args += ["--model-settings", self.cfg["model_settings"]]
        run(args, timeout=90)

    def maintain(self, action, req):
        name, uid = req["name"], str(UUID(req["uuid"]))
        if self.instance(name, uid) is None:
            raise Problem("no_instance")
        if action == "rename":
            title = req["title"].strip()
            if not title or len(title) > 80 or not title.isprintable() or title.startswith("-"):
                raise Problem("invalid")
            self.virsh("desc", uid, "--config", "--title", "--new-desc", title, write=True)
            return self.details(name)
        profile = self.binding(name).get("ssh_config")
        if not profile:
            raise Problem("no_profile")
        actual = run(["ssh", "-F", profile, "-oBatchMode=yes", "-oStrictHostKeyChecking=yes",
                      "-oConnectTimeout=4", name, "hostname"])
        if actual != name:
            raise Problem("identity_changed")
        if action == "connect":
            self.enroll(name, profile)
        return {"ok": True}

    def job_path(self, request_id):
        return self.state / (str(UUID(request_id)) + ".json")

    def reserve_platform_address(self, uid, ip):
        root = ET.fromstring(self.virsh("dumpxml", "--inactive", uid))
        matches = [nic.find("mac").get("address") for nic in root.findall("devices/interface")
                   if nic.find("mac") is not None and nic.find("source") is not None
                   and nic.find("source").get("network") == "default"]
        if len(matches) != 1:
            raise Problem("identity_changed")
        mac = matches[0]
        reservation = ET.tostring(ET.Element("host", mac=mac, ip=str(ip)), encoding="unicode")
        missing = []
        for view, args in (("--config", ["--inactive"]), ("--live", [])):
            network = ET.fromstring(self.virsh("net-dumpxml", "default", *args))
            related = [(h.get("mac"), h.get("ip")) for h in network.findall("ip/dhcp/host")
                       if h.get("mac") == mac or h.get("ip") == str(ip)]
            if not related:
                missing.append(view)
            elif related != [(mac, str(ip))]:
                raise Problem("address_in_use")
        if missing:
            self.virsh("net-update", "default", "add-last", "ip-dhcp-host", reservation, *missing, write=True)
        self.virsh("autostart", uid, write=True)

    def progress(self, request_id):
        path = self.job_path(request_id)
        if not path.exists():
            raise Problem("missing_request")
        job = json.loads(path.read_text())
        data = {key: job.get(key) for key in ("phase", "name", "error", "request_id")}
        if job["phase"] not in ("done", "failed") and time.time() - path.stat().st_mtime > 1200:
            data.update(phase="failed", error="interrupted")
        return data

    def start(self, req, resume=False):
        req = {**req, "user_ip": req.get("user_ip")}
        path = self.job_path(req["request_id"])
        with (self.state / "requests.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if path.is_file():
                job = json.loads(path.read_text())
                if not resume and any(req[k] != job[k] for k in ("name", "image", "user_ip", "cpus", "memory", "disk")):
                    raise Problem("conflict")
                if not resume or self.progress(req["request_id"])["phase"] != "failed":
                    return self.progress(req["request_id"])
            elif resume:
                raise Problem("missing_request")
            else:
                name = req["name"]
                if not re.fullmatch(r"[a-z][a-z0-9-]{1,60}[a-z0-9]", name) or name.startswith("forgemind-image-build-"):
                    raise Problem("invalid")
                if self.workers(name) or name in self.virsh("list", "--all", "--name").splitlines() or self.binding(name):
                    raise Problem("conflict")
                opts = self.options()
                image = next((item for item in opts["images"] if item["id"] == req["image"]), None)
                if not image or not all(isinstance(req[k], int) and lo <= req[k] <= hi
                                        for k, lo, hi in (("cpus", 1, 128), ("memory", 1, 512), ("disk", image["minimum"], 4096))):
                    raise Problem("invalid")
                if req["user_ip"] is not None:
                    try:
                        ip = ipaddress.IPv4Address(req["user_ip"])
                    except ipaddress.AddressValueError:
                        raise Problem("invalid_address") from None
                    if not any(ip in ipaddress.ip_network(n) for n in opts["networks"]):
                        raise Problem("invalid_address")
                job = {key: req[key] for key in ("name", "image", "user_ip", "cpus", "memory", "disk", "request_id")}
            job.update(phase="starting", error=None)
            save(path, job)
            try:
                subprocess.Popen([sys.executable, __file__, "--job", job["request_id"]],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True, close_fds=True)
            except OSError:
                save(path, dict(job, phase="failed", error="operation_failed"))
            return self.progress(req["request_id"])

    def build(self, request_id):
        path = self.job_path(request_id)
        job = json.loads(path.read_text())
        name = job["name"]
        with (self.state / (name + ".lock")).open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            job = json.loads(path.read_text())
            if job["phase"] == "done":
                return
            try:
                if "uuid" not in job:
                    if self.workers(name) or name in self.virsh("list", "--all", "--name").splitlines():
                        raise Problem("conflict")
                    job["phase"] = "creating"
                    save(path, job)
                    template = self.virsh("vol-path", "--pool", self.cfg["pool"], job["image"])
                    network_args = ["--user-ip", job["user_ip"], "--user-uplink", self.cfg["uplink"]] if job.get("user_ip") else []
                    self.remote("env", f"FM_CPUS={job['cpus']}", f"FM_RAM_MIB={job['memory'] * 1024}",
                                f"FM_DISK_GIB={job['disk']}", self.cfg["create_script"], name, template,
                                self.cfg["hypervisor_public_key"], *network_args, timeout=900)
                    job["uuid"] = self.virsh("domuuid", name)
                    save(path, job)
                if self.virsh("domuuid", name) != job["uuid"]:
                    raise Problem("identity_changed")
                job["phase"] = "connecting"
                save(path, job)
                for attempt in range(36):
                    try:
                        access = self.remote(self.cfg["create_script"], "--access", name).split()
                        break
                    except subprocess.CalledProcessError:
                        if attempt == 35:
                            raise Problem("not_ready")
                        time.sleep(5)
                if len(access) != 4 or access[0] != name or access[2] != "ssh-ed25519" or not re.fullmatch(r"[A-Za-z0-9+/=]+", access[3]):
                    raise Problem("identity_changed")
                ip = ipaddress.IPv4Address(access[1])
                self.reserve_platform_address(job["uuid"], ip)
                directory = self.state / job["request_id"]
                directory.mkdir(exist_ok=True, mode=0o700)
                known = directory / "known_hosts"
                pin = f"{name} {access[2]} {access[3]}\n"
                if known.exists() and known.read_text() != pin:
                    raise Problem("identity_changed")
                known.write_text(pin)
                profile = directory / "ssh_config"
                profile.write_text(f"Host {name}\n HostName {ip}\n User ubuntu\n HostKeyAlias {name}\n"
                                   f" UserKnownHostsFile \"{known}\"\n IdentityFile \"{self.cfg['management_identity']}\"\n"
                                   " StrictHostKeyChecking yes\n IdentitiesOnly yes\n BatchMode yes\n ConnectTimeout 5\n")
                save(self.state / ("instance-" + name + ".json"),
                     {"uuid": job["uuid"], "image": job["image"], "ssh_config": str(profile)})
                since = time.time()
                self.enroll(name, str(profile))
                for attempt in range(30):
                    rows = self.workers(name)
                    seen = rows[0]["seen"] if rows else None
                    if seen and datetime.fromisoformat(seen.replace("Z", "+00:00")).timestamp() >= since:
                        break
                    if attempt == 29:
                        raise Problem("not_ready")
                    time.sleep(4)
                job.update(phase="done", error=None)
            except (OSError, ValueError, KeyError, ET.ParseError, sqlite3.Error, subprocess.SubprocessError, Problem) as exc:
                error = str(exc) if isinstance(exc, Problem) else "operation_failed"
                if isinstance(exc, subprocess.CalledProcessError) and job["phase"] == "creating":
                    message = exc.stderr or ""
                    if "Insufficient VM pool capacity" in message or "No space left on device" in message:
                        error = "pool_capacity"
                    elif "User IP already" in message or "User IP is already" in message:
                        error = "address_in_use"
                    elif "User IP" in message or "user IP" in message:
                        error = "invalid_address"
                    elif "already exists" in message:
                        error = "conflict"
                job.update(phase="failed", error=error)
            save(path, job)

    def dispatch(self, req):
        action = req["action"]
        if action in ("project-directory", "project-save", "project-invite", "project-revoke-user", "project-assistant", "project-deployment"):
            from project_console.administration import Administration
            from project_console.store import Problem as ProjectProblem
            admin = Administration(self.cfg, lambda: [row["name"] for row in self.workers()])
            try:
                if action == "project-directory":
                    return admin.directory()
                if action == "project-assistant":
                    from project_console.assistant_setup import AssistantSetup
                    return AssistantSetup(admin, self.cfg.get("assistant_setup", {})).inspect(
                        req["project"], req["operation"], req.get("candidate", ""))
                if action == "project-save":
                    return admin.save(req["project"], req["change"])
                if action == "project-deployment":
                    if req["operation"] == "prepare":
                        return admin.retry_member(req["project"], req["user"], req["version"])
                    from project_console.verification import dispatch
                    return dispatch(admin, req["project"], req["user"], req["operation"], req["version"],
                                    req.get("candidate", ""), __file__)
                if action == "project-revoke-user":
                    return admin.revoke_user(req["user"])
                return admin.invite(req["project"], req["user"])
            except ProjectProblem as exc:
                raise Problem(str(exc)) from None
        if action == "list":
            return self.listing()
        if action == "options":
            return self.options()
        if action == "summaries":
            return self.summaries()
        if action == "detail":
            return self.details(req["name"])
        if action in ("rename", "check", "connect"):
            return self.maintain(action, req)
        if action in ("create", "resume"):
            return self.start(req, resume=action == "resume")
        if action == "progress":
            return self.progress(req["request_id"])
        raise Problem("invalid")


def main():
    os.umask(0o077)
    try:
        config = Path(os.getenv("FORGEMIND_HOST_CONFIG", "/etc/forgemind/host-manager.json"))
        manager = Manager(json.loads(config.read_text()))
        if len(sys.argv) == 5 and sys.argv[1] == "--verify":
            from project_console.administration import Administration
            from project_console.verification import execute
            admin = Administration(manager.cfg, lambda: [r["name"] for r in manager.workers()])
            execute(admin, sys.argv[2], int(sys.argv[3]), sys.argv[4])
            return
        if len(sys.argv) == 3 and sys.argv[1] == "--job":
            manager.build(sys.argv[2])
            return
        body = sys.stdin.buffer.read(262145)
        if len(body) > 262144:
            raise Problem("request_too_large")
        result = manager.dispatch(json.loads(body))
        response = {"result": result}
    except Problem as exc:
        response = {"error": str(exc)}
    except (OSError, KeyError, TypeError, ValueError, sqlite3.Error, subprocess.SubprocessError, ET.ParseError):
        response = {"error": "unavailable"}
    print(json.dumps(response))


if __name__ == "__main__":
    main()
