import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AutoCompact } from "../../../src/core/agent-runtime/autocompact.js";
import { FILE_MAX_MESSAGES, Session, SessionManager } from "../../../src/core/session/manager.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memmy-autocompact-"));
}

describe("AutoCompact session preparation", () => {
  it("keeps the session file cap as an internal constant", () => {
    expect(FILE_MAX_MESSAGES).toBe(2000);
  });

  it("trims sessions to the file cap without archiving already consolidated drops", () => {
    const archived: Record<string, any>[][] = [];
    const session = new Session({ key: "cli:direct" });
    for (let i = 0; i < 8; i += 1) session.addMessage("user", `u${i}`);
    session.lastConsolidated = 6;

    session.enforceFileCap((messages) => archived.push(messages), 4);

    expect(session.messages).toHaveLength(4);
    expect(archived).toEqual([]);
  });

  it("archives only the unconsolidated prefix dropped by the file cap", () => {
    const archived: Record<string, any>[][] = [];
    const session = new Session({ key: "cli:direct" });
    for (let i = 0; i < 8; i += 1) session.addMessage("user", `u${i}`);
    session.lastConsolidated = 2;

    session.enforceFileCap((messages) => archived.push(messages), 4);

    expect(session.messages).toHaveLength(4);
    expect(archived).toHaveLength(1);
    expect(archived[0].map((message) => message.content)).toEqual(["u2", "u3"]);
  });
});

describe("AutoCompact prepareSession", () => {
  it("formats summaries with last-active timestamps", () => {
    expect(AutoCompact.formatSummary("Summary.", new Date("2026-05-28T11:00:00.000Z"))).toContain("2026-05-28T11:00:00.000Z");
  });

  it("formats summaries with correct prefix", () => {
    expect(AutoCompact.formatSummary("Summary.", new Date("2026-05-28T11:00:00.000Z"))).toContain("Previous conversation summary");
  });

  it("recovers summaries from session metadata", () => {
    const sessions = new SessionManager(tmpRoot());
    const session = new Session({ key: "cli:test", metadata: { lastSummary: { text: "Recovered.", lastActive: "2026-05-28T11:00:00.000Z" } } });
    const compact = new AutoCompact(sessions, null);

    const [, summary] = compact.prepareSession(session);

    expect(summary).toContain("Recovered.");
    expect(summary).toContain("Previous conversation summary");
  });

  it("returns metadata summaries repeatedly for restart survival", () => {
    const session = new Session({ key: "cli:test", metadata: { lastSummary: { text: "Persisted.", lastActive: "2026-05-28T11:00:00.000Z" } } });
    const compact = new AutoCompact(new SessionManager(tmpRoot()), null);

    expect(compact.prepareSession(session)[1]).toContain("Persisted.");
    expect(compact.prepareSession(session)[1]).toContain("Persisted.");
  });

  it("ignores malformed summary metadata with bad date", () => {
    const session = new Session({ key: "cli:test", metadata: { lastSummary: { text: "Bad.", lastActive: "bad-date" } } });
    const compact = new AutoCompact(new SessionManager(tmpRoot()), null);

    expect(compact.prepareSession(session)[1]).toBeNull();
  });

  it("ignores malformed summary metadata when lastSummary is not an object", () => {
    const session = new Session({ key: "cli:test", metadata: { lastSummary: "plain string" } });
    const compact = new AutoCompact(new SessionManager(tmpRoot()), null);

    expect(compact.prepareSession(session)[1]).toBeNull();
  });

  it("returns null summary when session has no lastSummary metadata", () => {
    const session = new Session({ key: "cli:test" });
    const compact = new AutoCompact(new SessionManager(tmpRoot()), null);

    expect(compact.prepareSession(session)[1]).toBeNull();
  });

  it("returns the original session object unchanged", () => {
    const session = new Session({ key: "cli:test", metadata: { lastSummary: { text: "Summary.", lastActive: "2026-05-28T11:00:00.000Z" } } });
    const compact = new AutoCompact(new SessionManager(tmpRoot()), null);

    const [prepared] = compact.prepareSession(session);

    expect(prepared).toBe(session);
  });

  it("keeps lastSummary metadata after prepareSession", () => {
    const session = new Session({ key: "cli:test", metadata: { lastSummary: { text: "Persisted.", lastActive: "2026-05-28T11:00:00.000Z" } } });
    const compact = new AutoCompact(new SessionManager(tmpRoot()), null);

    compact.prepareSession(session);

    expect(session.metadata.lastSummary.text).toBe("Persisted.");
  });

  it("Session.clear removes persisted last summaries", () => {
    const session = new Session({ key: "cli:test", metadata: { lastSummary: { text: "Old", lastActive: "2026-05-28T11:00:00.000Z" } } });

    session.clear();

    expect(session.metadata.lastSummary).toBeUndefined();
  });
});
