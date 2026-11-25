import { Button } from "@bisheng/ui";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ManagedProject, Member } from "@/controllers/API/forgemind";
import { availableHosts, Picker, ProjectTeamForm, type WorkerChoice } from "./ProjectTeamForm";

export function MemberProjects({ member, projects, hosts, reload }: {
  member: Member; projects: ManagedProject[]; hosts: WorkerChoice[]; reload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  // Keep the version the owner opened. A newer directory response must not replace an unsaved edit.
  const [editing, setEditing] = useState<ManagedProject | null>(null);
  const [adding, setAdding] = useState(false);
  const assignments = projects.flatMap(project => {
    const row = project.members.find(m => m.user === member.user);
    return row ? [{ project, row }] : [];
  });
  const available = projects.filter(project => !project.members.some(m => m.user === member.user));
  const hostNames = new Map(hosts.map(h => [h.name, h.title ? h.title + " · " + h.name : h.name]));
  const machine = (name: string) => hostNames.get(name) || name || t("fmTeam.unassigned");
  const editor = editing && <ProjectTeamForm key={editing.id} initial={editing} user={member.user}
    users={[member]} hosts={availableHosts(hosts, projects, editing.id)} assistants={[]}
    cancel={() => setEditing(null)} saved={async () => { await reload(); setEditing(null); }} />;
  return <div className="grid gap-4 text-sm">
    <p className="text-text-2">{t("fmTeam.account")} · {member.account}</p>
    {assignments.map(({ project, row }) => <section key={project.id} aria-label={project.name}
      className="rounded-lg border border-border p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold">{project.name}</h3>
        {!editing && <Button variant="text" onClick={() => setEditing(project)}>{t("fmTeam.edit")}</Button>}
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {(["delegate", "read"] as const).map(feature => <Fragment key={feature}>
          <dt className="text-text-2">{t("fmTeam." + feature)}</dt>
          <dd>{t(!row.features.includes(feature) ? "fmTeam.notGranted" : row.effective?.[feature] ? "fmTeam.active" : "fmTeam.pending")}</dd>
        </Fragment>)}
        <dt className="text-text-2">{t("fmTeam.dev")}</dt><dd className="break-all">{machine(row.dev)}</dd>
        <dt className="text-text-2">{t("fmTeam.test")}</dt><dd className="break-all">{machine(row.test)}
          {row.paired && row.test && !hostNames.has(row.test) && " · " + t("fmTeam.unregisteredQA")}</dd>
        <dt className="text-text-2">{t("fmTeam.binding")}</dt><dd>{[row.feishuName,
          t(row.bound ? "fmTeam.bound" : "fmTeam.unbound")].filter(Boolean).join(" · ")}</dd>
      </dl>
      {row.error && <p role="status" className="mt-2">{t("fmTeam." + row.error, { defaultValue: t("fmTeam.pending") })}</p>}
      {editing?.id === project.id && editor}
    </section>)}
    {!assignments.length && !editing && <p className="text-text-2">{t("fmTeam.noMembership")}</p>}
    {editing && !assignments.some(a => a.project.id === editing.id) && editor}
    {!editing && available.length > 0 && (!assignments.length || adding
      ? <div className="grid gap-2"><Picker label={t("fmTeam.assignProject")} searchable value=""
          choices={available.map(p => ({ value: p.id, label: p.name }))}
          change={id => { setEditing(available.find(p => p.id === id) || null); setAdding(false); }} />
          {adding && <Button variant="text" onClick={() => setAdding(false)}>{t("cancel")}</Button>}</div>
      : <Button variant="outlined" onClick={() => setAdding(true)}>{t("fmTeam.assignProject")}</Button>)}
    {!projects.length && <p role="status">{t("fmTeam.noProjects")}</p>}
  </div>;
}
