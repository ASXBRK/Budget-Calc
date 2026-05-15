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
import { Copy, Link as LinkIcon, X, Settings, Info, Check, FileText } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { runCGTProjection, LEG } from './engine.js';
import { DEBUG_SCENARIOS, buildScenarioInputs } from './debugScenarios.js';

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

const BUCKET_EXPLAINERS_INCOME_SUPPORT = {
  A: 'Both purchase and sale are before 1 July 2027, so the old 50% discount applies to the whole gain.',
  B: 'Because you bought before 1 July 2027 and are selling after, the gain is split — the pre-2027 portion uses the old 50% discount, the post-2027 portion uses indexation only. As a Centrelink income support recipient, the 30% minimum tax floor does not apply.',
  C: 'Purchased after 1 July 2027, so the new rules apply to the whole gain. As a Centrelink income support recipient, the 30% minimum tax floor does not apply — only cost-base indexation, taxed at your marginal rate.',
  D: 'Pre-1985 asset. Gains accrued before 1 July 2027 remain exempt; the post-2027 portion is taxed under indexation only because as a Centrelink income support recipient the 30% minimum tax floor does not apply.',
};

function explainerForScenario(bucket, isPreCgt, incomeSupport) {
  if (isPreCgt && bucket === 'A') {
    return 'Pre-1985 asset sold before 1 July 2027 — exempt under existing CGT law. No tax under either regime.';
  }
  const table = incomeSupport ? BUCKET_EXPLAINERS_INCOME_SUPPORT : BUCKET_EXPLAINERS;
  return table[bucket] || '';
}

const PRE_CGT_VALUE_INFO = "Pre-1985 assets are exempt under existing CGT law. From 1 July 2027 the announced rules bring them into the CGT net; the standard transitional approach (and the assumption this tool makes) is a deemed market value cost base at 1 July 2027, so only gains accruing from that date are taxable. Treasury hasn't yet specified the cost base treatment, so flag this as illustrative when discussing with the client. A formal valuation isn't required for modelling — a reasonable estimate is fine.";

const INCOME_SUPPORT_INFO = 'Affects the new-rules calculation only: removes the 30% minimum tax floor on the gain. Per the 2026 Budget, recipients of Centrelink income support (Age Pension, JobSeeker, Disability Support Pension, Parenting Payment, etc.) pay their marginal rate without the minimum top-up. This only changes the outcome when the marginal rate on the gain would otherwise be below 30% — for clients whose income places them at or above the 30% bracket, toggling Yes has no visible effect.';

const VALUATION_INFO = "For an asset bought before 1 July 2027 and sold after, the value at 1 July 2027 splits the gain into pre and post portions. ATO formula estimates this using compound growth from purchase to sale. Use 'Enter value' if you have a real market valuation at that date.";

const CAPITAL_WORKS_INFO = "Division 43 capital works deductions claimed over the holding period reduce the cost base for CGT purposes. If you've claimed $10,000 of building depreciation, enter $10,000 here. Don't include plant & equipment (Div 40) — that's separate and may not affect cost base if acquired after May 2017.";

