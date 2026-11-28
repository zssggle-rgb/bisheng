import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hostApi, retirementApi, teamApi, type ManagedProject, type ProjectDeletion } from "@/controllers/API/forgemind";
import { TeamPage } from "./TeamPage";

vi.mock("@/controllers/API/forgemind", () => ({
  hostApi: { list: vi.fn(), summaries: vi.fn() },
  retirementApi: { preview: vi.fn(), confirm: vi.fn() },
  teamApi: { users: vi.fn(), directory: vi.fn(), save: vi.fn(), invite: vi.fn(), assistant: vi.fn(), deployment: vi.fn(),
    deletion: vi.fn(), deleteProject: vi.fn() },
  useHostAccess: () => ({ access: { isSuccess: true, data: true }, scope: "test" }),
}));
const project = (id: string): ManagedProject => ({ id, name: id, version: id + "-v1", assistant: "",
  assistantName: "", repository: "", features: ["delegate", "read"], legacy: [], members: [] });
let projects: ManagedProject[];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(teamApi.assistant).mockResolvedValue({ phase: "empty" });
  projects = [project("Alpha"), project("Beta")];
  vi.mocked(teamApi.users).mockResolvedValue([{ user: 3, name: "First Member", account: "user-one" },
    { user: 4, name: "Second Member", account: "user-two" }]);
  vi.mocked(teamApi.directory).mockImplementation(async () => ({ projects, assistants: [] }));
  vi.mocked(hostApi.list).mockResolvedValue(["dev-1", "test-1"].map(name => ({ name, created: "", seen: null, online: null })));
  vi.mocked(hostApi.summaries).mockResolvedValue({});
  vi.mocked(teamApi.save).mockImplementation(async changed => {
    projects = projects.map(p => p.id === changed.id ? { ...changed, version: changed.version + "-saved" } : p);
    return { id: changed.id };
  });
});
afterEach(cleanup);

it("shows the published bot name until Feishu confirms the requested name", async () => {
  projects[0] = { ...projects[0], assistant: "alpha-bot", assistantName: "Original" };
  const naming = { appId: "cli_alpha", name: "Original", desired: "Alpha Assistant", status: "publish" as const };
  vi.mocked(teamApi.assistant).mockResolvedValueOnce({ phase: "connected", naming })
    .mockImplementationOnce(async () => {
      projects = [{ ...projects[0], assistantName: naming.desired }, projects[1]];
      return { phase: "connected", naming: { ...naming, name: naming.desired, status: "active" } };
    });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.renameAssistant" }));
  fireEvent.change(screen.getByLabelText("fmTeam.feishuDisplayName"), { target: { value: naming.desired } });
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.submitName" }));
  expect(await screen.findByText("fmTeam.name_publish")).toBeVisible();
  expect(screen.getByText("fmTeam.assistant · Original")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.checkFeishuName" }));
  expect(await screen.findByText("fmTeam.assistant · Alpha Assistant")).toBeVisible();
  expect(screen.queryByText("fmTeam.name_publish")).toBeNull();
  expect(teamApi.save).not.toHaveBeenCalled();
});

it("removes a member only after the cross-project impact has been confirmed", async () => {
  projects[0].members.push({ user: 3, features: ["read"], dev: "", test: "" });
  vi.mocked(retirementApi.preview).mockResolvedValue({ phase: "ready", version: "opened", blockers: [],
    items: [{ project: "Alpha", dev: "", test: "", features: ["read"] }] });
  vi.mocked(retirementApi.confirm).mockResolvedValue({ phase: "removed", version: "updated", blockers: [], items: [] });
  openPage("members");
  fireEvent.click(await screen.findByRole("button", { name: /First Member/ }));
  fireEvent.click(await screen.findByRole("button", { name: "fmTeam.removeMember" }));
  const confirm = await screen.findByRole("button", { name: "fmTeam.confirmAction" });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(retirementApi.confirm).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  expect(await screen.findByText("fmTeam.removeMemberDone")).toBeVisible();
  expect(retirementApi.confirm).toHaveBeenCalledWith("removeMember", "3", "opened", "");
});

it("offers Feishu creation after the first save, then resumes the official confirmation", async () => {
  vi.mocked(teamApi.save).mockImplementationOnce(async p => {
    projects = [...projects, { ...p, version: "v1" }];
    return { id: p.id };
  });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: "fmTeam.newProject" }));
  expect(screen.queryByLabelText("fmTeam.assistant")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.change(screen.getByLabelText("fmTeam.projectName"), { target: { value: "New project" } });
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.save" }));
  const create = await screen.findByRole("button", { name: "fmTeam.createAssistant" });
  vi.mocked(teamApi.assistant).mockResolvedValue({ phase: "authorizing", url: "https://open.feishu.cn/page/cli?user_code=example" });
  fireEvent.click(create);
  expect(await screen.findByRole("link", { name: "fmTeam.authorizeApp" })).toHaveAttribute("href", "https://open.feishu.cn/page/cli?user_code=example");
  expect(screen.queryByRole("button", { name: "fmTeam.makeQr" })).toBeNull();
});

