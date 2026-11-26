import { Button } from "@bisheng/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { teamApi, type AssistantOperation } from "@/controllers/API/forgemind";

export function ProjectAssistantSetup({ project, disabled, connected }: {
  project: string; disabled: boolean; connected: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ["fm", "project-assistant", project];
  const status = useQuery(key, () => teamApi.assistant(project), {
    onSuccess: data => { if (data.phase === "connected" && !disabled) void connected(); },
    refetchInterval: data => data?.phase === "authorizing" ? 3000 : false,
    retry: false, cacheTime: 0, refetchOnWindowFocus: true,
  });
  const [choosing, setChoosing] = useState(false);
  const action = useMutation(({ operation, candidate }: { operation: AssistantOperation; candidate?: string }) =>
    teamApi.assistant(project, operation, candidate), {
    onMutate: () => client.cancelQueries(key),
    onSuccess: async state => {
      client.setQueryData(key, state);
      if (state.phase === "connected" || state.phase === "registered") await connected();
    },
  });
  const state = status.data;
  const busy = disabled || action.isLoading || status.isLoading;
  const act = (operation: AssistantOperation, candidate?: string) => action.mutate({ operation, candidate });
  return <section aria-label={t("fmTeam.assistant")} className="grid gap-2 rounded-lg border border-border p-3">
    <strong>{t("fmTeam.assistant")} · {t("fmTeam.setup_" + (state?.phase || "loading"))}</strong>
    {(status.isError || action.isError) && <p role="alert">{t("fmTeam." + ((action.error || status.error) as Error)?.message,
      { defaultValue: t("fmTeam.operationFailed") })}</p>}
    {(state?.phase === "empty" || state?.phase === "expired") && <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outlined" disabled={busy} onClick={() => act("create")}>{t("fmTeam.createAssistant")}</Button>
        <Button variant="outlined" disabled={busy} onClick={() => { setChoosing(!choosing); void status.refetch(); }}>
          {t("fmTeam.adoptAssistant")}</Button>
      </div>
      {choosing && ((state.choices || []).length ? state.choices!.map(c =>
        <Button key={c.mode + c.id} variant="text" disabled={busy} onClick={() => act(c.mode, c.id)}>
          {c.name} · {c.appId}</Button>) : <small>{t("fmTeam.noMatchingAssistant")}</small>)}
    </>}
    {state?.phase === "authorizing" && (state.url
      ? <a className="text-primary underline" href={state.url} target="_blank" rel="noopener noreferrer">{t("fmTeam.authorizeApp")}</a>
      : <small>{t("fmTeam.waitForLink")}</small>)}
    {state?.phase === "registered" && <>
      <span>{state.name} · {state.appId}</span>
      {state.checks ? <ul className="grid gap-1 text-sm">{(["published", "receive", "reply", "route", "callback", "members", "knowledge"] as const)
        .filter(k => k !== "knowledge" || state.checks?.knowledge !== undefined)
        .map(k => <li key={k}>{t("fmTeam.check_" + k)} · {t(state.checks![k] === undefined
          ? "fmTeam.notVerified" : state.checks![k] ? "fmTeam.verified" : "fmTeam.pending")}</li>)}</ul>
        : !state.canConnect && <small>{t("fmTeam.runtimePending")}</small>}
      {state.callback && !state.checks?.callback && <small className="break-all">{t("fmTeam.inviteCallback")} · {state.callback}</small>}
      {state.checks?.published && state.checks?.route && state.checks?.reply && state.checks?.receive &&
        <a className="text-primary underline" href={"https://applink.feishu.cn/client/bot/open?appId=" + encodeURIComponent(state.appId!)}
          target="_blank" rel="noopener noreferrer">{t("fmTeam.openBot")}</a>}
      <a className="text-primary underline" href={"https://open.feishu.cn/app/" + encodeURIComponent(state.appId!)}
        target="_blank" rel="noopener noreferrer">{t("fmTeam.appConsole")}</a>
      <Button variant="outlined" disabled={busy} onClick={() => act("connect")}>
        {t(state.canConnect ? "fmTeam.connectAssistant" : "fmTeam.recheckAssistant")}</Button>
    </>}
    {state?.phase === "connected" && <Button variant="text" onClick={connected}>{t("hosts.refresh")}</Button>}
    {status.isError && <Button variant="text" onClick={() => void status.refetch()}>{t("hosts.refresh")}</Button>}
  </section>;
}
