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

/** Reads the turn id stamped on a persisted message by `turnMetadata()`. */
function messageTurnId(message: Record<string, any> | undefined): string | null {
  const value = message?.metadata?.turn_id ?? message?.metadata?.turnId;
  return typeof value === "string" && value ? value : null;
}

/**
 * Locates the start of `turnId` from the message list itself.
 *
 * Sessions written before `metadata.turnBoundaries` existed have no recorded
 * boundary, but every user message carries its turn id, and a turn always
 * starts at its user message — so the index is recoverable without migrating
 * anything on disk.
 *
 * Returns null when the turn cannot be located, or when it is not the last
 * user turn (only the most recent turn is editable).
 */
function locateTurnStartFromMessages(
  messages: Record<string, any>[],
  turnId: string,
): number | null {
  let target = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role !== "user" || messageTurnId(message) !== turnId) continue;
    target = i;
  }
  if (target < 0) return null;
  for (let i = target + 1; i < messages.length; i += 1) {
    // Any later user turn means this one is no longer the most recent.
    if (messages[i]?.role === "user") return null;
  }
  return target;
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

  let fromIndex: number;
  if (boundary) {
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

    fromIndex = boundary.start;
  } else {
    // Session predates boundary tracking (or the turn was written before this
    // feature existed): recover the start index from the messages themselves.
    const located = locateTurnStartFromMessages(session.messages, beforeTurnId);
    if (located === null) {
      throw new Error(
        `Cannot revert: turn "${beforeTurnId}" could not be located as the last user turn in session "${sessionKey}".`,
      );
    }
    if (session.messages[located]?.internal_context === "goal_continuation") {
      throw new Error(
        `Cannot revert: the selected turn is a goal continuation and cannot be edited.`,
      );
    }
    fromIndex = located;
  }

  // 1. Truncate in-memory messages (must happen before save so model sees it immediately).
  session.messages = session.messages.slice(0, fromIndex);

  // 2. Fix compaction pointers. The summary is dropped when it covered messages
  // that no longer exist, so compare against the pre-clamp value.
  const previousConsolidated = session.lastConsolidated ?? 0;
  session.lastConsolidated = Math.min(previousConsolidated, fromIndex);
  if (previousConsolidated > fromIndex && session.metadata?.lastSummary) {
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
