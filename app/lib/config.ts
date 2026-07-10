import type { TiebreakerKey } from "./tournament";

export const CONFIG_STORAGE_KEY = "david-exe-config";

export interface AppConfig {
  /** Duration of each round countdown, in minutes. */
  roundMinutes: number;
  /** Ordered list of enabled tiebreakers (points always leads, name always trails). */
  tiebreakers: {
    order: TiebreakerKey[];
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  roundMinutes: 50,
  tiebreakers: {
    order: ["omwPct", "gwPct", "ogwPct"],
  },
};

export function loadConfig(): AppConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) {
      // One-time migration from the old tiebreaker-only key
      const legacy = localStorage.getItem("david-exe-tiebreakers");
      if (legacy) {
        const parsed = JSON.parse(legacy);
        const migrated: AppConfig = { ...DEFAULT_CONFIG, tiebreakers: parsed };
        localStorage.removeItem("david-exe-tiebreakers");
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return DEFAULT_CONFIG;
    }
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      roundMinutes:
        typeof parsed.roundMinutes === "number" && parsed.roundMinutes > 0
          ? parsed.roundMinutes
          : DEFAULT_CONFIG.roundMinutes,
      tiebreakers: parsed.tiebreakers ?? DEFAULT_CONFIG.tiebreakers,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: AppConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}
