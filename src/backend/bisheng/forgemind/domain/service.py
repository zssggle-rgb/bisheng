"""Transport for the controller's fixed host-management command."""
import json
import os
import re
import subprocess


class ControllerUnavailable(Exception):
    pass


async def tenant_accounts(tenant_id):
    from sqlmodel import select
    from bisheng.core.database import get_async_db_session
    from bisheng.database.models.tenant import UserTenant
    from bisheng.user.domain.models.user import User

    query = (select(User.user_id, User.user_name, User.external_id)
             .join(UserTenant, UserTenant.user_id == User.user_id)
             .where(UserTenant.tenant_id == tenant_id, UserTenant.is_active == 1,
                    UserTenant.status == "active", User.delete == 0)
             .order_by(User.user_name, User.user_id))
    async with get_async_db_session() as db:
        rows = (await db.exec(query)).all()
    return {uid: {"user": uid, "name": name, "account": account or name} for uid, name, account in rows}


def owner_enabled(user_id: int, tenant_id: int) -> bool:
    return (
        bool(os.getenv("FORGEMIND_CONTROLLER"))
        and str(user_id) == os.getenv("FORGEMIND_OWNER_ID")
        and str(tenant_id) == os.getenv("FORGEMIND_TENANT_ID")
    )


async def revoke_project_user(user_id: int, tenant_id: int | None = None):
    from starlette.concurrency import run_in_threadpool
    if os.getenv("FORGEMIND_PROJECTS_ENABLED") != "1":
        return
    if tenant_id is not None and str(tenant_id) != os.getenv("FORGEMIND_TENANT_ID"):
        return
    response = await run_in_threadpool(request_controller, "project-revoke-user", user=user_id)
    if not response.get("result", {}).get("revoked"):
        raise ControllerUnavailable


async def revoke_project_tenant(tenant_id: int):
    if os.getenv("FORGEMIND_PROJECTS_ENABLED") == "1" and str(tenant_id) == os.getenv("FORGEMIND_TENANT_ID"):
        from bisheng.database.models.tenant import UserTenantDao
        for uid in await UserTenantDao.aget_active_user_ids_by_tenant(tenant_id):
            await revoke_project_user(uid, tenant_id)


def request_controller(action: str, **fields) -> dict:
    target = os.getenv("FORGEMIND_CONTROLLER", "")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", target):
        raise ControllerUnavailable
    timeout = 120 if action == "connect" else 45
    if action == "project-save" or (action == "project-deployment" and fields.get("operation") == "prepare"):
        timeout = 600
    elif action == "project-assistant" and fields.get("operation") == "connect":
        timeout = 300
    try:
        result = subprocess.run(
            ["ssh", "-T", "-oBatchMode=yes", "-oStrictHostKeyChecking=yes",
             "-oConnectTimeout=5", target, "forgemind-host-manager"],
            input=json.dumps(dict(action=action, **fields)), capture_output=True,
            text=True, check=True, timeout=timeout,
        )
        response = json.loads(result.stdout)
        if not isinstance(response, dict) or "result" not in response and "error" not in response:
            raise ValueError
        return response
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise ControllerUnavailable from exc
