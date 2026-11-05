'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import type { Catchment, RiskLevel } from '@/data/types';

export function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .14 }} transition={{ duration: reduce ? .01 : .6, delay, ease: [.2,.75,.25,1] }}>{children}</motion.div>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="eyebrow"><span className="eyebrow-mark" />{children}</div>; }

export function PageHeading({ label, title, description, count }: { label: string; title: React.ReactNode; description: string; count?: string }) {
  return <div className="page-heading"><div><Eyebrow>{label}</Eyebrow><h1>{title}</h1><p>{description}</p></div>{count && <div className="heading-count"><strong>{count.split(' ')[0]}</strong><span>{count.split(' ').slice(1).join(' ')}</span></div>}</div>;
}

export function Meter({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const percent = Math.max(0, Math.min(100, value / max * 100));
  return <div className="meter-wrap">{label && <div className="meter-label"><span>{label}</span><span>{percent.toFixed(0)}%</span></div>}<div className="meter"><span style={{ width: `${percent}%` }} /></div></div>;
}

export const RISK_META: Record<RiskLevel, { label: string; color: string; glow: string }> = {
  low: { label: 'LOW RISK', color: '#79e3bd', glow: 'rgba(121,227,189,.5)' },
  watch: { label: 'ON WATCH', color: '#ffd078', glow: 'rgba(255,208,120,.5)' },
  high: { label: 'HIGH RISK', color: '#ff969d', glow: 'rgba(255,150,157,.55)' },
};

export function RiskBadge({ level, className = '' }: { level: RiskLevel; className?: string }) {
  const meta = RISK_META[level];
  return <span className={`risk-badge ${className}`} style={{ color: meta.color, borderColor: `${meta.color}55` }}><i style={{ background: meta.color, boxShadow: `0 0 7px ${meta.glow}` }} />{meta.label}</span>;
}

export function RiskDot({ level }: { level: RiskLevel }) {
  return <i className={`risk-dot-dot risk-${level}`} aria-label={RISK_META[level].label} />;
}

export function CatchmentCard({ catchment, risk, index = 0, focusId }: {
  catchment: Catchment;
  risk: RiskLevel;
  index?: number;
  focusId?: (id: string) => void;
}) {
  const meta = RISK_META[risk];
  const current = catchment.lastRecorded.discharge;
  const thresholdShare = current !== null ? Math.min(140, Math.round((current / catchment.thresholdHigh) * 100)) : 0;
  return <Reveal delay={Math.min(index % 4, 3) * .07}><article className="glass-card dam-card" id={catchment.id}>
    <div className="dam-card-top"><span className="dam-index">{String(index + 1).padStart(2,'0')} · {catchment.code}</span><RiskBadge level={risk} /></div>
    <h2>{catchment.name}</h2><p className="dam-location"><MapPin />{catchment.location} <span>·</span> {catchment.river}</p>
    <div className="dam-card-grid"><section><span className="data-label">LATEST DISCHARGE</span><strong>{current !== null ? fmtQ(current) : '—'} <small>{catchment.unit}</small></strong><span className="data-sub">Observed {formatDate(catchment.lastRecorded.date)}</span></section><section className="fill-stat"><span className="data-label">OF HIGH-FLOW THRESHOLD</span><strong>{thresholdShare}<small>%</small></strong><Meter value={thresholdShare} max={140} /></section></div>
    <div className="regions-block"><span className="data-label">REGIONS AT RISK IF IT CRESTS</span><div className="chip-row">{catchment.affectedRegions.map((region)=><span className="chip" key={region}>{region}</span>)}</div></div>
    <div className="dam-card-bottom"><span className="capacity-note" style={{ color: meta.color }}>T(c) {fmtQ(catchment.thresholdHigh)} {catchment.unit}</span>
      {focusId
        ? <button type="button" className="text-link predict-link" onClick={() => focusId(catchment.id)}>Locate on globe <span>↗</span></button>
        : <Link className="text-link predict-link" href={`/predict?catchment=${catchment.id}`}>Predict <span>↗</span></Link>}
    </div>
  </article></Reveal>;
}

export function MapPin(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.5"/></svg>}
export function formatDate(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
export function fmtQ(value: number) { return value.toLocaleString('en-IN', { maximumFractionDigits: 1 }); }
export function fmtP(value: number) { return `${Math.round(value * 100)}%`; }
