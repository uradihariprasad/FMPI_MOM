/**
 * Trade suggestion engine.
 *
 * NON-NEGOTIABLE RULE: an extreme FMPI reading is never, by itself, a
 * trade. Ideas are only produced when several independent pieces of
 * evidence agree, and the engine is allowed to return FEWER than the
 * requested count — including zero — rather than manufacture a setup.
 *
 * Ranking is by CONVICTION, not by |FMPI − 50|:
 *   • continuation strength from the state machine
 *   • 5M / 10M timeframe agreement (conflicts are disqualifying)
 *   • agreement among the available components (price, volume, futures
 *     OI, options OI, structure, acceleration)
 *   • effective component coverage and data quality
 *   • penalties for exhaustion evidence and adverse divergence
 *
 * Exhaustion / reversal-watch instruments are deliberately EXCLUDED from
 * entries and surfaced separately as watch-outs, because weakening
 * pressure is a warning, not a counter-trend signal.
 *
 * Risk levels are derived from genuine recent structure and ATR — they
 * are reference levels for sizing research, not advice.
 */
import { atr, clamp } from "./math";
import { getFmpiSeries } from "./service";
import type {
  Candle, ComponentKey, DataQuality, InstrumentMeta, MomentumState, ScanRow, Timeframe, ZoneId,
} from "./types";

export type Direction = "long" | "short";

export interface TradeIdea {
  rank: number;
  instrument: InstrumentMeta;
  direction: Direction;
  setup: string;
  conviction: number; // 0..100
  grade: "A" | "B" | "C";
  fmpi5: number;
  fmpi10: number | null;
  state5: MomentumState;
  state10: MomentumState | null;
  aligned: boolean;
  zone: ZoneId | null;
  lastPrice: number;
  atr: number;
  stop: number;
  target1: number;
  target2: number;
  riskPct: number;
  rewardRisk: number;
  evidence: string[];
  risks: string[];
  coverage: number;
  dataQuality: DataQuality;
  ts: number;
}

export interface WatchOut {
  instrument: InstrumentMeta;
  fmpi: number;
  state: MomentumState;
  note: string;
}

export interface SuggestionPayload {
  timeframe: Timeframe;
  generatedAt: string | null;
  status: "idle" | "building" | "ready";
  progress: { done: number; total: number };
  ideas: TradeIdea[];
  watchOuts: WatchOut[];
  considered: number;
  qualified: number;
  minConviction: number;
  scanStatus: "idle" | "building" | "ready";
  scanProgress: { done: number; total: number };
  disclaimer: string;
}

/** States that may become an entry idea (trend-following only). */
const ENTRY_STATES = new Set<MomentumState>([
  "bullish_acceleration", "bullish_continuation", "bullish_momentum",
  "bearish_acceleration", "bearish_continuation", "bearish_momentum",
]);

/** States that are warnings, never entries. */
const WATCH_STATES = new Set<MomentumState>([
  "bullish_exhaustion", "bullish_reversal_watch",
  "bearish_exhaustion", "bearish_reversal_watch",
  // counter-trend bounces: information, never a trade in either direction
  "bearish_pullback", "bullish_pullback",
]);

const MIN_CONVICTION = 55;
const SHORTLIST = 14;
const DEEP_CONCURRENCY = 3;
const CACHE_TTL = 150_000;

function directionOf(state: MomentumState): Direction | null {
  if (state.startsWith("bullish")) return "long";
  if (state.startsWith("bearish")) return "short";
  return null;
}

function setupLabel(state: MomentumState): string {
  switch (state) {
    case "bullish_acceleration": return "Bullish acceleration";
    case "bullish_continuation": return "Bullish continuation";
    case "bullish_momentum": return "Bullish momentum";
    case "bearish_acceleration": return "Bearish acceleration";
    case "bearish_continuation": return "Bearish continuation";
    case "bearish_momentum": return "Bearish momentum";
    default: return "Momentum";
  }
}

const COMPONENT_LABEL: Record<ComponentKey, string> = {
  price_pressure: "price pressure",
  volume_participation: "volume",
  futures_positioning: "futures OI",
  options_positioning: "options OI",
  price_structure: "structure",
  acceleration_persistence: "acceleration",
};

/**
 * Structure-anchored risk reference.
 * Stop sits beyond the recent swing extreme (with an ATR buffer) and is
 * capped so an unusually wide swing does not produce an absurd level.
 */
