import { Button, Input } from "@bisheng/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/bs-ui/dialog";
import { retirementApi, type RetirementAction } from "@/controllers/API/forgemind";

export function RetirementDialog({ action, id, label, scope, close, updated }: {
  action: RetirementAction; id: string; label: string; scope: string; close: () => void; updated: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queryKey = ["fm-operation", scope, action, id];
  const preview = useQuery(queryKey, () => retirementApi.preview(action, id), {
    retry: false, cacheTime: 0, refetchOnWindowFocus: false,
  });
  const [confirmation, setConfirmation] = useState("");
  const [finished, setFinished] = useState(false);
  const submitting = useRef(false);
  const remove = useMutation((version: string) => retirementApi.confirm(action, id, version, confirmation), {
    onSuccess: result => {
      client.setQueryData(queryKey, result);
      setFinished(["removed", "retired", "destroyed", "purged"].includes(result.phase));
      updated();
    },
    onError: () => { setConfirmation(""); void preview.refetch(); },
    onSettled: () => { submitting.current = false; },
  });
  const data = preview.data;
  const permanent = action === "destroy" || action === "purge";
  const terminal = finished || data?.phase === ({ removeMember: "removed", retireHost: "retired", destroy: "destroyed", purge: "purged" })[action];
  const reason = (remove.error as Error)?.message || (preview.error as Error)?.message || data?.error;
  return <Dialog open onOpenChange={open => { if (!open && !remove.isLoading) close(); }}>
    <DialogContent aria-describedby={undefined} className="max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{t("fmTeam." + action)} · {label}</DialogTitle></DialogHeader>
      <p>{t("fmTeam." + action + "Effect")}</p>
      {preview.isLoading && <p role="status">{t("hosts.loading")}</p>}
      {data?.uuid && <p className="break-all">UUID · {data.uuid}</p>}
      {data?.items?.map((item, i) => <p key={i}>{[item.project, ...(item.features || []).map(f => t("fmTeam." + f)),
        item.dev, item.test, item.manualHandoff && t("fmTeam.manualHandoff")].filter(Boolean).join(" · ")}</p>)}
      {data?.volumes?.map(v => <p key={v} className="break-all">{v}</p>)}
      {data?.blockers?.map(b => <p key={b} role="alert">{b}</p>)}
      {reason && <p role="alert">{t("fmTeam." + reason, { defaultValue: t("hosts." + reason, { defaultValue: reason }) })}</p>}
      {terminal ? <p role="status">{t("fmTeam." + action + "Done")}</p> : <>
        {data?.phase === "pending" && <p role="status">{t("fmTeam.cleanupPending")}</p>}
        {permanent && <label>{t("fmTeam.enterHost", { name: id })}
          <Input value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
      </>}
      <DialogFooter><Button variant="outlined" disabled={remove.isLoading} onClick={close}>{t(terminal ? "close" : "cancel")}</Button>
        {!terminal && <><Button variant="text" disabled={remove.isLoading} onClick={() => void preview.refetch()}>{t("hosts.refresh")}</Button>
          <Button color="danger" disabled={!data || data.phase === "blocked" || preview.isError || preview.isFetching || remove.isLoading ||
            !!data.blockers?.length || permanent && confirmation !== id} onClick={() => {
              if (!submitting.current && data) { submitting.current = true; remove.mutate(data.version); }
            }}>{t("fmTeam.confirmAction", { action: t("fmTeam." + action) })}</Button></>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
