import { Button, Input, Select } from "@bisheng/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelectLabels } from "@/components/bs-comp/formFields/useSelectLabels";
import { ProjectAssistantName, ProjectAssistantSetup } from "./ProjectAssistantSetup";
import { DeploymentCheck } from "./DeploymentCheck";
import { teamApi, type Assignment, type Feature, type Host, type ManagedProject, type Member, type ProjectAssistant } from "@/controllers/API/forgemind";

const features: Feature[] = ["delegate", "read"];
export type WorkerChoice = Host & { title?: string };
export function availableHosts(hosts: WorkerChoice[], projects: ManagedProject[], projectId?: string) {
  const occupied = new Set(projects.filter(p => p.id !== projectId)
    .flatMap(p => [...p.members.flatMap(m => [m.dev, m.test]), ...p.legacy.map(m => m.dev)]).filter(Boolean));
  return hosts.filter(h => !occupied.has(h.name));
}
export const newAssignment = (user: number): Assignment => ({ user, features: [], dev: "", test: "" });
export function Picker({ label, value, choices, change, searchable, placeholder }: {
  label: string; value: string; choices: { value: string; label: string }[]; change: (v: string) => void;
  searchable?: boolean; placeholder?: string;
}) {
  const labels = useSelectLabels();
  return <div className="grid gap-1.5"><span>{label}</span><Select {...labels} aria-label={label} value={value || null}
    showSearch={searchable} placeholder={placeholder}
    options={choices} onChange={v => { if (v != null) change(String(v)); }} /></div>;
}
function Features({ value, allowed, change }: {
  value: Feature[]; allowed: Feature[]; change: (f: Feature[]) => void;
}) {
  const { t } = useTranslation();
  return <div className="flex gap-4">{features.map(f => <label key={f} className="flex items-center gap-1.5">
    <input type="checkbox" checked={value.includes(f) || (f === "read" && value.includes("delegate"))}
      disabled={!allowed.includes(f) || (f === "read" && value.includes("delegate")) || (f === "delegate" && !allowed.includes("read"))}
      onChange={e => change(f === "delegate" ? (e.target.checked ? ["delegate", "read"] : ["read"])
        : e.target.checked ? ["read"] : [])} />
    {t("fmTeam." + f)}</label>)}</div>;
}
function AssignmentFields({ row, project, hosts, update }: {
  row: Assignment; project: ManagedProject; hosts: WorkerChoice[]; update: (changes: Partial<Assignment>) => void;
}) {
  const { t } = useTranslation();
  const occupied = new Set(project.members.filter(m => m.user !== row.user).flatMap(m => [m.dev, m.test]));
  const options = (opposite: string) => hosts.filter(h => h.name !== opposite && !occupied.has(h.name))
    .map(h => ({ value: h.name, label: h.title ? h.title + " · " + h.name : h.name }));
  return <div className="grid gap-3">
    {row.pendingKey && !row.bound && <label className="flex items-center gap-2">
      <input type="checkbox" checked={row.confirm === row.pendingKey}
        onChange={e => update({ confirm: e.target.checked ? row.pendingKey : "" })} />
      {t("fmTeam.confirmIdentity", { name: row.pendingName })}</label>}
    <Features value={row.features} allowed={project.features} change={features =>
      update(features.includes("delegate") ? { features } : { features, dev: "", test: "" })} />
    {row.features.includes("delegate") && <div className="grid gap-2 sm:grid-cols-2">
      <Picker label={t("fmTeam.dev")} value={row.dev} choices={options(row.test)} change={dev => update({ dev })} />
      <Picker label={t("fmTeam.test")} value={row.test} choices={options(row.dev)} change={test => update({ test })} />
    </div>}
    {!row.bound && project.legacy.length > 0 && <Picker label={t("fmTeam.existing")} value={row.legacy || ""}
      choices={project.legacy.map(x => ({ value: x.key, label: x.name }))} change={legacy => {
        const entry = project.legacy.find(x => x.key === legacy);
        if (entry) update({ legacy, confirm: "", features: entry.features.filter(f => project.features.includes(f)),
          dev: entry.dev || row.dev, test: entry.dev === row.test ? "" : row.test });
      }} />}
    {project.assistant && <small className="text-text-2">{row.feishuName || t(row.bound ? "fmTeam.bound" : "fmTeam.awaitingScan")}
      {row.bound && row.feishuName && " · " + t("fmTeam.bound")}
      {row.features.map(f => " · " + t("fmTeam." + f) + " " + t(row.effective?.[f] ? "fmTeam.active" : "fmTeam.pending")).join("")}</small>}
    {row.error && <small role="status">{t("fmTeam." + row.error, { app: row.githubApp, repository: project.repository, defaultValue: t("fmTeam.pending") })}</small>}
  </div>;
}
export function ProjectTeamForm({ initial, users, hosts, assistants, user, saved, cancel, remove }: {
  initial: ManagedProject; users: Member[]; hosts: WorkerChoice[]; assistants: ProjectAssistant[];
  user?: number; saved: (id: string) => Promise<void>; cancel?: () => void; remove?: () => void;
}) {
  const { t } = useTranslation();
  const [project, setProject] = useState<ManagedProject>(() => user && !initial.members.some(r => r.user === user)
    ? { ...initial, members: [...initial.members, newAssignment(user)] } : initial);
  const saving = useMutation(() => teamApi.save(project), { onSuccess: result => saved(result.id) });
  const dirty = (["name", "repository", "features", "knowledgeRole", "qaPort", "qaPath", "members"] as const)
    .some(field => JSON.stringify(initial[field]) !== JSON.stringify(project[field]));
  const memberName = (id: number) => {
    const account = users.find(person => person.user === id);
    return account ? account.name + " · " + account.account : String(id);
  };
  const rows = user ? project.members.filter(m => m.user === user) : project.members;
  const incomplete = rows.some(r => r.features.includes("delegate") && (!r.dev || !r.test) &&
    !initial.members.some(old => old.user === r.user && old.features.includes("delegate") && old.dev === r.dev && old.test === r.test));
  const sources = assistants.find(a => a.id === project.assistant)?.sources || {};
  const changeRow = (id: number, changes: Partial<Assignment>) => setProject(previous => ({ ...previous,
    members: previous.members.map(row => row.user === id ? { ...row, ...changes } : row) }));
  return <div className="flex flex-1 flex-col gap-5 py-4 text-sm">
    {!user && <>
      <label className="grid gap-1.5">{t("fmTeam.projectName")}<Input value={project.name}
        maxLength={80} onChange={e => setProject({ ...project, name: e.target.value })} /></label>
      <label className="grid gap-1.5">{t("fmTeam.repo")}<Input value={project.repository}
        placeholder="https://github.com/owner/repository" onChange={e => setProject({ ...project, repository: e.target.value })} /></label>
      {initial.assistant ? <ProjectAssistantName project={initial} disabled={dirty || saving.isLoading}
        refreshed={() => saved(initial.id)} /> :
        initial.version ? <ProjectAssistantSetup project={initial.id} disabled={dirty || saving.isLoading}
          connected={() => saved(initial.id)} /> : <p>{t("fmTeam.assistantAfterSave")}</p>}
      {initial.chatRoute === false && <small>{t("fmTeam.missingChatRoute")}</small>}
      <details><summary>{t("fmTeam.qaEndpoint")}</summary><div className="mt-2 grid grid-cols-2 gap-3">
        <label>{t("fmTeam.qaPort")}<Input type="number" min={1} max={65535} value={project.qaPort ?? ""}
          onChange={e => setProject({ ...project, qaPort: e.target.value ? Number(e.target.value) : null })} /></label>
        <label>{t("fmTeam.qaPath")}<Input value={project.qaPath || ""} placeholder="/"
          onChange={e => setProject({ ...project, qaPath: e.target.value })} /></label></div></details>
      {initial.provisioning && <div className="grid gap-1 text-sm" aria-live="polite">
        {initial.features.includes("read") && <span>{t("fmTeam.projectBrain")} · {t("fmTeam." + (
          initial.provisioning.brain === "ready" ? "active" : initial.provisioning.brain === "project_brain_conflict" ? "brainConflict" : "setupRetry"))}</span>}
        {!!initial.features.length && <span>{t("fmTeam.baseRules")} · {t("fmTeam." + (
          initial.provisioning.rules === "ready" ? "active" : "setupRetry"))}</span>}
        {initial.guidance ? <details><summary>{t("fmTeam.projectSkill")} · {t("fmTeam.active")}</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded border p-3">{initial.guidance}</pre></details> :
          initial.provisioning.skill && <span>{t("fmTeam.projectSkill")} · {t(initial.provisioning.skill === "ready" ? "fmTeam.active" : "fmTeam.setupRetry")}</span>}
        {initial.provisioning.repositorySync && <span>{t("fmTeam.repoSync")} · {t("fmTeam.sync_" + initial.provisioning.repositorySync)}
          {initial.provisioning.lastSyncedAt && " · " + initial.provisioning.lastSyncedAt}</span>}
        <Button className="justify-self-start" variant="text" disabled={dirty || saving.isLoading}
          onClick={() => saved(initial.id)}>{t("hosts.refresh")}</Button>
      </div>}
      {!initial.provisioning && project.features.includes("read") && project.assistant && (Object.keys(sources).length ?
        <Picker label={t("fmTeam.source")} value={project.knowledgeRole || ""} choices={Object.entries(sources)
          .map(([value, label]) => ({ value, label }))} change={knowledgeRole => setProject({ ...project, knowledgeRole })} /> :
        <small>{t("fmTeam.defaultSource")}</small>)}
      <Picker label={t("fmTeam.addMember")} searchable value="" choices={users.filter(u => !project.members.some(row => row.user === u.user))
        .map(u => ({ value: String(u.user), label: memberName(u.user) }))}
        change={id => setProject({ ...project, members: [...project.members, newAssignment(Number(id))] })} />
    </>}
    {rows.map(row => <section key={row.user} className="grid gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between"><strong>{user ? project.name : memberName(row.user)}</strong>
        {(!user || initial.members.some(m => m.user === user)) && <Button variant="text" disabled={saving.isLoading}
          onClick={() => setProject({ ...project, members: project.members.filter(m => m.user !== row.user) })}>
          {t("fmTeam.remove")}</Button>}</div>
      <AssignmentFields row={row} project={project} hosts={hosts} update={changes => changeRow(row.user, changes)} />
      {initial.provisioning && initial.members.some(r => r.user === row.user) && row.features.includes("delegate") && row.dev && row.test &&
        <DeploymentCheck project={initial} row={initial.members.find(r => r.user === row.user)!} disabled={dirty || saving.isLoading}
          reload={() => saved(initial.id)} />}
    </section>)}
    {initial.assistant && !user && <section className="grid gap-2 border-t border-border pt-4">
      <strong>{initial.assistantName} · {t("fmTeam.botQr")}</strong>
      {initial.botQr && <div className="grid justify-items-start gap-2">
        <img width={200} height={200} alt={t("fmTeam.botQr")} src={initial.botQr} />
        <p>{t("fmTeam.joinCommand")}</p>
        <a className="text-primary underline" href={initial.botQr} download={project.name + ".png"}>{t("fmTeam.downloadBotQr")}</a>
        <Button variant="text" disabled={dirty || saving.isLoading} onClick={() => saved(initial.id)}>{t("hosts.refresh")}</Button>
      </div>}
      {!!initial.applicants?.length && <fieldset className="grid gap-3"><legend>{t("fmTeam.pendingScans")}</legend>
        {initial.applicants.map(a => {
          const selected = project.members.find(r => r.confirm === a.key);
          const label = (a.name || t("fmTeam.feishuUser")) + " · …" + a.suffix;
          return <Picker key={a.key} label={label} searchable value={selected ? String(selected.user) : ""}
            placeholder={t("fmTeam.matchAccount")}
            choices={project.members.filter(r => !r.bound && !r.pendingKey && (!r.confirm || r.confirm === a.key) &&
              initial.members.some(m => m.user === r.user)).map(r => ({ value: String(r.user), label: memberName(r.user) }))}
            change={id => setProject(p => ({ ...p, members: p.members.map(r => r.user === Number(id)
              ? { ...r, confirm: a.key } : r.confirm === a.key ? { ...r, confirm: "" } : r) }))} />;
        })}
      </fieldset>}
    </section>}
    {incomplete && <p role="status">{t("fmTeam.workers_required")}</p>}
    {saving.isError && <p role="alert">{t("fmTeam." + (saving.error as Error)?.message, { defaultValue: t("fmTeam.operationFailed") })}</p>}
    {user && !rows.length && <p role="status">{t("fmTeam.removeOnSave", { project: project.name })}</p>}
    <div className="mt-auto flex justify-end gap-2">{remove && <Button color="danger" variant="text" className="mr-auto"
      disabled={dirty || saving.isLoading} onClick={remove}>{t("fmTeam.deleteProject")}</Button>}
      {cancel && <Button variant="outlined" disabled={saving.isLoading}
      onClick={cancel}>{t("cancel")}</Button>}<Button color="primary" disabled={!project.id || !project.name.trim() || saving.isLoading || incomplete || (!!user && !dirty)}
      onClick={() => saving.mutate()}>{t("fmTeam.save")}</Button></div>
  </div>;
}
