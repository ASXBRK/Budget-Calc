import React from 'react';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Area, ComposedChart, Legend,
} from 'recharts';
import { C, FONT_BODY, FONT_HEAD, FONT_MONO, fmt, fmtK } from './shared.jsx';

// ---------- X-axis helpers ----------

function cutoffXLabel(data) {
  if (!data?.length) return null;
  const years = data.map((d) => d.x);
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (2027 >= min && 2027 <= max) return 2027;
  return null;
}

function tickIntervalFor(n) {
  if (n <= 10) return 0;
  if (n <= 20) return 1;
  if (n <= 40) return 4;
  return 9;
}

function getXAxisProps(data) {
  return {
    dataKey: 'xLabel',
    type: 'category',
    interval: tickIntervalFor(data.length),
    padding: { left: 0, right: 0 },
    stroke: C.textSubtle,
    tick: { fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted },
  };
}

function PanelHeader({ title, subtitle, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      marginBottom: 4,
    }}>
      <div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2, lineHeight: 1.4 }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

// Recharts dispatches chart children by element.type — wrapper components are
// silently skipped. Plain helper FUNCTION (not component) so the JSX child has
// type === ReferenceLine.
function cutoffReference(data) {
  const cutoff = cutoffXLabel(data);
  if (cutoff == null) return null;
  return (
    <ReferenceLine
      x={cutoff}
      stroke={C.chartCutoff}
      strokeWidth={1.5}
      strokeDasharray="5 3"
      ifOverflow="extendDomain"
      isFront={true}
    />
  );
}

// ---------- Shared comparison tooltip ----------

function ComparisonTooltip({ active, payload, label, type }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isPost = d.x >= 2027;

  let oldV, newV, fmtVal, footerMore, footerLess, footerSame, epsilon;
  if (type === 'tax') {
    oldV = d.taxOld ?? 0;
    newV = d.taxNew ?? 0;
    fmtVal = fmt;
    footerMore = (g) => `New rules costs ${fmt(g)} more`;
    footerLess = (g) => `New rules costs ${fmt(g)} less`;
    footerSame = 'Same';
    epsilon = 0.5;
  } else if (type === 'proceeds') {
    oldV = d.afterTaxOld ?? 0;
    newV = d.afterTaxNew ?? 0;
    fmtVal = fmt;
    footerMore = (g) => `New rules keeps ${fmt(g)} more`;
    footerLess = (g) => `New rules keeps ${fmt(g)} less`;
    footerSame = 'Same';
    epsilon = 0.5;
  } else {
    oldV = d.rateOld ?? 0;
    newV = d.rateNew ?? 0;
    fmtVal = (v) => `${(Number(v) || 0).toFixed(1)}%`;
    footerMore = (g) => `New rules is ${g.toFixed(1)}pp higher`;
    footerLess = (g) => `New rules is ${g.toFixed(1)}pp lower`;
    footerSame = 'Same';
    epsilon = 0.1;
  }

  const diff = (newV ?? 0) - (oldV ?? 0);
  const absDiff = Math.abs(diff);
  let footerText, footerColor;
  if (absDiff < epsilon) {
    footerText = footerSame;
    footerColor = C.textMuted;
  } else if (type === 'proceeds') {
    footerText = diff > 0 ? footerMore(absDiff) : footerLess(absDiff);
    footerColor = diff > 0 ? C.semanticBetter : C.semanticWorse;
  } else {
    footerText = diff > 0 ? footerMore(absDiff) : footerLess(absDiff);
    footerColor = diff > 0 ? C.semanticWorse : C.semanticBetter;
  }

  const row = (k, v, color) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color }}>{k}</span>
      <span style={{ fontFamily: FONT_MONO, fontWeight: 600 }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 10, fontSize: 11, fontFamily: FONT_BODY, minWidth: 200,
    }}>
      <div style={{ color: C.textMuted, marginBottom: 6 }}>Sale year {label}</div>
      {row('Old rules', fmtVal(oldV), C.oldRules)}
      {isPost && row('New rules', fmtVal(newV), C.newRules)}
      {isPost ? (
        <div style={{
          borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6,
          color: footerColor, fontWeight: 600,
        }}>
          {footerText}
        </div>
      ) : (
        <div style={{
          borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6,
          fontStyle: 'italic', color: C.textSecondary,
        }}>
          New rules commence 1 July 2027 — old rules apply to this sale year.
        </div>
      )}
    </div>
  );
}

// ---------- Shared comparison panel renderer ----------

