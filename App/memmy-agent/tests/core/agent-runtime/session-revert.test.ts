import { describe, expect, it } from "vitest";
import { Session, SessionManager } from "../../../src/core/session/manager.js";
import { truncateSessionAt, type RevertDeps } from "../../../src/core/agent-runtime/session-revert.js";

/** Records what the revert told the derived stores to drop. */
interface RevertCalls {
  saved: string[];
  dag: { sessionKey: string; fromTurnId: string }[];
  transcript: { sessionKey: string; fromTurnId: string; fromMessageIndex: number }[];
}

function makeDeps(session: Session): { deps: RevertDeps; calls: RevertCalls } {
  const calls: RevertCalls = { saved: [], dag: [], transcript: [] };
  const deps = {
    sessions: {
      get: (key: string) => (key === session.key ? session : null),
      save: (saved: Session) => {
        calls.saved.push(saved.key);
      },
    },
    sessionDag: {
      deleteTurnsFromSession: (sessionKey: string, fromTurnId: string) => {
        calls.dag.push({ sessionKey, fromTurnId });
      },
    },
    transcript: {
      turnReverted: (sessionKey: string, fromTurnId: string, fromMessageIndex: number) => {
        calls.transcript.push({ sessionKey, fromTurnId, fromMessageIndex });
      },
    },
  } as unknown as RevertDeps;
  return { deps, calls };
}

function userTurn(turnId: string, content: string, extra: Record<string, any> = {}): Record<string, any> {
  return { role: "user", content, metadata: { turn_id: turnId }, ...extra };
}

