'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowRight, FlaskConical, Waves, Droplets, Activity } from 'lucide-react';
import { fetchCatchments, fetchRiskBoard } from '@/data/api';
import { projectInfo, DISCLAIMER } from '@/config';
import { RISK_META } from '@/components/Ui';
import { Eyebrow, Reveal, RiskDot, fmtP, fmtQ } from '@/components/Ui';
import type { RiskLevel } from '@/data/types';

export default function HomePage() {
  const { data: catchments = [] } = useQuery({ queryKey: ['catchments'], queryFn: ({ signal }) => fetchCatchments(signal) });
  const { data: board = [] } = useQuery({ queryKey: ['risk-board'], queryFn: ({ signal }) => fetchRiskBoard(signal) });
  const riskByCatchment = new Map(board.map((entry) => [entry.catchment.id, entry.risk as RiskLevel]));
  const redCount = board.filter((entry) => entry.risk === 'high').length;
  const yellowCount = board.filter((entry) => entry.risk === 'watch').length;
  return <>
    <section className="home-hero">
      <div className="hero-copy">
        <Eyebrow>{projectInfo.eyebrow}</Eyebrow>
        <h1>Rivers shift.<br /><span>We read the shift.</span></h1>
        <p className="hero-tagline">{projectInfo.tagline}</p>
        <p className="hero-highlight">{projectInfo.highlight}</p>
        <div className="hero-actions"><Link href="/predict" className="button button-primary">Open the forecast workbench <ArrowRight size={16}/></Link><Link href="/map" className="button button-ghost">View the risk map <span className="button-arrow">↗</span></Link></div>
        <div className="hero-footnote"><span className="footnote-rule"/> DAILY SIGNALS, HIGH-FLOW ODDS</div>
      </div>
      <div className="hero-orbit" aria-hidden="true"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-ring ring-three"/><div className="orbit-core"><span/><i/></div><div className="orbit-label orbit-top">LIVE DISCHARGE <b>↗</b></div><div className="orbit-label orbit-bottom">CARAVAN NETWORK <b>16 / 16</b></div><div className="orbit-coord">44° 52′ N<br/>69° 57′ W</div></div>
      <a href="#overview" className="scroll-cue"><span className="scroll-mouse"><i/></span><span>SCROLL TO EXPLORE</span><ArrowDownRight size={14}/></a>
    </section>
    <section className="home-overview" id="overview">
      <div className="section-topline"><Eyebrow>A FIELD GUIDE TO THE SHIFT</Eyebrow><span>01 — 03</span></div>
      <div className="home-card-grid">
        <Reveal><article className="glass-card feature-card description-card"><div className="feature-icon"><Waves size={20}/></div><span className="card-kicker">01 / THE PROJECT</span><h2>Every river<br/>runs a script.</h2><p>{projectInfo.description}</p><div className="mini-metrics"><div><strong>{catchments.length || 16}</strong><span>catchments</span></div><div><strong>5<span>d</span></strong><span>longest horizon</span></div><div><strong>3</strong><span>official horizons</span></div></div><Link href="/predict" className="card-arrow">Run a forecast <span>↗</span></Link></article></Reveal>
        <Reveal delay={.08}><article className="glass-card feature-card github-card"><div className="feature-icon"><FlaskConical size={20}/></div><span className="card-kicker">02 / THE SCIENCE</span><h2>Trained here.<br/>Tested anywhere.</h2><p>The benchmark question is generalization: the model must forecast basins it never saw in training. Each run reports prediction intervals, exceedance odds and calibration — and every run is logged so results can be audited later.</p><div className="repo-box"><span className="repo-branch"><i/> CARAVAN BENCHMARK · LIVE ML</span><strong>BASINSHIFT Streamflow Forecast</strong><span className="repo-sub">CATBOOST RESIDUAL MODEL · GENERALIZED INFERENCE</span></div><Link href="/history" className="button button-ghost button-wide">Review the run ledger <span className="button-arrow">↗</span></Link></article></Reveal>
        <Reveal delay={.16}><article className="glass-card feature-card list-card"><div className="feature-icon"><Droplets size={20}/></div><span className="card-kicker">03 / THE NETWORK</span><h2>Across the<br/>river basins.</h2><p>Follow the latest simulated reading at each gauged catchment — green, amber and red show where the model sees the water leaning high.</p><div className="compact-dam-list">{catchments.map((catchment,i)=><Link href={`/predict?catchment=${catchment.id}`} key={catchment.id}><span className="list-index">{String(i+1).padStart(2,'0')}</span><strong>{catchment.name.replace(' Catchment','')}</strong><span className="list-level">{catchment.lastRecorded.discharge!==null?fmtQ(catchment.lastRecorded.discharge):'—'} {catchment.unit}</span><span className="list-risk"><RiskDot level={riskByCatchment.get(catchment.id) ?? 'low'} /></span></Link>)}</div><Link href="/map" className="card-arrow">View all {catchments.length || 16} catchments <span>↗</span></Link></article></Reveal>
      </div>
      <div className="home-data-strip"><div><Activity size={15}/><span>{projectInfo.dataSummary}</span><span className="strip-pills"><b className="pill-high">{redCount} high</b><b className="pill-watch">{yellowCount} watch</b></span></div><span>OBSERVE · PREDICT · REVIEW</span></div>
    </section>
    <footer className="site-footer"><Link href="/" className="footer-brand">BASINSHIFT <span>FLOOD INTELLIGENCE</span></Link><p>{DISCLAIMER}</p><span className="footer-mark">GLOBAL · 2026</span></footer>
  </>;
}
