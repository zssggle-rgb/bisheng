import { Button, Input, Select } from "@bisheng/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { teamApi, type Assignment, type Feature, type Host, type ManagedProject, type Member, type ProjectAssistant } from "@/controllers/API/forgemind";

const features: Feature[] = ["delegate", "read"];
type WorkerChoice = Host & { title?: string };
export const newAssignment = (user: number): Assignment => ({ user, features: [], dev: "", test: "" });
export function Picker({ label, value, choices, change }: {
  label: string; value: string; choices: { value: string; label: string }[]; change: (v: string) => void;
}) {
  return <div className="grid gap-1.5"><span>{label}</span><Select aria-label={label} value={value || null}
    options={choices} onChange={v => { if (v != null) change(String(v)); }} /></div>;
}
function Features({ value, allowed, change }: {
  value: Feature[]; allowed: Feature[]; change: (f: Feature[]) => void;
}) {
  const { t } = useTranslation();
  return <div className="flex gap-4">{features.map(f => <label key={f} className="flex items-center gap-1.5">
    <input type="checkbox" checked={value.includes(f)} disabled={!allowed.includes(f)}
      onChange={e => change(e.target.checked ? [...value, f] : value.filter(x => x !== f))} />
    {t("fmTeam." + f)}</label>)}</div>;
}
function AssignmentFields({ row, project, hosts, update }: {
  row: Assignment; project: ManagedProject; hosts: WorkerChoice[]; update: (row: Assignment) => void;
}) {
  const { t } = useTranslation();
  const occupied = new Set(project.members.filter(m => m.user !== row.user).flatMap(m => [m.dev, m.test]));
  const options = (opposite: string) => hosts.filter(h => h.name !== opposite && !occupied.has(h.name))
    .map(h => ({ value: h.name, label: h.title ? h.title + " · " + h.name : h.name }));
  return <div className="grid gap-3">
    {!row.bound && <label className="grid gap-1.5">{t("fmTeam.recipient")}<Input value={row.recipient || ""}
      placeholder={t("fmTeam.recipientHint")} onChange={e => update({ ...row, recipient: e.target.value })} /></label>}
    {row.pendingKey && !row.bound && <label className="flex items-center gap-2">
      <input type="checkbox" checked={row.confirm === row.pendingKey}
        onChange={e => update({ ...row, confirm: e.target.checked ? row.pendingKey : "" })} />
      {t("fmTeam.confirmIdentity", { name: row.pendingName })}</label>}
    <Features value={row.features} allowed={project.features} change={f => update({
      ...row, features: f, dev: f.includes("delegate") ? row.dev : "", test: f.includes("delegate") ? row.test : "",
    })} />
    {row.features.includes("delegate") && <div className="grid gap-2 sm:grid-cols-2">
      <Picker label={t("fmTeam.dev")} value={row.dev} choices={options(row.test)} change={dev => update({ ...row, dev })} />
      <Picker label={t("fmTeam.test")} value={row.test} choices={options(row.dev)} change={test => update({ ...row, test })} />
    </div>}
    {!row.bound && project.legacy.length > 0 && <Picker label={t("fmTeam.existing")} value={row.legacy || ""}
      choices={project.legacy.map(x => ({ value: x.key, label: x.name }))} change={legacy => {
        const entry = project.legacy.find(x => x.key === legacy);
        if (entry) update({ ...row, legacy, confirm: "", features: entry.features.filter(f => project.features.includes(f)),
          dev: entry.dev || row.dev, test: entry.dev === row.test ? "" : row.test });
      }} />}
    <small className="text-text-2">{row.feishuName || t(row.bound ? "fmTeam.bound" : "fmTeam.unbound")}
      {row.bound && row.feishuName && " · " + t("fmTeam.bound")}
      {row.features.map(f => " · " + t("fmTeam." + f) + " " + t(row.effective?.[f] ? "fmTeam.active" : "fmTeam.pending")).join("")}</small>
    {row.error && <small role="status">{t("fmTeam." + row.error, { defaultValue: t("fmTeam.pending") })}</small>}
  </div>;
}
export function ProjectTeamForm({ initial, users, hosts, assistants, user, saved }: {
  initial: ManagedProject; users: Member[]; hosts: WorkerChoice[]; assistants: ProjectAssistant[];
  user?: number; saved: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [project, setProject] = useState<ManagedProject>(() => user && !initial.members.some(r => r.user === user)
    ? { ...initial, members: [...initial.members, newAssignment(user)] } : initial);
  const [invitee, setInvitee] = useState("");
  const saving = useMutation(() => teamApi.save(project), { onSuccess: result => saved(result.id) });
  const invitation = useMutation(() => teamApi.invite(initial.id, Number(invitee)));
  const dirty = JSON.stringify(initial) !== JSON.stringify(project);
  const memberName = (id: number) => {
    const account = users.find(person => person.user === id);
    return account ? account.name + " · " + account.account : String(id);
  };
  const rows = user ? project.members.filter(m => m.user === user) : project.members;
  const sources = assistants.find(a => a.id === project.assistant)?.sources || {};
  const changeRow = (row: Assignment) => setProject({ ...project,
    members: project.members.map(m => m.user === row.user ? row : m) });
  return <div className="flex flex-1 flex-col gap-5 py-4 text-sm">
    {!user && <>
      <label className="grid gap-1.5">{t("fmTeam.projectName")}<Input value={project.name}
        maxLength={80} onChange={e => setProject({ ...project, name: e.target.value })} /></label>
      <label className="grid gap-1.5">{t("fmTeam.repo")}<Input value={project.repository}
        placeholder="https://github.com/owner/repository" onChange={e => setProject({ ...project, repository: e.target.value })} /></label>
      {initial.assistant ? <div>{t("fmTeam.assistant")} · {project.assistantName}</div> :
        <Picker label={t("fmTeam.assistant")} value={project.assistant} choices={assistants.map(a => ({ value: a.id, label: a.name }))}
          change={assistant => setProject({ ...project, assistant, knowledgeRole: "" })} />}
      <fieldset className="grid gap-2"><legend>{t("fmTeam.projectFeatures")}</legend>
        <Features value={project.features} allowed={features} change={enabled => setProject({ ...project, features: enabled,
          members: project.members.map(row => ({ ...row, features: row.features.filter(f => enabled.includes(f)),
            dev: enabled.includes("delegate") ? row.dev : "", test: enabled.includes("delegate") ? row.test : "" })) })} /></fieldset>
      {project.features.includes("read") && project.assistant && (Object.keys(sources).length ?
        <Picker label={t("fmTeam.source")} value={project.knowledgeRole || ""} choices={Object.entries(sources)
          .map(([value, label]) => ({ value, label }))} change={knowledgeRole => setProject({ ...project, knowledgeRole })} /> :
        <small>{t("fmTeam.defaultSource")}</small>)}
      <Picker label={t("fmTeam.addMember")} value="" choices={users.filter(u => !project.members.some(row => row.user === u.user))
        .map(u => ({ value: String(u.user), label: memberName(u.user) }))}
        change={id => setProject({ ...project, members: [...project.members, newAssignment(Number(id))] })} />
    </>}
    {rows.map(row => <section key={row.user} className="grid gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between"><strong>{user ? project.name : memberName(row.user)}</strong>
        <Button variant="text" onClick={() => setProject({ ...project, members: project.members.filter(m => m.user !== row.user) })}>
          {t("fmTeam.remove")}</Button></div>
      <AssignmentFields row={row} project={project} hosts={hosts} update={changeRow} />
    </section>)}
    {initial.assistant && !user && <section className="grid gap-2 border-t border-border pt-4">
      <strong>{project.assistantName} · {t("fmTeam.invite")}</strong>
      <Picker label={t("fmTeam.invitee")} value={invitee} choices={initial.members.filter(r => !r.bound)
        .map(r => ({ value: String(r.user), label: memberName(r.user) }))}
        change={id => { setInvitee(id); invitation.reset(); }} />
      <Button variant="outlined" disabled={dirty || !invitee || invitation.isLoading} onClick={() => invitation.mutate()}>
        {t("fmTeam.makeQr")}</Button>
      {!dirty && invitation.data && <div><img width={200} height={200} alt={t("fmTeam.invite")} src={invitation.data.qr} />
        <small>{t("fmTeam.expires")} {new Date(invitation.data.until * 1000).toLocaleString()}</small></div>}
      {invitation.isError && <span role="alert">{t("fmTeam.operationFailed")}</span>}
    </section>}
    {saving.isError && <p role="alert">{t("fmTeam." + (saving.error as Error)?.message, { defaultValue: t("fmTeam.operationFailed") })}</p>}
    <div className="mt-auto flex justify-end"><Button color="primary" disabled={!project.id || !project.name.trim() || saving.isLoading}
      onClick={() => saving.mutate()}>{t("fmTeam.save")}</Button></div>
  </div>;
}