it("deploys the saved member pair and displays the SHA reported by the running service", async () => {
  const p = projects[0];
  p.provisioning = { brain: "ready", rules: "ready" };
  p.members = [{ user: 3, dev: "dev-1", test: "test-1", features: ["delegate"], paired: true }];
  const sha = "a".repeat(40);
  let deployed = false;
  vi.mocked(teamApi.deployment).mockImplementation(async (_p, uid, operation) => {
    expect(uid).toBe(3);
    if (operation === "deploy") { deployed = true; return { phase: "queued" }; }
    return deployed ? { phase: "passed", receipt: { candidate: sha, observed: sha, healthy: true,
      matches: true, target: "test-1", url: "http://test-1:18080" } } : {};
  });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  fireEvent.click(await screen.findByRole("button", { name: "fmTeam.qaDeploy" }));
  expect(await screen.findByRole("link", { name: /test-1:18080/ })).toBeVisible();
  expect(screen.getAllByText(sha)).toHaveLength(2);
});

it("shows independent team brain and routing status for a managed project", async () => {
  projects[0].features = ["read", "delegate"];
  projects[0].provisioning = { brain: "project_brain_conflict", rules: "ready" };
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  expect(screen.getByText(/fmTeam.projectBrain.*fmTeam.brainConflict/)).toBeVisible();
  expect(screen.getByText(/fmTeam.baseRules.*fmTeam.active/)).toBeVisible();
  expect(screen.queryByText("fmTeam.defaultSource")).toBeNull();
});

it("adopts only the selected existing assistant and distinguishes app identity from invitation readiness", async () => {
  vi.mocked(teamApi.assistant).mockImplementation(async (_id, op) => op === "existing"
    ? { phase: "registered", appId: "cli_123", name: "Sample bot" }
    : { phase: "empty", choices: [{ id: "legacy", appId: "cli_123", name: "Sample bot", mode: "existing" }] });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  fireEvent.click(await screen.findByRole("button", { name: "fmTeam.adoptAssistant" }));
  fireEvent.click(await screen.findByRole("button", { name: /Sample bot/ }));
  expect(await screen.findByText("fmTeam.runtimePending")).toBeVisible();
  expect(teamApi.assistant).toHaveBeenCalledWith("Alpha", "existing", "legacy");
  expect(screen.queryByRole("button", { name: "fmTeam.makeQr" })).toBeNull();
});

function openPage(mode: "members" | "projects" = "members") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><TeamPage mode={mode} /></QueryClientProvider>);
}

