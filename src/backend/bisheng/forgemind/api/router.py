import os
from ipaddress import IPv4Address
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from bisheng.common.dependencies.user_deps import UserPayload
from bisheng.common.errcode.http_error import ServerError, UnAuthorizedError
from bisheng.common.schemas.api import resp_200
from bisheng.core.context.tenant import get_current_tenant_id
from bisheng.forgemind.domain.service import ControllerUnavailable, owner_enabled, request_controller, tenant_accounts

BASE_PATH = "/forgemind/hosts"
router = APIRouter(tags=["ForgeMind"])


def enabled(user: UserPayload = Depends(UserPayload.get_login_user)) -> bool:
    return owner_enabled(user.user_id, get_current_tenant_id())


def require_owner(allowed: bool = Depends(enabled)):
    if not allowed:
        raise UnAuthorizedError.http_exception()


protected = APIRouter(dependencies=[Depends(require_owner)])


class CreateHost(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9-]{1,60}[a-z0-9]$")
    image: str = Field(min_length=1, max_length=150)
    user_ip: IPv4Address
    cpus: int = Field(ge=1, le=128)
    memory: int = Field(ge=1, le=512)
    disk: int = Field(ge=1, le=4096)
    request_id: UUID


class Instance(BaseModel):
    uuid: UUID


class Title(Instance):
    title: str = Field(min_length=1, max_length=80)


def call(action, **fields):
    try:
        return resp_200(data=request_controller(action, **fields))
    except ControllerUnavailable:
        raise ServerError.http_exception() from None


@router.get(BASE_PATH + "/access")
def access(allowed: bool = Depends(enabled)):
    return resp_200(data={"enabled": allowed, "projects": allowed and os.getenv("FORGEMIND_PROJECTS_ENABLED") == "1"})


@protected.get("")
def hosts():
    return call("list")


@protected.get("/options")
def options():
    return call("options")


@protected.get("/summaries")
def summaries():
    return call("summaries")


@protected.post("")
def create(data: CreateHost):
    return call("create", **data.model_dump(mode="json"))


@protected.get("/requests/{request_id}")
def progress(request_id: UUID):
    return call("progress", request_id=str(request_id))


@protected.post("/requests/{request_id}/resume")
def resume(request_id: UUID):
    return call("resume", request_id=str(request_id))


@protected.get("/instances/{name}")
def detail(name: str):
    return call("detail", name=name)


@protected.put("/instances/{name}/title")
def rename(name: str, data: Title):
    return call("rename", name=name, uuid=str(data.uuid), title=data.title)


@protected.post("/instances/{name}/check")
def check(name: str, data: Instance):
    return call("check", name=name, uuid=str(data.uuid))


@protected.post("/instances/{name}/connect")
def connect(name: str, data: Instance):
    return call("connect", name=name, uuid=str(data.uuid))


router.include_router(protected, prefix=BASE_PATH)


class Assignment(BaseModel):
    user: int = Field(gt=0)
    features: list[Literal["delegate", "read"]] = Field(max_length=2)
    dev: str = Field(default="", pattern=r"^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})?$")
    test: str = Field(default="", pattern=r"^(?:[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})?$")
    legacy: str = Field(default="", pattern=r"^(?:[a-f0-9]{24})?$")
    recipient: str = Field(default="", max_length=254)
    confirm: str = Field(default="", pattern=r"^(?:[a-f0-9]{24})?$")


class ProjectChange(BaseModel):
    assistant: str = Field(default="", max_length=100)
    knowledgeRole: str = Field(default="", max_length=100)
    name: str = Field(min_length=1, max_length=80)
    repository: str = Field(max_length=300)
    version: str = Field(pattern=r"^(?:[0-9a-f]{64})?$")
    features: list[Literal["delegate", "read"]] = Field(max_length=2)
    members: list[Assignment] = Field(max_length=500)


def require_projects(allowed: bool = Depends(enabled)):
    if not allowed or os.getenv("FORGEMIND_PROJECTS_ENABLED") != "1":
        raise UnAuthorizedError.http_exception()


teams = APIRouter(prefix="/forgemind", dependencies=[Depends(require_projects)])


@teams.get("/members")
async def members():
    return resp_200(data={"result": list((await tenant_accounts(get_current_tenant_id())).values())})


@teams.get("/projects")
def projects():
    return call("project-directory")


@teams.put("/projects/{project}")
async def save_project(project: str, change: ProjectChange):
    accounts = await tenant_accounts(get_current_tenant_id())
    if any(row.user not in accounts for row in change.members):
        raise UnAuthorizedError.http_exception()
    return await run_in_threadpool(call, "project-save", project=project, change=change.model_dump())


@teams.post("/projects/{project}/invites/{user_id}")
async def project_invite(project: str, user_id: int):
    if user_id not in await tenant_accounts(get_current_tenant_id()):
        raise UnAuthorizedError.http_exception()
    return await run_in_threadpool(call, "project-invite", project=project, user=user_id)


router.include_router(teams)
