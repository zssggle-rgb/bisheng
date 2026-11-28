import { Button, Input, Select } from "@bisheng/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock3, Plus, RefreshCw, Search, Server } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/bs-ui/sheet";
import { hostApi, useHostAccess } from "@/controllers/API/forgemind";
import { CreateHost } from "./CreateHost";
import { HostDetails } from "./HostDetails";
import { Failure, hostState, Seen } from "./HostFields";
export function HostsPage() {
  const { access, scope } = useHostAccess();
  if (access.isError) return <Failure retry={() => void access.refetch()} />;
  if (!access.isSuccess) return null;
  return access.data ? <Directory key={scope} scope={scope} /> : <Navigate to="/403" replace />;
}
function Directory({ scope }: { scope: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [drawer, setDrawer] = useState<{ name?: string } | null>(null);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("all");
  const list = useQuery(["fm", scope, "list"], hostApi.list, { refetchInterval: 30000, retry: false });
  const summary = useQuery(["fm", scope, "summary"], hostApi.summaries, {
    enabled: list.isSuccess && list.data.length > 0, staleTime: 30000, retry: false,
  });
  const refresh = () => void client.invalidateQueries(["fm", scope]);
  const visible = (list.data ?? []).filter(h => {
    const card = summary.data?.[h.name];
    return (filter === "history" ? !!h.retirement : (!h.retirement || h.retirement === "pending") && (filter === "all" || hostState(h) === filter)) &&
      [h.name, card?.title, card?.user_ip].some(s => s?.toLowerCase().includes(text.trim().toLowerCase()));
  });
  const selected = list.data?.find(h => h.name === drawer?.name);
  return <main className="h-full overflow-auto bg-[#f8f8f8] px-6 py-8 dark:bg-background-main lg:px-10">
    <div className="mx-auto max-w-screen-2xl">
      <header className="mb-6 flex items-center gap-3"><h1 className="text-xl font-semibold">{t("hosts.heading")}</h1>
        {list.isSuccess && <span className="text-sm text-text-2">{t("hosts.count", { count: visible.length })}</span>}
        <Button className="ml-auto" variant="text" onClick={refresh} aria-label={t("hosts.refresh")}><RefreshCw size={16} /></Button>
      </header>
      <div className="mb-5 grid max-w-lg gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Input prefix={<Search size={16} />} aria-label={t("hosts.search")} placeholder={t("hosts.search")} value={text} onChange={e => setText(e.target.value)} />
        <Select aria-label={t("hosts.filter")} value={filter} onChange={v => setFilter(String(v || "all"))}
          options={["all", "online", "offline", "never", "unknown", "history"].map(k => ({ value: k, label: t("hosts." + k) }))} />
      </div>
      {list.isError ? <Failure retry={refresh} /> : list.isLoading ? <p role="status">{t("hosts.loading")}</p> :
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,265px),1fr))] gap-4">
          <button onClick={() => setDrawer({})} className="flex min-h-52 flex-col items-start rounded-xl border border-dashed border-border bg-background-main-content p-5 text-left hover:border-primary focus-visible:outline-primary">
            <Plus className="mb-5" size={24} /><strong>{t("hosts.create")}</strong>
            <span className="mt-2 text-sm text-text-2">{t("hosts.createHint")}</span><ArrowRight className="mt-auto self-end" size={18} />
          </button>
          {visible.map(h => {
            const card = summary.data?.[h.name], status = hostState(h);
            return <button key={h.name} onClick={() => setDrawer({ name: h.name })} className="flex min-h-52 flex-col items-start gap-2 rounded-xl border border-border bg-background-main-content p-5 text-left hover:border-primary focus-visible:outline-primary">
              <span className="mb-2 flex w-full items-center justify-between"><Server className="rounded-md bg-primary/10 p-1.5 text-primary" size={30} />
                <span className="flex items-center gap-1.5 text-xs text-text-2"><i className={`size-2 rounded-full ${status === "online" ? "bg-green-600" : "bg-gray-400"}`} />{t("hosts." + status)}</span>
              </span>
              <strong className="break-all">{card?.title || h.name}</strong>
              {card?.title && card.title !== h.name && <span className="text-xs text-text-2">{h.name}</span>}
              {card && <span className="text-sm text-text-2">{t("hosts.userIp")} · {card.user_ip || t("hosts.unconfigured")}</span>}
              <span className="mt-auto flex items-center gap-1 pt-4 text-xs text-text-2"><Clock3 size={13} /><Seen value={h.seen} /></span>
            </button>;
          })}
        </div>}
      {list.isSuccess && visible.length === 0 && <p className="py-4 text-sm text-text-2">{t(text || filter !== "all" ? "hosts.noMatch" : "hosts.empty")}</p>}
      {summary.isError && <p className="mt-4 text-sm text-text-2">{t("hosts.summaryFailed")}</p>}
    </div>
    <Sheet open={drawer !== null} onOpenChange={open => { if (!open) setDrawer(null); }}>
      <SheetContent className="flex h-full w-full flex-col overflow-y-auto bg-background-main-content p-6 sm:max-w-lg" overlayClassName="bg-black/35" aria-describedby={undefined}>
        <SheetHeader><SheetTitle>{t(drawer?.name ? "hosts.detail" : "hosts.create")}</SheetTitle></SheetHeader>
        {drawer && (drawer.name ? selected ? <HostDetails key={selected.name} host={selected} scope={scope} refresh={refresh} /> :
          <p>{t("hosts.not_registered")}</p> : <CreateHost scope={scope} refresh={refresh} close={() => setDrawer(null)} />)}
      </SheetContent>
    </Sheet>
  </main>;
}
