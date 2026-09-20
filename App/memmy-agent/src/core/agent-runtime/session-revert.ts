import type { SessionManager } from "../session/manager.js";

/** Minimal transcript interface needed to record the revert marker. */
export interface RevertTranscriptSink {
  turnReverted(sessionKey: string, fromTurnId: string, fromMessageIndex: number): void;
}

/** Minimal DAG interface needed to delete turns on revert. */
export interface RevertDagSink {
  deleteTurnsFromSession(sessionKey: string, fromTurnId: string): void;
}

export interface RevertDeps {
  sessions: SessionManager;
  sessionDag: RevertDagSink | null;
  transcript: RevertTranscriptSink | null;
}

export interface RevertResult {
  fromIndex: number;
  fromTurnId: string;
}

/**
 * Truncate a session at the given turn's start boundary.
 *
 * All派生 data (compaction, session-dag, transcript) is updated in place.
 * The session is truncated in memory first (making it immediately visible to
 * the model) and then written back to disk via `sessions.save()`.
 *
 * The caller (`AgentLoop.truncateSession`) is responsible for clearing
 * private queue state (pendingQueues / goalRuntime.inbox) after this returns.
 */
export function truncateSessionAt(
  deps: RevertDeps,
  sessionKey: string,
  beforeTurnId: string,
): RevertResult {
  const { sessions, sessionDag, transcript } = deps;

  const session = sessions.get(sessionKey);
  if (!session) {
    throw new Error(`Session not found: ${sessionKey}`);
  }

  const boundaries: Record<string, { start: number; end: number }> =
    session.metadata?.turnBoundaries ?? {};
  const boundary = boundaries[beforeTurnId];
  if (!boundary) {
    throw new Error(
      `Cannot revert: turn "${beforeTurnId}" has no recorded boundary in session "${sessionKey}". ` +
        "This session may have been written before boundary tracking was introduced.",
    );
  }

  // Validate that beforeTurnId is the last editable user turn (not goal_continuation).
  // We verify it corresponds to the last user-message entry in turnBoundaries.
  const sortedBoundaries = Object.entries(boundaries).sort((a, b) => b[1].start - a[1].start);
  const lastTurn = sortedBoundaries[0];
  if (!lastTurn || lastTurn[0] !== beforeTurnId) {
    throw new Error(
      `Cannot revert: turn "${beforeTurnId}" is not the last recorded turn. Only the most recent turn can be reverted.`,
    );
  }

  // Check the user message at this boundary is not a goal continuation.
  const userMessage = session.messages[boundary.start];
  if (userMessage?.internal_context === "goal_continuation") {
    throw new Error(
      `Cannot revert: the selected turn is a goal continuation and cannot be edited.`,
    );
  }

  const fromIndex = boundary.start;

  // 1. Truncate in-memory messages (must happen before save so model sees it immediately).
  session.messages = session.messages.slice(0, fromIndex);

  // 2. Fix compaction pointers.
  session.lastConsolidated = Math.min(session.lastConsolidated ?? 0, fromIndex);
  if ((session.lastConsolidated ?? 0) > fromIndex && session.metadata?.lastSummary) {
    delete session.metadata.lastSummary;
  }

  // 3. Clean up turnBoundaries: remove the reverted turn and any later ones.
  const updatedBoundaries: Record<string, { start: number; end: number }> = {};
  for (const [turnId, b] of Object.entries(boundaries)) {
    if (b.start < fromIndex) {
      updatedBoundaries[turnId] = b;
    }
  }
  session.metadata.turnBoundaries = updatedBoundaries;

  // 4. Persist to disk (whole-file rewrite — the truncated memory state becomes the file state).
  sessions.save(session);

  // 5. Clean up session-dag: delete the reverted turn and all later turns (incl. nodes + edges).
  deps.sessionDag?.deleteTurnsFromSession(sessionKey, beforeTurnId);

  // 6. Record a turn_reverted marker in the GUI transcript so the replay path can apply it.
  transcript?.turnReverted(sessionKey, beforeTurnId, fromIndex);

  return { fromIndex, fromTurnId: beforeTurnId };
}
