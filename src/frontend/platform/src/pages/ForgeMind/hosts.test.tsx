import { describe, expect, it, vi } from "vitest";
import { hostState } from "./HostFields";
import { inUserNetwork } from "./CreateHost";

vi.mock("@/controllers/API/forgemind", () => ({ hostApi: {} }));

describe("host directory", () => {
  const host = { name: "test-host", created: "", seen: "2026-01-02", online: true };
  it("keeps registration, missing heartbeat and unavailable online status distinct", () => {
    expect(hostState(host)).toBe("online");
    expect(hostState({ ...host, online: false })).toBe("offline");
    expect(hostState({ ...host, online: null })).toBe("unknown");
    expect(hostState({ ...host, online: null, seen: null })).toBe("never");
  });
  it("checks an assigned IPv4 against the advertised user networks", () => {
    const networks = ["198.51.100.128/25", "192.0.2.0/24"];
    expect(inUserNetwork("198.51.100.129", networks)).toBe(true);
    expect(inUserNetwork("192.0.2.254", networks)).toBe(true);
    for (const value of ["", "198.51.100.128", "198.51.100.255", "198.51.100.7", "192.0.2.257", "01.1.1.1", "::1"]) {
      expect(inUserNetwork(value, networks)).toBe(false);
    }
    expect(inUserNetwork("192.0.2.1", [])).toBe(false);
  });
});