const HIDE_SPINNERS = `
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; appearance: textfield; }
  .slider-track { -webkit-appearance: none; appearance: none; height: 4px; background: ${C.border}; border-radius: 2px; outline: none; }
  .slider-track::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid ${C.white}; box-sizing: border-box; }
  .slider-track::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid ${C.white}; }
`;

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

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
  asset_type: 'at',
  purchase_date: 'pd',
  purchase_price: 'pp',
  acquisition_costs: 'ac',
  capital_improvements: 'ci',
  depreciation_claimed: 'dep',
  sale_costs: 'sc',
  return_rate: 'rr',
  inflation: 'inf',
  other_income: 'oi',
  income_support_recipient: 'is',
  value_2027: 'v27',
  valuation_method: 'vm',
  focus_years: 'fy',
};
const REVERSE_KEY_MAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);
const STRING_KEYS = new Set([
  'asset_type', 'valuation_method', 'purchase_date',
]);
const BOOLEAN_KEYS = new Set(['income_support_recipient']);

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
    if (BOOLEAN_KEYS.has(longKey)) {
      out[longKey] = value === '1';
    } else if (STRING_KEYS.has(longKey)) {
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
// Timeline strip
// ----------------------------------------------------------------------------

function TimelineStrip({ purchaseDate, saleDate, isPreCgt, bucket, incomeSupport }) {
  const pdate = purchaseDate ? new Date(purchaseDate) : null;
  const sdate = saleDate ? new Date(saleDate) : null;
  if (!pdate || !sdate) return null;

  const isSplit = bucket === 'B' || bucket === 'D';
  // Income-support recipients are exempt from the 30% minimum tax floor.
  const newRulesLabel = incomeSupport ? 'Indexation' : 'Indexation + 30% min';
  const newRulesLabelFromValue =
    incomeSupport
      ? 'Indexation from market value at 1 July 2027'
      : 'Indexation + 30% min from market value at 1 July 2027';

  let leftLabel, leftColor, rightLabel, rightColor, singleLabel, singleColor;
  if (isSplit) {
    if (bucket === 'B') {
      leftLabel = '50% discount';
      leftColor = C.teal;
      rightLabel = newRulesLabel;
      rightColor = C.newRules;
    } else {
      leftLabel = 'Pre-CGT exempt';
      leftColor = C.preCgt;
      rightLabel = newRulesLabelFromValue;
      rightColor = C.newRules;
    }
  } else if (bucket === 'A') {
    singleLabel = isPreCgt ? 'Pre-CGT exempt' : '50% discount';
    singleColor = isPreCgt ? C.preCgt : C.teal;
  } else {
    singleLabel = newRulesLabel;
    singleColor = C.newRules;
  }

  const bucketDesc = LEG.buckets[bucket]?.split(' — ')[1] || '';

  const segStyle = (color, radius) => ({
    position: 'absolute', top: 0, bottom: 0,
    background: color, borderRadius: radius,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: C.white, fontSize: 11, fontWeight: 600, fontFamily: FONT_BODY,
    overflow: 'hidden', padding: '0 8px', textAlign: 'center', lineHeight: 1.2,
  });

  return (
    <Card style={{ padding: 16 }}>
      <div style={{
        fontSize: 10, color: C.textMuted, fontFamily: FONT_MONO,
        marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        {bucketDesc}
      </div>

      {/* Boundary date label above the bar — split scenarios only */}
      {isSplit && (
        <div style={{ position: 'relative', height: 14, marginBottom: 2 }}>
          <div style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            fontSize: 10, fontFamily: FONT_MONO, fontWeight: 600,
            color: C.textPrimary, whiteSpace: 'nowrap',
          }}>
            1 Jul 2027 ↓
          </div>
        </div>
      )}

      {/* Bar */}
      <div style={{
        position: 'relative', height: 44, background: C.offWhite,
        borderRadius: 4, border: `1px solid ${C.border}`,
      }}>
        {isSplit ? (
          <>
            <div style={{ ...segStyle(leftColor, '3px 0 0 3px'), left: 0, width: '50%' }}>
              {leftLabel}
            </div>
            <div style={{ ...segStyle(rightColor, '0 3px 3px 0'), left: '50%', width: '50%' }}>
              {rightLabel}
            </div>
            <div style={{
              position: 'absolute', top: -4, bottom: -4, left: '50%',
              borderLeft: `1px dashed ${C.dark}`,
            }} />
          </>
        ) : (
          <div style={{ ...segStyle(singleColor, '3px'), left: 0, right: 0 }}>
            {singleLabel}
          </div>
        )}
      </div>

      {/* End-date labels — anchored to bar edges */}
      <div style={{ position: 'relative', height: 14, marginTop: 6 }}>
        <div style={{
          position: 'absolute', left: 0,
          fontSize: 10, fontFamily: FONT_MONO, color: C.textSecondary, whiteSpace: 'nowrap',
        }}>
          Bought {fmtDate(pdate)}
        </div>
        <div style={{
          position: 'absolute', right: 0,
          fontSize: 10, fontFamily: FONT_MONO, color: C.textSecondary, whiteSpace: 'nowrap',
        }}>
          Sold {fmtDate(sdate)}
        </div>
      </div>

    </Card>
  );
}

// ----------------------------------------------------------------------------
// Tooltips
// ----------------------------------------------------------------------------

function ChartTooltip({ active, payload, label, suffix }) {
  if (!active || !payload || !payload.length) return null;
  const old = payload.find((p) => p.dataKey === 'old' || p.dataKey === 'oldRate')?.value;
  const nw = payload.find((p) => p.dataKey === 'new' || p.dataKey === 'newRate')?.value;
  const diff = (nw ?? 0) - (old ?? 0);
  const isPct = suffix === '%';
  // On the after-tax chart, higher new = taxpayer keeps more = GOOD (green).
  // On the effective-rate chart, higher new = taxpayer pays more = BAD (red).
  const epsilon = isPct ? 0.001 : 0.5;
  const newIsBetter = isPct ? diff < -epsilon : diff > epsilon;
  const newIsWorse = isPct ? diff > epsilon : diff < -epsilon;
  const diffColor = newIsBetter ? C.healthy : newIsWorse ? C.risk : C.textMuted;
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
        <span style={{ color: C.textMuted }}>Difference</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: diffColor }}>
          {isPct ? `${diff.toFixed(1)}%` : fmt(diff)}
        </span>
      </div>
    </div>
  );
}

