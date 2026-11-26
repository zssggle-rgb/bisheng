import { Button, Input } from "@bisheng/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { teamApi, type Assignment, type ManagedProject } from "@/controllers/API/forgemind";

export function DeploymentCheck({ project, row, disabled, reload }: {
  project: ManagedProject; row: Assignment; disabled: boolean; reload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [candidate, setCandidate] = useState("");
  const status = useQuery(["fm-deployment", project.id, project.version, row.user, row.dev, row.test],
    () => teamApi.deployment(project, row.user, "status"), { enabled: Boolean(row.paired), retry: false,
      refetchInterval: result => result?.phase === "queued" || result?.phase === "running" ? 2500 : false });
  const submit = useMutation((action: "deploy" | "probe" | "prepare") => teamApi.deployment(project, row.user, action, candidate),
    { onSuccess: async (_, action) => { if (action === "prepare") await reload(); else await status.refetch(); } });
  const result = status.data;
  const busy = disabled || submit.isLoading || result?.phase === "running" || result?.phase === "queued" ||
    Boolean(candidate && !/^[0-9a-f]{40}$/.test(candidate));
  const error = (submit.error as Error)?.message || (status.error as Error)?.message || result?.error;
  return <div className="grid gap-2 text-sm">
    <span>{t("fmTeam.pairStatus")} · {t(row.paired ? "fmTeam.active" : "fmTeam.pending")}</span>
    {row.paired && <label className="grid gap-1">{t("fmTeam.candidate")}
      <Input value={candidate} maxLength={40} placeholder={t("fmTeam.defaultBranchHead")}
        onChange={e => setCandidate(e.target.value.trim().toLowerCase())} /></label>}
    <div className="flex flex-wrap gap-2">
      {row.paired ? <>
        <Button variant="outlined" disabled={busy} onClick={() => submit.mutate("deploy")}>{t("fmTeam.qaDeploy")}</Button>
        <Button variant="text" disabled={busy} onClick={() => submit.mutate("probe")}>{t("fmTeam.qaProbe")}</Button>
      </> : <Button variant="outlined" disabled={busy} onClick={() => submit.mutate("prepare")}>{t("fmTeam.retryPair")}</Button>}
    </div>
    {result?.phase && <p role="status">{t("fmTeam.qaResult")} · {t("fmTeam.job_" + result.phase)}</p>}
    {result?.receipt && <dl className="grid grid-cols-[auto_1fr] gap-x-3">
      <dt>{t("fmTeam.candidate")}</dt><dd className="break-all font-mono">{result.receipt.candidate}</dd>
      <dt>{t("fmTeam.servedVersion")}</dt><dd className="break-all font-mono">{result.receipt.observed || "—"}</dd>
      <dt>{t("fmTeam.test")}</dt><dd>{result.receipt.target}</dd>
      <dt>{t("fmTeam.qaUrl")}</dt><dd className="break-all"><a className="text-primary underline" href={result.receipt.url}
        target="_blank" rel="noreferrer">{result.receipt.url}</a></dd>
    </dl>}
    {error && <p role="alert">{t("fmTeam." + error, { defaultValue: t("fmTeam.operationFailed") })}</p>}
  </div>;
}
