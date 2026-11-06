'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Trash2, RotateCcw, ClipboardList, Gauge, CalendarDays, ShieldAlert } from 'lucide-react';
import { useRunsStore } from '@/data/runs';
import { HORIZONS } from '@/data/types';
import { DISCLAIMER } from '@/config';
import { formatDate, fmtP, fmtQ, Eyebrow, PageHeading, Reveal, RiskBadge } from '@/components/Ui';

export default function HistoryPage() {
  const runs = useRunsStore((s) => s.runs);
  const removeRun = useRunsStore((s) => s.removeRun);
  const clearAll = useRunsStore((s) => s.clearAll);
  const [confirming, setConfirming] = useState(false);

  const stats = useMemo(() => {
    const catchmentSet = new Set(runs.map((run) => run.catchmentId));
    const meanPHigh = runs.length ? runs.reduce((s, run) => s + run.pHigh, 0) / runs.length : 0;
    const highRisk = runs.filter((run) => run.risk === 'high').length;
    const last = runs.reduce((max, run) => (run.savedAt > max ? run.savedAt : max), '');
    return { total: runs.length, catchments: catchmentSet.size, meanPHigh, highRisk, last };
  }, [runs]);

  return <section className="catalog-page">
    <div className="catalog-top"><PageHeading label="THE RUN LEDGER" title={<>Every forecast,<br/><span>remembered.</span></>} description="Each workbench run is logged with its inputs and outputs — an audit trail for the experiment, exactly as the challenge asks." count={`${stats.total} runs`} />
      <div className="catalog-mark"><ClipboardList size={16}/><span>STORED LOCALLY<br/>IN THIS BROWSER</span></div></div>

    <Reveal>
      <div className="history-kpis">
        <div className="glass-card"><strong>{stats.total}</strong><span>TOTAL RUNS LOGGED</span></div>
        <div className="glass-card"><strong>{stats.catchments}</strong><span>CATCHMENTS COVERED</span></div>
        <div className="glass-card"><strong>{stats.total ? fmtP(stats.meanPHigh) : '—'}</strong><span>MEAN HIGH-FLOW ODDS</span></div>
        <div className="glass-card"><strong>{stats.last ? formatDate(stats.last.slice(0, 10)) : '—'}</strong><span>MOST RECENT RUN</span></div>
      </div>
    </Reveal>

    {runs.length === 0 && <div className="glass-card empty-card"><strong>The ledger is empty.</strong><p>Open the forecast workbench and run a prediction — it will be logged here with its full inputs and outputs.</p><Link href="/predict" className="button button-primary">Run a forecast ↗</Link></div>}

    {runs.length > 0 && <div className="run-list">
      {runs.map((run, index) => {
        const horizonDate = new Date(`${run.origin}T12:00:00Z`);
        horizonDate.setUTCDate(horizonDate.getUTCDate() + run.horizon);
        return <Reveal key={run.id} delay={Math.min(index * 0.04, 0.3)}>
          <article className="glass-card run-card">
            <div className="run-when">
              <strong>{run.catchmentName}</strong>
              <span>{run.catchmentCode} · {run.river}</span>
              <span className="run-when-sub"><CalendarDays size={11} /> origin {formatDate(run.origin)} · target {formatDate(horizonDate.toISOString().slice(0, 10))}</span>
            </div>
            <div className="run-stat">
              <span>PREDICTED Q · {run.horizon}-DAY</span>
              <strong>{fmtQ(run.predictedQ)} <small>m³/s</small></strong>
              <small>{fmtQ(run.lowerAtH ?? 0)}–{fmtQ(run.upperAtH ?? 0)} interval</small>
            </div>
            <div className="run-stat">
              <span>P(HIGH) · P(EXTREME)</span>
              <strong>{fmtP(run.pHigh)} <small>/ {fmtP(run.pExt)}</small></strong>
              <small>horizon {HORIZONS.includes(run.horizon) ? run.horizon : 7} days</small>
            </div>
            <div className="run-stat">
              <span>READING</span>
              <RiskBadge level={run.risk} />
              {run.sample && <span className="sample-tag">SAMPLE</span>}
            </div>
            <div className="run-actions">
              <Link href={`/predict?catchment=${run.catchmentId}&origin=${run.origin}&horizon=${run.horizon}`} className="text-link predict-link">Reopen <span>↗</span></Link>
              <button type="button" className="icon-btn" aria-label="Delete run" onClick={() => removeRun(run.id)}><Trash2 size={14} /></button>
            </div>
          </article>
        </Reveal>;
      })}
    </div>}

    {runs.length > 0 && <div className="catalog-foot">
      <span><i /> LEDGER STORED IN LOCALSTORAGE · NOTHING LEAVES THIS BROWSER</span>
      {confirming
        ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Delete all runs?<button type="button" className="button button-ghost" style={{ height: 30 }} onClick={() => { clearAll(); setConfirming(false); }}>Yes, clear</button><button type="button" className="button button-ghost" style={{ height: 30 }} onClick={() => setConfirming(false)}>Cancel</button></span>
        : <button type="button" className="reset-session" onClick={() => setConfirming(true)}><RotateCcw size={13} /> Clear the ledger</button>}
    </div>}

    <div className="prediction-footnote" style={{ marginTop: 14 }}>
      <span><ShieldAlert size={14} /></span>
      <p>Historical runs logged directly from the CatBoost forecast workbench. {DISCLAIMER}</p>
    </div>
  </section>;
}
