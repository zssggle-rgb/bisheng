import { Button, Input } from "@bisheng/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Folder, Plus, RefreshCw, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/bs-ui/sheet";
import { hostApi, teamApi, useHostAccess, type ManagedProject, type ProjectDeletion } from "@/controllers/API/forgemind";
import { Failure } from "./HostFields";
import { availableHosts, Picker, ProjectTeamForm } from "./ProjectTeamForm";
import { MemberProjects } from "./MemberProjects";
import { RetirementDialog } from "./RetirementDialog";
import { ProjectDeletionDialog, ReleasedWorkspaces } from "./ProjectDeletionDialog";

type Mode = "members" | "projects";
const empty: ManagedProject = { id: "", name: "", repository: "", assistant: "", assistantName: "", version: "", features: ["delegate", "read"], members: [], legacy: [] };
const card = "flex min-h-52 flex-col items-start gap-2 rounded-xl border border-border bg-background-main-content p-5 text-left hover:border-primary";
export function TeamPage({ mode }: { mode: Mode }) {
  const { access, scope } = useHostAccess(true);
  if (access.isError) return <Failure retry={() => void access.refetch()} />;
  if (!access.isSuccess) return null;
  return access.data ? <Directory key={scope + mode} scope={scope} mode={mode} /> : <Navigate to="/403" replace />;
}
function Directory({ scope, mode }: { scope: string; mode: Mode }) {
  const { t } = useTranslation();
  const users = useQuery(["fm", scope, "members"], teamApi.users);
  const directory = useQuery(["fm", scope, "projects"], teamApi.directory, {
    refetchInterval: data => data?.projects.some(p => p.deletion?.phase === "deleting") ? 5000 : false,
  });
  const hosts = useQuery(["fm", scope, "list"], hostApi.list);
  const summaries = useQuery(["fm", scope, "summary"], hostApi.summaries, { enabled: hosts.isSuccess, retry: false });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Pick<ManagedProject, "id" | "name"> | null>(null);
  const [completed, setCompleted] = useState<ProjectDeletion | null>(null);
  const [removing, setRemoving] = useState<{ user: number; name: string } | null>(null);
  const newProject = () => {
    setCompleted(null);
    const id = "project-" + Array.from(crypto.getRandomValues(new Uint8Array(12)), x => x.toString(16).padStart(2, "0")).join("");
    setNewId(id);
    setSelected(id);
  };
  useEffect(() => {
    if (mode === "projects" && selected && selected !== newId && directory.data &&
        !directory.data.projects.some(p => p.id === selected)) setSelected(null);
  }, [mode, selected, newId, directory.data]);
  const refresh = () => Promise.all([users.refetch(), directory.refetch(), hosts.refetch()]);
  if (directory.isError || users.isError || hosts.isError) return <Failure retry={() => void refresh()} />;
  if (!users.data || !directory.data || !hosts.data) return <p role="status">{t("hosts.loading")}</p>;
  const projects = directory.data.projects;
  const isMember = mode === "members";
  const pendingRemovals = directory.data.pendingRemovals || [];
  const accounts = [...users.data, ...pendingRemovals.filter(id => !users.data!.some(u => u.user === id))
    .map(user => ({ user, name: "#" + user, account: "" }))];
  const current = accounts.find(u => String(u.user) === selected);
  const currentProject = isMember ? undefined : projects.find(p => p.id === selected);
  const choices = hosts.data.filter(h => !h.retirement).map(h => ({ ...h, title: summaries.data?.[h.name]?.title }));
  const memberIds = new Set([...projects.flatMap(p => p.members.map(row => row.user)), ...pendingRemovals]);
  const used = new Set(projects.map(p => p.assistant));
  const assistants = directory.data.assistants.filter(a => !used.has(a.id) || a.id === currentProject?.assistant);
  const cards = isMember ? accounts.filter(u => memberIds.has(u.user)).map(u => {
    const joined = projects.filter(p => p.members.some(m => m.user === u.user));
    const rows = joined.flatMap(p => p.members.filter(m => m.user === u.user));
    const bound = rows.some(row => row.bound);
    const displayNames = [...new Set(rows.map(row => row.feishuName).filter(Boolean))].join(" / ");
    return { id: String(u.user), name: u.name, lines: [u.account, [displayNames, t(bound ? "fmTeam.bound" : "fmTeam.unbound")].filter(Boolean).join(" · "),
      joined.map(p => p.name).join("、")], bound };
  }) : projects.map(p => ({ id: p.id, name: p.name, lines: [p.repository, p.assistantName ||
    [p.setup?.name, t("fmTeam.setup_" + (p.setup?.phase || "empty"))].filter(Boolean).join(" · "),
    t("fmTeam.people", { count: p.members.length }), ...(p.deletion ? [t("fmTeam.deletePhase_" + p.deletion.phase)] : [])], bound: false }));
  const action = t(isMember ? "fmTeam.newMember" : "fmTeam.newProject");
  return <main className="h-full overflow-auto bg-[#f8f8f8] px-6 py-8 dark:bg-background-main lg:px-10"><div className="mx-auto max-w-screen-2xl">
    <header className="mb-6 flex items-center gap-3"><h1 className="text-xl font-semibold">{t("fmTeam." + mode)}</h1>
      <span className="text-sm text-text-2">{cards.length}</span><Button className="ml-auto" variant="text"
        aria-label={t("hosts.refresh")} onClick={() => void refresh()}><RefreshCw size={16} /></Button></header>
    <div className="mb-5 flex max-w-lg gap-3"><Input prefix={<Search size={16} />} value={search} placeholder={t("fmTeam.search")}
      aria-label={t("fmTeam.search")} onChange={e => setSearch(e.target.value)} />
      {isMember && <select aria-label={t("fmTeam.binding")} className="rounded-md border border-border px-2" value={filter}
        onChange={e => setFilter(e.target.value)}>{["all", "bound", "unbound"].map(k => <option key={k} value={k}>{t("fmTeam." + k)}</option>)}</select>}</div>
    {completed && <div className="mb-4 text-sm"><p role="status">{t("fmTeam.deletedProject", { project: completed.name })}</p>
      <ReleasedWorkspaces result={completed} /></div>}
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,265px),1fr))] gap-4">
      <button className={card + " border-dashed"} onClick={() => isMember ? setSelected("new-member") : newProject()}>
        <Plus className="mb-4" /><strong>{action}</strong><ArrowRight className="mt-auto self-end" size={18} /></button>
      {cards.filter(c => (!isMember || filter === "all" || c.bound === (filter === "bound"))
        && [c.name, ...c.lines].join(" ").toLowerCase().includes(search.trim().toLowerCase())).map(c => <button
          className={card} key={c.id} onClick={() => setSelected(c.id)}>
          {isMember ? <Users className="text-primary" /> : <Folder className="text-primary" />}
          <strong>{c.name}</strong>{c.lines.map((line, i) => <span key={i} className="break-all text-sm text-text-2">{line}</span>)}</button>)}</div>
    <Sheet open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
      <SheetContent className="flex h-full w-full flex-col overflow-y-auto bg-background-main-content p-6 sm:max-w-lg"
        aria-describedby={undefined}><SheetHeader><SheetTitle>
          {(isMember ? current?.name : currentProject?.name) || action}</SheetTitle></SheetHeader>
        {isMember && (selected === "new-member" || current && !memberIds.has(current.user)) && <Picker label={t("fmTeam.existingUser")}
          placeholder={t("fmTeam.searchUser")} searchable value={current ? String(current.user) : ""} choices={users.data.filter(u => !memberIds.has(u.user))
            .map(u => ({ value: String(u.user), label: u.name + " · " + u.account }))} change={setSelected} />}
        {isMember && current && !pendingRemovals.includes(current.user) && <MemberProjects key={current.user} member={current} projects={projects} hosts={choices}
          reload={async () => { await directory.refetch({ throwOnError: true }); }} />}
        {isMember && current && memberIds.has(current.user) && <Button variant="outlined" color="danger" onClick={() => setRemoving(current)}>
          {t(pendingRemovals.includes(current.user) ? "fmTeam.cleanupPending" : "fmTeam.removeMember")}</Button>}
        {!isMember && currentProject?.deletion && <Button variant="outlined"
          onClick={() => setDeleting(currentProject)}>{t("fmTeam.deletionProgress")}</Button>}
        {!isMember && !currentProject?.deletion && selected !== null && (currentProject || newId === selected) && <ProjectTeamForm key={[selected, currentProject?.version].join("/")}
          initial={currentProject || { ...empty, id: selected }} users={users.data}
          hosts={availableHosts(choices, projects, currentProject?.id)} assistants={assistants}
          remove={currentProject ? () => setDeleting(currentProject) : undefined}
          saved={async id => { await directory.refetch({ throwOnError: true }); setNewId(null); setSelected(id); }} />}
      </SheetContent></Sheet>
    {deleting && <ProjectDeletionDialog key={deleting.id} scope={scope} project={deleting} users={users.data}
      updated={() => { void directory.refetch(); }} close={() => { setDeleting(null); void directory.refetch(); }}
      deleted={result => { setCompleted(result); setDeleting(null); setSelected(null); void directory.refetch(); }} />}
    {removing && <RetirementDialog action="removeMember" id={String(removing.user)} label={removing.name} scope={scope}
      close={() => { setRemoving(null); setSelected(null); }} updated={() => { void directory.refetch(); }} />}
  </div></main>;
}