function riskLevels(candles: Candle[], direction: Direction, atrValue: number) {
  const n = candles.length;
  const last = candles[n - 1].close;
  const window = candles.slice(Math.max(0, n - 10));
  const buffer = atrValue * 0.15;
  let stop: number;
  if (direction === "long") {
    const swingLow = Math.min(...window.map((c) => c.low));
    stop = swingLow - buffer;
    if (last - stop > atrValue * 2.5 || stop >= last) stop = last - atrValue * 1.5;
  } else {
    const swingHigh = Math.max(...window.map((c) => c.high));
    stop = swingHigh + buffer;
    if (stop - last > atrValue * 2.5 || stop <= last) stop = last + atrValue * 1.5;
  }
  const risk = Math.abs(last - stop);
  const target1 = direction === "long" ? last + risk : last - risk;
  const target2 = direction === "long" ? last + 2 * risk : last - 2 * risk;
  return {
    stop, target1, target2,
    riskPct: (risk / last) * 100,
    rewardRisk: 2,
  };
}

const DISCLAIMER =
  "Research output, not investment advice. Ideas require multi-factor agreement — an extreme FMPI reading alone never qualifies. Fewer than the requested number (including none) are returned when the evidence is not there. Levels are derived from recent structure and ATR; verify independently and manage your own risk.";

interface SuggestState {
  status: "idle" | "building" | "ready";
  builtAt: number | null;
  ideas: TradeIdea[];
  watchOuts: WatchOut[];
  considered: number;
  qualified: number;
  progress: { done: number; total: number };
}
const globalSuggestions = globalThis as typeof globalThis & {
  __fmpiSuggestionState?: SuggestState;
  __fmpiSuggestionInflight?: Promise<void> | null;
};
const state: SuggestState = globalSuggestions.__fmpiSuggestionState ?? {
  status: "idle", builtAt: null, ideas: [], watchOuts: [],
  considered: 0, qualified: 0, progress: { done: 0, total: 0 },
};
globalSuggestions.__fmpiSuggestionState = state;
let inflight: Promise<void> | null = globalSuggestions.__fmpiSuggestionInflight ?? null;

/**
 * Non-blocking accessor: returns whatever has genuinely been computed and
 * kicks off a refresh in the background when the result is stale. The API
 * therefore responds immediately instead of holding the request open for
 * a multi-instrument deep analysis.
 */
export function ensureSuggestions(
  rows: ScanRow[],
  scanStatus: "idle" | "building" | "ready",
  scanProgress: { done: number; total: number },
  limit = 5,
  tf: Timeframe = "5m",
): SuggestionPayload {
  const stale = state.builtAt === null || Date.now() - state.builtAt > CACHE_TTL;
  // Never run the deep multi-timeframe pass concurrently with the cold
  // universe scan. On Render's 512MB tier those two workloads together can
  // kill the process. The scanner publishes progress; suggestions begin as
  // soon as it reaches READY.
  if (state.status !== "building" && stale && rows.length > 0 && scanStatus === "ready") {
    void runBuild(rows, limit, tf);
  }
  return {
    timeframe: tf,
    generatedAt: state.builtAt ? new Date(state.builtAt).toISOString() : null,
    status: state.status,
    progress: state.progress,
    ideas: state.ideas.slice(0, limit),
    watchOuts: state.watchOuts,
    considered: state.considered,
    qualified: state.qualified,
    minConviction: MIN_CONVICTION,
    scanStatus, scanProgress,
    disclaimer: DISCLAIMER,
  };
}