describe("truncateSessionAt", () => {
  describe("with recorded turnBoundaries", () => {
    it("truncates at the boundary and drops the reverted turn's derived data", () => {
      const session = new Session({
        key: "s1",
        messages: [
          userTurn("t1", "first"),
          { role: "assistant", content: "answer 1" },
          userTurn("t2", "second"),
          { role: "assistant", content: "answer 2" },
        ],
        metadata: {
          turnBoundaries: {
            t1: { start: 0, end: 2 },
            t2: { start: 2, end: 4 },
          },
        },
      });
      const { deps, calls } = makeDeps(session);

      const result = truncateSessionAt(deps, "s1", "t2");

      expect(result).toEqual({ fromIndex: 2, fromTurnId: "t2" });
      expect(session.messages.map((m) => m.content)).toEqual(["first", "answer 1"]);
      expect(Object.keys(session.metadata.turnBoundaries)).toEqual(["t1"]);
      expect(calls.saved).toEqual(["s1"]);
      expect(calls.dag).toEqual([{ sessionKey: "s1", fromTurnId: "t2" }]);
      expect(calls.transcript).toEqual([{ sessionKey: "s1", fromTurnId: "t2", fromMessageIndex: 2 }]);
    });

    it("refuses a turn that is not the most recent", () => {
      const session = new Session({
        key: "s1",
        messages: [userTurn("t1", "first"), { role: "assistant", content: "a" }, userTurn("t2", "second")],
        metadata: { turnBoundaries: { t1: { start: 0, end: 2 }, t2: { start: 2, end: 3 } } },
      });
      const { deps } = makeDeps(session);

      expect(() => truncateSessionAt(deps, "s1", "t1")).toThrow(/not the last recorded turn/);
    });

    it("refuses a goal continuation turn", () => {
      const session = new Session({
        key: "s1",
        messages: [
          userTurn("t1", "first"),
          { role: "assistant", content: "a" },
          userTurn("t2", "goal", { internal_context: "goal_continuation" }),
          { role: "assistant", content: "b" },
        ],
        metadata: { turnBoundaries: { t1: { start: 0, end: 2 }, t2: { start: 2, end: 4 } } },
      });
      const { deps } = makeDeps(session);

      expect(() => truncateSessionAt(deps, "s1", "t2")).toThrow(/goal continuation/);
    });

    it("rolls lastConsolidated back when it pointed past the cut", () => {
      const session = new Session({
        key: "s1",
        messages: [userTurn("t1", "first"), { role: "assistant", content: "a" }, userTurn("t2", "second")],
        metadata: {
          turnBoundaries: { t1: { start: 0, end: 2 }, t2: { start: 2, end: 3 } },
          lastSummary: "summary covering both turns",
        },
        lastConsolidated: 3,
      });
      const { deps } = makeDeps(session);

      truncateSessionAt(deps, "s1", "t2");

      expect(session.lastConsolidated).toBe(2);
      expect(session.metadata.lastSummary).toBeUndefined();
    });
  });

  describe("without recorded turnBoundaries (sessions written before the feature)", () => {
    it("recovers the cut index from the message's turn id", () => {
      const session = new Session({
        key: "legacy",
        messages: [
          userTurn("t1", "first"),
          { role: "assistant", content: "answer 1" },
          userTurn("t2", "second"),
          { role: "assistant", content: "answer 2" },
        ],
        metadata: {},
      });
      const { deps, calls } = makeDeps(session);

      const result = truncateSessionAt(deps, "legacy", "t2");

      expect(result).toEqual({ fromIndex: 2, fromTurnId: "t2" });
      expect(session.messages.map((m) => m.content)).toEqual(["first", "answer 1"]);
      expect(calls.saved).toEqual(["legacy"]);
      expect(calls.dag).toEqual([{ sessionKey: "legacy", fromTurnId: "t2" }]);
      expect(calls.transcript).toEqual([{ sessionKey: "legacy", fromTurnId: "t2", fromMessageIndex: 2 }]);
    });

    it("accepts the camelCase turnId stamp older sessions may carry", () => {
      const session = new Session({
        key: "legacy",
        messages: [
          userTurn("t1", "first"),
          { role: "assistant", content: "a" },
          { role: "user", content: "second", metadata: { turnId: "t2" } },
          { role: "assistant", content: "b" },
        ],
        metadata: {},
      });
      const { deps } = makeDeps(session);

      expect(truncateSessionAt(deps, "legacy", "t2").fromIndex).toBe(2);
    });

    it("refuses a turn that has a later user turn after it", () => {
      const session = new Session({
        key: "legacy",
        messages: [
          userTurn("t1", "first"),
          { role: "assistant", content: "a" },
          userTurn("t2", "second"),
          { role: "assistant", content: "b" },
          userTurn("t3", "third"),
          { role: "assistant", content: "c" },
        ],
        metadata: {},
      });
      const { deps } = makeDeps(session);

      expect(() => truncateSessionAt(deps, "legacy", "t2")).toThrow(/could not be located as the last user turn/);
    });

    it("refuses a turn id that is absent from the message list", () => {
      const session = new Session({
        key: "legacy",
        messages: [userTurn("t1", "first"), { role: "assistant", content: "a" }],
        metadata: {},
      });
      const { deps } = makeDeps(session);

      expect(() => truncateSessionAt(deps, "legacy", "missing")).toThrow(/could not be located/);
    });

    it("refuses a goal continuation turn", () => {
      const session = new Session({
        key: "legacy",
        messages: [
          userTurn("t1", "first"),
          { role: "assistant", content: "a" },
          userTurn("t2", "goal", { internal_context: "goal_continuation" }),
          { role: "assistant", content: "b" },
        ],
        metadata: {},
      });
      const { deps } = makeDeps(session);

      expect(() => truncateSessionAt(deps, "legacy", "t2")).toThrow(/goal continuation/);
    });
  });

  it("throws when the session does not exist", () => {
    const session = new Session({ key: "known" });
    const { deps } = makeDeps(session);

    expect(() => truncateSessionAt(deps, "unknown", "t1")).toThrow(/Session not found/);
  });

  it("tolerates a missing session-dag or transcript sink", () => {
    const session = new Session({
      key: "legacy",
      messages: [userTurn("t1", "first"), { role: "assistant", content: "a" }],
      metadata: {},
    });
    const deps = {
      sessions: {
        get: () => session,
        save: () => undefined,
      },
      sessionDag: null,
      transcript: null,
    } as unknown as RevertDeps;

    expect(truncateSessionAt(deps, "legacy", "t1").fromIndex).toBe(0);
    expect(session.messages).toEqual([]);
  });
});
