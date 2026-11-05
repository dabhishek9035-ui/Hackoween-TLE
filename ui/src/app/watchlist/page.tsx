'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Eye, ShieldAlert, TrendingUp } from 'lucide-react';
import { fetchRiskBoard } from '@/data/api';
import { DISCLAIMER } from '@/config';
import { formatDate, fmtP, fmtQ, Eyebrow, Meter, PageHeading, Reveal, RiskBadge, RISK_META } from '@/components/Ui';
import { RISK_ORDER } from '@/data/types';
import type { RiskBoardEntry } from '@/data/types';

const WATCH_CSS = `
.watch-card{padding:19px 21px 15px;display:grid;gap:12px;overflow:hidden}
.watch-card:after{content:'';position:absolute;width:180px;height:180px;right:-98px;top:26px;border:1px solid rgba(91,183,201,.08);border-radius:50%;box-shadow:0 0 0 19px rgba(91,183,201,.025),0 0 0 39px rgba(91,183,201,.018);pointer-events:none}
.watch-card-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.watch-card h2{margin:2px 0 2px;color:#e1f2f3;font:500 20px var(--display);letter-spacing:-.04em}
.watch-card .sub{color:#8ea7ad;font-size:10px}
.watch-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;padding:13px 0;border-top:1px solid rgba(135,204,216,.11);border-bottom:1px solid rgba(135,204,216,.11)}
.watch-stats section{display:grid;gap:4px}
.watch-stats strong{color:#c8f2f3;font:500 17px var(--display)}
.watch-stats small{color:#89a6ad;font:8px var(--mono)}
.watch-stats .meter-wrap{width:100%}
.watch-chips{display:flex;flex-wrap:wrap;gap:5px}
.watch-foot{display:flex;justify-content:space-between;align-items:center;padding-top:9px;border-top:1px solid rgba(135,204,216,.09)}
@media(max-width:620px){.watch-stats{grid-template-columns:1fr 1fr}}
`;

export default function WatchlistPage() {
  const { data: board = [], isLoading } = useQuery({ queryKey: ['risk-board'], queryFn: ({ signal }) => fetchRiskBoard(signal) });

  const sorted = useMemo(() => [...board].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.pHigh7 - a.pHigh7), [board]);
  const underWatch = sorted.filter((entry) => entry.risk !== 'low');
  const steady = sorted.filter((entry) => entry.risk === 'low');
  const counts = { high: board.filter((e) => e.risk === 'high').length, watch: board.filter((e) => e.risk === 'watch').length, low: board.filter((e) => e.risk === 'low').length };
  const peak = sorted[0];

  return <section className="catalog-page">
    <style dangerouslySetInnerHTML={{ __html: WATCH_CSS }} />
    <div className="catalog-top"><PageHeading label="THE WATCH LIST" title={<>Where the water<br/><span>leans high.</span></>} description="Catchments whose 7-day odds of crossing the high-flow threshold put them on watch. Regions listed below each entry are exposed if the river crests." count={`${underWatch.length} watched`} />
      <div className="catalog-mark"><Eye size={16}/><span>REBUILT FROM THE<br/>LIVE RISK BOARD</span></div></div>

    <Reveal>
      <div className="watch-hero-grid">
        <div className="glass-card"><strong style={{ color: RISK_META.high.color }}>{counts.high}</strong><span>HIGH RISK · RED</span></div>
        <div className="glass-card"><strong style={{ color: RISK_META.watch.color }}>{counts.watch}</strong><span>ON WATCH · AMBER</span></div>
        <div className="glass-card"><strong style={{ color: RISK_META.low.color }}>{counts.low}</strong><span>HOLDING STEADY · GREEN</span></div>
        <div className="glass-card"><strong>{peak ? fmtP(peak.pHigh7) : '—'}</strong><span>PEAK 7-DAY ODDS{peak ? ` · ${peak.catchment.code}` : ''}</span></div>
      </div>
    </Reveal>

    {isLoading && <div className="glass-card chart-state" style={{ height: 220 }}><span>Scoring the network…</span></div>}

    {!isLoading && <>
      <div className="watch-section-label"><Eyebrow>UNDER WATCH · RED &amp; AMBER</Eyebrow></div>
      {underWatch.length === 0 && <div className="glass-card empty-card"><strong>Nothing is on watch right now.</strong><p>No catchment’s 7-day odds cross the watch band. Check the workbench for scenario forecasts.</p></div>}
      <div className="dam-grid">{underWatch.map((entry, index) => <WatchCard key={entry.catchment.id} entry={entry} index={index} />)}</div>

      <div className="watch-section-label"><Eyebrow>HOLDING STEADY · GREEN</Eyebrow></div>
      <div className="steady-list">{steady.map((entry) => (
        <Link href={`/predict?catchment=${entry.catchment.id}`} key={entry.catchment.id} className="glass-card steady-row">
          <RiskDotInline level={entry.risk} />
          <span style={{ display: 'grid', gap: 2 }}><strong>{entry.catchment.name}</strong><span>{entry.catchment.river} · P(high) {fmtP(entry.pHigh7)}</span></span>
          <span>{fmtQ(entry.catchment.lastRecorded.discharge ?? 0)} m³/s</span>
          <span className="list-arrow" style={{ color: '#65cbd7' }}>↗</span>
        </Link>
      ))}</div>

      <div className="catalog-foot" style={{ marginTop: 18 }}><span><i /> DERIVED FROM THE SAME ENGINE AS THE WORKBENCH</span><span>OPEN ANY CATCHMENT TO RUN A SCENARIO <b>↗</b></span></div>

      <div className="prediction-footnote" style={{ marginTop: 12 }}>
        <span><ShieldAlert size={14} /></span>
        <p>Watch bands are derived from CatBoost multi-horizon predictions against statistical flow thresholds. {DISCLAIMER}</p>
      </div>
    </>}
  </section>;
}

