import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hostApi, teamApi, type ManagedProject } from "@/controllers/API/forgemind";
import { TeamPage } from "./TeamPage";

vi.mock("@/controllers/API/forgemind", () => ({
  hostApi: { list: vi.fn(), summaries: vi.fn() },
  teamApi: { users: vi.fn(), directory: vi.fn(), save: vi.fn(), invite: vi.fn() },
  useHostAccess: () => ({ access: { isSuccess: true, data: true }, scope: "test" }),
}));
const project = (id: string): ManagedProject => ({ id, name: id, version: id + "-v1", assistant: "",
  assistantName: "", repository: "", features: ["delegate", "read"], legacy: [], members: [] });
let projects: ManagedProject[];
beforeEach(() => {
  vi.clearAllMocks();
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

function openPage(mode: "members" | "projects" = "members") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><TeamPage mode={mode} /></QueryClientProvider>);
}
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
  for (const [field, worker] of [["dev", "dev-1"], ["test", "test-1"]]) {
    const picker = screen.getByRole("combobox", { name: "fmTeam." + field });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: worker }));
    expect(picker).toHaveTextContent(worker);
  }
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.save" }));
  await waitFor(() => expect(teamApi.save).toHaveBeenCalledWith(expect.objectContaining({ id: "Alpha",
    members: [{ user: 3, features: ["delegate"], dev: "dev-1", test: "test-1" }] })));
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
  fireEvent.click(alpha.getByRole("checkbox", { name: "fmTeam.read" }));
  vi.mocked(teamApi.save).mockRejectedValueOnce(new Error("stale_project"));
  fireEvent.click(alpha.getByRole("button", { name: "fmTeam.save" }));
  expect(await alpha.findByRole("alert")).toHaveTextContent("fmTeam.stale_project");
  expect(teamApi.save).toHaveBeenCalledWith(expect.objectContaining({ id: "Alpha", version: "Alpha-v1",
    members: [expect.objectContaining({ user: 3, features: ["delegate", "read"] }), projects[0].members[1]] }));
  expect(beta.getByText("fmTeam.active")).toBeVisible();
});

it("generates a downloadable invitation only when the owner chooses an unbound member in the project", async () => {
  projects[0].assistant = "assistant";
  projects[0].members = [{ user: 3, dev: "", test: "", features: ["read"] },
    { user: 4, dev: "", test: "", features: [], bound: true }];
  vi.mocked(teamApi.invite).mockResolvedValue({ qr: "data:image/png;base64,AA==", until: 1900000000 });
  openPage("projects");
  fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
  expect(teamApi.invite).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "fmTeam.makeQr" })).toBeDisabled();
  await userEvent.click(screen.getByRole("combobox", { name: "fmTeam.invitee" }));
  expect(screen.queryByRole("option", { name: /user-two/ })).toBeNull();
  await userEvent.click(await screen.findByRole("option", { name: /user-one/ }));
  fireEvent.click(screen.getByRole("button", { name: "fmTeam.makeQr" }));
  expect(await screen.findByRole("link", { name: "fmTeam.downloadInvite" })).toHaveAttribute("download", "Alpha-First Member · user-one.png");
  expect(teamApi.invite).toHaveBeenCalledWith("Alpha", 3);
});
