import { describe, it, expect } from "vitest";
import { collectLarkStatusIssues } from "./status-issues.js";

describe("collectLarkStatusIssues", () => {
  it("flags unconfigured credentials", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: true,
        configured: false,
        tokenSource: "none",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("config");
    expect(issues[0].message).toContain("not configured");
    expect(issues[0].fix).toContain("appId");
  });

  it("warns when dmPolicy is open", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: true,
        configured: true,
        tokenSource: "config",
        dmPolicy: "open",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues.some((i) => i.kind === "config" && i.message.includes("open"))).toBe(true);
    expect(issues.some((i) => i.fix?.includes("pairing"))).toBe(true);
  });

  it("notes env credential source", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: true,
        configured: true,
        tokenSource: "env",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues.some((i) => i.message.includes("environment"))).toBe(true);
  });

  it("detects permission errors", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: true,
        configured: true,
        tokenSource: "config",
        lastError: "code: 99991403, msg: permission denied",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues.some((i) => i.kind === "auth")).toBe(true);
    expect(issues.some((i) => i.fix?.includes("im:message"))).toBe(true);
  });

  it("detects connection errors", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: true,
        configured: true,
        tokenSource: "config",
        lastError: "ECONNRESET",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues.some((i) => i.kind === "runtime")).toBe(true);
    expect(issues.some((i) => i.message.includes("connection error"))).toBe(true);
  });

  it("handles generic runtime errors", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: true,
        configured: true,
        tokenSource: "config",
        lastError: "Some unknown error occurred",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues.some((i) => i.kind === "runtime")).toBe(true);
    expect(issues.some((i) => i.message.includes("unknown error"))).toBe(true);
  });

  it("skips disabled accounts", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: false,
        configured: false,
        tokenSource: "none",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues).toHaveLength(0);
  });

  it("handles multiple accounts", () => {
    const accounts = [
      {
        accountId: "work",
        enabled: true,
        configured: true,
        tokenSource: "config",
        dmPolicy: "pairing",
      },
      {
        accountId: "personal",
        enabled: true,
        configured: false,
        tokenSource: "none",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    // Only personal account should have issues (unconfigured)
    expect(issues).toHaveLength(1);
    expect(issues[0].accountId).toBe("personal");
  });

  it("handles empty accounts array", () => {
    const issues = collectLarkStatusIssues([]);
    expect(issues).toHaveLength(0);
  });

  it("handles null/undefined entries gracefully", () => {
    const accounts = [null as unknown, undefined as unknown, {}];
    const issues = collectLarkStatusIssues(accounts);
    // Should not throw, empty object gets default accountId
    expect(Array.isArray(issues)).toBe(true);
  });

  it("detects WebSocket connection failures", () => {
    const accounts = [
      {
        accountId: "default",
        enabled: true,
        configured: true,
        tokenSource: "config",
        lastError: "WebSocket connection failed",
      },
    ];
    const issues = collectLarkStatusIssues(accounts);
    expect(issues.some((i) => i.kind === "runtime")).toBe(true);
    expect(issues.some((i) => i.fix?.includes("proxy"))).toBe(true);
  });
});
