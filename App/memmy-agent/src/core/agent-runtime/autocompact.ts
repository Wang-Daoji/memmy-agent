import { Session, SessionManager } from "../session/manager.js";

function parseDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class AutoCompact {
  sessions: SessionManager;
  consolidator: any;

  constructor(sessions?: SessionManager, consolidator?: any) {
    this.sessions = sessions ?? new SessionManager(process.cwd());
    this.consolidator = consolidator;
  }

  static formatSummary(text: string, lastActive: Date): string {
    return `Previous conversation summary (last active ${lastActive.toISOString()}):\n${text}`;
  }

  prepareSession(session: Session): [Session, string | null] {
    const meta = session.metadata?.lastSummary;
    if (meta && typeof meta === "object" && meta.text && meta.lastActive) {
      const lastActive = parseDate(meta.lastActive);
      if (lastActive) return [session, AutoCompact.formatSummary(String(meta.text), lastActive)];
    }
    return [session, null];
  }
}
