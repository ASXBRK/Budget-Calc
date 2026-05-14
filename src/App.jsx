import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
  Legend,
} from 'recharts';
import { Copy, Link as LinkIcon, X, Settings, Info, Check } from 'lucide-react';
import { runCGTProjection, runCGTSeries, LEG } from './engine.js';

// ----------------------------------------------------------------------------
// Design tokens
// ----------------------------------------------------------------------------

const C = {
  teal: '#0d9488', tealLight: '#ccfbf1',
  dark: '#111827', white: '#ffffff', offWhite: '#f8fafc',
  textPrimary: '#111827', textSecondary: '#374151',
  textMuted: '#6b7280', textSubtle: '#9ca3af',
  border: '#e2e8f0',
  healthy: '#10b981', healthyBg: '#d1fae5', healthyText: '#065f46',
  warning: '#f59e0b', warningBg: '#fef3c7', warningText: '#92400e',
  risk: '#ef4444', riskBg: '#fee2e2', riskText: '#991b1b',
  oldRules: '#0d9488',
  newRules: '#f59e0b',
  preCgt: '#10b981',
};

const FONT_BODY = "'Plus Jakarta Sans', system-ui, sans-serif";
const FONT_HEAD = "'DM Sans', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

const BUCKET_EXPLAINERS = {
  A: 'Both purchase and sale are before 1 July 2027, so the old 50% discount applies to the whole gain.',
  B: 'Because you bought before 1 July 2027 and are selling after, the gain is split — the pre-2027 portion uses the old 50% discount, the post-2027 portion uses indexation + 30% min.',
  C: 'Purchased after 1 July 2027, so the new rules — indexation + 30% min — apply to the whole gain.',
  D: 'Pre-1985 asset. Gains accrued before 1 July 2027 remain exempt; only the portion accruing after that date is taxed under the new rules.',
};

const PRE_CGT_VALUE_INFO = "Pre-1985 assets are exempt up to 1 July 2027. From that date forwards, the new rules treat the 1 July 2027 market value as the cost base. A formal valuation isn't required for modelling — a reasonable estimate is fine, but flag it as illustrative when discussing with the client.";

const HIDE_SPINNERS = `
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; appearance: textfield; }
  .slider-track { -webkit-appearance: none; appearance: none; height: 4px; background: ${C.border}; border-radius: 2px; outline: none; }
  .slider-track::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid ${C.white}; box-sizing: border-box; }
  .slider-track::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid ${C.white}; }
`;

// ----------------------------------------------------------------------------
// Format helpers
// ----------------------------------------------------------------------------

const fmt = (v) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(Math.round(v || 0));

const fmtK = (v) => {
  const n = Number(v) || 0;
  return Math.abs(n) >= 1e6
    ? `$${(n / 1e6).toFixed(1)}M`
    : `$${Math.round(n / 1e3)}k`;
};

const fmtPct = (v, decimals = 1) => `${((Number(v) || 0) * 100).toFixed(decimals)}%`;

const fmtDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(dt);
};

// ----------------------------------------------------------------------------
// URL state
// ----------------------------------------------------------------------------

const KEY_MAP = {
  mode: 'mode',
  purchase_price: 'pp',
  return_rate: 'rr',
  inflation: 'inf',
  holding_years: 'hy',
  other_income: 'oi',
  income_support_recipient: 'is',
  purchase_date: 'pd',
  acquisition_costs: 'ac',
  capital_improvements: 'ci',
  depreciation_claimed: 'dep',
  asset_type: 'at',
  sale_date: 'sd',
  sale_price: 'sp',
  sale_costs: 'sc',
  growth_rate: 'gr',
  valuation_method: 'vm',
  value_2027: 'v27',
};
const REVERSE_KEY_MAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);

function encodeState(state) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value == null || value === '') continue;
    const shortKey = KEY_MAP[key];
    if (!shortKey) continue;
    if (typeof value === 'boolean') {
      params.set(shortKey, value ? '1' : '0');
    } else if (value instanceof Date) {
      params.set(shortKey, value.toISOString().slice(0, 10));
    } else {
      params.set(shortKey, String(value));
    }
  }
  params.set('v', '1');
  return params.toString();
}

function decodeState(search) {
  const params = new URLSearchParams(search);
  const out = {};
  for (const [shortKey, value] of params.entries()) {
    if (shortKey === 'v') continue;
    const longKey = REVERSE_KEY_MAP[shortKey];
    if (!longKey) continue;
    if (longKey === 'income_support_recipient') {
      out[longKey] = value === '1';
    } else if (
      longKey === 'mode' ||
      longKey === 'valuation_method' ||
      longKey === 'asset_type' ||
      longKey.endsWith('_date')
    ) {
      out[longKey] = value;
    } else {
      const num = Number(value);
      out[longKey] = Number.isFinite(num) ? num : value;
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Atoms
// ----------------------------------------------------------------------------

function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
      <div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function InfoTooltip({ content, title }) {
  const [open, setOpen] = useState(false);
  const [flipLeft, setFlipLeft] = useState(false);
  const iconRef = useRef(null);
  const TOOLTIP_WIDTH = 260;

  useEffect(() => {
    if (!open || !iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const roomRight = window.innerWidth - rect.left;
    setFlipLeft(roomRight < TOOLTIP_WIDTH + 16);
  }, [open]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        ref={iconRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        style={{
          cursor: 'help', color: C.textSubtle,
          display: 'inline-flex', alignItems: 'center',
        }}
        aria-label="More info"
      >
        <Info size={12} />
      </span>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', top: '100%', marginTop: 6,
            ...(flipLeft ? { right: 0 } : { left: 0 }),
            background: C.dark, color: C.white,
            fontSize: 11, lineHeight: 1.5, fontWeight: 400,
            textTransform: 'none', letterSpacing: 0,
            padding: '10px 12px', borderRadius: 6,
            width: TOOLTIP_WIDTH, zIndex: 50,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {title && (
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
          )}
          {content}
        </div>
      )}
    </span>
  );
}

function Label({ children, info, infoTitle }) {
  return (
    <div style={{ marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {children}
      </span>
      {info && <InfoTooltip content={info} title={infoTitle} />}
    </div>
  );
}

function NumberInput({ value, onChange, prefix = '$', step = 1, min }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '6px 10px', background: C.white,
    }}>
      {prefix && <span style={{ color: C.textMuted, marginRight: 6, fontSize: 13 }}>{prefix}</span>}
      <input
        type="number"
        value={value === '' ? '' : value}
        step={step}
        min={min}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        style={{
          border: 'none', outline: 'none', width: '100%', fontSize: 14,
          fontFamily: FONT_MONO, color: C.textPrimary, background: 'transparent',
        }}
      />
    </div>
  );
}

function DateInput({ value, onChange }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px',
        fontSize: 13, fontFamily: FONT_BODY, color: C.textPrimary, background: C.white,
        width: '100%', boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px',
        fontSize: 13, fontFamily: FONT_BODY, color: C.textPrimary, background: C.white,
        width: '100%', outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function Slider({ value, onChange, min, max, step, format }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <div />
        <div style={{ fontSize: 13, fontFamily: FONT_MONO, fontWeight: 600, color: C.teal }}>
          {format ? format(value) : value}
        </div>
      </div>
      <input
        type="range"
        className="slider-track"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textSubtle, marginTop: 2, fontFamily: FONT_MONO }}>
        <span>{format ? format(min) : min}</span>
        <span>{format ? format(max) : max}</span>
      </div>
    </div>
  );
}

