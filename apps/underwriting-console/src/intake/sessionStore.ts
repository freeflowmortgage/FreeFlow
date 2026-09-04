import type { IntakeAnswers } from './intake-agent';
import type { IntakeLang } from './detect-spoken-language';

/**
 * Device-local draft persistence for the AI 1003.
 *
 * ZDR note: FreeFlow servers never see or store this draft. The in-progress
 * answers live in the borrower's own browser storage (their device, their
 * custody) so a phone lock, app switch, or accidental reload does not force a
 * restart. The draft is wiped the moment the completed MISMO file is delivered
 * to the lender, when the borrower starts over, or after the TTL expires.
 */

const STORAGE_KEY = 'freeflow-1003-draft-v1';
const TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

export interface SavedIntakeSession {
  answers: IntakeAnswers;
  lang: IntakeLang;
  leadSent: boolean;
  savedAt: number;
}

export function saveIntakeSession(session: Omit<SavedIntakeSession, 'savedAt'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, savedAt: Date.now() } satisfies SavedIntakeSession));
  } catch {
    // Storage full or blocked (private browsing) — the session simply won't resume.
  }
}

export function loadIntakeSession(): SavedIntakeSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedIntakeSession;
    if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > TTL_MS) {
      clearIntakeSession();
      return null;
    }
    if (!parsed.answers || Object.keys(parsed.answers).length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearIntakeSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
