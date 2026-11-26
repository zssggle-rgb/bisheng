import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";
import { userContext } from "@/contexts/userContext";
import request from "@/controllers/request";

const url = "/api/v1/forgemind/hosts";
const instanceUrl = (name: string) => url + "/instances/" + encodeURIComponent(name);
export type Host = { name: string; created: string; seen: string | null; online: boolean | null };
export type Instance = {
  uuid: string; title: string; power: string; cpus: number; memory: number; disk: number | null;
  user_ip: string | null; platform_ip: string | null; image: string | null; mutable: boolean; connection: boolean;
};
export type HostOptions = { images: { id: string; label: string; minimum: number }[]; networks: string[] };
export type HostInput = { name: string; image: string; user_ip: string | null; cpus: number; memory: number; disk: number; request_id: string };
export type Job = { request_id: string; name: string; phase: string; error: string | null };
type Reply<T> = { result: T } | { error: string };
async function unpack<T>(response: Promise<Reply<T>>): Promise<T> {
  const body = await response;
  if ("error" in body) throw new Error(body.error);
  return body.result;
}
export function useHostAccess(projects = false) {
  const { user } = useContext(userContext);
  const scope = [user?.user_id, user?.tenant_id, user?.leaf_tenant_id].join("/");
  const access = useQuery(["host-access", scope], () =>
    request.get<never, { enabled: boolean; projects?: boolean }>(url + "/access", { showError: false }),
    { select: result => projects ? Boolean(result.projects) : result.enabled,
      enabled: Boolean(user?.user_id), retry: false, staleTime: 15000 });
  return { access, scope };
}
export const hostApi = {
  list: () => unpack<Host[]>(request.get(url)),
  summaries: () => unpack<Record<string, Pick<Instance, "title" | "user_ip">>>(request.get(url + "/summaries")),
  options: () => unpack<HostOptions>(request.get(url + "/options")),
  detail: (name: string) => unpack<Instance | null>(request.get(instanceUrl(name))),
  create: (input: HostInput) => unpack<Job>(request.post(url, input)),
  progress: (id: string) => unpack<Job>(request.get(url + "/requests/" + encodeURIComponent(id))),
  resume: (id: string) => unpack<Job>(request.post(url + "/requests/" + encodeURIComponent(id) + "/resume")),
  rename: (name: string, uuid: string, title: string) =>
    unpack<Instance>(request.put(instanceUrl(name) + "/title", { uuid, title })),
  check: (name: string, uuid: string, action: "check" | "connect") =>
    unpack<{ ok: boolean }>(request.post(instanceUrl(name) + "/" + action, { uuid })),
};

export type Feature = "delegate" | "read";
export type Member = { user: number; name: string; account: string };
export type Assignment = {
  user: number; features: Feature[]; dev: string; test: string; legacy?: string;
  bound?: boolean; feishuName?: string; paired?: boolean;
  effective?: Partial<Record<Feature, boolean>>; error?: string; githubApp?: string;
  recipient?: string; confirm?: string; pendingName?: string; pendingKey?: string;
};
export type ManagedProject = {
  deletion?: { phase: "deleting" | "failed"; error?: string };
  provisioning?: { brain?: string; rules?: string; skill?: string; service?: string; repositorySync?: string; lastSyncedAt?: string };
  qaPort?: number | null; qaPath?: string;
  guidance?: string;
  applicants?: { key: string; name: string; suffix: string }[];
  botQr?: string;
  chatRoute?: boolean;
  id: string; name: string; repository: string; assistant: string; assistantName: string; knowledgeRole?: string;
  setup?: { name?: string; phase: "authorizing" | "registered" };
  version: string; features: Feature[]; members: Assignment[]; legacy: { key: string; name: string; features: Feature[]; dev: string }[];
};
export type ProjectAssistant = { id: string; name: string; sources: Record<string, string> };
export type ProjectDeletion = {
  id: string; name: string; repository: string; version: string;
  phase: "ready" | "blocked" | "deleting" | "failed" | "deleted";
  assistantName: string; assistantState: string; members: Pick<Assignment, "user" | "dev" | "test">[];
  brain: "managed" | "existing" | "absent" | "unknown"; blockers: string[];
  steps: { key: string; state: string }[]; error?: string; resource?: string;
  workerReceipts?: Record<string, { workspace?: string; credential?: "issuance_revoked" | "not_managed" }>;
};
export type AssistantOperation = "status" | "create" | "existing" | "connect";
export type AssistantStatus = {
  phase: "empty" | "authorizing" | "expired" | "registered" | "connected";
  url?: string; name?: string; appId?: string; canConnect?: boolean;
  checks?: Partial<Record<"published" | "receive" | "reply" | "callback" | "route" | "members" | "knowledge", boolean>>;
  callback?: string;
  choices?: { id: string; name: string; appId: string; mode: "existing" | "connect" }[];
};
type TeamDirectory = { projects: ManagedProject[]; assistants: ProjectAssistant[] };
export type Deployment = { phase?: "queued" | "running" | "failed" | "passed"; error?: string; finished?: number;
  receipt?: { candidate: string; observed: string | null; target: string; url: string; healthy: boolean; matches: boolean } };
const projectsUrl = "/api/v1/forgemind/projects";
export const teamApi = {
  deletion: (id: string) => unpack<ProjectDeletion>(request.get(projectsUrl + "/" + encodeURIComponent(id) + "/deletion")),
  deleteProject: (id: string, version: string) =>
    unpack<ProjectDeletion>(request.delete(projectsUrl + "/" + encodeURIComponent(id), { data: { version } })),
  deployment: (p: ManagedProject, user: number, operation: "status" | "deploy" | "probe" | "prepare", candidate = "") =>
    unpack<Deployment>(request.post(projectsUrl + "/" + encodeURIComponent(p.id) + "/members/" + user + "/deployment",
      { operation, version: p.version, candidate })),
  assistant: (project: string, operation: AssistantOperation = "status", candidate = "") =>
    unpack<AssistantStatus>(request.post(projectsUrl + "/" + encodeURIComponent(project) + "/assistant", { operation, candidate })),
  directory: () => unpack<TeamDirectory>(request.get(projectsUrl)),
  users: () => unpack<Member[]>(request.get("/api/v1/forgemind/members")),
  save: (p: ManagedProject) => unpack<{ id: string }>(request.put(projectsUrl + "/" + encodeURIComponent(p.id),
    { name: p.name, repository: p.repository, assistant: p.assistant, knowledgeRole: p.knowledgeRole, version: p.version,
      qaPort: p.qaPort, qaPath: p.qaPath,
      members: p.members.map(({ user, features, dev, test, legacy, recipient, confirm }) =>
        ({ user, features, dev, test, legacy, recipient, confirm })) })),
  invite: (project: string, user: number) => unpack<{ qr: string; until: number }>(
    request.post(projectsUrl + "/" + encodeURIComponent(project) + "/invites/" + user)),
};