function Toggle({ value, onChange, options, disabled }) {
  return (
    <div style={{
      display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 2, background: C.offWhite, opacity: disabled ? 0.5 : 1,
    }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            style={{
              border: 'none',
              background: active ? C.white : 'transparent',
              color: active ? C.textPrimary : C.textMuted,
              fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600,
              padding: '6px 12px', borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: active ? `0 0 0 1px ${C.border}` : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Timeline strip — labels below the bar, no negative positioning
// ----------------------------------------------------------------------------

function TimelineStrip({ purchaseDate, saleDate, isPreCgt, bucket }) {
  const start = new Date(LEG.newRulesStart);
  const pdate = purchaseDate ? new Date(purchaseDate) : null;
  const sdate = saleDate ? new Date(saleDate) : null;
  if (!pdate || !sdate) return null;

  // Window: include both dates with a small buffer around 1 Jul 2027
  const buffer = 365 * 24 * 3600 * 1000;
  const earliest = new Date(Math.min(pdate.getTime(), start.getTime() - buffer));
  const latest = new Date(Math.max(sdate.getTime(), start.getTime() + buffer));
  const span = latest - earliest;
  const pct = (d) => Math.max(0, Math.min(100, ((d - earliest) / span) * 100));

  const cutoffPct = pct(start);
  const purchasePct = pct(pdate);
  const salePct = pct(sdate);

  const preColor = isPreCgt ? C.preCgt : C.teal;
  const preLabel = isPreCgt ? 'Pre-CGT exempt' : '50% discount';
  const postLabel = 'Indexation + 30% min';

  const segStart = Math.max(purchasePct, 0);
  const segEnd = Math.min(salePct, 100);

  const bucketDesc = LEG.buckets[bucket]?.split(' — ')[1] || '';

  // Avoid label collisions under the bar by giving each its own slot
  // when too close. We render Bought / 1 Jul 2027 / Sold each anchored to
  // its position; the parent has overflow: visible so overlaps are tolerated.

  return (
    <Card style={{ padding: 16 }}>
      <div style={{
        fontSize: 10, color: C.textMuted, fontFamily: FONT_MONO,
        marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        Bucket {bucket} · {bucketDesc}
      </div>

      {/* Bar */}
      <div style={{
        position: 'relative', height: 40, background: C.offWhite,
        borderRadius: 4, border: `1px solid ${C.border}`,
      }}>
        {bucket !== 'C' && segStart < cutoffPct && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${segStart}%`,
            width: `${Math.min(segEnd, cutoffPct) - segStart}%`,
            background: preColor, borderRadius: '3px 0 0 3px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.white, fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
            overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 8px',
          }}>
            {preLabel}
          </div>
        )}
        {bucket !== 'A' && segEnd > cutoffPct && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${Math.max(segStart, cutoffPct)}%`,
            width: `${segEnd - Math.max(segStart, cutoffPct)}%`,
            background: C.newRules,
            borderRadius: bucket === 'C' ? '3px' : '0 3px 3px 0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.white, fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
            overflow: 'hidden', whiteSpace: 'nowrap', padding: '0 8px',
          }}>
            {postLabel}
          </div>
        )}
        {/* 1 July 2027 dashed line (no label here — sits below) */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${cutoffPct}%`,
          borderLeft: `1px dashed ${C.dark}`,
        }} />
      </div>

      {/* Labels under the bar — three slots */}
      <div style={{ position: 'relative', height: 18, marginTop: 6 }}>
        <DateMarker pct={purchasePct} label={`Bought ${fmtDate(pdate)}`} />
        <DateMarker
          pct={cutoffPct}
          label="1 Jul 2027"
          strong
        />
        <DateMarker pct={salePct} label={`Sold ${fmtDate(sdate)}`} />
      </div>
    </Card>
  );
}

function DateMarker({ pct, label, strong }) {
  // Keep labels inside the box by clamping anchor and choosing text-anchor
  // based on position.
  const anchor =
    pct < 8 ? 'flex-start' : pct > 92 ? 'flex-end' : 'center';
  const transform =
    anchor === 'center' ? 'translateX(-50%)' :
    anchor === 'flex-start' ? 'none' : 'translateX(-100%)';
  return (
    <div style={{
      position: 'absolute', left: `${pct}%`, transform,
      fontSize: 10, fontFamily: FONT_MONO,
      color: strong ? C.textPrimary : C.textSecondary,
      fontWeight: strong ? 600 : 400,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tooltip for charts
// ----------------------------------------------------------------------------

function ChartTooltip({ active, payload, label, suffix }) {
  if (!active || !payload || !payload.length) return null;
  const old = payload.find((p) => p.dataKey === 'old' || p.dataKey === 'oldRate')?.value;
  const nw = payload.find((p) => p.dataKey === 'new' || p.dataKey === 'newRate')?.value;
  const diff = (nw ?? 0) - (old ?? 0);
  const isPct = suffix === '%';
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 10, fontSize: 12, fontFamily: FONT_BODY, minWidth: 180,
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: C.oldRules }}>Old rules</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600 }}>
          {isPct ? `${(old || 0).toFixed(1)}%` : fmt(old)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: C.newRules }}>New rules</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600 }}>
          {isPct ? `${(nw || 0).toFixed(1)}%` : fmt(nw)}
        </span>
      </div>
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: C.textMuted }}>Δ</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: diff > 0 ? C.risk : C.healthy }}>
          {isPct ? `${diff.toFixed(1)}%` : fmt(diff)}
        </span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Modals
// ----------------------------------------------------------------------------

function Modal({ title, onClose, children, wide }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17, 24, 39, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white, borderRadius: 12, padding: 24,
          width: wide ? 720 : 520, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto',
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ParamsModal({ onClose }) {
  const flat = [
    ['New rules commencement', fmtDate(LEG.newRulesStart)],
    ['Pre-CGT cutoff', fmtDate(LEG.preCgtCutoff)],
    ['Minimum tax rate', fmtPct(LEG.minimumTaxRate, 0)],
    ['Old discount rate', fmtPct(LEG.oldDiscountRate, 0)],
    ['Super fund discount', fmtPct(LEG.superDiscountRate, 1) + ' (not modelled v1)'],
    ['Medicare levy (high-income)', fmtPct(LEG.medicareLevy, 0)],
    ['Medicare lower threshold (single)', fmt(LEG.medicareLowerSingle)],
    ['Medicare upper threshold (single)', fmt(LEG.medicareUpperSingle)],
  ];
  return (
    <Modal title="Legislated parameters" onClose={onClose} wide>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Four transition buckets
        </div>
        <BucketsDiagram />
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>Constants</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
        <tbody>
          {flat.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: '6px 0', color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{k}</td>
              <td style={{ padding: '6px 0', fontFamily: FONT_MONO, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>Marginal tax brackets (resident individuals)</div>
      {Object.entries(LEG.brackets).map(([fy, bk]) => (
        <div key={fy} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{fy}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {bk.map(([f, c, r]) => (
                <tr key={f}>
                  <td style={{ padding: '4px 8px', color: C.textSecondary, fontFamily: FONT_MONO }}>
                    {fmt(f)} – {c === Infinity ? '∞' : fmt(c)}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: FONT_MONO }}>{fmtPct(r, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 12 }}>
        Subject to final legislation. Engine constants designed for one-line updates when law is released.
      </div>
    </Modal>
  );
}

function BucketsDiagram() {
  const rows = [
    { label: 'A', desc: 'Bought & sold before 1 Jul 2027', pre: 100, post: 0, preColor: C.teal },
    { label: 'B', desc: 'Bought before, sold after', pre: 60, post: 40, preColor: C.teal },
    { label: 'C', desc: 'Bought after 1 Jul 2027', pre: 0, post: 100, preColor: C.teal },
    { label: 'D', desc: 'Pre-1985 asset, sold after', pre: 60, post: 40, preColor: C.preCgt },
  ];
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 18, height: 18, borderRadius: 4, background: C.dark, color: C.white,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, fontFamily: FONT_MONO,
          }}>{r.label}</div>
          <div style={{ flex: 1, height: 20, position: 'relative', border: `1px solid ${C.border}`, borderRadius: 3, overflow: 'hidden' }}>
            {r.pre > 0 && (
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${r.pre}%`, background: r.preColor }} />
            )}
            {r.post > 0 && (
              <div style={{ position: 'absolute', left: `${r.pre}%`, top: 0, bottom: 0, width: `${r.post}%`, background: C.newRules }} />
            )}
            {r.post > 0 && r.pre > 0 && (
              <div style={{ position: 'absolute', left: `${r.pre}%`, top: 0, bottom: 0, borderLeft: `1px dashed ${C.dark}` }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: C.textSecondary, width: 220 }}>{r.desc}</div>
        </div>
      ))}
    </div>
  );
}