function buildBandPoints(data, oldKey, newKey, betterWhen) {
  return data.map((d) => {
    const oldV = d[oldKey] ?? 0;
    const newV = d[newKey];
    // null new value (pre-commencement sale years) → no band, no new line.
    // Recharts breaks the line at null by default, which is what we want.
    const hasNew = newV != null;
    const lo = hasNew ? Math.min(oldV, newV) : 0;
    const gap = hasNew ? Math.abs(newV - oldV) : 0;
    const newBetter = hasNew && (betterWhen === 'higher' ? newV > oldV : newV < oldV);
    return {
      x: d.x,
      xLabel: d.xLabel,
      [oldKey]: oldV,
      [newKey]: hasNew ? newV : null,
      base: lo,
      gapGreen: hasNew && newBetter ? gap : 0,
      gapRed: hasNew && !newBetter && gap > 0 ? gap : 0,
    };
  });
}

function PanelChart({
  data, points, oldKey, newKey, tooltipType, height, compact,
  title, subtitle, yDomain, yTicks, yTickFormatter,
}) {
  const margin = compact
    ? { top: 8, right: 8, bottom: 32, left: 0 }
    : { top: 8, right: 16, bottom: 36, left: 4 };
  const yAxisWidth = compact ? 44 : 60;
  return (
    <div>
      <PanelHeader title={title} subtitle={subtitle} />
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <ComposedChart data={points} margin={margin}>
            <CartesianGrid stroke={C.chartGrid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              {...getXAxisProps(data)}
              label={{ value: 'Sale year', position: 'insideBottom', fontSize: 11, fill: C.textMuted, dy: 14 }}
            />
            <YAxis
              stroke={C.textSubtle}
              tick={{ fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted }}
              domain={yDomain}
              ticks={yTicks}
              tickFormatter={yTickFormatter}
              width={yAxisWidth}
            />
            <Tooltip content={<ComparisonTooltip type={tooltipType} />} wrapperStyle={{ maxWidth: '90vw' }} />
            <Legend
              verticalAlign="top" height={26} iconType="line"
              payload={[
                { value: 'Old rules', type: 'line', color: C.oldRules },
                { value: 'New rules', type: 'line', color: C.newRules },
              ]}
              formatter={(value) => <span style={{ fontSize: 11, color: C.textSecondary }}>{value}</span>}
            />
            <Area type="monotone" dataKey="base" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} activeDot={false} />
            <Area type="monotone" dataKey="gapRed" stackId="band" stroke="none" fill={C.semanticWorse} fillOpacity={0.18} isAnimationActive={false} activeDot={false} />
            <Area type="monotone" dataKey="gapGreen" stackId="band" stroke="none" fill={C.semanticBetter} fillOpacity={0.18} isAnimationActive={false} activeDot={false} />
            <Line type="monotone" dataKey={oldKey} stroke={C.oldRules} strokeWidth={2} dot={false} isAnimationActive={false} name="Old rules" />
            <Line type="monotone" dataKey={newKey} stroke={C.newRules} strokeWidth={2} dot={false} isAnimationActive={false} name="New rules" />
            {cutoffReference(data)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DiffPanel({ data, height = 220, compact = false }) {
  const points = buildBandPoints(data, 'taxOld', 'taxNew', 'lower');
  return (
    <PanelChart
      data={data} points={points}
      oldKey="taxOld" newKey="taxNew" tooltipType="tax" height={height} compact={compact}
      title="Tax owed"
      subtitle="Tax payable at each sale year. Solid lines compare regimes. Green band: new rules cost less. Red band: new rules cost more."
      yDomain={[0, 'auto']}
      yTickFormatter={fmtK}
    />
  );
}

export function ProceedsPanel({ data, height = 220, compact = false }) {
  const points = buildBandPoints(data, 'afterTaxOld', 'afterTaxNew', 'higher');
  return (
    <PanelChart
      data={data} points={points}
      oldKey="afterTaxOld" newKey="afterTaxNew" tooltipType="proceeds" height={height} compact={compact}
      title="After-tax proceeds"
      subtitle="What you keep after tax at each sale year. Solid lines show retention under each regime. Green band: new rules keep more. Red band: new rules keep less."
      yDomain={[0, 'auto']}
      yTickFormatter={fmtK}
    />
  );
}

export function RatePanel({ data, height = 220, compact = false }) {
  const points = buildBandPoints(data, 'rateOld', 'rateNew', 'lower');
  return (
    <PanelChart
      data={data} points={points}
      oldKey="rateOld" newKey="rateNew" tooltipType="rate" height={height} compact={compact}
      title="Effective rate"
      subtitle="Tax as a percentage of nominal gain. Green band: new rules lower. Red band: new rules higher."
      yDomain={[0, 50]}
      yTicks={[0, 10, 20, 30, 40, 50]}
      yTickFormatter={(v) => `${v.toFixed(0)}%`}
    />
  );
}
