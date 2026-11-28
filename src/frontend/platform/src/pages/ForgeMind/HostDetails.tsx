import { Button, Input } from "@bisheng/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { hostApi, type Host } from "@/controllers/API/forgemind";
import { Failure, hostState, Seen } from "./HostFields";
import { RetirementDialog } from "./RetirementDialog";
import type { RetirementAction } from "@/controllers/API/forgemind";

interface Props { host: Host; scope: string; refresh: () => void }
export function HostDetails({ host, scope, refresh }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState<string | null>(null);
  const [action, setAction] = useState<RetirementAction | null>(null);
  const details = useQuery(["fm", scope, "detail", host.name], () => hostApi.detail(host.name), { retry: false, enabled: !host.retirement });
  const vm = details.data;
  const op = useMutation(async (action: "rename" | "connect" | "check") => {
    if (!vm) return;
    if (action === "rename") await hostApi.rename(host.name, vm.uuid, title?.trim() ?? "");
    else await hostApi.check(host.name, vm.uuid, action);
  }, { onSuccess: () => { setTitle(null); refresh(); } });
  function row(label: string, value: React.ReactNode) {
    return <div className="flex justify-between gap-4 border-b border-border py-3"><dt className="shrink-0 text-text-2">{t("hosts." + label)}</dt><dd className="break-all text-right">{value}</dd></div>;
  }
  return <div className="space-y-5 py-3 text-sm">
    <h3 className="break-all text-lg font-semibold">{vm?.title || host.name}</h3>
    <dl>{row("registration", host.name)}{row("status", t("hosts." + hostState(host)))}
      {row("registeredAt", <Seen value={host.created} />)}{row("lastSeen", <Seen value={host.seen} />)}</dl>
    {details.isInitialLoading && <p role="status">{t("hosts.loading")}</p>}
    {details.isError && <Failure retry={() => void details.refetch()} />}
    {!host.retirement && details.isSuccess && (vm ? <>
      <dl>{row("power", t("hosts.powerStates." + vm.power, { defaultValue: vm.power }))}
        {row("cpu", t("hosts.cores", { count: vm.cpus }))}{row("memory", vm.memory + " GiB")}
        {row("disk", vm.disk === null ? t("hosts.noRecord") : vm.disk + " GiB")}
        {row("userIp", vm.user_ip || t("hosts.unconfigured"))}{row("platformIp", vm.platform_ip || t("hosts.noAddress"))}
        {row("image", vm.image || t("hosts.noRecord"))}</dl>
      {vm.mutable && <form onSubmit={e => { e.preventDefault(); op.mutate("rename"); }} className="space-y-2">
        <label htmlFor="fm-title">{t("hosts.displayName")}</label>
        <div className="flex gap-2"><Input id="fm-title" maxLength={80} value={title ?? vm.title} onChange={e => setTitle(e.target.value)} />
          <Button type="submit" disabled={!title?.trim() || title.trim() === vm.title || op.isLoading}>{t("hosts.save")}</Button></div>
      </form>}
      {vm.connection && <div className="flex gap-2"><Button variant="outlined" disabled={op.isLoading} onClick={() => op.mutate("check")}>{t("hosts.check")}</Button>
        {host.online !== true && <Button variant="outlined" disabled={op.isLoading} onClick={() => op.mutate("connect")}>{t("hosts.reconnect")}</Button>}</div>}
      {op.isSuccess && <p role="status">{t(op.variables === "check" ? "hosts.connected" : "hosts.saved")}</p>}
      {op.isError && <p role="alert">{t("hosts." + (op.error as Error)?.message, { defaultValue: t("hosts.operation_failed") })}</p>}
    </> : <p className="text-text-2">{t("hosts.no_instance")}</p>)}
    {(!host.retirement || host.retirement === "pending") && <Button color="danger" variant="outlined"
      onClick={() => setAction("retireHost")}>{t("fmTeam.retireHost")}</Button>}
    {host.disposable && host.retirement === "retired" && <Button color="danger" variant="outlined"
      onClick={() => setAction("destroy")}>{t("fmTeam.destroy")}</Button>}
    {host.disposable && host.retirement === "destroyed" && <Button color="danger" variant="outlined"
      onClick={() => setAction("purge")}>{t("fmTeam.purge")}</Button>}
    {action && <RetirementDialog key={action} action={action} id={host.name} label={host.name} scope={scope}
      close={() => { setAction(null); refresh(); }} updated={refresh} />}
  </div>;
}
