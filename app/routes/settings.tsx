import { useState, useEffect } from "react";
import { Link } from "react-router";
import { ALL_TIEBREAKER_KEYS, TIEBREAKER_META } from "~/lib/tournament";
import type { TiebreakerKey } from "~/lib/tournament";
import { loadConfig, saveConfig, DEFAULT_CONFIG } from "~/lib/config";
import type { AppConfig } from "~/lib/config";

export function meta() {
  return [{ title: "david.exe — Settings" }];
}

// ── Round timer presets ───────────────────────────────────────────────────────

const PRESET_MINUTES = [30, 40, 50, 60, 75, 90];

// ── Tiebreaker UI helpers ─────────────────────────────────────────────────────

interface UIItem {
  key: TiebreakerKey;
  enabled: boolean;
}

function buildUIItems(config: AppConfig): UIItem[] {
  const enabledSet = new Set(config.tiebreakers.order);
  return [
    ...config.tiebreakers.order.map((k) => ({ key: k, enabled: true })),
    ...ALL_TIEBREAKER_KEYS.filter((k) => !enabledSet.has(k)).map((k) => ({ key: k, enabled: false })),
  ];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const initialConfig = loadConfig();

  const [roundMinutes, setRoundMinutes] = useState(initialConfig.roundMinutes);
  const [customMode, setCustomMode] = useState(!PRESET_MINUTES.includes(initialConfig.roundMinutes));
  const [customInput, setCustomInput] = useState(String(initialConfig.roundMinutes));
  const [tbItems, setTbItems] = useState<UIItem[]>(() => buildUIItems(initialConfig));
  const [saved, setSaved] = useState(false);

  // Auto-save whenever anything changes
  useEffect(() => {
    const config: AppConfig = {
      roundMinutes,
      tiebreakers: { order: tbItems.filter((i) => i.enabled).map((i) => i.key) },
    };
    saveConfig(config);
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [roundMinutes, tbItems]);

  // ── Round timer controls ──────────────────────────────────────────────────

  function selectPreset(mins: number) {
    setRoundMinutes(mins);
    setCustomInput(String(mins));
    setCustomMode(false);
  }

  function applyCustomInput(raw: string) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n <= 240) {
      setRoundMinutes(n);
    }
  }

  // ── Tiebreaker controls ───────────────────────────────────────────────────

  function moveTb(idx: number, dir: -1 | 1) {
    setTbItems((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function toggleTb(idx: number) {
    setTbItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, enabled: !item.enabled } : item))
    );
  }

  function resetTb() {
    setTbItems(buildUIItems(DEFAULT_CONFIG));
  }

  const enabledTbs = tbItems.filter((i) => i.enabled);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-lg mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-mono font-bold text-green-400">david.exe</h1>
            <p className="text-slate-400 text-sm">Settings</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-xs text-green-400 transition-opacity">Saved ✓</span>
            )}
            <Link
              to="/"
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              ← Event
            </Link>
          </div>
        </div>

        {/* ── Round Timer ──────────────────────────────────────────────── */}
        <div className="bg-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-700/60 border-b border-slate-700">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Round Timer</h2>
          </div>
          <div className="px-5 py-5 space-y-4">
            <p className="text-slate-400 text-sm leading-relaxed">
              Duration of the countdown shown on the pairings page. The timer resets
              automatically at the start of each new round.
            </p>

            {/* Preset buttons */}
            <div className="flex flex-wrap gap-2">
              {PRESET_MINUTES.map((m) => {
                const active = !customMode && roundMinutes === m;
                return (
                  <button
                    key={m}
                    onClick={() => selectPreset(m)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-green-600 text-white"
                        : "bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
                    }`}
                  >
                    {m} min
                  </button>
                );
              })}
              <button
                onClick={() => setCustomMode(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  customMode
                    ? "bg-green-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
                }`}
              >
                Custom
              </button>
            </div>

            {/* Custom number input */}
            {customMode && (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onBlur={(e) => applyCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      applyCustomInput((e.target as HTMLInputElement).value);
                  }}
                  className="w-24 bg-slate-700 rounded-lg px-3 py-2 text-white border border-slate-600 focus:outline-none focus:border-green-500 tabular-nums"
                  placeholder="50"
                />
                <span className="text-slate-400 text-sm">minutes (1–240)</span>
              </div>
            )}

            <p className="text-slate-500 text-xs">
              Current:{" "}
              <span className="text-slate-300 font-medium">{roundMinutes} minutes</span>
            </p>
          </div>
        </div>

        {/* ── Tiebreakers ──────────────────────────────────────────────── */}
        <div className="bg-slate-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-700/60 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Tiebreakers
            </h2>
            <button
              onClick={resetTb}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Reset to default
            </button>
          </div>

          <div className="px-5 pt-4 pb-2">
            <p className="text-slate-400 text-sm leading-relaxed">
              When players are tied on points, these are consulted in order. Reorder or
              disable them to match your group's preferences.
            </p>
          </div>

          {/* Locked first: Match Points */}
          <div className="border-t border-slate-700 px-5 py-3 flex items-center gap-4 opacity-60">
            <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-green-400 shrink-0">
              1
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm text-white">Match Points</p>
              <p className="text-slate-500 text-xs">Win = 3 pts · Draw = 1 pt · Loss = 0 pts</p>
            </div>
            <span className="text-xs text-slate-500 bg-slate-700/80 px-2 py-0.5 rounded">locked</span>
          </div>

          {/* Configurable tiebreakers */}
          <ul className="divide-y divide-slate-700">
            {tbItems.map((item, idx) => {
              const meta = TIEBREAKER_META[item.key];
              const rank = tbItems.slice(0, idx).filter((i) => i.enabled).length + 2;
              return (
                <li
                  key={item.key}
                  className={`px-5 py-3 flex items-center gap-4 transition-opacity ${
                    item.enabled ? "opacity-100" : "opacity-40"
                  }`}
                >
                  {/* Rank badge */}
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      item.enabled
                        ? "bg-slate-700 text-green-400"
                        : "bg-slate-700 text-slate-600"
                    }`}
                  >
                    {item.enabled ? rank : "—"}
                  </div>

                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-semibold text-sm ${
                        item.enabled ? "text-white" : "text-slate-500"
                      }`}
                    >
                      {meta.label}
                    </p>
                    <p className="text-slate-500 text-xs mt-0.5 leading-snug">
                      {meta.description}
                    </p>
                  </div>

                  {/* Up / Down */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => moveTb(idx, -1)}
                      disabled={idx === 0}
                      className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveTb(idx, 1)}
                      disabled={idx === tbItems.length - 1}
                      className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    >
                      ↓
                    </button>
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => toggleTb(idx)}
                    className={`flex items-center w-10 h-5 rounded-full p-0.5 transition-colors shrink-0 ${
                      item.enabled ? "bg-green-600" : "bg-slate-600"
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        item.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Locked last: Alphabetical */}
          <div className="border-t border-slate-700 px-5 py-3 flex items-center gap-4 opacity-60">
            <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-green-400 shrink-0">
              {enabledTbs.length + 2}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm text-white">Alphabetical</p>
              <p className="text-slate-500 text-xs">Final fallback — extremely rare in practice</p>
            </div>
            <span className="text-xs text-slate-500 bg-slate-700/80 px-2 py-0.5 rounded">locked</span>
          </div>
        </div>

        {/* Effective sort order summary */}
        <div className="bg-slate-800/50 rounded-xl px-5 py-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Effective Sort Order
          </p>
          <ol className="space-y-1">
            <li className="text-sm text-slate-300">
              <span className="text-slate-500 tabular-nums mr-2">1.</span>Match Points
            </li>
            {enabledTbs.map((item, i) => (
              <li key={item.key} className="text-sm text-slate-300">
                <span className="text-slate-500 tabular-nums mr-2">{i + 2}.</span>
                {TIEBREAKER_META[item.key].label}
              </li>
            ))}
            <li className="text-sm text-slate-300">
              <span className="text-slate-500 tabular-nums mr-2">
                {enabledTbs.length + 2}.
              </span>
              Alphabetical
            </li>
          </ol>
          {enabledTbs.length === 0 && (
            <p className="text-yellow-500 text-xs mt-2">
              ⚠ All tiebreakers disabled — ties broken alphabetically only.
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
