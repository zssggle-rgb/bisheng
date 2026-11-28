import { Button } from "@bisheng/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/bs-ui/dialog";
import { teamApi, type Member, type ProjectDeletion } from "@/controllers/API/forgemind";

export function ReleasedWorkspaces({ result }: { result: ProjectDeletion }) {
  const { t } = useTranslation();
  const released = Object.entries(result.workerReceipts || {});
  if (!released.length) return null;
  return <details className="text-sm"><summary>{t("fmTeam.releasedWorkspaces")}</summary>
    <ul className="mt-2 grid gap-1">{released.map(([id, item]) => <li key={id}>
      {result.members.find(row => String(row.user) === id)?.dev || id}
      {item.workspace && <span className="break-all"> · {item.workspace}</span>}
      {item.credential === "issuance_revoked" && <p>{t("fmTeam.gitGrantRetired")}</p>}
    </li>)}</ul></details>;
}

export function ProjectDeletionDialog({ scope, project, users, close, updated, deleted }: {
  scope: string; project: { id: string; name: string }; users: Member[];
  close: () => void; updated: () => void; deleted: (result: ProjectDeletion) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ["fm", scope, "project-deletion", project.id];
  const preview = useQuery(key, () => teamApi.deletion(project.id), {
    retry: false, cacheTime: 0, refetchOnWindowFocus: false,
    refetchInterval: data => data?.phase === "deleting" ? 2500 : false,
  });
  const result = preview.data;
  const submitted = useRef(false);
  const remove = useMutation((version: string) => teamApi.deleteProject(project.id, version), {
    onSuccess: response => { client.setQueryData(key, response); updated(); },
    onError: () => { void preview.refetch(); },
    onSettled: () => { submitted.current = false; },
  });
  const notified = useRef(false);
  useEffect(() => {
    if (result?.phase === "deleted" && !notified.current) {
      notified.current = true;
      deleted(result);
    }
  }, [result, deleted]);
  const canSubmit = result && (result.phase === "ready" || result.phase === "failed") &&
    !result.blockers.length && !preview.isFetching && !preview.isError && !remove.isLoading;
  const explain = (code: string) => t("fmTeam." + code, { defaultValue: code });
  const error = (remove.error as Error)?.message || (preview.error as Error)?.message || result?.error;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("fmTeam.deleteTitle", { project: project.name })}</DialogTitle></DialogHeader>
      {preview.isInitialLoading && <p role="status">{t("hosts.loading")}</p>}
      {result && <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt>{t("fmTeam.repo")}</dt><dd className="break-all">{result.repository || t("fmTeam.unassigned")}</dd>
          <dt>{t("fmTeam.assistant")}</dt><dd>{[result.assistantName, result.assistantState && t("fmTeam.setup_" + result.assistantState, { defaultValue: result.assistantState })].filter(Boolean).join(" · ") || t("fmTeam.unassigned")}</dd>
          <dt>{t("fmTeam.deleteMembers")}</dt><dd>{result.members.length ? <ul>{result.members.map(row => {
            const account = users.find(u => u.user === row.user);
            return <li key={row.user} className="break-words">
              <strong>{account ? account.name + " · " + account.account : row.user}</strong>
              {row.dev && <div>{t("fmTeam.dev")} · {row.dev}</div>}
              {row.test && <div>{t("fmTeam.test")} · {row.test}</div>}
            </li>;
          })}</ul> : t("fmTeam.unassigned")}</dd>
          <dt>{t("fmTeam.projectBrain")}</dt><dd>{t("fmTeam.deleteBrain_" + result.brain)}</dd>
        </dl>
        <p className="text-sm text-text-2">{t("fmTeam.deleteEffects")}</p>
        {result.phase !== "ready" && <p role="status">{t("fmTeam.deletePhase_" + result.phase)}</p>}
        {!!result.blockers.length && <ul role="alert">{result.blockers.map(reason => <li key={reason}>{explain(reason)}</li>)}</ul>}
        {!!result.steps.length && <ol className="grid gap-1 text-sm">{result.steps.map(step => <li key={step.key}>
          {t("fmTeam.deleteStep_" + step.key, { defaultValue: step.key })} · {t("fmTeam.deleteState_" + step.state, { defaultValue: step.state })}
        </li>)}</ol>}
        <ReleasedWorkspaces result={result} />
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{explain(error)}{result?.resource && " · " + result.resource}</p>}
      <DialogFooter>
        <Button variant="text" onClick={close}>{t("close")}</Button>
        {(!result || result.phase === "blocked" || preview.isError) && <Button variant="outlined" disabled={preview.isFetching}
          onClick={() => void preview.refetch()}>{t("hosts.refresh")}</Button>}
        {(result?.phase === "ready" || result?.phase === "failed") && <Button color="danger" disabled={!canSubmit}
          onClick={() => {
            if (canSubmit && !submitted.current) { submitted.current = true; remove.mutate(result.version); }
          }}>{t(result.phase === "failed" ? "fmTeam.retryDeletion" : "fmTeam.confirmDelete")}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
