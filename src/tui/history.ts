/**
 * Command history with file persistence.
 *
 * Stores entries in ~/.clark/history.json. Supports up/down navigation
 * and deduplicates consecutive identical entries.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

const HISTORY_PATH = join(homedir(), ".clark", "history.json");
const MAX_ENTRIES = 100;

export class CommandHistory {
  private entries: string[] = [];
  private cursor = -1;
  private savedInput = "";
  private readonly shouldPersist: boolean;

  constructor({ persist = true }: { persist?: boolean } = {}) {
    this.shouldPersist = persist;
    if (persist) {
      try {
        if (existsSync(HISTORY_PATH)) {
          const data = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
          if (Array.isArray(data)) {
            this.entries = data.slice(-MAX_ENTRIES);
          }
        }
      } catch {
        // Corrupt or missing — start fresh
      }
    }
  }

  private async persist() {
    try {
      await mkdir(join(homedir(), ".clark"), { recursive: true });
      await Bun.write(HISTORY_PATH, JSON.stringify(this.entries) + "\n");
    } catch {
      // Best-effort
    }
  }

  /** Add an entry. Skips if identical to the most recent entry. */
  push(entry: string) {
    if (!entry.trim()) return;
    if (this.entries[this.entries.length - 1] !== entry) {
      this.entries.push(entry);
      if (this.entries.length > MAX_ENTRIES) {
        this.entries.shift();
      }
      if (this.shouldPersist) this.persist();
    }
    this.cursor = -1;
    this.savedInput = "";
  }

  /** Navigate to the previous (older) entry. Returns the entry or null if at the start. */
  up(currentInput: string): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor === -1) {
      this.savedInput = currentInput;
      this.cursor = this.entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    } else {
      return null;
    }
    return this.entries[this.cursor]!;
  }

  /** Navigate to the next (newer) entry. Returns saved input when past the newest. */
  down(): string | null {
    if (this.cursor === -1) return null;
    this.cursor++;
    if (this.cursor >= this.entries.length) {
      this.cursor = -1;
      return this.savedInput;
    }
    return this.entries[this.cursor]!;
  }

  /** Get all entries (for testing). */
  getEntries(): readonly string[] {
    return this.entries;
  }
}