const preview: ProjectDeletion = { id: "Alpha", name: "Alpha", version: "confirmed-preview", phase: "ready",
  repository: "org/example", assistantName: "example-bot", assistantState: "registered", brain: "managed",
  members: [{ user: 3, dev: "worker-1", test: "qa-1" }], blockers: [], steps: [] };

it("previews project resources and rechecks a blocked deletion before requesting any change", async () => {
  vi.mocked(teamApi.deletion).mockResolvedValueOnce({ ...preview, phase: "blocked", blockers: ["worker_busy"] })
    .mockResolvedValue(preview);
  vi.mocked(teamApi.deleteProject).mockImplementation(async () => {
    projects = projects.filter(p => p.id !== preview.id);
    return { ...preview, phase: "deleted" };
  });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.deleteProject" }));
  expect(await screen.findByText("org/example")).toBeVisible();
  expect(screen.getByText(/worker-1/)).toBeVisible();
  expect(screen.getByText(/qa-1/)).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("fmTeam.worker_busy");
  expect(screen.queryByRole("button", { name: "fmTeam.confirmDelete" })).toBeNull();
  expect(teamApi.deleteProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "hosts.refresh" }));
  fireEvent.click(await screen.findByRole("button", { name: "fmTeam.confirmDelete" }));
  await waitFor(() => expect(teamApi.deleteProject).toHaveBeenCalledWith("Alpha", "confirmed-preview"));
  expect(await screen.findByText("fmTeam.deletedProject")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Alpha/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Beta/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.newProject" }));
  expect(screen.queryByRole("button", { name: "fmTeam.deleteProject" })).toBeNull();
});

