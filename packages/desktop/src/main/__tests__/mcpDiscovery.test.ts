import { describe, it, expect, vi } from "vitest";

// discoverMcpServers sources everything from the detectord daemon, whose client
// resolves a socket path via Electron's `app.getPath` (absent under vitest).
// These tests cover the shape it returns and the pure fingerprinting, so the
// daemon reports nothing.
vi.mock("../detectord/discovery", () => ({
  discoverViaDetectord: () => Promise.resolve([]),
}));
import { discoverMcpServers, getServerFingerprint } from "../discovery/mcpDiscovery";
import type { DiscoveredMcpServer } from "../discovery/mcpDiscovery";

describe("discoverMcpServers and fingerprinting", () => {
  it("discoverMcpServers returns an array of DiscoveredMcpServer", async () => {
    const servers = await discoverMcpServers();
    expect(Array.isArray(servers)).toBe(true);
    for (const s of servers) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.client).toBe("string");
      expect(typeof s.path).toBe("string");
      expect(s.config).toBeDefined();
      expect(
        ["user", "workspace", "remote", "unknown", "enterprise", "project", "marketplace", "plugin"],
      ).toContain(s.source);
    }
  });

  it("getServerFingerprint is stable for same input", () => {
    const server: DiscoveredMcpServer = {
      name: "test-server",
      client: "cursor",
      source: "user",
      path: "/tmp/mcp.json",
      config: { command: "npx", args: ["-y", "some-server"] },
    };
    const fp1 = getServerFingerprint(server);
    const fp2 = getServerFingerprint(server);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(16);
    expect(fp1).toMatch(/^[0-9a-f]+$/);
  });

  it("getServerFingerprint differs for different name/command", () => {
    const a: DiscoveredMcpServer = {
      name: "a",
      client: "cursor",
      source: "user",
      path: "/p",
      config: { command: "cmd", args: ["x"] },
    };
    const b: DiscoveredMcpServer = {
      name: "b",
      client: "cursor",
      source: "user",
      path: "/p",
      config: { command: "cmd", args: ["x"] },
    };
    expect(getServerFingerprint(a)).not.toBe(getServerFingerprint(b));
  });

  it("fingerprint changes when command changes", () => {
    const base: DiscoveredMcpServer = {
      name: "s",
      client: "cursor",
      source: "user",
      path: "/p",
      config: { command: "cmd1", args: [] },
    };
    const modified: DiscoveredMcpServer = {
      ...base,
      config: { command: "cmd2", args: [] },
    };
    expect(getServerFingerprint(base)).not.toBe(
      getServerFingerprint(modified),
    );
  });

  it("fingerprint changes when args change", () => {
    const base: DiscoveredMcpServer = {
      name: "s",
      client: "cursor",
      source: "user",
      path: "/p",
      config: { command: "cmd", args: ["a"] },
    };
    const modified: DiscoveredMcpServer = {
      ...base,
      config: { command: "cmd", args: ["b"] },
    };
    expect(getServerFingerprint(base)).not.toBe(
      getServerFingerprint(modified),
    );
  });
});

