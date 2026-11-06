'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, Brush, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, ChevronLeft, ChevronRight, CircleHelp, Copy, CloudRain, Gauge, Play, Search, Waves, SlidersHorizontal } from 'lucide-react';
import { fetchCatchments, fetchForecast, fetchHistory } from '@/data/api';
import { HORIZONS } from '@/data/types';
import type { Catchment, DischargePoint, ForecastInputs, ForecastResult, Horizon, QualityFlag } from '@/data/types';
import { DISCLAIMER } from '@/config';
import { formatDate, fmtP, fmtQ, Eyebrow, Meter, PageHeading, Reveal, RiskBadge, RISK_META } from '@/components/Ui';
import { useAppStore } from '@/state/store';
import { useRunsStore } from '@/data/runs';

/* ───────────────────────── helpers ───────────────────────── */

const clampDate = (value: string, min: string, max: string) => (value < min ? min : value > max ? max : value);
const shiftDate = (value: string, amount: number) => {
  const d = new Date(`${value}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
};
const dateToX = (value: string) => new Date(`${value}T12:00:00Z`).getTime();

type ChartPoint = { x: number; date: string; observed: number | null; forecast: number | null; lower: number | null; band: number | null };

/* ───────────────────────── styles ───────────────────────── */
/* The water itself is drawn by the shared 3D scene (SceneCanvas) behind this page.
   Only the gauge and predicted-discharge line live in the DOM. */

const PAGE_CSS = `
.prediction-page{
  --cy:#5de1ee;--cy2:#b4f6fa;--ink:#eefcfd;--mut:#9dbcc4;--dim:#6f8f98;
  --line:rgba(150,230,242,.18);--mono:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);
  position:relative;z-index:1;max-width:1480px;margin:0 auto;
  padding:0 clamp(16px,3.4vw,56px) 90px;color:var(--ink);
}
.prediction-page p{color:var(--mut);margin:0;line-height:1.55}
.prediction-page h2{margin:4px 0 2px;font-size:clamp(20px,1.7vw,26px);font-weight:600;letter-spacing:-.01em;color:var(--ink)}

/* ── predicted waterline + gauge, drawn over the 3D water ── */
.predicted-band,.predicted-line{position:absolute;left:0;right:0;transition:bottom 1.6s cubic-bezier(.22,.8,.24,1),height 1.6s cubic-bezier(.22,.8,.24,1)}
.predicted-band{background:repeating-linear-gradient(135deg,rgba(210,163,255,.12) 0 8px,rgba(210,163,255,.04) 8px 16px)}
.predicted-line{height:0;border-top:2px dashed rgba(210,163,255,.85)}
.predicted-line span{position:absolute;right:clamp(12px,2vw,28px);transform:translateY(-100%);padding:3px 9px;margin-top:-4px;
  font:500 11px var(--mono);letter-spacing:.06em;color:#e8d3ff;background:rgba(18,8,32,.72);border:1px solid rgba(210,163,255,.4);border-radius:8px}

.water-gauge{position:absolute;left:0;top:0;bottom:0;width:64px}
.water-gauge .tick{position:absolute;left:10px;display:flex;align-items:center;gap:6px;font:500 9px var(--mono);color:rgba(190,235,242,.45);transform:translateY(50%)}
.water-gauge .tick::before{content:'';width:10px;height:1px;background:rgba(190,235,242,.4)}
.water-gauge .marker{position:absolute;left:0;transform:translateY(50%);transition:bottom 1.6s cubic-bezier(.22,.8,.24,1);
  display:flex;align-items:center;font:600 11px var(--mono);color:#02161b}
.water-gauge .marker b{padding:4px 9px 4px 8px;background:var(--cy2);border-radius:0 8px 8px 0;white-space:nowrap}

/* ── heading ── */
.prediction-page .heading-row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:26px;text-shadow:0 2px 24px rgba(2,16,22,.6)}
.prediction-page .asof-status{display:flex;align-items:center;gap:10px;padding:10px 16px;border:1px solid var(--line);border-radius:999px;
  background:rgba(3,14,19,.62);backdrop-filter:blur(8px);font:500 12px var(--mono);color:var(--mut);white-space:nowrap}
.prediction-page .asof-status strong{color:var(--cy2);font-weight:600}
.prediction-page .status-pulse{width:7px;height:7px;border-radius:50%;background:var(--cy);box-shadow:0 0 0 0 rgba(93,225,238,.6);animation:pp-pulse 2s infinite}
@keyframes pp-pulse{70%{box-shadow:0 0 0 9px rgba(93,225,238,0)}100%{box-shadow:0 0 0 0 rgba(93,225,238,0)}}

/* ── cards ── */
.prediction-page .glass-card{position:relative;background:linear-gradient(180deg,rgba(5,20,27,.78),rgba(3,11,16,.7));
  border:1px solid var(--line);border-radius:18px;padding:20px 22px;
  backdrop-filter:blur(12px) saturate(1.2);-webkit-backdrop-filter:blur(12px) saturate(1.2);
  box-shadow:0 22px 50px -28px rgba(0,0,0,.95),inset 0 1px 0 rgba(160,240,250,.07)}
.prediction-page .card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.prediction-page .data-label{display:block;font:500 10px var(--mono);letter-spacing:.12em;color:var(--dim);text-transform:uppercase}
.prediction-page .tag{font:500 10px var(--mono);letter-spacing:.12em;color:var(--cy);padding:6px 11px;border:1px solid rgba(93,225,238,.28);border-radius:999px;background:rgba(93,225,238,.06);white-space:nowrap}
.prediction-page .tag.warn{color:#ffd078;border-color:rgba(255,208,120,.3);background:rgba(255,208,120,.06)}

/* ── control deck ── */
.prediction-page .deck-wrap{position:relative;z-index:30;margin-bottom:18px}
.prediction-page .control-deck{display:grid;grid-template-columns:minmax(260px,1.3fr) minmax(280px,1fr) minmax(220px,.8fr);gap:22px;align-items:end;padding:18px 22px}
.prediction-page .control{display:flex;flex-direction:column;gap:9px;min-width:0}
.prediction-page .control-label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:var(--mut)}
.prediction-page .control-label strong{font:600 13px var(--mono);color:var(--cy2)}

.prediction-page .dam-picker{position:relative;display:flex;align-items:center;gap:10px;padding:0 6px 0 14px;height:50px;border-radius:13px;background:rgba(2,10,14,.6);border:1px solid var(--line);color:var(--mut);transition:.2s}
.prediction-page .dam-picker:focus-within{border-color:rgba(93,225,238,.6);box-shadow:0 0 0 4px rgba(93,225,238,.09)}
.prediction-page .dam-picker input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--ink);font-size:16px;font-weight:500}
.prediction-page .dam-picker>button{width:38px;height:38px;border-radius:10px;border:0;background:transparent;color:var(--cy);font-size:18px;cursor:pointer}
.prediction-page .dam-picker>button:hover{background:rgba(93,225,238,.1)}
.prediction-page .dam-options{position:absolute;left:0;right:0;top:calc(100% + 8px);max-height:340px;overflow:auto;padding:6px;border-radius:16px;background:rgba(3,12,17,.97);border:1px solid rgba(125,222,238,.28);box-shadow:0 30px 60px -20px #000;z-index:50;scrollbar-width:thin}
.prediction-page .dam-options button{width:100%;display:flex;align-items:center;gap:12px;text-align:left;padding:10px 12px;border:0;border-radius:11px;background:transparent;color:var(--ink);cursor:pointer}
.prediction-page .dam-options button:hover,.prediction-page .dam-options button.selected{background:rgba(93,225,238,.1)}
.prediction-page .dam-options button span:nth-child(2){flex:1;display:flex;flex-direction:column;min-width:0}
.prediction-page .dam-options small{color:var(--dim);font-size:11.5px}
.prediction-page .option-monogram{width:32px;height:32px;display:grid;place-items:center;border-radius:9px;background:rgba(93,225,238,.12);color:var(--cy);font-weight:600}
.prediction-page .option-value{font:500 11px var(--mono);color:var(--mut);white-space:nowrap}
.prediction-page .options-empty{padding:16px;color:var(--mut);font-size:13px}

.prediction-page .segmented-control{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:5px;height:50px;border-radius:13px;background:rgba(2,10,14,.55);border:1px solid var(--line)}
.prediction-page .segmented-control button{display:flex;align-items:baseline;justify-content:center;gap:5px;border:0;border-radius:9px;background:transparent;color:var(--mut);cursor:pointer;transition:.2s}
.prediction-page .segmented-control button strong{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;align-self:center}
.prediction-page .segmented-control button span{font-size:11px;align-self:center}
.prediction-page .segmented-control button:hover{background:rgba(93,225,238,.08);color:var(--ink)}
.prediction-page .segmented-control button.selected{background:linear-gradient(180deg,#a4f4f8,#5de1ee);color:#021419;box-shadow:0 8px 26px -10px rgba(93,225,238,.7)}

.prediction-page .range-slider{-webkit-appearance:none;appearance:none;width:100%;height:6px;margin:22px 0 14px;border-radius:99px;background:linear-gradient(90deg,rgba(93,225,238,.5),rgba(93,225,238,.12));outline:0;cursor:pointer}
.prediction-page .range-slider::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--cy);border:3px solid #021419;box-shadow:0 0 0 1px var(--cy),0 0 16px rgba(93,225,238,.7)}
.prediction-page .range-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--cy);border:3px solid #021419;box-shadow:0 0 0 1px var(--cy)}
.prediction-page .range-mini{margin:8px 0 4px}
.prediction-page .range-caption{display:flex;justify-content:space-between;color:var(--dim);font:10px var(--mono)}

/* ── KPI strip ── */
.prediction-page .kpi-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
.prediction-page .kpi{display:flex;flex-direction:column;gap:5px;padding:16px 18px}
.prediction-page .kpi strong{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1}
.prediction-page .kpi strong small{font-size:13px;color:var(--mut);font-weight:400}
.prediction-page .kpi>span:last-child{font-size:12px;color:var(--mut)}
.prediction-page .kpi.accent{border-color:rgba(93,225,238,.4);background:linear-gradient(135deg,rgba(93,225,238,.16),rgba(3,11,16,.72))}
.prediction-page .kpi .up{color:#ff9aa1}.prediction-page .kpi .down{color:#6df0b0}
.prediction-page .kpi-toggle{justify-content:space-between}
.prediction-page .tank-toggle{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink);cursor:pointer;position:relative;user-select:none}
.prediction-page .tank-toggle input{position:absolute;opacity:0;width:0;height:0}
.prediction-page .switch{width:40px;height:23px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid var(--line);position:relative;transition:.25s;flex:none}
.prediction-page .switch::after{content:'';position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:var(--mut);transition:.25s}
.prediction-page .tank-toggle input:checked + .switch{background:rgba(210,163,255,.25);border-color:rgba(210,163,255,.6)}
.prediction-page .tank-toggle input:checked + .switch::after{transform:translateX(17px);background:#d2a3ff;box-shadow:0 0 10px #d2a3ff}
.prediction-page .tank-toggle input:focus-visible + .switch{outline:2px solid var(--cy);outline-offset:2px}

/* ── main grid ── */
.prediction-page .main-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:20px;align-items:start;margin-bottom:20px}
.prediction-page .workbench-main{display:grid;gap:18px;min-width:0}
.prediction-page .details-column{position:sticky;top:112px;max-height:calc(100vh - 132px);overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(93,225,238,.3) transparent;border-radius:18px}
.prediction-page .lower-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:20px;align-items:start;margin-bottom:16px}

