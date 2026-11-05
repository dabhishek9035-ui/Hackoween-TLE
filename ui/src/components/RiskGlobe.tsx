'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Globe, { GlobeMethods } from 'react-globe.gl';
import type { RiskBoardEntry, RiskLevel } from '@/data/types';
import { RISK_META, fmtP, fmtQ } from '@/components/Ui';

/* 3D Earth risk board. The globe is a VIEW of the demo risk board — the same
   engine that feeds the legend and the register cards below it. Dark Earth
   texture: NASA Blue Marble-derived imagery (public domain), from the
   three-globe example assets. Markers are coloured by the 7-day risk band.
   NOTE: react-globe.gl is imported directly (no next/dynamic here) so the
   forwarded ref — used for camera POV and controls — is not dropped. The
   parent page is responsible for the ssr:false boundary. */

type GlobePoint = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  code: string;
  river: string;
  risk: RiskLevel;
  color: string;
  altitude: number;
  current: number | null;
  predicted5: number;
  pHigh5: number;
  pExt5: number;
  predicted7?: number;
  pHigh7?: number;
  pExt7?: number;
  thresholdHigh: number;
  unit: string;
};

function pointLabel(d: object) {
  const p = d as GlobePoint;
  const meta = RISK_META[p.risk];
  const current = p.current !== null ? `${fmtQ(p.current)} ${p.unit}` : 'no reading';
  const pred = p.predicted5 ?? p.predicted7 ?? 0;
  const ph = p.pHigh5 ?? p.pHigh7 ?? 0;
  const pe = p.pExt5 ?? p.pExt7 ?? 0;
  return `
    <div style="min-width:190px">
      <span class="pop-code">${p.code} · ${p.river.toUpperCase()}</span><br/>
      <b>${p.name}</b><br/>
      <span style="color:${meta.color}">● ${meta.label}</span><br/>
      Latest ${current}<br/>
      5-day predicted ${fmtQ(pred)} ${p.unit}<br/>
      P(high flow) ${fmtP(ph)} · P(extreme) ${fmtP(pe)}<br/>
      <span style="color:#69d6e0;font-weight:600">Click to open forecast ↗</span>
    </div>`;
}