// Plain-English assumptions modal
function AssumptionsModal({ diagnostics, onClose }) {
  const items = [
    {
      label: 'How the gain is split before and after 1 July 2027',
      text: 'For an asset bought before 1 July 2027 and sold after, the value at 1 July 2027 is estimated using compound growth from purchase to sale, then portioned across the two periods. This matches Treasury\'s worked example. You can override with a specific market valuation if you have one.',
    },
    {
      label: 'How inflation indexation is applied',
      text: 'The cost base is grown each year by the inflation rate you set (annual compounding). Only the gain above this inflation-adjusted base is taxable under the new rules. The 1985-1999 method used quarterly CPI; for future modelling, annual compounding is industry standard since future CPI doesn\'t yet exist.',
    },
    {
      label: 'How the 30% minimum tax applies',
      text: 'Under the new rules, tax is the higher of (a) your marginal rate on the real gain, or (b) 30% × real gain. For people whose marginal rate is already above 30%, the minimum does nothing. For lower-income retirees, it raises the effective rate to 30%.',
    },
    {
      label: 'Pre-2027 vs post-2027 tax allocation (Bucket B)',
      text: 'Marginal tax across both portions is split pro-rata by their taxable amounts. Treasury hasn\'t yet specified stacking order. If they require strict sequential stacking, results could shift by a few percent in close cases.',
    },
    {
      label: 'Medicare levy',
      text: 'Calculated using the proper shading-in formula for resident singles (nothing under $28,011, 10% phase-in to $35,014, then 2%). For clients well above the threshold this is effectively 2% × gain. For low-income clients it\'s correctly lower.',
    },
    {
      label: 'Capital losses',
      text: 'Not modelled in this version. Losses carry forward against future gains under both regimes, but the tool currently shows gain scenarios only.',
    },
    {
      label: 'Legislation status',
      text: 'These rules were announced in the May 2026 Federal Budget but have not yet been passed into law. Treatment may change before commencement.',
    },
  ];
  return (
    <Modal title="What the calculator assumes" onClose={onClose} wide>
      <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
        Treasury hasn't released final mechanics for some details of the reform. Where ambiguity exists, the engine commits to the published industry consensus. Switch a single constant in the engine if final legislation differs.
      </div>
      {items.map((item, i) => (
        <div key={i} style={{
          paddingBottom: 12, marginBottom: 12,
          borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
            {item.label}
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.55 }}>
            {item.text}
          </div>
        </div>
      ))}
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// Main App
// ----------------------------------------------------------------------------

const DEFAULT_MODE1 = {
  mode: 'old_vs_new',
  purchase_price: 500000,
  return_rate: 0.06,
  inflation: 0.025,
  holding_years: 10,
  other_income: 100000,
  income_support_recipient: false,
};

const today = new Date();
const DEFAULT_MODE2 = {
  mode: 'specific',
  asset_type: 'shares',
  purchase_date: '2020-07-01',
  purchase_price: 100000,
  acquisition_costs: 500,
  capital_improvements: 0,
  depreciation_claimed: 0,
  sale_date: `${today.getFullYear() + 5}-06-30`,
  sale_price: 0, // derived
  sale_costs: 500,
  growth_rate: 0.06,
  inflation: 0.025,
  other_income: 100000,
  income_support_recipient: false,
  valuation_method: 'ATO_formula',
  value_2027: 0,
};

export default function App() {
  const [mode, setMode] = useState('old_vs_new');
  const [mode1, setMode1] = useState(DEFAULT_MODE1);
  const [mode2, setMode2] = useState(DEFAULT_MODE2);
  const [chartTab, setChartTab] = useState('after_tax');
  const [paramsOpen, setParamsOpen] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [salePriceOverridden, setSalePriceOverridden] = useState(false);
  const [copied, setCopied] = useState(false);

  // Hydrate from URL on first mount
  useEffect(() => {
    const decoded = decodeState(window.location.search);
    if (decoded.mode === 'specific') {
      setMode('specific');
      setMode2((m) => ({ ...m, ...decoded }));
      if (decoded.sale_price) setSalePriceOverridden(true);
    } else if (decoded.mode === 'old_vs_new') {
      setMode('old_vs_new');
      setMode1((m) => ({ ...m, ...decoded }));
    }
  }, []);

  // Push state to URL on every change (replace, not push)
  useEffect(() => {
    const active = mode === 'old_vs_new' ? { ...mode1, mode } : { ...mode2, mode };
    const qs = encodeState(active);
    const url = `${window.location.pathname}?${qs}`;
    window.history.replaceState(null, '', url);
  }, [mode, mode1, mode2]);

  const updateMode1 = useCallback((patch) => setMode1((s) => ({ ...s, ...patch })), []);
  const updateMode2 = useCallback((patch) => setMode2((s) => ({ ...s, ...patch })), []);

  // Auto-detected pre-CGT for Mode 2
  const isPreCgt = useMemo(() => {
    if (!mode2.purchase_date) return false;
    return new Date(mode2.purchase_date) < LEG.preCgtCutoff;
  }, [mode2.purchase_date]);

  // Derive sale price when not overridden
  const mode2Effective = useMemo(() => {
    if (isPreCgt) {
      // Sale price derived from value_2027 + growth since 1 July 2027
      const sd = new Date(mode2.sale_date);
      const yearsPost = Math.max(
        (sd - new Date(LEG.newRulesStart)) / (365.25 * 24 * 3600 * 1000),
        0
      );
      const derived = (mode2.value_2027 || 0) * Math.pow(1 + mode2.growth_rate, yearsPost);
      return {
        ...mode2,
        is_pre_cgt: true,
        sale_price: salePriceOverridden ? mode2.sale_price : Math.round(derived),
      };
    }
    if (salePriceOverridden && mode2.sale_price > 0) {
      return { ...mode2, is_pre_cgt: false };
    }
    const pd = new Date(mode2.purchase_date);
    const sd = new Date(mode2.sale_date);
    const years = Math.max((sd - pd) / (365.25 * 24 * 3600 * 1000), 0);
    const dep = mode2.asset_type === 'property' ? (mode2.depreciation_claimed || 0) : 0;
    const cb = (mode2.purchase_price || 0) + (mode2.acquisition_costs || 0)
      + (mode2.capital_improvements || 0) - dep;
    const derived = cb * Math.pow(1 + mode2.growth_rate, years);
    return { ...mode2, is_pre_cgt: false, sale_price: Math.round(derived) };
  }, [mode2, salePriceOverridden, isPreCgt]);

  const result = useMemo(() => {
    try {
      if (mode === 'old_vs_new') return runCGTProjection(mode1);
      return runCGTProjection(mode2Effective);
    } catch (e) {
      return { error: e.message };
    }
  }, [mode, mode1, mode2Effective]);

  // Series for charts
  const chartData = useMemo(() => {
    if (result.error) return [];
    if (mode === 'old_vs_new') {
      const maxYears = Math.max(1, mode1.holding_years || 1);
      const series = runCGTSeries(mode1, 'holding_years', [1, maxYears]);
      return series.map((s, i) => ({
        x: i + 1,
        xLabel: `${i + 1}y`,
        old: s.oldRules?.afterTaxProceeds || 0,
        new: s.newRules?.afterTaxProceeds || 0,
        oldRate: (s.oldRules?.effectiveRate || 0) * 100,
        newRate: (s.newRules?.effectiveRate || 0) * 100,
      }));
    }
    const pd = new Date(mode2.purchase_date);
    const startYear = Math.max(pd.getFullYear() + 1, 2024);
    const endYear = startYear + 25;
    const series = runCGTSeries(
      { ...mode2Effective, sale_price_derive: true },
      'sale_year',
      [startYear, endYear]
    );
    return series.map((s) => {
      const y = new Date(s.saleDate || mode2Effective.sale_date).getFullYear();
      return {
        x: y,
        xLabel: y,
        old: s.oldRules?.afterTaxProceeds || 0,
        new: s.actual?.afterTaxProceeds || s.newRules?.afterTaxProceeds || 0,
        oldRate: (s.oldRules?.effectiveRate || 0) * 100,
        newRate: (s.actual?.effectiveRate || s.newRules?.effectiveRate || 0) * 100,
      };
    });
  }, [mode, mode1, mode2, mode2Effective, result]);

  // Copy summary
  const copySummary = useCallback(() => {
    const r = result;
    if (r.error) return;
    const lines = [];
    lines.push(`CGT Estimate — ${fmtDate(new Date())}`);
    lines.push(`Mode: ${mode === 'old_vs_new' ? 'Old vs New rules' : 'Specific asset'}`);
    if (mode === 'specific') {
      const assetType = mode2.asset_type || 'shares';
      lines.push(`Asset type: ${assetType}`);
      lines.push(`Purchase: ${fmt(mode2Effective.purchase_price)} on ${fmtDate(mode2.purchase_date)}`);
      lines.push(`Sale: ${fmt(mode2Effective.sale_price)} on ${fmtDate(mode2.sale_date)}`);
      lines.push(`Bucket: ${r.bucket} (${LEG.buckets[r.bucket]?.split(' — ')[1] || ''})`);
      if (r.split) {
        lines.push(`Pre-1 July 2027 gain (taxable): ${fmt(r.split.prePortionTaxable)}`);
        lines.push(`Post-1 July 2027 gain (taxable): ${fmt(r.split.postPortionTaxable)}`);
        lines.push(`Total taxable: ${fmt(r.split.totalTaxable)}`);
      }
      lines.push(`Actual tax: ${fmt(r.actual.taxOnGain)}`);
      lines.push(`Actual after-tax proceeds: ${fmt(r.actual.afterTaxProceeds)}`);
      lines.push(`Counterfactual old-rules after-tax: ${fmt(r.oldRules.afterTaxProceeds)}`);
      const diff = r.actual.afterTaxProceeds - r.oldRules.afterTaxProceeds;
      lines.push(`Difference: ${fmt(Math.abs(diff))} (${diff >= 0 ? 'new regime better' : 'new regime costs more'})`);
    } else {
      lines.push(`Inputs: ${fmt(mode1.purchase_price)}, ${fmtPct(mode1.return_rate)} return, ${fmtPct(mode1.inflation)} inflation, ${mode1.holding_years} years`);
      lines.push(`Old rules tax: ${fmt(r.oldRules.taxOnGain)}`);
      lines.push(`New rules tax: ${fmt(r.newRules.taxOnGain)}`);
      const diff = r.newRules.taxOnGain - r.oldRules.taxOnGain;
      lines.push(`Difference: ${fmt(Math.abs(diff))} (${diff > 0 ? 'new regime costs more' : 'new regime better'})`);
    }
    lines.push('');
    lines.push('— Generated by CGT Reform Calc. Illustrative only. Subject to final legislation.');
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [result, mode, mode1, mode2, mode2Effective]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // Verdict
  const verdict = useMemo(() => {
    if (result.error) return null;
    const oldVal = result.oldRules?.afterTaxProceeds || 0;
    const newVal = (mode === 'specific' ? result.actual?.afterTaxProceeds : result.newRules?.afterTaxProceeds) || 0;
    const diff = newVal - oldVal;
    const pct = oldVal > 0 ? Math.abs(diff) / oldVal : 0;
    if (mode === 'specific' && result.bucket === 'A') {
      return { tone: 'neutral', label: 'Pre-2027 sale', desc: 'Old rules apply.' };
    }
    if (mode === 'specific' && result.bucket === 'D') {
      return { tone: 'good', label: 'Pre-CGT exempt', desc: 'Pre-2027 gains exempt.' };
    }
    if (pct < 0.05) return { tone: 'warn', label: 'Within 5%', desc: 'Broadly equivalent outcome.' };
    if (diff > 0) return { tone: 'good', label: 'New rules cheaper', desc: 'New regime preserves more after-tax value.' };
    return { tone: 'bad', label: 'New rules costlier', desc: 'New regime costs more.' };
  }, [result, mode]);

  return (
    <>
      <style>{HIDE_SPINNERS}</style>

      {/* Nav bar */}
      <div style={{
        background: C.white, borderBottom: `1px solid ${C.border}`,
        padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontFamily: FONT_HEAD, fontWeight: 700, fontSize: 16, color: C.textPrimary }}>
          <span style={{ color: C.teal }}>CGT</span> Reform Calc
        </div>
        <Toggle
          value={mode}
          onChange={setMode}
          options={[
            { value: 'old_vs_new', label: 'Old vs New rules' },
            { value: 'specific', label: 'Specific asset' },
          ]}
        />
        <button
          onClick={() => setParamsOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
            border: `1px solid ${C.border}`, padding: '6px 12px', borderRadius: 8,
            fontSize: 12, fontFamily: FONT_BODY, cursor: 'pointer', color: C.textSecondary,
          }}
        >
          <Settings size={14} /> Params
        </button>
      </div>

      {/* Intro */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 0' }}>
        <Card>
          <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6 }}>
            The May 2026 Federal Budget proposes replacing the 50% CGT discount with cost-base indexation plus a 30% minimum tax on real gains, for CGT events on or after 1 July 2027. This tool models the impact in two ways: <strong style={{ color: C.textPrimary }}>Old vs New rules</strong> compares the regimes for a hypothetical asset at any return, inflation, and holding period; <strong style={{ color: C.textPrimary }}>Specific asset</strong> projects a real client's holding using actual purchase and sale dates. Calculations follow the Budget paper plus published industry analysis (Treasury worked examples, Pitcher Partners, BDO, NAB); the reform is not yet legislated and treatment may change.
          </div>
        </Card>
      </div>

      {/* Main layout */}
      <div style={{
        maxWidth: 1280, margin: '0 auto', padding: 20,
        display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16,
      }}>
        {/* Left column: inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'old_vs_new' ? (
            <Mode1Inputs inputs={mode1} update={updateMode1} />
          ) : (
            <Mode2Inputs
              inputs={mode2}
              update={updateMode2}
              effectiveSalePrice={mode2Effective.sale_price}
              salePriceOverridden={salePriceOverridden}
              setSalePriceOverridden={setSalePriceOverridden}
              isPreCgt={isPreCgt}
            />
          )}
        </div>

        {/* Right column: results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'specific' && result.bucket && !result.error && (
            <>
              <TimelineStrip
                purchaseDate={mode2.purchase_date}
                saleDate={mode2.sale_date}
                isPreCgt={isPreCgt}
                bucket={result.bucket}
              />
              <div style={{
                fontSize: 12, fontStyle: 'italic', color: C.textSecondary,
                lineHeight: 1.5, padding: '0 4px', marginTop: -4,
              }}>
                {BUCKET_EXPLAINERS[result.bucket]}
              </div>
            </>
          )}

          {/* Headline sentence */}
          <div style={{
            fontFamily: FONT_HEAD, fontSize: 19, lineHeight: 1.4, fontStyle: 'italic',
            color: C.textPrimary, padding: '4px 0',
          }}>
            {result.error
              ? `Error: ${result.error}`
              : result.result === 'awaiting_value_2027'
                ? 'Enter a market value at 1 July 2027 in Asset details to model this pre-CGT asset.'
                : (result.headline || '')}
          </div>

          {!result.error && result.result !== 'awaiting_value_2027' && (
            <SummaryCards mode={mode} result={result} verdict={verdict} />
          )}

          {!result.error && result.result !== 'awaiting_value_2027' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={copySummary} style={pillButton(copied)}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy summary'}
              </button>
              <button onClick={copyLink} style={pillButton(false)}>
                <LinkIcon size={13} /> Copy link
              </button>
              <button onClick={() => setAssumptionsOpen(true)} style={pillButton(false)}>
                <Info size={13} /> Assumptions
              </button>
            </div>
          )}

          {!result.error && result.result !== 'awaiting_value_2027' && chartData.length > 0 && (
            <Card>
              <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>
                {[
                  { id: 'after_tax', label: 'After-tax proceeds' },
                  { id: 'effective_rate', label: 'Effective rate' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setChartTab(tab.id)}
                    style={{
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      padding: '8px 14px', fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY,
                      color: chartTab === tab.id ? C.textPrimary : C.textMuted,
                      borderBottom: chartTab === tab.id ? `2px solid ${C.teal}` : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.teal, fontStyle: 'italic', marginBottom: 8 }}>
                {chartTab === 'after_tax'
                  ? 'Best for showing the dollar impact of the regime change.'
                  : 'Best for understanding how the new rules tax real gains.'}
              </div>
              <MainChart data={chartData} tab={chartTab} xLabel={mode === 'old_vs_new' ? 'Holding period (years)' : 'Sale year'} />
              <DiffChart data={chartData} tab={chartTab} />
            </Card>
          )}

          {/* Asset-type-specific footnote */}
          {mode === 'specific' && (
            <AssetTypeFootnote assetType={mode2.asset_type} />
          )}

          <div style={{ fontSize: 11, color: C.textMuted, padding: '8px 4px', lineHeight: 1.5 }}>
            Illustrative model based on the May 2026 Budget announcement and industry analysis. Calculations are subject to final legislation.
          </div>
        </div>
      </div>

      {paramsOpen && <ParamsModal onClose={() => setParamsOpen(false)} />}
      {assumptionsOpen && !result.error && (
        <AssumptionsModal diagnostics={result.diagnostics || {}} onClose={() => setAssumptionsOpen(false)} />
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Asset type footnote — shown only for property/other in Mode 2
// ----------------------------------------------------------------------------

function AssetTypeFootnote({ assetType }) {
  if (assetType === 'shares' || assetType === 'crypto') return null;
  const notes = {
    property: 'Investment property: capital works deductions claimed (Div 43) reduce the cost base for CGT. New residential builds get a per-disposal election between old and new rules — both numbers are shown above; pick the lower at sale. Main residence exemption and stamp duty on a primary residence are not modelled.',
    other: 'Other assets (collectibles, business assets, units in unit trusts) follow the same CGT mechanics shown here. Specific rules may apply — small business CGT concessions, personal-use asset exemptions, and trust pass-through aren\'t modelled.',
  };
  const text = notes[assetType];
  if (!text) return null;
  return (
    <div style={{
      padding: 12, background: C.offWhite, border: `1px solid ${C.border}`,
      borderRadius: 8, fontSize: 11, color: C.textSecondary, lineHeight: 1.5,
    }}>
      {text}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components: inputs
// ----------------------------------------------------------------------------

const INCOME_SUPPORT_INFO = 'Recipients of means-tested income support payments (Age Pension, JobSeeker, Disability Support Pension, Parenting Payment, etc.) are exempt from the 30% minimum tax on capital gains. They pay their marginal rate on the gain — without the minimum top-up. This protects lower-income retirees who realise large gains in years when their marginal rate would otherwise be below 30%.';

function Mode1Inputs({ inputs, update }) {
  return (
    <Card>
      <CardHeader title="Scenario inputs" subtitle="Hypothetical asset under both regimes." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Label>Purchase price</Label>
          <NumberInput value={inputs.purchase_price} onChange={(v) => update({ purchase_price: v })} />
        </div>
        <div>
          <Label>Annual nominal return</Label>
          <Slider
            value={inputs.return_rate * 100}
            onChange={(v) => update({ return_rate: v / 100 })}
            min={0} max={15} step={0.1}
            format={(v) => `${v.toFixed(1)}%`}
          />
        </div>
        <div>
          <Label>Annual inflation</Label>
          <Slider
            value={inputs.inflation * 100}
            onChange={(v) => update({ inflation: v / 100 })}
            min={0} max={6} step={0.1}
            format={(v) => `${v.toFixed(1)}%`}
          />
        </div>
        <div>
          <Label>Holding period</Label>
          <Slider
            value={inputs.holding_years}
            onChange={(v) => update({ holding_years: v })}
            min={1} max={30} step={1}
            format={(v) => `${v} yr`}
          />
        </div>
        <div>
          <Label>Other taxable income at sale</Label>
          <NumberInput value={inputs.other_income} onChange={(v) => update({ other_income: v })} />
        </div>
        <div>
          <Label info={INCOME_SUPPORT_INFO} infoTitle="Income support recipient">
            Income support recipient
          </Label>
          <Toggle
            value={inputs.income_support_recipient}
            onChange={(v) => update({ income_support_recipient: v })}
            options={[{ value: false, label: 'No' }, { value: true, label: 'Yes' }]}
          />
        </div>
      </div>
    </Card>
  );
}

function Mode2Inputs({ inputs, update, effectiveSalePrice, salePriceOverridden, setSalePriceOverridden, isPreCgt }) {
  const purchase = new Date(inputs.purchase_date);
  const sale = new Date(inputs.sale_date);
  const needsValuation = purchase < LEG.newRulesStart && sale >= LEG.newRulesStart;
  const showValuationToggle = needsValuation && !isPreCgt;
  // Pre-CGT always uses entered value; otherwise honour the user choice
  const effectiveValuationMethod = isPreCgt ? 'use_entered_value' : inputs.valuation_method;
  const showValue2027 =
    needsValuation && (effectiveValuationMethod === 'use_entered_value' || isPreCgt);

  const assetTypeLabels = {
    purchase_price:
      inputs.asset_type === 'property' ? 'Purchase price' : 'Purchase price',
    acquisition_costs:
      inputs.asset_type === 'property'
        ? 'Stamp duty + legal fees'
        : 'Acquisition costs',
    capital_improvements:
      inputs.asset_type === 'property'
        ? 'Capital improvements (renovations, extensions)'
        : 'Capital improvements',
  };

  return (
    <>
      <Card>
        <CardHeader title="Asset details" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Label>Asset type</Label>
            <Select
              value={inputs.asset_type || 'shares'}
              onChange={(v) => update({ asset_type: v })}
              options={[
                { value: 'shares', label: 'Shares / managed funds' },
                { value: 'property', label: 'Investment property' },
                { value: 'crypto', label: 'Crypto / digital assets' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          <div>
            <Label>Purchase date</Label>
            <DateInput value={inputs.purchase_date} onChange={(v) => update({ purchase_date: v })} />
            {isPreCgt && (
              <div style={{ fontSize: 10, color: C.preCgt, marginTop: 4, fontWeight: 600 }}>
                Pre-CGT asset — enter the 1 July 2027 market value below.
              </div>
            )}
          </div>
          {isPreCgt && (
            <div>
              <Label info={PRE_CGT_VALUE_INFO} infoTitle="Market value at 1 July 2027">
                Market value at 1 July 2027 (estimate)
              </Label>
              <NumberInput value={inputs.value_2027} onChange={(v) => update({ value_2027: v })} />
            </div>
          )}
          {!isPreCgt && (
            <>
              <div>
                <Label>{assetTypeLabels.purchase_price}</Label>
                <NumberInput value={inputs.purchase_price} onChange={(v) => update({ purchase_price: v })} />
              </div>
              <div>
                <Label>{assetTypeLabels.acquisition_costs}</Label>
                <NumberInput value={inputs.acquisition_costs} onChange={(v) => update({ acquisition_costs: v })} />
              </div>
              <div>
                <Label>{assetTypeLabels.capital_improvements}</Label>
                <NumberInput value={inputs.capital_improvements} onChange={(v) => update({ capital_improvements: v })} />
              </div>
              {inputs.asset_type === 'property' && (
                <div>
                  <Label
                    info="Division 43 capital works deductions claimed over the holding period reduce the cost base for CGT purposes. If you've claimed $10,000 of building depreciation, enter $10,000 here. Don't include plant & equipment (Div 40) — that's separate and may not affect cost base if acquired after May 2017."
                    infoTitle="Capital works deductions"
                  >
                    Capital works deductions claimed
                  </Label>
                  <NumberInput value={inputs.depreciation_claimed} onChange={(v) => update({ depreciation_claimed: v })} />
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Sale assumptions" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Label>Sale date</Label>
            <DateInput value={inputs.sale_date} onChange={(v) => update({ sale_date: v })} />
          </div>
          <div>
            <Label>Annual growth assumption</Label>
            <Slider
              value={inputs.growth_rate * 100}
              onChange={(v) => update({ growth_rate: v / 100 })}
              min={0} max={15} step={0.1}
              format={(v) => `${v.toFixed(1)}%`}
            />
          </div>
          <div>
            <Label>Annual inflation</Label>
            <Slider
              value={inputs.inflation * 100}
              onChange={(v) => update({ inflation: v / 100 })}
              min={0} max={6} step={0.1}
              format={(v) => `${v.toFixed(1)}%`}
            />
          </div>
          <div>
            <Label>Sale price {salePriceOverridden ? '(overridden)' : '(derived)'}</Label>
            <NumberInput
              value={salePriceOverridden ? inputs.sale_price : effectiveSalePrice}
              onChange={(v) => {
                setSalePriceOverridden(true);
                update({ sale_price: v });
              }}
            />
            {salePriceOverridden && (
              <button
                onClick={() => { setSalePriceOverridden(false); update({ sale_price: 0 }); }}
                style={{
                  marginTop: 4, background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.teal, fontSize: 11, padding: 0,
                }}
              >
                Reset to derived
              </button>
            )}
          </div>
          <div>
            <Label>Sale costs</Label>
            <NumberInput value={inputs.sale_costs} onChange={(v) => update({ sale_costs: v })} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Tax position" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Label>Other taxable income at sale year</Label>
            <NumberInput value={inputs.other_income} onChange={(v) => update({ other_income: v })} />
          </div>
          <div>
            <Label info={INCOME_SUPPORT_INFO} infoTitle="Income support recipient">
              Income support recipient
            </Label>
            <Toggle
              value={inputs.income_support_recipient}
              onChange={(v) => update({ income_support_recipient: v })}
              options={[{ value: false, label: 'No' }, { value: true, label: 'Yes' }]}
            />
          </div>
          {showValuationToggle && (
            <div>
              <Label
                info="For an asset bought before 1 July 2027 and sold after, the value at 1 July 2027 splits the gain into pre and post portions. ATO formula estimates this using compound growth from purchase to sale. Use 'Enter value' if you have a real market valuation at that date."
                infoTitle="Valuation method"
              >
                Valuation at 1 July 2027
              </Label>
              <Toggle
                value={inputs.valuation_method}
                onChange={(v) => update({ valuation_method: v })}
                options={[
                  { value: 'ATO_formula', label: 'ATO formula' },
                  { value: 'use_entered_value', label: 'Enter value' },
                ]}
              />
            </div>
          )}
          {showValue2027 && !isPreCgt && (
            <div>
              <Label>Value at 1 July 2027</Label>
              <NumberInput value={inputs.value_2027} onChange={(v) => update({ value_2027: v })} />
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

// ----------------------------------------------------------------------------
// Summary cards
// ----------------------------------------------------------------------------

function SummaryCards({ mode, result, verdict }) {
  const toneStyles = {
    good: { bg: C.healthyBg, fg: C.healthyText, border: C.healthy },
    bad: { bg: C.riskBg, fg: C.riskText, border: C.risk },
    warn: { bg: C.warningBg, fg: C.warningText, border: C.warning },
    neutral: { bg: C.offWhite, fg: C.textSecondary, border: C.border },
  };
  const v = verdict ? toneStyles[verdict.tone] : toneStyles.neutral;

  let card1, card2, diff, card1Label, card2Label;
  if (mode === 'old_vs_new') {
    card1Label = 'Tax under old rules';
    card2Label = 'Tax under new rules';
    card1 = result.oldRules.taxOnGain;
    card2 = result.newRules.taxOnGain;
    diff = card2 - card1;
  } else {
    card1Label = 'After-tax proceeds (actual)';
    card2Label = 'After-tax (old rules counterfactual)';
    card1 = result.actual?.afterTaxProceeds || result.newRules?.afterTaxProceeds || 0;
    card2 = result.oldRules?.afterTaxProceeds || 0;
    diff = card1 - card2;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          {card1Label}
        </div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700, color: mode === 'old_vs_new' ? C.oldRules : C.textPrimary }}>
          {fmt(card1)}
        </div>
      </Card>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          {card2Label}
        </div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700, color: mode === 'old_vs_new' ? C.newRules : C.textPrimary }}>
          {fmt(card2)}
        </div>
      </Card>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          {mode === 'old_vs_new' ? 'Δ Tax' : 'Δ After-tax proceeds'}
        </div>
        <div style={{
          fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700,
          color: (mode === 'old_vs_new' ? diff > 0 : diff < 0) ? C.risk : C.healthy,
        }}>
          {diff >= 0 ? '+' : ''}{fmt(diff)}
        </div>
      </Card>
      <Card style={{ padding: 16, background: v.bg, borderColor: v.border }}>
        <div style={{ fontSize: 11, color: v.fg, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          Verdict
        </div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 18, fontWeight: 700, color: v.fg }}>
          {verdict?.label || '—'}
        </div>
        <div style={{ fontSize: 11, color: v.fg, marginTop: 4, opacity: 0.85 }}>
          {verdict?.desc || ''}
        </div>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Charts
// ----------------------------------------------------------------------------

function MainChart({ data, tab, xLabel }) {
  const isPct = tab === 'effective_rate';
  const keyOld = isPct ? 'oldRate' : 'old';
  const keyNew = isPct ? 'newRate' : 'new';

  let crossover = null;
  for (let i = 1; i < data.length; i++) {
    const a = data[i - 1][keyNew] - data[i - 1][keyOld];
    const b = data[i][keyNew] - data[i][keyOld];
    if (a * b < 0) {
      crossover = data[i].x;
      break;
    }
  }

  return (
    <div style={{ width: '100%', height: 420 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="xLabel"
            stroke={C.textSubtle}
            tick={{ fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted }}
            label={{ value: xLabel, position: 'insideBottom', fontSize: 11, fill: C.textMuted, dy: 14 }}
          />
          <YAxis
            stroke={C.textSubtle}
            tick={{ fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted }}
            domain={['dataMin', 'dataMax']}
            tickFormatter={isPct ? (v) => `${v.toFixed(0)}%` : fmtK}
            width={60}
          />
          <Tooltip content={<ChartTooltip suffix={isPct ? '%' : '$'} />} />
          <Legend verticalAlign="top" height={28} iconType="line" formatter={(value) => (
            <span style={{ fontSize: 11, color: C.textSecondary }}>{value}</span>
          )} />
          <Line type="monotone" dataKey={keyOld} stroke={C.oldRules} strokeWidth={2} dot={false} name="Old rules" />
          <Line type="monotone" dataKey={keyNew} stroke={C.newRules} strokeWidth={2} dot={false} name="New rules" />
          {crossover != null && (
            <ReferenceLine x={crossover} stroke={C.textSubtle} strokeDasharray="4 4" label={{ value: 'crossover', fontSize: 10, fill: C.textMuted, position: 'top' }} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DiffChart({ data, tab }) {
  const isPct = tab === 'effective_rate';
  const points = data.map((d) => {
    const diff = isPct ? d.newRate - d.oldRate : d.new - d.old;
    return {
      x: d.x,
      xLabel: d.xLabel,
      pos: diff >= 0 ? diff : 0,
      neg: diff < 0 ? diff : 0,
    };
  });
  return (
    <div style={{ width: '100%', height: 150, marginTop: 6 }}>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 0, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="xLabel"
            stroke={C.textSubtle}
            tick={{ fontSize: 10, fontFamily: FONT_MONO, fill: C.textMuted }}
          />
          <YAxis
            stroke={C.textSubtle}
            tick={{ fontSize: 10, fontFamily: FONT_MONO, fill: C.textMuted }}
            tickFormatter={isPct ? (v) => `${v.toFixed(0)}%` : fmtK}
            width={60}
          />
          <ReferenceLine y={0} stroke={C.textMuted} />
          <Tooltip
            formatter={(value) => isPct ? `${value.toFixed(1)}%` : fmt(value)}
            labelStyle={{ fontSize: 11, color: C.textMuted }}
            contentStyle={{ fontSize: 12, fontFamily: FONT_BODY, padding: 8, border: `1px solid ${C.border}`, borderRadius: 6 }}
          />
          <Area type="monotone" dataKey="pos" stroke={C.healthy} strokeWidth={1} fill={C.healthy} fillOpacity={0.25} isAnimationActive={false} activeDot={false} name="New better" />
          <Area type="monotone" dataKey="neg" stroke={C.risk} strokeWidth={1} fill={C.risk} fillOpacity={0.25} isAnimationActive={false} activeDot={false} name="New worse" />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 10, color: C.textMuted, marginTop: -2, paddingLeft: 6 }}>
        Difference (new − old). Above zero = new rules better, below zero = new rules costlier.
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Small bits
// ----------------------------------------------------------------------------

function pillButton(active) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: active ? C.healthyBg : C.white,
    border: `1px solid ${active ? C.healthy : C.border}`,
    color: active ? C.healthyText : C.textSecondary,
    padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
    fontSize: 12, fontFamily: FONT_BODY, fontWeight: 600,
  };
}