/* ── inputs card ── */
.prediction-page .inputs-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.prediction-page .input-group{display:flex;flex-direction:column;gap:11px;min-width:0;padding:13px 14px;border-radius:14px;border:1px solid var(--line);background:rgba(2,10,14,.42)}
.prediction-page .input-group>.data-label{display:flex;align-items:center;gap:7px;color:var(--cy)}
.prediction-page .input-group>.data-label svg{width:13px;height:13px}
.prediction-page .control-mini{display:flex;flex-direction:column;gap:5px}
.prediction-page .control-mini .control-label{font-size:12px}
.prediction-page .control-mini .control-label strong{font-size:12px}
.prediction-page .auto-chips{display:flex;flex-direction:column;gap:8px}
.prediction-page .auto-chip{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12px;color:var(--mut)}
.prediction-page .auto-chip strong{font:500 12.5px var(--mono);color:var(--cy2);font-variant-numeric:tabular-nums}
.prediction-page .attr-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.prediction-page .attr-cell{display:flex;flex-direction:column;gap:3px;padding:9px 11px;border-radius:10px;background:rgba(1,8,12,.55);border:1px solid rgba(126,196,208,.1)}
.prediction-page .attr-cell span{font:500 8px var(--mono);letter-spacing:.1em;color:var(--dim)}
.prediction-page .attr-cell strong{font-size:12px;font-weight:500;color:#c3dde0;line-height:1.3}
.prediction-page .quality-select{height:38px;padding:0 10px;border:1px solid var(--line);border-radius:10px;background:rgba(2,10,14,.7);color:var(--ink);font:500 13px var(--mono);color-scheme:dark}
.prediction-page .run-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:13px;border-top:1px solid var(--line)}
.prediction-page .run-button{display:inline-flex;align-items:center;gap:9px;height:46px;padding:0 22px;border-radius:13px;border:0;background:linear-gradient(180deg,#a4f4f8,#5de1ee);color:#021419;font-weight:700;font-size:13.5px;letter-spacing:.02em;cursor:pointer;box-shadow:0 10px 28px -10px rgba(93,225,238,.8);transition:.2s}
.prediction-page .run-button:hover{transform:translateY(-2px);filter:brightness(1.05)}
.prediction-page .run-button:disabled{opacity:.45;cursor:not-allowed;transform:none}
.prediction-page .run-note{font-size:12px;color:var(--dim)}

/* ── chart ── */
.prediction-page .chart-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--mut)}
.prediction-page .chart-legend span{display:flex;align-items:center;gap:8px}
.prediction-page .chart-legend i{display:block;width:22px;height:0;border-top:2px solid}
.prediction-page .legend-observed{border-color:#7ca4aa}
.prediction-page .legend-forecast{border-color:#5de1ee;border-top-style:dashed}
.prediction-page .chart-wrap{height:clamp(320px,46vh,460px);position:relative}
.prediction-page .chart-state{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--mut);text-align:center}
.prediction-page .chart-skeleton{height:100%;display:flex;flex-direction:column;justify-content:center;gap:18px}
.prediction-page .chart-skeleton span{height:14px;border-radius:8px;background:linear-gradient(90deg,rgba(93,225,238,.05),rgba(93,225,238,.18),rgba(93,225,238,.05));background-size:200% 100%;animation:pp-shimmer 1.4s infinite linear}
.prediction-page .chart-skeleton span:nth-child(2){width:78%}.prediction-page .chart-skeleton span:nth-child(3){width:55%}
@keyframes pp-shimmer{to{background-position:-200% 0}}
.prediction-page .chart-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--dim)}
.prediction-page .chart-foot>span{display:flex;align-items:center;gap:7px}
.prediction-page .risk-dot{width:8px;height:8px;border-radius:2px;background:rgba(255,86,96,.55)}
.prediction-page .chart-tooltip{padding:11px 14px;border-radius:12px;background:rgba(3,12,17,.95);border:1px solid rgba(125,222,238,.3);box-shadow:0 14px 34px -10px #000;display:flex;flex-direction:column;gap:6px;min-width:190px}
.prediction-page .chart-tooltip>span{font:500 10px var(--mono);letter-spacing:.12em;color:var(--mut);text-transform:uppercase}
.prediction-page .chart-tooltip div{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--mut)}
.prediction-page .chart-tooltip div strong{margin-left:auto;color:var(--ink);font-variant-numeric:tabular-nums}
.prediction-page .chart-tooltip i{width:8px;height:8px;border-radius:50%}
.prediction-page .tooltip-observed{background:#7ca4aa}.prediction-page .tooltip-forecast{background:#5de1ee}

/* ── output card ── */
.prediction-page .output-table{display:grid;gap:8px}
.prediction-page .output-row{display:grid;grid-template-columns:56px minmax(90px,1fr) repeat(3,minmax(84px,.9fr)) minmax(84px,.9fr);align-items:center;gap:12px;padding:11px 14px;border-radius:13px;border:1px solid transparent;background:rgba(2,10,14,.45);color:var(--ink);text-align:left;transition:.2s}
.prediction-page .output-row.head{border:0;background:transparent;padding-bottom:2px}
.prediction-page .output-row.head span{font:500 9px var(--mono);letter-spacing:.1em;color:var(--dim)}
.prediction-page .output-row.active{border-color:rgba(93,225,238,.5);background:rgba(93,225,238,.07);box-shadow:inset 3px 0 0 var(--cy)}
.prediction-page .output-row strong{font:600 15px var(--display);color:#dff2f3}
.prediction-page .output-row span{font:500 12px var(--mono);color:var(--mut);font-variant-numeric:tabular-nums}
.prediction-page .output-row .prob-cell{display:flex;align-items:center;gap:8px}
.prediction-page .output-row .prob-cell .meter-wrap{flex:1}
.prediction-page .schema-block{margin-top:14px;padding:13px 15px;border-radius:13px;border:1px solid rgba(125,222,238,.18);background:rgba(1,8,12,.72)}
.prediction-page .schema-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:9px}
.prediction-page .schema-head span{font:500 9px var(--mono);letter-spacing:.12em;color:var(--dim)}
.prediction-page .copy-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--mut);font-size:11px;cursor:pointer;transition:.2s}
.prediction-page .copy-btn:hover{color:var(--ink);border-color:rgba(93,225,238,.5)}
.prediction-page .schema-pre{margin:0;max-height:210px;overflow:auto;font:11px/1.7 var(--mono);color:#9fd0d6;white-space:pre;scrollbar-width:thin}

/* ── risk read (horizon comparison) ── */
.prediction-page .horizon-comparison{display:flex;flex-direction:column;gap:8px}
.prediction-page .horizon-row{display:grid;grid-template-columns:56px minmax(90px,1fr) minmax(130px,1.1fr) auto;align-items:center;gap:16px;padding:12px 14px;border-radius:14px;border:1px solid transparent;background:rgba(2,10,14,.45);color:var(--ink);text-align:left;cursor:pointer;transition:.2s}
.prediction-page .horizon-row:hover{border-color:var(--line)}
.prediction-page .horizon-row.active{border-color:rgba(93,225,238,.5);background:rgba(93,225,238,.07);box-shadow:inset 3px 0 0 var(--cy)}
.prediction-page .horizon-name{font-size:24px;font-weight:600;line-height:1;display:flex;flex-direction:column;gap:3px}
.prediction-page .horizon-name small{font:500 9px var(--mono);letter-spacing:.14em;color:var(--dim)}
.prediction-page .confidence-meter{display:flex;flex-direction:column;gap:6px}
.prediction-page .confidence-meter strong{font-size:14px}
.prediction-page .value-pair{display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--mut)}
.prediction-page .value-pair strong{color:var(--ink);font-weight:500;font-variant-numeric:tabular-nums}
.prediction-page .skill-note{font:500 11px var(--mono);color:var(--dim);text-align:right;white-space:nowrap}
.prediction-page .skill-note.positive{color:#6df0b0}
.prediction-page .time-controls{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}
.prediction-page .step-button,.prediction-page .latest-button{display:inline-flex;align-items:center;gap:7px;height:44px;padding:0 15px;border-radius:12px;border:1px solid var(--line);background:rgba(2,10,14,.55);color:var(--ink);font-weight:500;font-size:13.5px;cursor:pointer;transition:.2s}
.prediction-page .step-button:hover:not(:disabled),.prediction-page .latest-button:hover{border-color:rgba(93,225,238,.55);background:rgba(93,225,238,.09)}
.prediction-page .step-button:disabled{opacity:.35;cursor:not-allowed}
.prediction-page .date-picker{display:flex;align-items:center;gap:9px;height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:rgba(2,10,14,.55);color:var(--cy);flex:1;min-width:170px}
.prediction-page .date-picker input{background:none;border:0;outline:0;color:var(--ink);font:500 14px var(--mono);color-scheme:dark;flex:1;min-width:0}
.prediction-page .footnote{display:flex;gap:14px;align-items:flex-start;padding:4px 6px;font-size:12px;text-shadow:0 1px 12px rgba(2,16,22,.9)}
.prediction-page .footnote>span{font:500 10px var(--mono);letter-spacing:.12em;color:var(--cy);padding-top:2px;white-space:nowrap}

/* ── catchment details ── */
.prediction-page .details-card{display:flex;flex-direction:column;gap:16px}
.prediction-page .details-title{display:flex;justify-content:space-between;align-items:center}
.prediction-page .details-emblem{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;background:rgba(93,225,238,.1);color:var(--cy);border:1px solid rgba(93,225,238,.25)}
.prediction-page .details-card h2{font-size:28px;margin:0;line-height:1.05}
.prediction-page .details-location{display:flex;align-items:center;gap:6px;font-size:13px;margin-top:-8px}
.prediction-page .details-asof{padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,rgba(93,225,238,.12),rgba(93,225,238,.03));border:1px solid rgba(93,225,238,.25)}
.prediction-page .details-asof span{display:block;font:500 10px var(--mono);letter-spacing:.12em;color:var(--mut);margin-bottom:4px}
.prediction-page .details-asof strong{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums}
.prediction-page .details-asof small{font-size:13px;color:var(--mut);font-weight:400}
.prediction-page .detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;border-radius:14px;overflow:hidden;background:var(--line);border:1px solid var(--line)}
.prediction-page .detail-grid>div{display:flex;flex-direction:column;gap:3px;padding:11px 13px;background:rgba(3,12,17,.9)}
.prediction-page .detail-grid span{font:500 9px var(--mono);letter-spacing:.1em;color:var(--dim)}
.prediction-page .detail-grid strong{font-size:13px;font-weight:500;line-height:1.35}
.prediction-page .places-section{display:flex;flex-direction:column;gap:9px}
.prediction-page .chip-row{display:flex;flex-wrap:wrap;gap:6px}
.prediction-page .chip{padding:5px 11px;border-radius:999px;font-size:12px;color:var(--cy2);background:rgba(93,225,238,.08);border:1px solid rgba(93,225,238,.22)}
.prediction-page .chip-alert{color:#ffb3b3;background:rgba(255,86,96,.09);border-color:rgba(255,120,130,.3)}
.prediction-page .location-map{position:relative;height:200px;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:radial-gradient(circle at 50% 45%,rgba(93,225,238,.1),rgba(2,10,14,.9) 70%)}
.prediction-page .location-map::before{content:'';position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:28px 28px;opacity:.45}
.prediction-page .location-map svg{position:absolute;inset:0;width:100%;height:100%}
.prediction-page .map-watermark{position:absolute;left:14px;top:10px;font:600 22px var(--mono);letter-spacing:.3em;color:rgba(93,225,238,.07)}
.prediction-page .map-outline{fill:rgba(93,225,238,.06);stroke:rgba(93,225,238,.45);stroke-width:.6}
.prediction-page .map-river{fill:none;stroke:rgba(93,225,238,.55);stroke-width:.7;stroke-dasharray:2 1.5}
.prediction-page .map-pin{fill:#a4f4f8}
.prediction-page .map-ping{fill:rgba(93,225,238,.25);animation:pp-ping 2.2s infinite;transform-box:fill-box;transform-origin:center}
@keyframes pp-ping{0%{transform:scale(.5);opacity:1}100%{transform:scale(2.4);opacity:0}}
.prediction-page .map-label{position:absolute;left:12px;bottom:10px;display:flex;flex-direction:column;gap:2px}
.prediction-page .map-label span{font-size:12px;color:var(--mut)}
.prediction-page .map-label strong{font:500 11px var(--mono);color:var(--cy2)}
.prediction-page .details-footer{display:flex;justify-content:space-between;align-items:center;padding-top:12px;border-top:1px solid var(--line);font-size:12px;color:var(--dim)}
.prediction-page .details-footer strong{color:var(--ink);font-weight:500}

/* ── responsive ── */
@media (max-width:1280px){
  .prediction-page .lower-grid{grid-template-columns:1fr}
}
@media (max-width:1180px){
  .prediction-page .main-grid{grid-template-columns:1fr}
  .prediction-page .details-column{position:static;max-height:none}
  .prediction-page .control-deck{grid-template-columns:1fr 1fr}
  .prediction-page .control-deck .control:first-child{grid-column:1/-1}
  .prediction-page .kpi-strip{grid-template-columns:1fr 1fr}
  .prediction-page .inputs-grid{grid-template-columns:1fr 1fr}
}
@media (max-width:760px){
  .water-gauge{display:none}
  .prediction-page .glass-card{padding:16px;border-radius:16px}
  .prediction-page .control-deck{grid-template-columns:1fr}
  .prediction-page .kpi-strip{grid-template-columns:1fr 1fr;gap:10px}
  .prediction-page .kpi strong{font-size:21px}
  .prediction-page .horizon-row{grid-template-columns:48px 1fr;gap:10px}
  .prediction-page .horizon-row .skill-note{text-align:left}
  .prediction-page .output-row{grid-template-columns:44px 1fr 1fr;row-gap:8px}
  .prediction-page .output-row.head{display:none}
  .prediction-page .detail-grid{grid-template-columns:1fr}
  .prediction-page .inputs-grid{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  .status-pulse,.map-ping{animation:none !important}
  .predicted-line,.predicted-band,.water-gauge .marker{transition:none !important}
}
`;

/* ───────────────────────── page ───────────────────────── */

const DEFAULT_CATCHMENT = 'camels_01047000';

export default function PredictPage() {
  const [catchmentId, setCatchmentId] = useState(DEFAULT_CATCHMENT);
  const [horizon, setHorizon] = useState<Horizon>(7);
  const [windowDays, setWindowDays] = useState(180);
  const [origin, setOrigin] = useState('');
  const [inputs, setInputs] = useState<ForecastInputs>({ antecedentRainMm: 90, forecastRainMm: 85, tempC: 24, gapDays: 0, quality: 'good' });
  const [search, setSearch] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const savePending = useRef(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  const setSelectedCatchment = useAppStore((s) => s.setSelectedCatchment);
  const setStoreHorizon = useAppStore((s) => s.setHorizon);
  const addRun = useRunsStore((s) => s.addRun);

  /* ── data ── */
  const catchmentsQuery = useQuery({ queryKey: ['catchments'], queryFn: ({ signal }) => fetchCatchments(signal) });
  const catchments = catchmentsQuery.data ?? [];
  const catchment = catchments.find((item) => item.id === catchmentId) ?? catchments[0];

  const latestDate = catchment?.lastRecorded.date ?? new Date().toISOString().slice(0, 10);
  const minDate = shiftDate(latestDate, -364);

  /* ── URL <-> state ── */
  useEffect(() => {
    if (!catchments.length || urlReady) return;
    const params = new URLSearchParams(window.location.search);
    const requestedCatchment = params.get('catchment');
    const requestedH = Number(params.get('horizon'));
    const requestedOrigin = params.get('origin');

    const nextCatchment = catchments.some((item) => item.id === requestedCatchment) ? requestedCatchment! : catchments[0].id;
    const chosen = catchments.find((item) => item.id === nextCatchment)!;
    const nextH = HORIZONS.includes(requestedH as Horizon) ? (requestedH as Horizon) : 7;
    const nextOrigin = clampDate(requestedOrigin ?? chosen.lastRecorded.date, shiftDate(chosen.lastRecorded.date, -364), chosen.lastRecorded.date);

    setCatchmentId(nextCatchment);
    setHorizon(nextH);
    setOrigin(nextOrigin);
    setInputs(chosen.defaultInputs);
    setSelectedCatchment(nextCatchment);
    setStoreHorizon(nextH);
    setUrlReady(true);
  }, [catchments, urlReady, setSelectedCatchment, setStoreHorizon]);

  useEffect(() => {
    if (!urlReady || !origin) return;
    const params = new URLSearchParams();
    params.set('catchment', catchmentId);
    params.set('horizon', String(horizon));
    params.set('origin', origin);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [catchmentId, horizon, origin, urlReady]);

  useEffect(() => { setSelectedCatchment(catchmentId); }, [catchmentId, setSelectedCatchment]);
  useEffect(() => { setStoreHorizon(horizon); }, [horizon, setStoreHorizon]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) setShowOptions(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  /* ── history + forecast ── */
  const historyQuery = useQuery({
    queryKey: ['history', catchment?.id, origin, windowDays],
    queryFn: ({ signal }) => fetchHistory(catchment!, origin, windowDays, signal),
    enabled: !!catchment && urlReady && !!origin,
  });
  const history = historyQuery.data ?? [];
  const historyThroughOrigin = history.filter((point) => point.date <= origin);
  const hasAnchor = historyThroughOrigin.some((point) => point.date === origin) || historyThroughOrigin.length > 0;
  const inputsKey = JSON.stringify(inputs);
  const forecastQuery = useQuery({
    queryKey: ['forecast', catchment?.id, origin, inputsKey],
    queryFn: ({ signal }) => fetchForecast(catchment!, origin, inputs, horizon, signal),
    enabled: !!catchment && urlReady && !!origin && hasAnchor && historyQuery.isSuccess,
    staleTime: 0,
  });
  const forecast: ForecastResult | undefined =
    forecastQuery.data && catchment && forecastQuery.data.catchmentId === catchment.id && forecastQuery.data.asOf === origin
      ? forecastQuery.data
      : undefined;

  /* log the run once the user presses RUN (the automatic first render is not logged) */
  useEffect(() => {
    if (!savePending.current || !forecast || !catchment || forecastQuery.isFetching) return;
    const idx = HORIZONS.indexOf(horizon);
    addRun({
      id: `run-${Date.now()}`,
      savedAt: new Date().toISOString(),
      catchmentId: catchment.id,
      catchmentCode: catchment.code,
      catchmentName: catchment.name,
      river: catchment.river,
      origin,
      horizon,
      inputs,
      output: forecast.output,
      risk: forecast.risk,
      predictedQ: forecast.output.predicted_discharge[idx],
      pHigh: forecast.pHigh[horizon],
      pExt: forecast.pExt[horizon],
      lowerAtH: forecast.output.prediction_intervals.lower[idx],
      upperAtH: forecast.output.prediction_intervals.upper[idx],
    });
    savePending.current = false;
  }, [forecast, catchment, horizon, origin, inputs, addRun, forecastQuery.isFetching]);

  /* ── chart data ── */
  const chartData = useMemo(() => {
    const rows: ChartPoint[] = history
      .filter((p) => p.date <= origin)
      .map((p) => ({ x: dateToX(p.date), date: p.date, observed: p.discharge, forecast: null, lower: null, band: null }));
    const anchor = rows.at(-1);
    if (anchor) anchor.forecast = anchor.observed;
    forecast?.series.forEach((p) =>
      rows.push({ x: dateToX(p.date), date: p.date, observed: null, forecast: p.discharge, lower: p.lower, band: p.lower !== null ? (p.upper ?? 0) - p.lower : null }),
    );
    return rows;
  }, [history, origin, forecast]);

  const chartYDomain = useMemo<[number, number]>(() => {
    if (!catchment) return [0, 1];
    const values = chartData
      .flatMap((p) => [p.observed, p.forecast, p.lower, p.lower !== null && p.band !== null ? p.lower + p.band : null])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (!values.length) return [0, catchment.thresholdExtreme];
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values, catchment.thresholdHigh);
    const span = Math.max(dataMax - dataMin, catchment.thresholdHigh * 0.08, 1);
    const padding = span * 0.14;
    return [Math.max(0, dataMin - padding), dataMax + padding];
  }, [chartData, catchment]);

  /* ── derived read-outs ── */
  const currentLevel = historyThroughOrigin.filter((p) => p.discharge !== null).at(-1)?.discharge ?? catchment?.lastRecorded.discharge ?? 0;
  const recentMean = useMemo(() => {
    const window = historyThroughOrigin.filter((p) => p.discharge !== null).slice(-5).map((p) => p.discharge as number);
    return window.length ? window.reduce((s, v) => s + v, 0) / window.length : undefined;
  }, [historyThroughOrigin]);
  const trend = recentMean !== undefined && currentLevel ? currentLevel - recentMean : undefined;
  const idx = HORIZONS.indexOf(horizon);
  const predicted = forecast?.output.predicted_discharge[idx];
  const delta = predicted !== undefined ? predicted - currentLevel : undefined;
  const pHigh = forecast?.pHigh[horizon];
  const pExt = forecast?.pExt[horizon];
  const riskMeta = forecast ? RISK_META[forecast.risk] : undefined;

  /* ── actions ── */
  const chooseCatchment = (next: string) => {
    setCatchmentId(next);
    const found = catchments.find((item) => item.id === next);
    if (found) {
      setOrigin(found.lastRecorded.date);
      setInputs(found.defaultInputs);
    }
    setShowOptions(false);
    setSearch('');
  };
  const step = (amount: number) => setOrigin((date) => (date ? clampDate(shiftDate(date, amount), minDate, latestDate) : date));
  const run = useCallback(() => { savePending.current = true; forecastQuery.refetch(); }, [forecastQuery]);
  const copySchema = () => {
    if (!forecast) return;
    navigator.clipboard?.writeText(JSON.stringify(forecast.output, null, 2)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  const filteredCatchments = catchments.filter((item) => `${item.name} ${item.code} ${item.location} ${item.river}`.toLowerCase().includes(search.toLowerCase()));
  const isLoading = catchmentsQuery.isLoading || (urlReady && historyQuery.isLoading);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />

      <section className="prediction-page">
        <div className="heading-row">
          <PageHeading
            label="FORECAST WORKBENCH"
            title={<>Run the<br /><span>river model.</span></>}
            description="Set the catchment and origin, feed the model its observations and forcing, then read discharge, exceedance odds and intervals at the official horizons."
          />
          <div className="asof-status">
            <span className="status-pulse" />
            <span>Forecast origin</span>
            <strong>{origin ? formatDate(origin) : 'Loading…'}</strong>
          </div>
        </div>

        {catchmentsQuery.isError && (
          <div className="glass-card chart-state" style={{ height: 140 }}>
            <strong>Catchment register could not be loaded.</strong>
            <button className="button button-ghost" onClick={() => catchmentsQuery.refetch()}>Retry ↻</button>
          </div>
        )}

        {catchment && (
          <>
            {/* ── controls ── */}
            <div className="deck-wrap">
              <Reveal>
                <section className="glass-card control-deck">
                  <div className="control" ref={selectorRef}>
                    <div className="control-label"><span>Catchment · §8.2 identity</span><strong>{catchment.code}</strong></div>
                    <div className="dam-picker">
                      <Search size={16} />
                      <input
                        value={showOptions ? search : catchment.name}
                        onChange={(e) => { setSearch(e.target.value); setShowOptions(true); }}
                        onFocus={() => { setSearch(''); setShowOptions(true); }}
                        onKeyDown={(e) => { if (e.key === 'ArrowDown') setShowOptions(true); if (e.key === 'Escape') setShowOptions(false); }}
                        aria-label="Search catchments"
                        placeholder="Search catchment name or code"
                      />
                      <button type="button" onClick={() => { setSearch(''); setShowOptions((open) => !open); }} aria-expanded={showOptions} aria-label="Toggle catchment list">⌄</button>
                      {showOptions && (
                        <div className="dam-options">
                          {filteredCatchments.map((item) => (
                            <button key={item.id} type="button" onClick={() => chooseCatchment(item.id)} className={catchment.id === item.id ? 'selected' : ''}>
                              <span className="option-monogram">{item.name.slice(0, 1)}</span>
                              <span><strong>{item.name}</strong><small>{item.code} · {item.river}</small></span>
                              <span className="option-value">{fmtQ(item.thresholdHigh)} {item.unit}</span>
                            </button>
                          ))}
                          {filteredCatchments.length === 0 && <div className="options-empty">No catchments found for “{search}”.</div>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="control">
                    <div className="control-label"><span>Forecast horizon</span><strong>OFFICIAL SET · 1 · 3 · 5</strong></div>
                    <div className="segmented-control" role="group" aria-label="Forecast horizon">
                      {HORIZONS.map((item) => (
                        <button key={item} className={item === horizon ? 'selected' : ''} onClick={() => setHorizon(item)}>
                          <strong>{item}</strong><span>{item === 1 ? 'day' : 'days'}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="control">
                    <div className="control-label"><span>History window</span><strong>{windowDays} days</strong></div>
                    <input
                      className="range-slider"
                      type="range" min="60" max="365" step="1"
                      value={windowDays}
                      onChange={(e) => setWindowDays(Number(e.target.value))}
                      aria-label="History window from 60 to 365 days"
                    />
                    <div className="range-caption"><span>60 d</span><span>365 d</span></div>
                  </div>
                </section>
              </Reveal>
            </div>

            {/* ── KPI strip ── */}
            <Reveal delay={0.04}>
              <div className="kpi-strip">
                <div className="glass-card kpi">
                  <span className="data-label">Latest observed discharge</span>
                  <strong>{fmtQ(currentLevel)} <small>{catchment.unit}</small></strong>
                  <span>{trend !== undefined ? <span className={trend > 0 ? 'up' : 'down'}>{trend > 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)} {catchment.unit} vs 5-day mean</span> : 'vs 5-day mean'}</span>
                </div>
                <div className="glass-card kpi accent">
                  <span className="data-label">Predicted · {horizon}-day horizon</span>
                  <strong>{predicted !== undefined ? fmtQ(predicted) : '—'} <small>{catchment.unit}</small></strong>
                  <span>
                    {delta !== undefined
                      ? <span className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} {catchment.unit} vs origin</span>
                      : 'Waiting for the model'}
                  </span>
                </div>
                <div className="glass-card kpi">
                  <span className="data-label">High-flow probability · P(Q &gt; T(c))</span>
                  <strong>{pHigh !== undefined ? fmtP(pHigh) : '—'}</strong>
                  <span>T(c) {fmtQ(catchment.thresholdHigh)} {catchment.unit}</span>
                </div>
              </div>
            </Reveal>

            {/* ── inputs + chart | details ── */}
            <div className="main-grid">
              <div className="workbench-main">
                {/* ── model inputs ── */}
                <Reveal delay={0.05}>
                  <section className="glass-card">
                    <div className="card-head">
                      <div>
                        <Eyebrow>MODEL INPUTS · CHALLENGE §8.2</Eyebrow>
                        <h2>Feed the model</h2>
                        <p>Identity and static attributes come from the register; forcing and missingness are yours to set.</p>
                      </div>
                      <span className="tag success">CATBOOST ML · LIVE INFERENCE</span>
                    </div>

                    <div className="inputs-grid">
                      <div className="input-group">
                        <span className="data-label"><CloudRain /> METEOROLOGY · FORCING</span>
                        <div className="control-mini">
                          <div className="control-label"><span>Antecedent rain · past 7 d</span><strong>{inputs.antecedentRainMm} mm</strong></div>
                          <input className="range-slider range-mini" type="range" min="0" max="250" step="2" value={inputs.antecedentRainMm} onChange={(e) => setInputs({ ...inputs, antecedentRainMm: Number(e.target.value) })} aria-label="Antecedent rainfall" />
                        </div>
                        <div className="control-mini">
                          <div className="control-label"><span>Forecast rain · over horizon</span><strong>{inputs.forecastRainMm} mm</strong></div>
                          <input className="range-slider range-mini" type="range" min="0" max="200" step="2" value={inputs.forecastRainMm} onChange={(e) => setInputs({ ...inputs, forecastRainMm: Number(e.target.value) })} aria-label="Forecast rainfall" />
                        </div>
                        <div className="control-mini">
                          <div className="control-label"><span>Mean air temperature</span><strong>{inputs.tempC} °C</strong></div>
                          <input className="range-slider range-mini" type="range" min="0" max="40" step="1" value={inputs.tempC} onChange={(e) => setInputs({ ...inputs, tempC: Number(e.target.value) })} aria-label="Mean air temperature" />
                        </div>
                      </div>

                      <div className="input-group">
                        <span className="data-label"><Gauge /> HYDROLOGY HISTORY · AUTO</span>
                        <div className="auto-chips">
                          <span className="auto-chip"><span>Last observed</span><strong>{fmtQ(currentLevel)} {catchment.unit}</strong></span>
                          <span className="auto-chip"><span>5-day mean</span><strong>{recentMean !== undefined ? fmtQ(recentMean) : '—'} {catchment.unit}</strong></span>
                          <span className="auto-chip"><span>5-day trend</span><strong>{trend !== undefined ? `${trend > 0 ? '+' : ''}${trend.toFixed(1)}` : '—'} {catchment.unit}</strong></span>
                          <span className="auto-chip"><span>Record quality</span><strong>{catchment.lastRecorded.quality.toUpperCase()}</strong></span>
                        </div>
                        <span className="data-label" style={{ marginTop: 6 }}><SlidersHorizontal /> MISSINGNESS METADATA</span>
                        <div className="control-mini">
                          <div className="control-label"><span>Observation gaps before origin</span><strong>{inputs.gapDays} d</strong></div>
                          <input className="range-slider range-mini" type="range" min="0" max="10" step="1" value={inputs.gapDays} onChange={(e) => setInputs({ ...inputs, gapDays: Number(e.target.value) })} aria-label="Observation gap days" />
                        </div>
                        <select className="quality-select" value={inputs.quality} onChange={(e) => setInputs({ ...inputs, quality: e.target.value as QualityFlag })} aria-label="Overall record quality flag">
                          <option value="good">Quality flag · GOOD</option>
                          <option value="degraded">Quality flag · DEGRADED</option>
                          <option value="missing">Quality flag · MISSING</option>
                        </select>
                      </div>

                      <div className="input-group">
                        <span className="data-label"><Waves /> CATCHMENT ATTRIBUTES · STATIC</span>
                        <div className="attr-grid">
                          <span className="attr-cell"><span>AREA</span><strong>{catchment.areaSqKm.toLocaleString('en-IN')} km²</strong></span>
                          <span className="attr-cell"><span>MEAN ELEVATION</span><strong>{catchment.elevMeanM.toLocaleString('en-IN')} m</strong></span>
                          <span className="attr-cell"><span>SOIL</span><strong>{catchment.soil}</strong></span>
                          <span className="attr-cell"><span>LAND COVER</span><strong>{catchment.landCover}</strong></span>
                        </div>
                        <span className="run-note">Static attributes are supplied by the catchment register and checked for leakage in the real benchmark.</span>
                      </div>
                    </div>

                    <div className="run-row">
                      <button type="button" className="run-button" onClick={run} disabled={forecastQuery.isFetching}>
                        {!forecastQuery.isFetching && <Play size={15} fill="currentColor" />}
                        {forecastQuery.isFetching ? 'Running…' : 'Run forecast'}
                      </button>
                      <span className="run-note">Runs are logged to the history ledger. {DISCLAIMER}</span>
                    </div>
                  </section>
                </Reveal>

                {/* ── chart ── */}
                <Reveal delay={0.06}>
                  <section className="glass-card">
                    <div className="card-head">
                      <div>
                        <Eyebrow>RIVER DISCHARGE FORECAST</Eyebrow>
                        <h2>Observed &amp; predicted discharge</h2>
                        <p>{catchment.name} · {formatDate(origin)} origin · {horizon}-day horizon</p>
                      </div>
                      <div className="chart-legend">
                        <span><i className="legend-observed" /> Observed</span>
                        <span><i className="legend-forecast" /> Forecast</span>
                      </div>
                    </div>

                    <div className="chart-wrap">
                      {historyQuery.isError || forecastQuery.isError ? (
                        <div className="chart-state">
                          <strong>Couldn’t load forecast data.</strong>
                          <span>Check the connection and retry.</span>
                          <button className="button button-ghost" onClick={() => { historyQuery.refetch(); forecastQuery.refetch(); }}>Retry ↻</button>
                        </div>
                      ) : isLoading || historyQuery.isFetching || forecastQuery.isFetching || !chartData.length ? (
                        <div className="chart-skeleton"><span /><span /><span /></div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={chartData} margin={{ top: 15, right: 13, bottom: 2, left: 2 }}>
                            <CartesianGrid stroke="rgba(166,217,228,.08)" vertical={false} />
                            <XAxis
                              dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']}
                              tickFormatter={(v) => new Date(v).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                              tick={{ fill: '#8aa3ad', fontSize: 10 }} axisLine={{ stroke: 'rgba(166,217,228,.14)' }} tickLine={false} minTickGap={28}
                            />
                            <YAxis
                              width={60} tick={{ fill: '#8aa3ad', fontSize: 10 }} tickLine={false} axisLine={false}
                              domain={chartYDomain} allowDataOverflow tickCount={6} allowDecimals
                              tickFormatter={(v) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            />
                            <Tooltip content={<ChartTooltip unit={catchment.unit} />} cursor={{ stroke: 'rgba(150,235,244,.35)', strokeDasharray: '3 4' }} />
                            <ReferenceArea y1={catchment.thresholdHigh} y2={chartYDomain[1]} fill="#ff5660" fillOpacity={0.07} ifOverflow="visible" />
                            <ReferenceLine y={catchment.thresholdHigh} stroke="#ff8f8f" strokeDasharray="4 5" strokeOpacity={0.75} label={{ value: `T(c) HIGH · ${fmtQ(catchment.thresholdHigh)}`, position: 'insideTopRight', fill: '#ffaaa9', fontSize: 9 }} />
                            <ReferenceLine y={catchment.thresholdExtreme} stroke="#ff5660" strokeDasharray="2 6" strokeOpacity={0.8} label={{ value: 'EXTREME', position: 'insideTopRight', fill: '#ff8f8f', fontSize: 9 }} />
                            <ReferenceLine x={dateToX(origin)} stroke="#b6edec" strokeDasharray="3 5" strokeOpacity={0.65} label={{ value: 'ORIGIN', position: 'insideTopLeft', fill: '#b5d9dc', fontSize: 9 }} />
                            <Area type="monotone" dataKey="lower" stackId="confidence" stroke="none" fill="transparent" isAnimationActive={false} />
                            <Area type="monotone" dataKey="band" stackId="confidence" stroke="none" fill="#55d2df" fillOpacity={0.13} isAnimationActive={false} />
                            <Line type="monotone" dataKey="observed" name="Observed" stroke="#7ca4aa" strokeWidth={1.6} dot={false} connectNulls={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#5de1ee" strokeWidth={2.2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
                            <Brush dataKey="date" height={16} stroke="#55cbd6" travellerWidth={6} fill="rgba(3,14,19,.82)" tickFormatter={() => ''} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    <div className="chart-foot">
                      <span><span className="risk-dot" /> Red zone begins above the high-flow threshold T(c)</span>
                      <span>
                        {forecastQuery.isFetching ? 'Updating forecast' : 'Shaded band shows the 80% prediction interval, which widens with horizon, gaps and degraded quality'} <CircleHelp size={12} />
                      </span>
                    </div>
                  </section>
                </Reveal>
              </div>

              <aside className="details-column">
                <Reveal delay={0.08}>
                  <CatchmentDetails catchment={catchment} currentLevel={currentLevel} origin={origin} risk={forecast?.risk} />
                </Reveal>
              </aside>
            </div>

            {/* ── output + risk read ── */}
            <div className="lower-grid">
              <Reveal delay={0.04}>
                <section className="glass-card">
                  <div className="card-head">
                    <div>
                      <Eyebrow>MODEL OUTPUT · CHALLENGE §8.3</Eyebrow>
                      <h2>Submission preview</h2>
                      <p>The official schema: discharge, exceedance odds and prediction intervals at each horizon.</p>
                    </div>
                    <button type="button" className="copy-btn" onClick={copySchema} disabled={!forecast}><Copy size={13} /> {copied ? 'Copied' : 'Copy JSON'}</button>
                  </div>

                  <div className="output-table">
                    <div className="output-row head">
                      <span>HORIZON</span><span>DATE</span><span>Q (m³/s)</span><span>INTERVAL</span><span>P(HIGH)</span><span>P(EXTREME)</span>
                    </div>
                    {forecast ? HORIZONS.map((h) => {
                      const i = HORIZONS.indexOf(h);
                      const date = forecast.series[h - 1]?.date ?? '';
                      const q = forecast.output.predicted_discharge[i];
                      const lo = forecast.output.prediction_intervals.lower[i];
                      const up = forecast.output.prediction_intervals.upper[i];
                      return (
                        <button type="button" key={h} className={`output-row ${h === horizon ? 'active' : ''}`} onClick={() => setHorizon(h)}>
                          <strong>{h}d</strong>
                          <span>{date.slice(5)}</span>
                          <span>{fmtQ(q)}</span>
                          <span>{fmtQ(lo)}–{fmtQ(up)}</span>
                          <span className="prob-cell"><Meter value={forecast.pHigh[h] * 100} /><span>{fmtP(forecast.pHigh[h])}</span></span>
                          <span className="prob-cell"><Meter value={forecast.pExt[h] * 100} /><span>{fmtP(forecast.pExt[h])}</span></span>
                        </button>
                      );
                    }) : <div className="chart-state" style={{ minHeight: 120 }}><span>Run the model to fill the submission schema.</span></div>}
                  </div>

                  <div className="schema-block">
                    <div className="schema-head"><span>SUBMISSION SCHEMA · ILLUSTRATIVE (§8.3)</span></div>
                    <pre className="schema-pre">{forecast ? JSON.stringify(forecast.output, null, 2) : '// waiting for a forecast run'}</pre>
                  </div>
                </section>
              </Reveal>

              <Reveal delay={0.08}>
                <section className="glass-card">
                  <div className="card-head">
                    <div>
                      <Eyebrow>RISK READ · THRESHOLDS ARE FROZEN</Eyebrow>
                      <h2>Odds of crossing T(c)</h2>
                      <p>Each horizon is scored against the catchment’s pre-defined high-flow and extreme thresholds.</p>
                    </div>
                    {forecast && <RiskBadge level={forecast.risk} />}
                  </div>

                  <div className="horizon-comparison">
                    {HORIZONS.map((h) => {
                      const pH = forecast?.pHigh[h];
                      const pE = forecast?.pExt[h];
                      const q = forecast?.output.predicted_discharge[HORIZONS.indexOf(h)];
                      const tHigh = catchment.thresholdHigh;
                      const share = q !== undefined ? q / Math.max(1, tHigh) : undefined;
                      return (
                        <button type="button" key={h} className={`horizon-row ${h === horizon ? 'active' : ''}`} onClick={() => setHorizon(h)}>
                          <span className="horizon-name">{h}<small>{h === 1 ? 'DAY' : 'DAYS'}</small></span>
                          <span className="confidence-meter">
                            <span className="data-label">P(HIGH FLOW)</span>
                            <Meter value={(pH ?? 0) * 100} />
                            <strong>{pH !== undefined ? fmtP(pH) : '—'}</strong>
                          </span>
                          <span className="value-pair">
                            <span>Predicted <strong>{q !== undefined ? `${fmtQ(q)} ${catchment.unit}` : '—'}</strong></span>
                            <span>P(extreme) <strong>{pE !== undefined ? fmtP(pE) : '—'}</strong></span>
                          </span>
                          <span className={`skill-note ${share !== undefined && share >= 1 ? 'positive' : ''}`}>
                            {share !== undefined ? `${(share * 100).toFixed(0)}% of T(c)` : 'Awaiting run'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="time-controls" style={{ marginTop: 16 }}>
                    <button className="step-button" type="button" onClick={() => step(-1)} disabled={origin <= minDate}><ChevronLeft size={15} /><span>−1 day</span></button>
                    <label className="date-picker">
                      <CalendarDays size={15} />
                      <input aria-label="Choose forecast origin" type="date" min={minDate} max={latestDate} value={origin} onChange={(e) => setOrigin(e.target.value)} />
                    </label>
                    <button className="step-button" type="button" onClick={() => step(1)} disabled={origin >= latestDate}><span>+1 day</span><ChevronRight size={15} /></button>
                    <button className="latest-button" type="button" onClick={() => setOrigin(latestDate)}>Latest</button>
                  </div>
                </section>
              </Reveal>
            </div>

            <div className="footnote">
              <span>FORECAST NOTE</span>
              <p>
                This workbench runs live multi-horizon CatBoost inference trained on the Caravan v1.6 streamflow benchmark with dynamic residual prediction, sequence progression, and calibrated threshold exceedance odds.
                {' '}{DISCLAIMER}
              </p>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/* ───────────────────────── sub-components ───────────────────────── */

function ChartTooltip({ active, payload, label, unit }: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; payload?: { date: string } }>;
  label?: number;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload.find((p) => p.value !== undefined)?.payload;
  const date = row?.date ?? (label ? new Date(label).toISOString().slice(0, 10) : '');
  const values = payload.filter((p) => p.value !== undefined && p.dataKey && ['observed', 'forecast'].includes(p.dataKey));
  return (
    <div className="chart-tooltip">
      <span>{date ? formatDate(date) : '—'}</span>
      {values.map((p) => (
        <div key={p.dataKey}>
          <i className={`tooltip-${p.dataKey}`} />
          <span>{p.dataKey === 'observed' ? 'Observed' : 'Predicted'}</span>
          <strong>{Number(p.value).toLocaleString('en-IN')} {unit}</strong>
        </div>
      ))}
    </div>
  );
}

function CatchmentDetails({ catchment, currentLevel, origin, risk }: { catchment: Catchment; currentLevel: number; origin: string; risk?: ForecastResult['risk'] }) {
  const lat = Math.max(9, Math.min(20, catchment.lat));
  const lng = Math.max(72, Math.min(79, catchment.lng));
  const x = 13 + (lng - 72) * 11.3;
  const y = 87 - (lat - 9) * 7.1;

  const fields: [string, string][] = [
    ['CATCHMENT CODE', catchment.code],
    ['RIVER BASIN', catchment.river],
    ['DISTRICT', catchment.district],
    ['GAUGE PURPOSE', catchment.purpose],
    ['CATCHMENT AREA', `${catchment.areaSqKm.toLocaleString('en-IN')} km²`],
    ['MEAN ELEVATION', `${catchment.elevMeanM.toLocaleString('en-IN')} m`],
    ['SOIL', catchment.soil],
    ['LAND COVER', catchment.landCover],
    ['HIGH-FLOW THRESHOLD T(c)', `${fmtQ(catchment.thresholdHigh)} ${catchment.unit}`],
    ['EXTREME THRESHOLD', `${fmtQ(catchment.thresholdExtreme)} ${catchment.unit}`],
  ];

  return (
    <section className="glass-card details-card">
      <div className="details-title">
        <Eyebrow>CATCHMENT FIELD NOTES</Eyebrow>
        <span className="details-emblem"><Waves size={18} /></span>
      </div>
      <h2>{catchment.name}</h2>
      <p className="details-location"><MapPinIcon size={13} />{catchment.location}</p>

      <div className="details-asof">
        <span>DISCHARGE ON {formatDate(origin).toUpperCase()}</span>
        <strong>{fmtQ(currentLevel)} <small>{catchment.unit}</small></strong>
      </div>

      {risk && <RiskBadge level={risk} className="self-start" />}

      <div className="detail-grid">
        {fields.map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>

      <div className="places-section">
        <span className="data-label">Places around the gauge</span>
        <div className="chip-row">{catchment.nearbyPlaces.map((p) => <span className="chip" key={p}>{p}</span>)}</div>
      </div>
      <div className="places-section">
        <span className="data-label">Regions at risk if it crests</span>
        <div className="chip-row">{catchment.affectedRegions.map((p) => <span className="chip chip-alert" key={p}>{p}</span>)}</div>
      </div>

      <div className="location-map">
        <div className="map-watermark">CARAVAN</div>
        <svg viewBox="0 0 100 100" aria-label={`Schematic location map for ${catchment.name}`}>
          <path className="map-outline" d="M35 5 48 9 54 17 67 20 72 29 68 37 78 44 72 55 77 65 70 74 72 84 61 91 50 84 39 94 28 85 24 73 17 66 22 55 14 45 21 34 19 24 27 16 28 9Z" />
          <path className="map-river" d="M29 79c10-12 8-18 20-23s15-10 19-22" />
          <circle cx={x} cy={y} r="5.5" className="map-ping" />
          <circle cx={x} cy={y} r="2" className="map-pin" />
        </svg>
        <div className="map-label">
          <span>{catchment.location}</span>
          <strong>{Math.abs(catchment.lat).toFixed(3)}° {catchment.lat >= 0 ? 'N' : 'S'} · {Math.abs(catchment.lng).toFixed(3)}° {catchment.lng >= 0 ? 'E' : 'W'}</strong>
        </div>
      </div>

      <div className="details-footer"><span>Origin observation</span><strong>{formatDate(origin)}</strong></div>
    </section>
  );
}

function MapPinIcon({ size }: { size: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.5"/></svg>;
}