export default function RiskGlobe({ board, focusId, debugMode = 0 }: { board: RiskBoardEntry[]; focusId: string | null; debugMode?: number }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  /* responsive canvas size */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* reduced motion */
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const points = useMemo<GlobePoint[]>(
    () =>
      board.map((entry) => {
        const meta = RISK_META[entry.risk];
        const fill = entry.current !== null ? Math.min(1, entry.current / Math.max(1, entry.catchment.thresholdExtreme)) : 0.4;
        return {
          id: entry.catchment.id,
          lat: entry.catchment.lat,
          lng: entry.catchment.lng,
          name: entry.catchment.name,
          code: entry.catchment.code,
          river: entry.catchment.river,
          risk: entry.risk,
          color: meta.color,
          // column height encodes the same "share of extreme threshold" the DOM shows
          altitude: 0.012 + fill * 0.05,
          current: entry.current,
          predicted5: entry.predicted5 ?? entry.predicted7 ?? 0,
          pHigh5: entry.pHigh5 ?? entry.pHigh7 ?? 0,
          pExt5: entry.pExt5 ?? entry.pExt7 ?? 0,
          predicted7: entry.predicted7 ?? entry.predicted5 ?? 0,
          pHigh7: entry.pHigh7 ?? entry.pHigh5 ?? 0,
          pExt7: entry.pExt7 ?? entry.pExt5 ?? 0,
          thresholdHigh: entry.catchment.thresholdHigh,
          unit: entry.catchment.unit,
        };
      }),
    [board],
  );

  const rings = useMemo(
    () =>
      reducedMotion
        ? []
        : board
            .filter((entry) => entry.risk === 'high')
            .map((entry) => ({
              lat: entry.catchment.lat,
              lng: entry.catchment.lng,
              color: [RISK_META.high.color, RISK_META.high.glow],
              altitude: 0.012,
              propagationSpeed: 1.1,
              repeatPeriod: 1100,
              maxR: 5,
            })),
    [board, reducedMotion],
  );

  const labels = useMemo(
    () =>
      points.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        text: p.code,
        color: 'rgba(196,240,244,.85)',
        size: 0.7,
        altitude: p.altitude + 0.05,
        risk: p.risk,
      })),
    [points],
  );

  /* once the globe exists (ref populated) and has a size, wire the camera:
     gentle drift only while idle, frozen whenever the pointer is over the
     globe so markers stay under the cursor. */
  /* one-time setup: camera POV + material + distance clamps (never re-run —
     re-issuing pointOfView on pointer events breaks three-globe's hover raycast) */
  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe || size.w === 0) return;
    const controls = globe.controls?.();
    if (controls) {
      // still globe: markers must stay put under the cursor for hover/click
      controls.autoRotate = false;
      controls.minDistance = 130;
      controls.maxDistance = 700;
    }
    // lift the night side of the blue-marble texture with a soft teal emissive
    try {
      const material = (globe as unknown as { globeMaterial?: () => { emissive?: { set: (v: string) => void }; emissiveIntensity?: number } }).globeMaterial?.();
      material?.emissive?.set('#1d4e5e');
      if (material?.emissiveIntensity !== undefined) material.emissiveIntensity = 0.35;
    } catch {
      /* material shape differs across three versions — texture still renders */
    }
    // centre on the gauge network once
    globe.pointOfView({ lat: 15.5, lng: 76.5, altitude: 1.75 }, 0);
  }, [ready, size.w, size.h]);

  const onGlobeReady = () => setReady(true);

  /* fly to a catchment when the register asks for it */
  useEffect(() => {
    if (!focusId || !globeRef.current) return;
    const entry = board.find((item) => item.catchment.id === focusId);
    if (!entry) return;
    globeRef.current.pointOfView({ lat: entry.catchment.lat, lng: entry.catchment.lng, altitude: 1.55 }, 1100);
  }, [focusId, board]);

  return (
    <div
      ref={containerRef}
      className="globe-viewport"
      aria-label="3D Earth risk globe of gauged catchments"
    >
      {size.w > 0 && size.h > 0 && (
        <Globe
          ref={globeRef}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="/textures/earth-blue-marble.jpg"
          atmosphereColor="#5de1ee"
          atmosphereAltitude={0.17}
          onGlobeReady={onGlobeReady}
          pointsData={points}
          pointLat={(d: object) => (d as GlobePoint).lat}
          pointLng={(d: object) => (d as GlobePoint).lng}
          pointColor={(d: object) => (d as GlobePoint).color}
          pointAltitude={(d: object) => (d as GlobePoint).altitude}
          pointRadius={0.68}
          pointResolution={16}
          pointLabel={pointLabel}
          onPointClick={(d: object) => router.push(`/predict?catchment=${(d as GlobePoint).id}`)}
          pointsTransitionDuration={450}
          ringsData={rings}
          ringLat={(d: object) => (d as { lat: number }).lat}
          ringLng={(d: object) => (d as { lng: number }).lng}
          ringColor={(d: object) => (d as { color: string[] }).color}
          ringMaxRadius={(d: object) => (d as { maxR: number }).maxR}
          ringPropagationSpeed={(d: object) => (d as { propagationSpeed: number }).propagationSpeed}
          ringRepeatPeriod={(d: object) => (d as { repeatPeriod: number }).repeatPeriod}
          labelsData={labels}
          labelLat={(d: object) => (d as { lat: number }).lat}
          labelLng={(d: object) => (d as { lng: number }).lng}
          labelText={(d: object) => (d as { text: string }).text}
          labelColor={(d: object) => (d as { color: string }).color}
          labelSize={(d: object) => (d as { size: number }).size}
          labelAltitude={(d: object) => (d as { altitude: number }).altitude}
          labelResolution={2}
        />
      )}
      <span className="globe-note">DRAG TO ROTATE · SCROLL TO ZOOM · CLICK A MARKER FOR ITS FORECAST</span>
      <span className="globe-credit">EARTH TEXTURE · NASA BLUE MARBLE (PUBLIC DOMAIN) · MARKERS · LIVE ML RISK BOARD</span>
    </div>
  );
}