function DiffTooltip({ active, payload, label, isPct }) {
  if (!active || !payload || !payload.length) return null;
  const pos = payload.find((p) => p.dataKey === 'pos')?.value || 0;
  const neg = payload.find((p) => p.dataKey === 'neg')?.value || 0;
  const diff = pos + neg;
  const epsilon = isPct ? 0.001 : 0.5;
  // After-tax: higher new = taxpayer keeps more = BETTER.
  // Effective rate: higher new = taxpayer pays more = WORSE.
  const newIsBetter = isPct ? diff < -epsilon : diff > epsilon;
  const newIsWorse = isPct ? diff > epsilon : diff < -epsilon;
  let labelText, color;
  if (newIsBetter) {
    labelText = 'New better';
    color = C.healthy;
  } else if (newIsWorse) {
    labelText = 'New worse';
    color = C.risk;
  } else {
    labelText = 'Same';
    color = C.textMuted;
  }
  const valueText = isPct
    ? `${Math.abs(diff).toFixed(1)}%`
    : fmt(Math.abs(diff));
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 10, fontSize: 12, fontFamily: FONT_BODY, minWidth: 160,
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color }}>{labelText}</span>
        <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color }}>{valueText}</span>
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
    ['Super fund discount', fmtPct(LEG.superDiscountRate, 1) + ' (not modelled)'],
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
    { key: 'A', desc: 'Bought & sold before 1 Jul 2027', pre: 100, post: 0, preColor: C.teal },
    { key: 'B', desc: 'Bought before, sold after', pre: 60, post: 40, preColor: C.teal },
    { key: 'C', desc: 'Bought after 1 Jul 2027', pre: 0, post: 100, preColor: C.teal },
    { key: 'D', desc: 'Pre-1985 asset, sold after', pre: 60, post: 40, preColor: C.preCgt },
  ];
  return (
    <div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
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
      label: 'Pre-2027 vs post-2027 tax allocation (split treatment)',
      text: 'Marginal tax across both portions is split pro-rata by their taxable amounts. Treasury hasn\'t yet specified stacking order. If they require strict sequential stacking, results could shift by a few percent in close cases.',
    },
    {
      label: 'Medicare levy',
      text: 'Calculated using the proper shading-in formula for resident singles (nothing under $28,011, 10% phase-in to $35,014, then 2%). For clients well above the threshold this is effectively 2% × gain. For low-income clients it\'s correctly lower.',
    },
    {
      label: 'Pre-1985 (pre-CGT) assets',
      text: "Pre-CGT assets remain exempt under existing CGT law indefinitely (old-rules counterfactual = 0% across all years). The Budget announces these assets are brought into the new regime from 1 July 2027 onwards. Treasury hasn't yet specified the cost base treatment; this tool assumes a deemed market value reset at 1 July 2027, so only gains accruing from that date are taxable under indexation + 30% min. Final mechanics may differ.",
    },
    {
      label: 'Capital losses',
      text: 'Not modelled. Losses carry forward against future gains under both regimes, but the tool currently shows gain scenarios only.',
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

const today = new Date();
const DEFAULT_INPUTS = {
  asset_type: 'shares',
  purchase_date: today.toISOString().slice(0, 10),
  purchase_price: 100000,
  acquisition_costs: 500,
  capital_improvements: 0,
  depreciation_claimed: 0,
  sale_costs: 0,
  return_rate: 0.06,
  inflation: 0.025,
  other_income: 100000,
  income_support_recipient: false,
  value_2027: 0,
  valuation_method: 'ATO_formula',
  focus_years: 10,
};

const SALE_YEAR_SPAN = 25;

function buildCostBase(inputs, isPreCgt) {
  if (isPreCgt) return 0;
  const dep = inputs.asset_type === 'property' ? (inputs.depreciation_claimed || 0) : 0;
  return (inputs.purchase_price || 0) +
    (inputs.acquisition_costs || 0) +
    (inputs.capital_improvements || 0) -
    dep;
}

function derivedSalePrice({ inputs, isPreCgt, saleDate, costBase, yearsFromPurchase }) {
  if (isPreCgt) {
    const yearsPost = Math.max((saleDate - new Date(LEG.newRulesStart)) / MS_PER_YEAR, 0);
    return (inputs.value_2027 || 0) * Math.pow(1 + inputs.return_rate, yearsPost);
  }
  return costBase * Math.pow(1 + inputs.return_rate, yearsFromPurchase);
}

export default function App() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [chartTab, setChartTab] = useState('after_tax');
  const [paramsOpen, setParamsOpen] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfState, setPdfState] = useState('idle'); // 'idle' | 'rendering' | 'capturing'
  const pdfRef = useRef(null);
  const [debugVisible, setDebugVisible] = useState(() => {
    try { return localStorage.getItem('cgtDebugVisible') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('cgtDebugVisible', debugVisible ? '1' : '0'); } catch {}
  }, [debugVisible]);

  useEffect(() => {
    const decoded = decodeState(window.location.search);
    if (Object.keys(decoded).length > 0) {
      setInputs((s) => ({ ...s, ...decoded }));
    }
  }, []);

  useEffect(() => {
    const qs = encodeState(inputs);
    const url = `${window.location.pathname}?${qs}`;
    window.history.replaceState(null, '', url);
  }, [inputs]);

  const update = useCallback((patch) => setInputs((s) => ({ ...s, ...patch })), []);

  const isPreCgt = useMemo(() => {
    if (!inputs.purchase_date) return false;
    return new Date(inputs.purchase_date) < LEG.preCgtCutoff;
  }, [inputs.purchase_date]);

  const costBase = useMemo(
    () => buildCostBase(inputs, isPreCgt),
    [inputs, isPreCgt]
  );

  // Focus scenario: sale = purchase + focus_years
  const focusScenario = useMemo(() => {
    const pd = new Date(inputs.purchase_date);
    const sale = new Date(pd);
    sale.setFullYear(pd.getFullYear() + Math.round(inputs.focus_years));
    const sp = derivedSalePrice({
      inputs,
      isPreCgt,
      saleDate: sale,
      costBase,
      yearsFromPurchase: inputs.focus_years,
    });
    return {
      ...inputs,
      mode: 'specific',
      sale_date: sale.toISOString().slice(0, 10),
      sale_price: Math.round(sp),
    };
  }, [inputs, isPreCgt, costBase]);

  const result = useMemo(() => {
    try {
      return runCGTProjection(focusScenario);
    } catch (e) {
      return { error: e.message };
    }
  }, [focusScenario]);

  const chartData = useMemo(() => {
    if (result.error) return [];
    const pd = new Date(inputs.purchase_date);
    const points = [];

    const buildPoint = (saleDate, years, xValue, xLabel) => {
      const sp = derivedSalePrice({
        inputs,
        isPreCgt,
        saleDate,
        costBase,
        yearsFromPurchase: years,
      });
      try {
        const r = runCGTProjection({
          ...inputs,
          mode: 'specific',
          sale_date: saleDate.toISOString().slice(0, 10),
          sale_price: Math.round(sp),
        });
        return {
          x: xValue,
          xLabel,
          old: r.oldRules?.afterTaxProceeds ?? 0,
          new: r.actual?.afterTaxProceeds ?? 0,
          oldRate: (r.oldRules?.effectiveRate ?? 0) * 100,
          newRate: (r.actual?.effectiveRate ?? 0) * 100,
        };
      } catch {
        return null;
      }
    };

    const startYear = pd.getFullYear() + 1;
    const endYear = pd.getFullYear() + Math.max(1, Math.round(inputs.focus_years));
    for (let y = startYear; y <= endYear; y++) {
      const sale = new Date(`${y}-06-30T00:00:00+10:00`);
      const years = Math.max((sale - pd) / MS_PER_YEAR, 0);
      const p = buildPoint(sale, years, y, y);
      if (p) points.push(p);
    }
    return points;
  }, [inputs, costBase, isPreCgt, result.error]);

  const verdict = useMemo(() => {
    if (result.error) return null;
    const oldVal = result.oldRules?.afterTaxProceeds ?? 0;
    const newVal = result.actual?.afterTaxProceeds ?? 0;
    const diff = newVal - oldVal;
    const pct = oldVal > 0 ? Math.abs(diff) / oldVal : 0;
    if (result.bucket === 'A' && !isPreCgt) {
      return { tone: 'neutral', label: 'Pre-2027 sale', desc: 'Old rules apply.' };
    }
    if (result.bucket === 'D') {
      return { tone: 'good', label: 'Pre-CGT exempt', desc: 'Pre-2027 gains exempt.' };
    }
    if (isPreCgt && result.bucket === 'A') {
      return { tone: 'good', label: 'Pre-CGT exempt', desc: 'Exempt under both regimes.' };
    }
    if (pct < 0.05) return { tone: 'warn', label: 'Within 5%', desc: 'Broadly equivalent outcome.' };
    if (diff > 0) return { tone: 'good', label: 'New rules cheaper', desc: 'New regime preserves more after-tax value.' };
    return { tone: 'bad', label: 'New rules costlier', desc: 'New regime costs more.' };
  }, [result, isPreCgt]);

  const copySummary = useCallback(() => {
    const r = result;
    if (r.error || r.result === 'awaiting_value_2027') return;
    const lines = [];
    lines.push(`CGT Estimate — ${fmtDate(new Date())}`);
    lines.push(`Asset type: ${inputs.asset_type}`);
    lines.push(`Purchase: ${fmt(inputs.purchase_price)} on ${fmtDate(inputs.purchase_date)}`);
    lines.push(`Sale: ${fmt(focusScenario.sale_price)} on ${fmtDate(focusScenario.sale_date)} (${inputs.focus_years}y holding)`);
    lines.push(`Treatment: ${LEG.buckets[r.bucket]?.split(' — ')[1] || ''}`);
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
    lines.push('');
    lines.push('— Generated by CGT Reform Calc. Illustrative only. Subject to final legislation.');
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [result, inputs, focusScenario]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const exportPdf = useCallback(async () => {
    if (pdfState !== 'idle') return;
    setPdfState('rendering');
    // Let the offscreen report mount + charts measure + fonts settle.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch {}
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 800));
    setPdfState('capturing');
    try {
      const node = pdfRef.current;
      if (!node) throw new Error('Report container missing');
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      // Scale to fit the page in both dimensions so the report is always
      // exactly one page, even if content slightly overflows the A4 height.
      const scaleW = pageWidth / canvas.width;
      const scaleH = pageHeight / canvas.height;
      const scale = Math.min(scaleW, scaleH);
      const renderedWidth = canvas.width * scale;
      const renderedHeight = canvas.height * scale;
      const xOffset = (pageWidth - renderedWidth) / 2;
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        xOffset, 0,
        renderedWidth,
        renderedHeight
      );
      const dateStr = new Date().toISOString().slice(0, 10);
      pdf.save(`CGT-Impact-${dateStr}.pdf`);
    } catch (e) {
      console.error('PDF export failed', e); // eslint-disable-line no-console
    } finally {
      setPdfState('idle');
    }
  }, [pdfState]);

  const awaitingValue = result.result === 'awaiting_value_2027';
  const showResults = !result.error && !awaitingValue;

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
        <Card style={{ padding: 22 }}>
          <div style={{ fontSize: 15, color: C.textSecondary, lineHeight: 1.7 }}>
            <p style={{ margin: 0 }}>
              The May 2026 Federal Budget proposes replacing the 50% CGT discount with cost-base indexation plus a 30% minimum tax on real gains, for CGT events on or after 1 July 2027. This tool models the impact for a single asset across different sale years. Calculations follow the Budget paper and published industry analysis.
            </p>
            <p style={{ margin: '12px 0 0' }}>
              The announcement is a high-level policy outline, not draft legislation. The final law could differ materially from what is modelled here. Areas that remain unsettled include the mechanics of cost base indexation, the treatment of pre-CGT assets, how the 30% minimum tax floor interacts with capital losses, transitional rules for assets held across the 1 July 2027 commencement date, and the scope of the testamentary trust carve-out. Treasury consultation is expected through late 2026 and 2027, with draft legislation likely in 2027.
            </p>
            <p style={{ margin: '12px 0 0' }}>
              This tool is for illustration and education only. It is not financial, tax, or investment advice and should not be relied upon for any decision about acquiring, holding, or disposing of an asset.
            </p>
          </div>
          <div style={{
            fontSize: 12, color: C.textSecondary, lineHeight: 1.5,
            borderLeft: `3px solid ${C.teal}`,
            background: C.offWhite,
            padding: '8px 12px', marginTop: 14,
          }}>
            <strong style={{ color: C.textPrimary }}>Scope:</strong> Models individual taxpayers only. SMSF, trust, and company treatment not included.
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
          <UnifiedInputs inputs={inputs} update={update} isPreCgt={isPreCgt} />
        </div>

        {/* Right column: results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {showResults && result.bucket && (
            <>
              <TimelineStrip
                purchaseDate={inputs.purchase_date}
                saleDate={focusScenario.sale_date}
                isPreCgt={isPreCgt}
                bucket={result.bucket}
                incomeSupport={inputs.income_support_recipient}
              />
              <div style={{
                fontSize: 12, fontStyle: 'italic', color: C.textSecondary,
                lineHeight: 1.5, padding: '0 4px', marginTop: -4,
              }}>
                {explainerForScenario(result.bucket, isPreCgt, inputs.income_support_recipient)}
              </div>
            </>
          )}

          <div style={{
            fontFamily: FONT_HEAD, fontSize: 19, lineHeight: 1.4, fontStyle: 'italic',
            color: C.textPrimary, padding: '4px 0',
          }}>
            {result.error
              ? `Error: ${result.error}`
              : awaitingValue
                ? 'Enter a market value at 1 July 2027 in Asset details to model this pre-CGT asset.'
                : (result.headline || '')}
          </div>

          {showResults && (
            <SummaryCards result={result} verdict={verdict} />
          )}

          {showResults && (
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
              <button
                onClick={exportPdf}
                disabled={pdfState !== 'idle'}
                style={{ ...pillButton(false), opacity: pdfState !== 'idle' ? 0.6 : 1, cursor: pdfState !== 'idle' ? 'wait' : 'pointer' }}
              >
                <FileText size={13} /> {pdfState === 'idle' ? 'Export PDF' : pdfState === 'rendering' ? 'Preparing…' : 'Generating…'}
              </button>
            </div>
          )}

          {showResults && chartData.length > 0 && (
            <Card>
              {/* Chart header: tabs only — x-axis is always sale year */}
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
              <MainChart
                data={chartData}
                tab={chartTab}
                xLabel="Sale year"
              />

              {chartTab === 'effective_rate' && (
                <div style={{
                  fontSize: 11, color: C.textMuted, lineHeight: 1.5,
                  padding: '8px 4px 0',
                }}>
                  The 30% minimum tax applies to the real (post-indexation) gain. The effective rate shown is tax as a percentage of <em>nominal</em> gain — it can fall below 30% when indexation reduces the taxable gain, or when split-treatment rules apply (gains accrued before 1 July 2027 are not subject to the floor).
                </div>
              )}

              <div style={{ height: 48 }} />

              <div style={{
                fontFamily: FONT_HEAD, fontSize: 14, fontWeight: 700,
                color: C.textPrimary, marginBottom: 4,
              }}>
                Difference: New rules vs Old rules
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>
                {chartTab === 'after_tax'
                  ? 'Difference in after-tax proceeds (new − old) across sale years. Above zero = new rules better; below zero = new rules costlier.'
                  : 'Difference in effective rate (new − old) across sale years. Above zero = new rules costlier; below zero = new rules better.'}
              </div>
              <DiffChart data={chartData} tab={chartTab} xLabel="Sale year" />
            </Card>
          )}

          {showResults && <AssetTypeFootnote assetType={inputs.asset_type} />}

          <div style={{ fontSize: 11, color: C.textMuted, padding: '8px 4px', lineHeight: 1.5 }}>
            Illustrative model based on the May 2026 Budget announcement and industry analysis. Calculations are subject to final legislation.
          </div>
        </div>
      </div>

      {/* Debug scenarios — engine verification, not in PDF export */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 20px 24px' }}>
        <button
          onClick={() => setDebugVisible((v) => !v)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.textSubtle, fontSize: 11, fontFamily: FONT_BODY,
            padding: '6px 0', textDecoration: 'underline dotted', textUnderlineOffset: 3,
          }}
        >
          {debugVisible ? 'Hide debug scenarios' : 'Show debug scenarios'}
        </button>
        {debugVisible && <DebugTable />}
      </div>

      {paramsOpen && <ParamsModal onClose={() => setParamsOpen(false)} />}
      {assumptionsOpen && showResults && (
        <AssumptionsModal diagnostics={result.diagnostics || {}} onClose={() => setAssumptionsOpen(false)} />
      )}

      {/* Offscreen PDF report — rendered only when an export is in progress
          so it doesn't double-mount Recharts on every keystroke. */}
      {pdfState !== 'idle' && showResults && (
        <div
          aria-hidden
          style={{
            position: 'fixed', left: -10000, top: 0,
            width: 794, // A4 width at 96 DPI
            background: C.white,
          }}
        >
          <div ref={pdfRef} style={{ padding: 32, background: C.white, fontFamily: FONT_BODY, color: C.textPrimary }}>
            <PdfReport
              inputs={inputs}
              focusScenario={focusScenario}
              result={result}
              chartData={chartData}
              isPreCgt={isPreCgt}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Unified input panel
// ----------------------------------------------------------------------------

function UnifiedInputs({ inputs, update, isPreCgt }) {
  const purchase = new Date(inputs.purchase_date);
  // Valuation toggle relevant if non-pre-CGT and purchase straddles 1 Jul 2027
  // for at least one chart point — i.e. purchase < cutoff (chart extends 25y forward).
  const showValuationToggle = !isPreCgt && purchase < LEG.newRulesStart;
  const showValue2027ManualInput = showValuationToggle && inputs.valuation_method === 'use_entered_value';
  const isProperty = inputs.asset_type === 'property';
  const purchaseYear = purchase.getFullYear();

  const acqLabel = isProperty ? 'Stamp duty + legal fees' : 'Acquisition costs';
  const improvementsLabel = isProperty
    ? 'Capital improvements (renovations, extensions)'
    : 'Capital improvements';

  return (
    <>
      <Card>
        <CardHeader title="Asset details" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Label>Asset type</Label>
            <Select
              value={inputs.asset_type}
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
                <Label>Purchase price</Label>
                <NumberInput value={inputs.purchase_price} onChange={(v) => update({ purchase_price: v })} />
              </div>
              {isProperty && (
                <>
                  <div>
                    <Label>{acqLabel}</Label>
                    <NumberInput value={inputs.acquisition_costs} onChange={(v) => update({ acquisition_costs: v })} />
                  </div>
                  <div>
                    <Label>{improvementsLabel}</Label>
                    <NumberInput value={inputs.capital_improvements} onChange={(v) => update({ capital_improvements: v })} />
                  </div>
                  <div>
                    <Label info={CAPITAL_WORKS_INFO} infoTitle="Capital works deductions">
                      Capital works deductions claimed
                    </Label>
                    <NumberInput value={inputs.depreciation_claimed} onChange={(v) => update({ depreciation_claimed: v })} />
                  </div>
                  <div>
                    <Label>Sale costs (agent, conveyancing)</Label>
                    <NumberInput value={inputs.sale_costs} onChange={(v) => update({ sale_costs: v })} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Sale year" subtitle="Sets the chart's right edge — chart scales to fit." />
        <div>
          <Label>Sale year</Label>
          <Slider
            value={inputs.focus_years}
            onChange={(v) => update({ focus_years: v })}
            min={1}
            max={SALE_YEAR_SPAN}
            step={1}
            format={(v) => `${purchaseYear + v} · ${v}y`}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Returns" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label>Annual return rate</Label>
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
        </div>
      </Card>

      <Card>
        <CardHeader title="Tax position" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Label>Other taxable income (drives marginal rate)</Label>
            <NumberInput value={inputs.other_income} onChange={(v) => update({ other_income: v })} />
          </div>
          <div>
            <Label info={INCOME_SUPPORT_INFO} infoTitle="Centrelink income support">
              Centrelink income support recipient
            </Label>
            <Toggle
              value={inputs.income_support_recipient}
              onChange={(v) => update({ income_support_recipient: v })}
              options={[{ value: false, label: 'No' }, { value: true, label: 'Yes' }]}
            />
          </div>
          {showValuationToggle && (
            <div>
              <Label info={VALUATION_INFO} infoTitle="Valuation method">
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
          {showValue2027ManualInput && (
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
// PDF report — offscreen, captured by html2canvas
// ----------------------------------------------------------------------------

function PdfReport({ inputs, focusScenario, result, chartData, isPreCgt }) {
  const today = new Date();
  const todayStr = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(today);

  const assetTypeLabels = {
    shares: 'Shares / managed funds',
    property: 'Investment property',
    crypto: 'Crypto / digital assets',
    other: 'Other',
  };

  const oldAfter = result.oldRules?.afterTaxProceeds ?? 0;
  const newAfter = result.actual?.afterTaxProceeds ?? 0;
  const diffAfter = newAfter - oldAfter;
  const saleDateStr = fmtDate(focusScenario.sale_date);

  const otherIncome = inputs.other_income || 0;
  const fy = '2027-28';
  const mtrBrackets = LEG.brackets[fy];
  let mtr = 0;
  for (const [floor, ceiling, rate] of mtrBrackets) {
    if (otherIncome >= floor && otherIncome < ceiling) { mtr = rate; break; }
  }

  const summaryRows = [
    ['Asset type', assetTypeLabels[inputs.asset_type] || inputs.asset_type],
    ['Purchase date', fmtDate(inputs.purchase_date)],
    ['Sale date', saleDateStr],
    ...(isPreCgt
      ? [['Pre-CGT asset', 'Yes (acquired before 20 Sep 1985)'],
         ['Market value at 1 July 2027', fmt(inputs.value_2027)]]
      : [['Purchase price (cost base)', fmt(inputs.purchase_price)]]),
    ...(!isPreCgt && inputs.asset_type === 'property'
      ? [
          ['Acquisition costs (stamp duty, legal)', fmt(inputs.acquisition_costs)],
          ['Capital improvements', fmt(inputs.capital_improvements)],
          ['Capital works deductions claimed', fmt(inputs.depreciation_claimed)],
          ['Sale costs', fmt(inputs.sale_costs)],
        ]
      : []),
    ['Annual return rate', fmtPct(inputs.return_rate, 1)],
    ['Annual inflation', fmtPct(inputs.inflation, 1)],
    ['Other taxable income', `${fmt(otherIncome)} (marginal rate ${fmtPct(mtr, 0)})`],
    ['Centrelink income support recipient', inputs.income_support_recipient ? 'Yes' : 'No'],
  ];

  let headline;
  if (isPreCgt && result.bucket === 'A') {
    headline = `This pre-1985 asset sold on ${saleDateStr} is exempt under existing CGT law. No tax payable under either regime.`;
  } else {
    headline = `Under existing CGT rules, this asset produces approximately ${fmt(oldAfter)} after tax when sold on ${saleDateStr}. Under the announced new rules, the same sale produces approximately ${fmt(newAfter)} after tax — a difference of ${fmt(Math.abs(diffAfter))} ${diffAfter >= 0 ? 'in favour of the new rules' : 'against the new rules'}.`;
  }

  const explainer = explainerForScenario(result.bucket, isPreCgt, inputs.income_support_recipient);

  const assumptions = [
    ['Transition split', "Pre-2027 portion uses the 50% discount; post-2027 portion uses indexation + 30% minimum (or indexation only for Centrelink income support recipients). Treasury's worked-example compound CAGR is used to estimate the 1 July 2027 value when no explicit valuation is entered."],
    ['Indexation', 'Annual compounding using the user-specified inflation rate. Treasury hasn\'t specified the final mechanic; quarterly CPI was used historically (1985–1999) but is not viable for future modelling.'],
    ['30% minimum tax', 'Applied as max(marginal rate on real gain, 30% × real gain). Centrelink income support recipients are exempt from the floor.'],
    ['Pre-CGT (pre-1985) treatment', "Exempt under existing CGT law indefinitely. The Budget brings these assets into the new regime from 1 July 2027 onwards. This tool assumes a deemed market-value cost base at 1 July 2027; Treasury hasn't specified the final cost base treatment."],
    ['Medicare levy', 'Resident-singles shading-in: nothing under $28,011, 10% phase-in to $35,014, then 2%.'],
    ['Out of scope', 'Capital losses, SMSF, trusts, companies, and foreign residents are not modelled.'],
  ];

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        paddingBottom: 10, borderBottom: `2px solid ${C.teal}`,
      }}>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 22, fontWeight: 700, color: C.textPrimary }}>
          CGT Reform Impact Analysis
        </div>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          Generated {todayStr}
        </div>
      </div>

      {/* Scenario summary */}
      <div style={{ marginTop: 16 }}>
        <div style={pdfSectionTitle}>Scenario</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            {summaryRows.map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '4px 0', color: C.textSecondary, width: '55%' }}>{k}</td>
                <td style={{ padding: '4px 0', fontFamily: FONT_MONO, textAlign: 'right' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Headline */}
      <div style={{ marginTop: 14 }}>
        <div style={pdfSectionTitle}>Headline result at {saleDateStr}</div>
        <div style={{ fontSize: 12.5, color: C.textPrimary, lineHeight: 1.55 }}>
          {headline}
        </div>
      </div>

      {/* Effective rate chart */}
      <div style={{ marginTop: 10 }}>
        <div style={pdfSectionTitle}>Effective rate</div>
        <div style={{ width: 700 }}>
          <MainChart data={chartData} tab="effective_rate" xLabel="Sale year" height={220} />
        </div>
      </div>

      {/* After-tax proceeds chart */}
      <div style={{ marginTop: 8 }}>
        <div style={pdfSectionTitle}>After-tax proceeds</div>
        <div style={{ width: 700 }}>
          <MainChart data={chartData} tab="after_tax" xLabel="Sale year" height={220} />
        </div>
      </div>

      {/* Treatment bar */}
      <div style={{ marginTop: 14 }}>
        <div style={pdfSectionTitle}>Treatment</div>
        <TimelineStrip
          purchaseDate={inputs.purchase_date}
          saleDate={focusScenario.sale_date}
          isPreCgt={isPreCgt}
          bucket={result.bucket}
          incomeSupport={inputs.income_support_recipient}
        />
        <div style={{ fontSize: 11, color: C.textSecondary, fontStyle: 'italic', marginTop: 4 }}>
          {explainer}
        </div>
      </div>

      {/* Assumptions + disclaimer */}
      <div style={{ marginTop: 14, fontSize: 9.5, color: C.textSecondary, lineHeight: 1.5 }}>
        <div style={pdfSectionTitle}>Assumptions</div>
        {assumptions.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 4 }}>
            <strong style={{ color: C.textPrimary }}>{k}.</strong> {v}
          </div>
        ))}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, fontStyle: 'italic' }}>
          The May 2026 Federal Budget announcement is a high-level policy outline, not draft legislation. Final law may differ materially from what is modelled here. This report is for illustration and education only — it is not financial, tax, or investment advice and should not be relied upon for any decision about acquiring, holding, or disposing of an asset.
        </div>
        <div style={{ marginTop: 6, color: C.textMuted }}>
          Generated by CGT Reform Calc on {todayStr}.
        </div>
      </div>
    </div>
  );
}

