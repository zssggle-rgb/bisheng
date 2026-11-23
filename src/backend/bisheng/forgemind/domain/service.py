"""Transport for the controller's fixed host-management command."""
import json
import os
import re
import subprocess


class ControllerUnavailable(Exception):
    pass


def owner_enabled(user_id: int, tenant_id: int) -> bool:
    return (
        bool(os.getenv("FORGEMIND_CONTROLLER"))
        and str(user_id) == os.getenv("FORGEMIND_OWNER_ID")
        and str(tenant_id) == os.getenv("FORGEMIND_TENANT_ID")
    )


def request_controller(action: str, **fields) -> dict:
    target = os.getenv("FORGEMIND_CONTROLLER", "")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", target):
        raise ControllerUnavailable
    try:
        result = subprocess.run(
            ["ssh", "-T", "-oBatchMode=yes", "-oStrictHostKeyChecking=yes",
             "-oConnectTimeout=5", target, "forgemind-host-manager"],
            input=json.dumps(dict(action=action, **fields)), capture_output=True,
            text=True, check=True, timeout=120 if action == "connect" else 45,
        )
        response = json.loads(result.stdout)
        if not isinstance(response, dict) or "result" not in response and "error" not in response:
            raise ValueError
        return response
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise ControllerUnavailable from exc
