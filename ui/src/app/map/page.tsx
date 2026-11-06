'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { Globe2, ShieldAlert } from 'lucide-react';
import { fetchRiskBoard } from '@/data/api';
import { DISCLAIMER } from '@/config';
import { PageHeading, Reveal, CatchmentCard, RISK_META, Eyebrow } from '@/components/Ui';
import { RISK_ORDER } from '@/data/types';

/* ssr:false boundary lives here so react-globe.gl is client-only, while the
   ref forwarded inside RiskGlobe still reaches the real Globe component. */
const RiskGlobe = dynamic(() => import('@/components/RiskGlobe'), {
  ssr: false,
  loading: () => <div className="globe-viewport"><span className="globe-loading">PREPARING THE GLOBE…</span></div>,
});

export default function MapPage() {
  const { data: board = [], isLoading, isError, refetch } = useQuery({ queryKey: ['risk-board'], queryFn: ({ signal }) => fetchRiskBoard(signal) });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'watch' | 'low'>('all');

    const sorted = [...board].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || ((b.pHigh7 ?? b.pHigh5 ?? 0) - (a.pHigh7 ?? a.pHigh5 ?? 0)));
  const filtered = riskFilter === 'all' ? sorted : sorted.filter((entry) => entry.risk === riskFilter);
  const counts = { high: board.filter((e) => e.risk === 'high').length, watch: board.filter((e) => e.risk === 'watch').length, low: board.filter((e) => e.risk === 'low').length };

  return <section className="catalog-page">
    <div className="catalog-top"><PageHeading label="THE RISK GLOBE" title={<>One Earth,<br/><span>every gauge.</span></>} description="The monitored catchments on a 3D Earth. Column height tracks how close each river runs to its extreme threshold; red, amber and green come from the FIMO model’s 7-day odds of crossing the high-flow threshold." count={`${board.length || 16} gauged`} />
      <div className="catalog-mark"><Globe2 size={16}/><span>TEXTURE © NASA BLUE MARBLE<br/>· DATA © CARAVAN BENCHMARK</span></div></div>

    <div className="map-toolbar">
      <div className="map-legend">
        <span><i style={{ background: RISK_META.high.color, boxShadow: `0 0 9px ${RISK_META.high.glow}` }} /> HIGH RISK · {counts.high}</span>
        <span><i style={{ background: RISK_META.watch.color, boxShadow: `0 0 9px ${RISK_META.watch.glow}` }} /> ON WATCH · {counts.watch}</span>
        <span><i style={{ background: RISK_META.low.color, boxShadow: `0 0 9px ${RISK_META.low.glow}` }} /> LOW RISK · {counts.low}</span>
      </div>
      <div className="segmented-filter" role="group" aria-label="Filter by risk band">
        {(['all', 'high', 'watch', 'low'] as const).map((key) => (
          <button key={key} type="button" className={riskFilter === key ? 'active' : ''} onClick={() => setRiskFilter(key)}>
            {key === 'all' ? 'ALL' : key === 'high' ? 'RED' : key === 'watch' ? 'AMBER' : 'GREEN'}
          </button>
        ))}
      </div>
    </div>

    {isLoading && <div className="glass-card globe-viewport chart-state"><span>Loading the gauge network…</span></div>}
    {isError && <div className="glass-card error-card"><strong>The risk board could not be loaded.</strong><p>Check the data connection and try again.</p><button className="button button-ghost" onClick={() => refetch()}>Retry ↻</button></div>}
    {!isLoading && !isError && <Reveal><RiskGlobe board={board} focusId={focusId} /></Reveal>}

    <div className="catalog-toolbar" style={{ paddingTop: 26 }}>
      <div className="toolbar-note"><Eyebrow>THE REGISTER, MAPPED</Eyebrow><span>Sorted by severity — click “Locate on globe” to fly there</span></div>
      <span className="source-tag" style={{ padding: '6px 10px' }}>COLUMN HEIGHT · SHARE OF EXTREME THRESHOLD</span>
    </div>

    {!isLoading && !isError && <div className="dam-grid">{filtered.map((entry, index) => (
      <CatchmentCard key={entry.catchment.id} catchment={entry.catchment} risk={entry.risk} index={index} focusId={(id) => { setFocusId(id); document.querySelector('.globe-viewport')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />
    ))}</div>}

    <div className="catalog-foot"><span><i /> RISK = CATBOOST ML 5-DAY EXCEEDANCE BAND</span><span>SELECT A CATCHMENT TO RUN ITS FORECAST <b>↗</b></span></div>

    <div className="prediction-footnote" style={{ marginTop: 12 }}>
      <span><ShieldAlert size={14} /></span>
      <p>Risk bands are derived from CatBoost multi-horizon predictions against statistical thresholds. {DISCLAIMER}</p>
    </div>
  </section>;
}
