"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Building2, LandPlot, Lightbulb, Search,
  TrendingDown, TrendingUp, Trophy,
} from "lucide-react";
import type { InstrumentMeta, ScanRow } from "@/lib/fmpi/types";
import type { SuggestionPayload, TradeIdea } from "@/lib/fmpi/suggestions";
import { fmtNum, fmtPrice, fmtSigned, stateColor, STATE_LABEL } from "@/lib/client/format";

export interface MoverRow extends ScanRow { rank: number }
export interface TopMoversPayload {
  buying: MoverRow[];
  selling: MoverRow[];
  eligible: number;
  status: "idle" | "building" | "ready";
  progress: { done: number; total: number };
  disclaimer: string;
}

interface Props {
  instruments: InstrumentMeta[];
  scanRows: Map<string, ScanRow>;
  scanStatus: "idle" | "building" | "ready";
  scanProgress: { done: number; total: number };
  /** fetched once by the terminal and shared by both sidebar instances */
  movers: TopMoversPayload | null;
  trades: SuggestionPayload | null;
  selected: string;
  onSelect: (symbol: string) => void;
  /** called after a selection — used to close the mobile drawer */
  onNavigate?: () => void;
}

export function Sidebar({
  instruments, scanRows, scanStatus, scanProgress, movers, trades, selected, onSelect, onNavigate,
}: Props) {
  const [tab, setTab] = useState<"trades" | "top" | "universe">("trades");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase();
    if (!needle) return instruments;
    return instruments.filter(
      (m) => m.symbol.toUpperCase().includes(needle) || m.name.toUpperCase().includes(needle),
    );
  }, [instruments, q]);

  const indexes = filtered.filter((m) => m.segment === "index");
  const fno = filtered.filter((m) => m.segment === "fno");

  const pick = (symbol: string) => {
    onSelect(symbol);
    onNavigate?.();
  };

  const renderRow = (m: InstrumentMeta) => {
    const row = scanRows.get(m.symbol);
    const active = selected === m.symbol;
    return (
      <button
        key={m.instrumentKey}
        onClick={() => pick(m.symbol)}
        className={`row-hover flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-[7px] text-left transition-colors max-lg:py-[10px] ${
          active ? "bg-[rgba(65,200,255,0.10)] outline-1 outline-[rgba(65,200,255,0.4)]" : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="mono h-[7px] w-[7px] shrink-0 rounded-[2px]"
            style={{ background: row?.state ? stateColor(row.state) : "#33415a" }}
          />
          <span className={`truncate text-[12px] font-semibold tracking-wide ${active ? "text-white" : "text-[#c8d6ea]"}`}>
            {m.symbol}
          </span>
          {m.futuresKey && <span className="text-[8.5px] tracking-widest text-[#4a586e]">FUT</span>}
        </span>
        <span className="mono shrink-0 text-[11px]" style={{ color: row?.state ? stateColor(row.state) : "#4a586e" }}>
          {row?.value != null ? fmtNum(row.value) : "—"}
        </span>
      </button>
    );
  };

  const renderMover = (r: MoverRow, side: "buy" | "sell") => {
    const active = selected === r.instrument.symbol;
    const accent = side === "buy" ? "#2fd47b" : "#f0506e";
    return (
      <button
        key={r.instrument.instrumentKey}
        onClick={() => pick(r.instrument.symbol)}
        title={STATE_LABEL[r.state]}
        className={`row-hover flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left transition-colors max-lg:py-[10px] ${
          active ? "bg-[rgba(65,200,255,0.10)] outline-1 outline-[rgba(65,200,255,0.4)]" : ""
        }`}
      >
        <span className="mono w-[14px] shrink-0 text-[9.5px] text-[#4a586e]">{r.rank}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate text-[11.5px] font-semibold tracking-wide ${active ? "text-white" : "text-[#c8d6ea]"}`}>
            {r.instrument.symbol}
          </span>
          <span className="mono truncate text-[8.5px]" style={{ color: stateColor(r.state) }}>
            {STATE_LABEL[r.state]}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="mono text-[11.5px] font-bold" style={{ color: accent }}>{fmtNum(r.value)}</span>
          <span
            className="mono text-[8.5px]"
            style={{ color: (r.change ?? 0) >= 0 ? "#2fd47b" : "#f0506e" }}
          >
            {fmtSigned(r.change, 1)}
          </span>
        </span>
      </button>
    );
  };

  const coverage = movers?.progress ?? scanProgress;

  return (
    <aside className="panel flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden">
      {/* ─── tab bar (sits above the indices list) ─── */}
      <div className="flex shrink-0 border-b border-[rgba(125,165,220,0.1)]">
        <button
          onClick={() => setTab("trades")}
          className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-[9px] font-bold tracking-[0.1em] transition-colors ${
            tab === "trades" ? "bg-[rgba(65,200,255,0.08)] text-[#41c8ff] shadow-[inset_0_-2px_0_#41c8ff]" : "text-[#4a586e] hover:text-[#8ea3c4]"
          }`}
        >
          <Lightbulb className="h-3 w-3" /> TRADES
        </button>
        <button
          onClick={() => setTab("top")}
          className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-[9px] font-bold tracking-[0.1em] transition-colors ${
            tab === "top" ? "bg-[rgba(65,200,255,0.08)] text-[#41c8ff] shadow-[inset_0_-2px_0_#41c8ff]" : "text-[#4a586e] hover:text-[#8ea3c4]"
          }`}
        >
          <Trophy className="h-3 w-3" /> TOP 10
        </button>
        <button
          onClick={() => setTab("universe")}
          className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-[9px] font-bold tracking-[0.1em] transition-colors ${
            tab === "universe" ? "bg-[rgba(65,200,255,0.08)] text-[#41c8ff] shadow-[inset_0_-2px_0_#41c8ff]" : "text-[#4a586e] hover:text-[#8ea3c4]"
          }`}
        >
          <Building2 className="h-3 w-3" /> ALL
        </button>
      </div>

      {tab === "trades" ? (
        <TradesTab trades={trades} selected={selected} onPick={pick} />
      ) : tab === "top" ? (
        <>
          <div className="shrink-0 border-b border-[rgba(125,165,220,0.1)] px-3 py-2">
            <div className="panel-title">FMPI PRESSURE LEADERS · 5M · F&O STOCKS</div>
            <div className="mono mt-1 flex items-center justify-between text-[9px] text-[#4a586e]">
              <span>{movers?.eligible ?? 0} ranked</span>
              <span className={movers?.status === "building" ? "text-[#41c8ff]" : ""}>
                {movers?.status === "building" ? `scanning ${coverage.done}/${Math.max(coverage.total, 1)}` : "scan complete"}
              </span>
            </div>
            {movers?.status === "building" && (
              <div className="bar-track mt-1.5">
                <div
                  className="bar-fill"
                  style={{ width: `${(coverage.done / Math.max(coverage.total, 1)) * 100}%`, background: "#41c8ff" }}
                />
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <div className="panel-title flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[#2fd47b]">
              <TrendingUp className="h-3 w-3" /> TOP 10 BUYING PRESSURE
            </div>
            {movers?.buying.length
              ? movers.buying.map((r) => renderMover(r, "buy"))
              : <EmptyNote building={movers?.status === "building"} side="buying" />}

            <div className="panel-title flex items-center gap-1.5 px-2 pt-3 pb-1.5 text-[#f0506e]">
              <TrendingDown className="h-3 w-3" /> TOP 10 SELLING PRESSURE
            </div>
            {movers?.selling.length
              ? movers.selling.map((r) => renderMover(r, "sell"))
              : <EmptyNote building={movers?.status === "building"} side="selling" />}

            <p className="mt-3 rounded-md border border-[rgba(245,181,63,0.22)] bg-[rgba(245,181,63,0.05)] p-2 text-[9px] leading-snug text-[#c9a45c]">
              Ranked by each stock&apos;s own FMPI pressure — evidence, not buy/sell recommendations. Indices are excluded; only instruments with a genuine valid/partial reading are ranked.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 border-b border-[rgba(125,165,220,0.1)] p-3">
            <div className="flex items-center gap-2 rounded-md border border-[rgba(125,165,220,0.14)] bg-[rgba(4,7,12,0.6)] px-2 py-[6px]">
              <Search className="h-3.5 w-3.5 text-[#4a586e]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search instruments…"
                className="w-full bg-transparent text-[12px] text-[#dce6f2] outline-none placeholder:text-[#4a586e]"
              />
            </div>
            <div className="mono mt-2 flex items-center justify-between text-[9.5px] text-[#4a586e]">
              <span>{instruments.length} instruments · dynamic master</span>
              {scanStatus === "building" && (
                <span className="text-[#41c8ff]">scan {scanProgress.done}/{Math.max(scanProgress.total, 1)}</span>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <div className="panel-title flex items-center gap-1.5 px-2 pt-1 pb-1.5">
              <LandPlot className="h-3 w-3" /> INDICES
            </div>
            {indexes.map(renderRow)}
            <div className="panel-title flex items-center gap-1.5 px-2 pt-3 pb-1.5">
              <Building2 className="h-3 w-3" /> F&O EQUITIES ({fno.length})
            </div>
            {fno.map(renderRow)}
            {filtered.length === 0 && (
              <div className="mono p-4 text-center text-[11px] text-[#4a586e]">
                {instruments.length === 0 ? "syncing universe from Upstox instrument master…" : "no matches"}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function TradesTab({
  trades, selected, onPick,
}: { trades: SuggestionPayload | null; selected: string; onPick: (s: string) => void }) {
  // "building" covers both the universe scan and the deep analysis pass.
  const building = trades?.scanStatus === "building" || trades?.status === "building";
  const p =
    trades?.status === "building" && trades.progress.total > 0
      ? trades.progress
      : trades?.scanProgress ?? { done: 0, total: 0 };
  return (
    <>
      <div className="shrink-0 border-b border-[rgba(125,165,220,0.1)] px-3 py-2">
        <div className="panel-title">TOP 5 BY CONVICTION · F&O + NIFTY/SENSEX</div>
        <div className="mono mt-1 flex items-center justify-between text-[9px] text-[#4a586e]">
          <span>{trades ? `${trades.qualified} qualified / ${trades.considered} screened` : "…"}</span>
          <span className={building ? "text-[#41c8ff]" : ""}>
            {building
              ? `${trades?.status === "building" ? "analysing" : "scanning"} ${p.done}/${Math.max(p.total, 1)}`
              : `5M · min conviction ${trades?.minConviction ?? 55}`}
          </span>
        </div>
        {building && (
          <div className="bar-track mt-1.5">
            <div className="bar-fill" style={{ width: `${(p.done / Math.max(p.total, 1)) * 100}%`, background: "#41c8ff" }} />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {trades?.ideas.length
          ? trades.ideas.map((t) => <IdeaCard key={t.instrument.instrumentKey} idea={t} active={selected === t.instrument.symbol} onPick={onPick} />)
          : (
            <div className="mono px-2 py-3 text-[9.5px] leading-snug text-[#54637a]">
              {building
                ? "screening the universe — ideas appear only when several independent components agree"
                : "No setup currently meets the evidence threshold. The engine returns nothing rather than forcing a trade."}
            </div>
          )}

        {trades?.watchOuts.length ? (
          <>
            <div className="panel-title flex items-center gap-1.5 px-2 pt-3 pb-1.5 text-[#f5b53f]">
              <AlertTriangle className="h-3 w-3" /> WATCH-OUTS · NOT ENTRIES
            </div>
            {trades.watchOuts.map((w) => (
              <button
                key={w.instrument.instrumentKey}
                onClick={() => onPick(w.instrument.symbol)}
                title={w.note}
                className="row-hover flex w-full items-center justify-between gap-2 rounded-md px-2 py-[7px] text-left max-lg:py-[10px]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[11px] font-semibold text-[#c8d6ea]">{w.instrument.symbol}</span>
                  <span className="mono truncate text-[8.5px]" style={{ color: stateColor(w.state) }}>
                    {STATE_LABEL[w.state]}
                  </span>
                </span>
                <span className="mono text-[11px]" style={{ color: stateColor(w.state) }}>{fmtNum(w.fmpi)}</span>
              </button>
            ))}
          </>
        ) : null}

        <p className="mt-3 rounded-md border border-[rgba(245,181,63,0.22)] bg-[rgba(245,181,63,0.05)] p-2 text-[9px] leading-snug text-[#c9a45c]">
          Research output, not investment advice. An extreme FMPI reading alone never qualifies — ideas need agreement across timeframes and components. Levels come from recent structure and ATR; verify independently.
        </p>
      </div>
    </>
  );
}

function IdeaCard({
  idea, active, onPick,
}: { idea: TradeIdea; active: boolean; onPick: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const long = idea.direction === "long";
  const col = long ? "#2fd47b" : "#f0506e";
  const gradeCol = idea.grade === "A" ? "#2fd47b" : idea.grade === "B" ? "#41c8ff" : "#f5b53f";
  return (
    <div
      className={`mb-1.5 rounded-lg border p-2 transition-colors ${
        active ? "border-[rgba(65,200,255,0.45)] bg-[rgba(65,200,255,0.07)]" : "border-[rgba(125,165,220,0.12)]"
      }`}
    >
      <button onClick={() => onPick(idea.instrument.symbol)} className="flex w-full items-center gap-2 text-left">
        <span className="mono w-[12px] shrink-0 text-[9px] text-[#4a586e]">{idea.rank}</span>
        <span
          className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-[2px] text-[8.5px] font-bold"
          style={{ background: `${col}1f`, color: col }}
        >
          {long ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
          {long ? "LONG" : "SHORT"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-[#dce6f2]">
          {idea.instrument.symbol}
        </span>
        <span className="mono shrink-0 text-[8.5px] font-bold" style={{ color: gradeCol }}>{idea.grade}</span>
        <span className="mono shrink-0 text-[11px] font-bold" style={{ color: gradeCol }}>{idea.conviction}</span>
      </button>

      <div className="mono mt-1 flex items-center justify-between text-[8.5px] text-[#54637a]">
        <span>{idea.setup}</span>
        <span>
          5M {fmtNum(idea.fmpi5)}
          {idea.fmpi10 != null && <> · 10M {fmtNum(idea.fmpi10)}</>}
          {idea.aligned && <span className="text-[#2fd47b]"> ✓</span>}
        </span>
      </div>

      <div className="bar-track mt-1.5">
        <div className="bar-fill" style={{ width: `${idea.conviction}%`, background: gradeCol }} />
      </div>

      <div className="mono mt-1.5 grid grid-cols-4 gap-1 text-[8.5px]">
        <Cell label="ENTRY" value={fmtPrice(idea.lastPrice)} />
        <Cell label="STOP" value={fmtPrice(idea.stop)} color="#f0506e" />
        <Cell label="T1" value={fmtPrice(idea.target1)} color="#2fd47b" />
        <Cell label="T2" value={fmtPrice(idea.target2)} color="#2fd47b" />
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mono mt-1.5 w-full text-left text-[8.5px] text-[#41c8ff] hover:underline"
      >
        {open ? "− hide evidence" : `+ evidence & risks · risk ${idea.riskPct.toFixed(2)}% · R:R 1:${idea.rewardRisk}`}
      </button>

      {open && (
        <div className="mt-1.5 space-y-1 border-t border-[rgba(125,165,220,0.1)] pt-1.5">
          {idea.evidence.map((e, i) => (
            <p key={i} className="flex gap-1 text-[8.5px] leading-snug text-[#9db4d4]">
              <span className="text-[#2fd47b]">✓</span>{e}
            </p>
          ))}
          {idea.risks.map((r, i) => (
            <p key={i} className="flex gap-1 text-[8.5px] leading-snug text-[#c9a45c]">
              <span>!</span>{r}
            </p>
          ))}
          <p className="text-[8px] leading-snug text-[#4a586e]">
            Stop is the recent swing extreme (ATR-buffered); targets are 1R and 2R from it. Coverage {(idea.coverage * 100).toFixed(0)}% · {idea.dataQuality}.
          </p>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded border border-[rgba(125,165,220,0.1)] px-1 py-[3px]">
      <div className="text-[7px] tracking-[0.1em] text-[#4a586e]">{label}</div>
      <div style={{ color: color ?? "#c8d6ea" }}>{value}</div>
    </div>
  );
}

function EmptyNote({ building, side }: { building?: boolean; side: string }) {
  return (
    <div className="mono px-2 py-2 text-[9.5px] leading-snug text-[#54637a]">
      {building
        ? `scanning the universe — ${side} leaders appear as each stock's own FMPI is genuinely computed`
        : `no stock currently shows ${side} pressure on the completed 5M candles`}
    </div>
  );
}