it("reopens a failed deletion and retries the saved operation after a refreshed preview", async () => {
  projects[0].deletion = { phase: "failed" };
  vi.mocked(teamApi.deletion).mockResolvedValue({ ...preview, phase: "failed", error: "qa_pending", resource: "qa-1" });
  vi.mocked(teamApi.deleteProject).mockResolvedValue({ ...preview, phase: "deleting" });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  expect(screen.queryByRole("button", { name: "fmTeam.save" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.deletionProgress" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("qa-1");
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.retryDeletion" }));
  expect(await screen.findByText("fmTeam.deletePhase_deleting")).toBeVisible();
  expect(teamApi.deleteProject).toHaveBeenCalledTimes(1);
});

it("requires a new confirmation when the deletion preview changes", async () => {
  const updated = { ...preview, version: "changed-preview", repository: "org/changed" };
  vi.mocked(teamApi.deletion).mockResolvedValueOnce(preview).mockResolvedValue(updated);
  vi.mocked(teamApi.deleteProject).mockRejectedValueOnce(new Error("stale_project"))
    .mockResolvedValue({ ...updated, phase: "deleting" });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.deleteProject" }));
  fireEvent.click(await screen.findByRole("button", { name: "fmTeam.confirmDelete" }));
  expect(await screen.findByText("org/changed")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("fmTeam.stale_project");
  expect(teamApi.deleteProject).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.confirmDelete" }));
  await waitFor(() => expect(teamApi.deleteProject).toHaveBeenLastCalledWith("Alpha", "changed-preview"));
});
it("searches existing accounts, then saves a project assignment for the selected native user", async () => {
  openPage();
  fireEvent.click(await screen.findByRole("button", { name: "fmTeam.newMember" }));
  const input = screen.getByRole("combobox", { name: "fmTeam.existingUser" });
  await userEvent.type(input, "USER-one");
  expect(screen.queryByRole("option", { name: /user-two/ })).toBeNull();
  fireEvent.click(await screen.findByRole("option", { name: /First Member.*user-one/ }));
  fireEvent.click(screen.getByRole("combobox", { name: "fmTeam.assignProject" }));
  fireEvent.click(await screen.findByRole("option", { name: "Alpha" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "fmTeam.delegate" }));
  expect(screen.getByRole("checkbox", { name: "fmTeam.read" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "fmTeam.read" })).toBeDisabled();
  for (const [field, worker] of [["dev", "dev-1"], ["test", "test-1"]]) {
    const picker = screen.getByRole("combobox", { name: "fmTeam." + field });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: worker }));
    expect(picker).toHaveTextContent(worker);
  }
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.save" }));
  await waitFor(() => expect(teamApi.save).toHaveBeenCalledWith(expect.objectContaining({ id: "Alpha",
    members: [{ user: 3, features: ["delegate", "read"], dev: "dev-1", test: "test-1" }] })));
  expect(await screen.findByRole("region", { name: "Alpha" })).toHaveTextContent("dev-1");
  expect(screen.queryByRole("combobox", { name: "fmTeam.existingUser" })).toBeNull();
});

it("shows every assignment immediately, preserving the other project and other members during edits", async () => {
  projects[0].members = [{ user: 3, dev: "alpha-dev", test: "alpha-qa", paired: true, features: ["delegate"], effective: { delegate: true } },
    { user: 4, dev: "", test: "", features: ["read"] }];
  projects[1].members = [{ user: 3, dev: "", test: "", features: ["read"], effective: { read: true } }];
  openPage();
  fireEvent.click(await screen.findByRole("button", { name: /First Member/ }));
  const alpha = within(screen.getByRole("region", { name: "Alpha" }));
  const beta = within(screen.getByRole("region", { name: "Beta" }));
  expect(alpha.getByText(/alpha-qa/)).toHaveTextContent("fmTeam.unregisteredQA");
  expect(beta.getByText("fmTeam.active")).toBeVisible();
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.click(alpha.getByRole("button", { name: "fmTeam.edit" }));
  fireEvent.click(alpha.getByRole("checkbox", { name: "fmTeam.delegate" }));
  expect(alpha.getByRole("checkbox", { name: "fmTeam.read" })).toBeChecked();
  expect(alpha.getByRole("checkbox", { name: "fmTeam.read" })).toBeEnabled();
  vi.mocked(teamApi.save).mockRejectedValueOnce(new Error("stale_project"));
  fireEvent.click(alpha.getByRole("button", { name: "fmTeam.save" }));
  expect(await alpha.findByRole("alert")).toHaveTextContent("fmTeam.stale_project");
  expect(teamApi.save).toHaveBeenCalledWith(expect.objectContaining({ id: "Alpha", version: "Alpha-v1",
    members: [expect.objectContaining({ user: 3, features: ["read"], dev: "", test: "" }), projects[0].members[1]] }));
  expect(beta.getByText("fmTeam.active")).toBeVisible();
});

it("shows one project bot QR and lets the owner match a join request to a saved unbound account", async () => {
  projects[0].assistant = "assistant";
  projects[0].botQr = "data:image/png;base64,AA==";
  projects[0].applicants = [{ key: "abcd", name: "Feishu account", suffix: "123456" }];
  projects[0].members = [{ user: 3, dev: "", test: "", features: ["read"] },
    { user: 4, dev: "", test: "", features: [], bound: true }];
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  expect(teamApi.invite).not.toHaveBeenCalled();
  expect(screen.getByRole("img", { name: "fmTeam.botQr" })).toHaveAttribute("src", projects[0].botQr);
  expect(screen.getByRole("link", { name: "fmTeam.downloadBotQr" })).toHaveAttribute("download", "Alpha.png");
  expect(screen.queryByText("fmTeam.recipient")).toBeNull();
  await userEvent.click(screen.getByRole("combobox", { name: /Feishu account.*123456/ }));
  expect(screen.queryByRole("option", { name: /user-two/ })).toBeNull();
  await userEvent.click(await screen.findByRole("option", { name: /user-one/ }));
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.save" }));
  await waitFor(() => expect(teamApi.save).toHaveBeenCalledWith(expect.objectContaining({
    members: [expect.objectContaining({ user: 3, confirm: "abcd" }), projects[0].members[1]]
  })));
});