function WatchCard({ entry, index }: { entry: RiskBoardEntry; index: number }) {
  const { catchment: c, risk, current, predicted7, pHigh7, pExt7 } = entry;
  const meta = RISK_META[risk];
  const share = predicted7 / Math.max(1, c.thresholdHigh);
  const why = risk === 'high'
    ? `7-day forecast sits at or above the high-flow threshold with ${(pHigh7 * 100).toFixed(0)}% exceedance odds — treat as the priority basin.`
    : `Forecast pressure is building: ${(pHigh7 * 100).toFixed(0)}% odds of crossing T(c) within 7 days, ${(pExt7 * 100).toFixed(0)}% for the extreme band.`;
  return <Reveal delay={Math.min(index % 4, 3) * .07}>
    <article className="glass-card watch-card" style={{ borderColor: `${meta.color}30` }}>
      <div className="watch-card-top"><span className="dam-index">{String(index + 1).padStart(2, '0')} · {c.code}</span><RiskBadge level={risk} /></div>
      <div>
        <h2>{c.name}</h2>
        <p className="sub"><TrendingUp size={12} style={{ color: meta.color }} /> {c.river} · {c.location}</p>
      </div>
      <div className="watch-stats">
        <section><span className="data-label">LATEST Q</span><strong>{current !== null ? fmtQ(current) : '—'} <small>m³/s</small></strong><small>{formatDate(c.lastRecorded.date)}</small></section>
        <section><span className="data-label">7-DAY FORECAST</span><strong>{fmtQ(predicted7)} <small>m³/s</small></strong><small>{(share * 100).toFixed(0)}% of T(c) {fmtQ(c.thresholdHigh)}</small></section>
        <section><span className="data-label">P(HIGH) · 7-DAY</span><strong>{fmtP(pHigh7)}</strong><Meter value={pHigh7 * 100} /></section>
      </div>
      <p className="watch-why">{why}</p>
      <div className="watch-chips">{c.affectedRegions.map((region) => <span className="chip chip-alert" key={region}>{region}</span>)}</div>
      <div className="watch-foot"><span className="capacity-note" style={{ color: meta.color }}>P(EXTREME) {fmtP(pExt7)}</span><Link className="text-link predict-link" href={`/predict?catchment=${c.id}`}>Open forecast <span>↗</span></Link></div>
    </article>
  </Reveal>;
}

function RiskDotInline({ level }: { level: RiskBoardEntry['risk'] }) {
  return <i className="risk-dot-dot" style={{ background: RISK_META[level].color, boxShadow: `0 0 8px ${RISK_META[level].glow}` }} />;
}
