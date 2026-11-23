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
export type HostInput = { name: string; image: string; user_ip: string; cpus: number; memory: number; disk: number; request_id: string };
export type Job = { request_id: string; name: string; phase: string; error: string | null };
type Reply<T> = { result: T } | { error: string };
async function unpack<T>(response: Promise<Reply<T>>): Promise<T> {
  const body = await response;
  if ("error" in body) throw new Error(body.error);
  return body.result;
}
export function useHostAccess() {
  const { user } = useContext(userContext);
  const scope = [user?.user_id, user?.tenant_id, user?.leaf_tenant_id].join("/");
  const access = useQuery(["host-access", scope], async (): Promise<boolean> =>
    (await request.get<never, { enabled: boolean }>(url + "/access", { showError: false })).enabled,
    { enabled: Boolean(user?.user_id), retry: false, staleTime: 15000 });
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