async function runBuild(rows: ScanRow[], limit: number, tf: Timeframe): Promise<void> {
  if (inflight) return inflight;
  state.status = "building";
  inflight = (async () => {
    try {
      // Eligible universe: F&O equities + the two requested indices.
      const eligible = rows.filter(
        (r) =>
          r.value != null &&
          (r.quality === "valid" || r.quality === "partial") &&
          (r.instrument.segment === "fno" ||
            r.instrument.symbol === "NIFTY" ||
            r.instrument.symbol === "SENSEX"),
      );

      const watchOuts: WatchOut[] = eligible
        .filter((r) => WATCH_STATES.has(r.state))
        .sort((a, b) => Math.abs((b.value as number) - 50) - Math.abs((a.value as number) - 50))
        .slice(0, 5)
        .map((r) => ({
          instrument: r.instrument,
          fmpi: r.value as number,
          state: r.state,
          note: r.state.includes("pullback")
            ? "Counter-trend bounce inside the prevailing trend. Not an entry in either direction until the regime actually flips."
            : r.state.includes("reversal")
              ? "Reversal watch — divergence plus weakening pressure. Warning only, not a counter-trend entry."
              : "Pressure weakening against the prevailing move. Continuation is no longer well supported.",
        }));

      // Shortlist trend-following candidates; deep analysis is expensive.
      const shortlist = eligible
        .filter((r) => ENTRY_STATES.has(r.state) && directionOf(r.state))
        .sort((a, b) => Math.abs((b.value as number) - 50) - Math.abs((a.value as number) - 50))
        .slice(0, SHORTLIST);

      state.watchOuts = watchOuts;
      state.considered = shortlist.length;
      state.progress = { done: 0, total: shortlist.length };

      const ideas: TradeIdea[] = [];
      const queue = [...shortlist];

      const worker = async () => {
        for (;;) {
          const row = queue.shift();
          if (!row) return;
          try {
            // sessions=4 matches the scanner's cached depth; options are
            // skipped during screening so a pass stays a few requests deep.
            // includePeer=false: the confirming timeframe is fetched
            // explicitly below so a failure is visible instead of silently
            // degrading every idea to "unconfirmed".
            const payload = await getFmpiSeries(row.instrument.symbol, tf, 4, false, false, false, true);
            const l = payload.latest;
            if (!l || !l.zone || l.quality === "warming_up" || l.quality === "unavailable") continue;

            const direction = directionOf(l.state);
            // Re-check on fresh data: the state may have moved on since the scan.
            if (!direction || !ENTRY_STATES.has(l.state)) continue;
            // Never trade on a still-forming candle's reading alone.
            if (l.provisional && payload.points.length < 2) continue;

            // Higher-timeframe confirmation, fetched with a retry because
            // a transient miss must not be read as "no confirmation".
            const peerTf: Timeframe = tf === "5m" ? "10m" : "5m";
            let peer: { value: number; state: MomentumState } | null = null;
            for (let attempt = 0; attempt < 2 && !peer; attempt++) {
              try {
                const pp = await getFmpiSeries(row.instrument.symbol, peerTf, 4, false, false, false, true);
                const pl = pp.latest;
                if (pl && pl.zone && pl.quality !== "warming_up" && pl.quality !== "unavailable") {
                  peer = { value: pl.value, state: pl.state };
                }
              } catch {
                /* retry once, then treat as unconfirmed */
              }
            }
            const peerDir = peer ? directionOf(peer.state) : null;
            // Opposing higher-timeframe pressure disqualifies the idea.
            if (peerDir !== null && peerDir !== direction) continue;
            // Same direction is not automatically confirmation: a higher
            // timeframe sitting in exhaustion/reversal-watch is fading
            // pressure, so it counts as a caution, never as a confirm.
            const peerTrending = peer ? ENTRY_STATES.has(peer.state) : false;
            const aligned = peerDir !== null && peerDir === direction && peerTrending;
            const peerFading = peerDir === direction && !peerTrending;

            // Component agreement among those actually available.
            const sign = direction === "long" ? 1 : -1;
            const available = (Object.keys(l.components) as ComponentKey[]).filter(
              (k) => l.components[k].available && l.components[k].score != null,
            );
            const agreeing = available.filter((k) => sign * (l.components[k].score as number) > 0.02);
            const agreement = available.length ? agreeing.length / available.length : 0;

            /* Conviction is a weighted blend, not an additive score that
               saturates at 100: each pillar contributes a bounded share so
               ideas actually separate from one another.
                 continuation strength 45 · HTF confirmation 20
                 component agreement   20 · data coverage      15      */
            let conviction =
              (l.continuationScore ?? 50) * 0.45 +
              (aligned ? 20 : 0) +
              agreement * 20 +
              clamp(l.coverage, 0, 1) * 15;
            conviction -= (l.exhaustionScore ?? 0) * 0.2;
            if (l.quality === "partial") conviction -= 8;
            if (l.quality === "stale") conviction -= 25;
            const adverseDivergence =
              (direction === "long" && l.divergence?.includes("bearish")) ||
              (direction === "short" && l.divergence?.includes("bullish"));
            if (adverseDivergence) conviction -= l.divergence?.startsWith("developing") ? 10 : 20;
            if (peerFading) conviction -= 12;
            // Without higher-timeframe confirmation an idea can never be
            // presented as high conviction, however clean the 5M looks.
            if (!aligned) conviction = Math.min(conviction, 70);
            conviction = Math.round(clamp(conviction, 0, 100));
            if (conviction < MIN_CONVICTION) continue;

            const candles = payload.candles;
            if (candles.length < 20) continue;
            const atrValue = atr(
              candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close),
              candles.length - 1, 14,
            );
            if (!(atrValue > 0)) continue;
            const lastPrice = candles[candles.length - 1].close;
            const levels = riskLevels(candles, direction, atrValue);

            const evidence: string[] = [
              `FMPI ${l.value.toFixed(1)} in the ${l.zone} zone, slope ${(l.slope ?? 0) >= 0 ? "+" : ""}${(l.slope ?? 0).toFixed(2)}`,
              aligned && peer
                ? `${peerTf.toUpperCase()} confirms at ${peer.value.toFixed(1)} (${peer.state.replace(/_/g, " ")})`
                : peerFading && peer
                  ? `${peerTf.toUpperCase()} is same-direction but fading at ${peer.value.toFixed(1)} (${peer.state.replace(/_/g, " ")}) — caution, not confirmation`
                  : `${peerTf.toUpperCase()} confirmation unavailable — conviction capped`,
              `${agreeing.length}/${available.length} available components agree: ${agreeing.map((k) => COMPONENT_LABEL[k]).join(", ") || "none"}`,
            ];
            const fut = l.components.futures_positioning;
            if (fut.available && fut.evidence[0]) evidence.push(fut.evidence[0]);
            const opt = l.components.options_positioning;
            if (opt.available && opt.evidence[0]) evidence.push(opt.evidence[0]);

            const risks: string[] = [];
            if (peerFading) {
              risks.push(`${peerTf.toUpperCase()} pressure is already fading (${peer?.state.replace(/_/g, " ")}) — the higher timeframe does not support continuation.`);
            } else if (!aligned) {
              risks.push(`${peerTf.toUpperCase()} confirmation is absent — conviction is capped at 70 and the grade cannot be A.`);
            }
            if (adverseDivergence) risks.push(`Adverse ${l.divergence?.replace(/_/g, " ")} divergence is present.`);
            if ((l.exhaustionScore ?? 0) >= 45) risks.push(`Exhaustion evidence at ${l.exhaustionScore}/100 — pressure may be fading.`);
            if (l.coverage < 0.7) risks.push(`Only ${(l.coverage * 100).toFixed(0)}% component coverage: ${l.missingComponents.map((k) => COMPONENT_LABEL[k]).join(", ")} missing.`);
            if (l.quality !== "valid") risks.push(`Data quality is ${l.quality}.`);
            if (payload.marketState !== "open") risks.push("Market is closed — levels are from the last completed session.");
            if (risks.length === 0) risks.push("No material contradictions detected at this candle.");

            ideas.push({
              rank: 0,
              instrument: payload.instrument,
              direction,
              setup: setupLabel(l.state),
              conviction,
              // Grade A additionally requires 10M confirmation (enforced by
              // the cap above, which keeps unconfirmed ideas below 78).
              grade: conviction >= 78 ? "A" : conviction >= 66 ? "B" : "C",
              fmpi5: l.value,
              fmpi10: peer?.value ?? null,
              state5: l.state,
              state10: peer?.state ?? null,
              aligned,
              zone: l.zone,
              lastPrice,
              atr: atrValue,
              stop: levels.stop,
              target1: levels.target1,
              target2: levels.target2,
              riskPct: levels.riskPct,
              rewardRisk: levels.rewardRisk,
              evidence,
              risks,
              coverage: l.coverage,
              dataQuality: l.quality,
              ts: l.ts,
            });
          } catch {
            /* one instrument must never break the suggestion run */
          } finally {
            state.progress = { done: state.progress.done + 1, total: shortlist.length };
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(DEEP_CONCURRENCY, shortlist.length) }, worker),
      );

      // Rank by conviction; `limit` is applied on read so the cached set
      // stays reusable. Nothing is padded if fewer ideas qualify.
      ideas.sort((a, b) => b.conviction - a.conviction);
      state.ideas = ideas.map((idea, i) => ({ ...idea, rank: i + 1 }));
      state.qualified = ideas.length;
      state.builtAt = Date.now();
      state.status = "ready";
    } catch (e) {
      console.warn(`[suggestions] build failed: ${(e as Error).message}`);
      state.status = state.ideas.length ? "ready" : "idle";
      state.builtAt = state.ideas.length ? Date.now() : null;
    } finally {
      inflight = null;
      globalSuggestions.__fmpiSuggestionInflight = null;
    }
  })();
  globalSuggestions.__fmpiSuggestionInflight = inflight;
  return inflight;
}