const pdfSectionTitle = {
  fontFamily: FONT_HEAD, fontSize: 12, fontWeight: 700,
  color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5,
  marginBottom: 6,
};

// ----------------------------------------------------------------------------
// Debug scenarios table — engine verification, hidden by default
// ----------------------------------------------------------------------------

function DebugTable() {
  const rows = useMemo(() => DEBUG_SCENARIOS.map((spec) => {
    const inputs = buildScenarioInputs(spec);
    let result;
    try { result = runCGTProjection(inputs); } catch (e) { result = { error: e.message }; }
    return { spec, inputs, result };
  }), []);

  const cell = {
    padding: '4px 6px',
    borderBottom: `1px solid ${C.border}`,
    verticalAlign: 'top',
    fontSize: 10.5,
  };
  const headerCell = {
    ...cell,
    fontWeight: 700,
    fontFamily: FONT_BODY,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 9.5,
    borderBottom: `2px solid ${C.border}`,
    textAlign: 'left',
  };
  const monoCell = { ...cell, fontFamily: FONT_MONO, textAlign: 'right', whiteSpace: 'nowrap' };

  const summarise = (i) => {
    const parts = [
      `pd ${i.purchase_date}`,
      `sd ${i.sale_date}`,
      `cb ${fmt(i.purchase_price || i.value_2027 || 0)}`,
      `r ${fmtPct(i.return_rate, 1)}`,
      `inf ${fmtPct(i.inflation, 1)}`,
      `oi ${fmt(i.other_income)}`,
      `is ${i.income_support_recipient ? 'Y' : 'N'}`,
      `at ${i.asset_type}`,
    ];
    if (i.is_pre_cgt) parts.push(`pre-CGT, v27 ${fmt(i.value_2027)}`);
    if (!i.is_pre_cgt && new Date(i.purchase_date) < LEG.newRulesStart && new Date(i.sale_date) >= LEG.newRulesStart) {
      parts.push(`vm ${i.valuation_method}`);
    }
    return parts.join(' · ');
  };

  const bucketLabel = (r, i) => {
    if (r.error) return 'ERR';
    if (i.is_pre_cgt) return r.bucket === 'A' ? 'Pre-CGT' : 'Pre-CGT D';
    return r.bucket || '—';
  };

  const realGain = (r) => {
    if (r.error) return null;
    if (r.bucket === 'A' && !r.inputs?.is_pre_cgt) return null;
    if (r.split?.postPortionTaxable != null) return r.split.postPortionTaxable;
    if (r.bucket === 'C') return r.newRules?.taxableGain ?? null;
    return null;
  };

  return (
    <Card style={{ padding: 12, marginTop: 12 }}>
      <div style={{
        fontFamily: FONT_HEAD, fontSize: 12, fontWeight: 700,
        color: C.textPrimary, marginBottom: 6,
      }}>
        Debug scenarios ({rows.length})
      </div>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 8 }}>
        Each row runs the engine with the spec at left and reports computed outputs. Used for engine verification only; not exported.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT_BODY }}>
          <thead>
            <tr>
              <th style={headerCell}>Scenario</th>
              <th style={headerCell}>Inputs</th>
              <th style={headerCell}>Bucket</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>Nominal gain</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>Real gain (post-idx)</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>Old tax</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>Old rate</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>New tax</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>New rate</th>
              <th style={headerCell}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ spec, inputs, result }, i) => {
              const nominal = result.error ? null : (result.nominalGain ?? (inputs.sale_price - (inputs.is_pre_cgt ? 0 : inputs.purchase_price)));
              const rg = realGain({ ...result, inputs });
              const oldTax = result.oldRules?.taxOnGain ?? null;
              const oldRate = result.oldRules?.effectiveRate ?? null;
              const newTax = result.actual?.taxOnGain ?? null;
              const newRate = result.actual?.effectiveRate ?? null;
              return (
                <tr key={i}>
                  <td style={{ ...cell, fontWeight: 600, color: C.textPrimary, maxWidth: 180 }}>{spec.name}</td>
                  <td style={{ ...cell, fontFamily: FONT_MONO, fontSize: 9.5, color: C.textSecondary, maxWidth: 260, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    {summarise(inputs)}
                  </td>
                  <td style={{ ...cell, fontFamily: FONT_MONO, fontWeight: 600 }}>{bucketLabel(result, inputs)}</td>
                  <td style={monoCell}>{nominal == null ? '—' : fmt(nominal)}</td>
                  <td style={monoCell}>{rg == null ? '—' : fmt(rg)}</td>
                  <td style={monoCell}>{oldTax == null ? '—' : fmt(oldTax)}</td>
                  <td style={monoCell}>{oldRate == null ? '—' : fmtPct(oldRate, 1)}</td>
                  <td style={monoCell}>{newTax == null ? '—' : fmt(newTax)}</td>
                  <td style={monoCell}>{newRate == null ? '—' : fmtPct(newRate, 1)}</td>
                  <td style={{ ...cell, color: C.textSecondary, maxWidth: 260, whiteSpace: 'normal' }}>{spec.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Asset type footnote
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
// Summary cards
// ----------------------------------------------------------------------------

function SummaryCards({ result, verdict }) {
  const toneStyles = {
    good: { bg: C.healthyBg, fg: C.healthyText, border: C.healthy },
    bad: { bg: C.riskBg, fg: C.riskText, border: C.risk },
    warn: { bg: C.warningBg, fg: C.warningText, border: C.warning },
    neutral: { bg: C.offWhite, fg: C.textSecondary, border: C.border },
  };
  const v = verdict ? toneStyles[verdict.tone] : toneStyles.neutral;

  const card1Label = 'After-tax proceeds (actual)';
  const card2Label = 'After-tax (old rules counterfactual)';
  const card1 = result.actual?.afterTaxProceeds ?? 0;
  const card2 = result.oldRules?.afterTaxProceeds ?? 0;
  const diff = card1 - card2;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          {card1Label}
        </div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700, color: C.textPrimary }}>
          {fmt(card1)}
        </div>
      </Card>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          {card2Label}
        </div>
        <div style={{ fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700, color: C.textPrimary }}>
          {fmt(card2)}
        </div>
      </Card>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
          Difference (after-tax proceeds)
        </div>
        <div style={{
          fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700,
          color: diff < 0 ? C.risk : C.healthy,
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

function MainChart({ data, tab, xLabel, height = 420 }) {
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
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 56, left: 4 }}>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="xLabel"
            type="category"
            interval={0}
            padding={{ left: 0, right: 0 }}
            stroke={C.textSubtle}
            tick={{ fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted }}
            label={{ value: xLabel, position: 'insideBottom', fontSize: 11, fill: C.textMuted, dy: 14 }}
          />
          <YAxis
            stroke={C.textSubtle}
            tick={{ fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted }}
            domain={isPct ? [0, 50] : ['dataMin', 'dataMax']}
            ticks={isPct ? [0, 10, 20, 30, 40, 50] : undefined}
            tickFormatter={isPct ? (v) => `${v.toFixed(0)}%` : fmtK}
            width={60}
          />
          <Tooltip content={<ChartTooltip suffix={isPct ? '%' : '$'} />} />
          <Legend verticalAlign="top" height={28} iconType="line" formatter={(value) => (
            <span style={{ fontSize: 11, color: C.textSecondary }}>{value}</span>
          )} />
          {/* 30% minimum tax reference line (effective rate only) */}
          {isPct && (
            <ReferenceLine
              y={30}
              stroke={C.textMuted}
              strokeDasharray="4 4"
              label={{
                value: '30% floor (on real gain, post-indexation)',
                fontSize: 10,
                fill: C.textMuted,
                position: 'insideTopRight',
              }}
            />
          )}
          <Line type="monotone" dataKey={keyOld} stroke={C.oldRules} strokeWidth={2} dot={false} isAnimationActive={false} name="Old rules" />
          <Line type="monotone" dataKey={keyNew} stroke={C.newRules} strokeWidth={2} dot={false} isAnimationActive={false} name="New rules" />
          {crossover != null && (
            <ReferenceLine x={crossover} stroke={C.textSubtle} strokeDasharray="4 4" label={{ value: 'crossover', fontSize: 10, fill: C.textMuted, position: 'top' }} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DiffChart({ data, tab, xLabel }) {
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
  // After-tax: positive diff = new keeps more = BETTER (green).
  // Effective rate: positive diff = new pays more = WORSE (red).
  const posColor = isPct ? C.risk : C.healthy;
  const negColor = isPct ? C.healthy : C.risk;
  const posName = isPct ? 'New worse' : 'New better';
  const negName = isPct ? 'New better' : 'New worse';
  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 56, left: 4 }}>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="xLabel"
            type="category"
            interval={0}
            padding={{ left: 0, right: 0 }}
            stroke={C.textSubtle}
            tick={{ fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted }}
            label={{ value: xLabel, position: 'insideBottom', fontSize: 11, fill: C.textMuted, dy: 14 }}
          />
          <YAxis
            stroke={C.textSubtle}
            tick={{ fontSize: 11, fontFamily: FONT_MONO, fill: C.textMuted }}
            tickFormatter={isPct ? (v) => `${v.toFixed(0)}%` : fmtK}
            width={60}
          />
          <ReferenceLine y={0} stroke={C.textMuted} />
          <Tooltip content={<DiffTooltip isPct={isPct} />} />
          <Area type="monotone" dataKey="pos" stroke={posColor} strokeWidth={1} fill={posColor} fillOpacity={0.25} isAnimationActive={false} activeDot={false} name={posName} />
          <Area type="monotone" dataKey="neg" stroke={negColor} strokeWidth={1} fill={negColor} fillOpacity={0.25} isAnimationActive={false} activeDot={false} name={negName} />
        </AreaChart>
      </ResponsiveContainer>
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
