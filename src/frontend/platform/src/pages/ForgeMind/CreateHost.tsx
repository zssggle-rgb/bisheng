import { Button, Input, Select } from "@bisheng/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { hostApi, type HostInput } from "@/controllers/API/forgemind";
import { Failure } from "./HostFields";

interface Props { scope: string; refresh: () => void; close: () => void }
function ipv4(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every(v => /^(0|[1-9]\d{0,2})$/.test(v) && Number(v) < 256)) return null;
  return parts.reduce((n, v) => n * 256 + Number(v), 0);
}

export function inUserNetwork(address: string, networks: string[]) {
  const value = ipv4(address);
  if (value === null) return false;
  return networks.some(cidr => {
    const [base, prefix] = cidr.split("/");
    const start = ipv4(base), bits = Number(prefix);
    if (start === null || !prefix || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(start / size) && (bits >= 31 || (value % size !== 0 && value % size !== size - 1));
  });
}

function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
export function CreateHost({ scope, refresh, close }: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const storage = "fm-host-request/" + scope;
  const [id, setId] = useState(() => sessionStorage.getItem(storage) || "");
  const [name, setName] = useState(""), [ip, setIp] = useState(""), [chosen, setChosen] = useState("");
  const [cpus, setCpus] = useState("4"), [memory, setMemory] = useState("8"), [disk, setDisk] = useState("48");
  const opts = useQuery(["fm", scope, "options"], hostApi.options, { enabled: !id, retry: false });
  const key = ["fm", scope, "request", id];
  const status = useQuery(key, () => hostApi.progress(id), {
    enabled: Boolean(id), retry: false,
    refetchInterval: data => data && ["done", "failed"].includes(data.phase) ? false : 3500,
  });
  const create = useMutation((input: HostInput) => hostApi.create(input), {
    onSuccess: job => {
      client.setQueryData(["fm", scope, "request", job.request_id], job);
      sessionStorage.setItem(storage, job.request_id); setId(job.request_id);
    },
  });
  const resume = useMutation(() => hostApi.resume(id), { onSuccess: job => client.setQueryData(key, job) });
  useEffect(() => {
    if (status.data?.phase === "done") {
      sessionStorage.removeItem(storage);
      void client.invalidateQueries(["fm", scope, "list"]);
      void client.invalidateQueries(["fm", scope, "summary"]);
    }
  }, [status.data?.phase, storage, client, scope]);
  const options = opts.data;
  const image = options?.images.find(i => i.id === chosen) ?? options?.images[0];
  const validIp = inUserNetwork(ip, options?.networks ?? []);
  const validName = /^[a-z][a-z0-9-]{1,60}[a-z0-9]$/.test(name) && !name.startsWith("forgemind-image-build-");
  const job = status.data;
  const errorText = (error?: string | null) => t("hosts." + error, { defaultValue: t("hosts.operation_failed") });
  if (id) return <section className="space-y-4 py-5" aria-live="polite">
    {job && <><h3 className="text-lg font-semibold">{job.name}</h3><p>{t("hosts.phases." + job.phase)}</p></>}
    {status.isLoading && <span>{t("hosts.loading")}</span>}
    {status.isError && <Failure retry={() => void status.refetch()} />}
    {job?.phase === "failed" && <><p>{errorText(job.error)}</p>
      <Button disabled={resume.isLoading} onClick={() => resume.mutate()}>{t("hosts.resume")}</Button></>}
    {resume.isError && <p role="alert">{errorText((resume.error as Error)?.message)}</p>}
    {(job?.phase === "failed" || status.isError) && <Button variant="text" onClick={() => {
      sessionStorage.removeItem(storage); setId(""); create.reset();
    }}>{t("hosts.backForm")}</Button>}
    {job?.phase === "done" && <Button onClick={() => { refresh(); close(); }}>{t("hosts.backList")}</Button>}
  </section>;
  if (opts.isLoading) return <p role="status">{t("hosts.loading")}</p>;
  if (opts.isError || !options) return <Failure retry={() => void opts.refetch()} />;
  return <form className="flex flex-1 flex-col gap-5 py-4" onSubmit={e => {
    e.preventDefault();
    if (!validName || !validIp || !image || create.isLoading) return;
    // Retain the request identity across ambiguous transport failures and remounts.
    const payload = { name, image: image.id, user_ip: ip, cpus: +cpus, memory: +memory, disk: +disk };
    const signature = JSON.stringify(payload);
    const prior = sessionStorage.getItem(storage + "/pending");
    const rid = prior?.endsWith(signature) ? prior.slice(0, 36) : requestId();
    sessionStorage.setItem(storage + "/pending", rid + signature);
    create.mutate({ ...payload, request_id: rid });
  }}>
    <label className="grid gap-2">{t("hosts.name")}<Input required value={name} maxLength={62} onChange={e => setName(e.target.value)} placeholder="dev-03" /></label>
    {name && !validName && <small>{t("hosts.nameHint")}</small>}
    <div className="grid gap-2"><label id="fm-image-label">{t("hosts.image")}</label>
      <Select aria-labelledby="fm-image-label" value={image?.id ?? null}
        options={options.images.map(i => ({ label: i.label, value: i.id }))}
        onChange={v => { setChosen(String(v)); const opt = options.images.find(i => i.id === v); if (opt && +disk < opt.minimum) setDisk(String(opt.minimum)); }} />
      {!image && <small>{t("hosts.noImage")}</small>}</div>
    <label className="grid gap-2">{t("hosts.userIp")}<Input required value={ip} onChange={e => setIp(e.target.value.trim())} placeholder={t("hosts.ipHint")} /></label>
    <p className="-mt-3 text-xs text-text-2">{t("hosts.networks")} · {options.networks.join(", ") || t("hosts.unconfigured")}</p>
    {ip && !validIp && <p role="status" className="-mt-2 text-sm text-text-2">{t("hosts.invalid_address")}</p>}
    <div className="grid grid-cols-3 gap-3">
      {([{ label: "cpu", value: cpus, set: setCpus, min: 1, max: 128 }, { label: "memoryGib", value: memory, set: setMemory, min: 1, max: 512 },
        { label: "diskGib", value: disk, set: setDisk, min: image?.minimum ?? 1, max: 4096 }]).map(f =>
        <label key={f.label} className="grid gap-2">{t("hosts." + f.label)}<Input type="number" required min={f.min} max={f.max} step={1}
          value={f.value} onChange={e => f.set(e.target.value)} /></label>)}
    </div>
    {create.isError && <p role="alert">{errorText((create.error as Error)?.message)}</p>}
    <div className="mt-auto flex justify-end gap-2 pt-6"><Button type="button" variant="outlined" onClick={close}>{t("hosts.cancel")}</Button>
      <Button type="submit" color="primary" disabled={create.isLoading || !image || !options.networks.length || !validIp || !validName}>{t("hosts.create")}</Button></div>
  </form>;
}
