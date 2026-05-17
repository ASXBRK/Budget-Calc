import React, { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { LEG } from './engine.js';

// ----------------------------------------------------------------------------
// Design tokens
// ----------------------------------------------------------------------------

export const C = {
  teal: '#0d9488', tealLight: '#ccfbf1',
  dark: '#111827', white: '#ffffff', offWhite: '#f8fafc',
  textPrimary: '#111827', textSecondary: '#374151',
  textMuted: '#6b7280', textSubtle: '#9ca3af',
  border: '#e2e8f0',
  healthy: '#10b981', healthyBg: '#d1fae5', healthyText: '#065f46',
  warning: '#f59e0b', warningBg: '#fef3c7', warningText: '#92400e',
  risk: '#ef4444', riskBg: '#fee2e2', riskText: '#991b1b',
  oldRules: '#F43F5E',             // rose-500 — old regime indicator + "worse" semantic
  newRules: '#0D9488',             // teal-600 — new regime indicator
  preCgt: '#10b981',
  semanticBetter: '#10B981',       // emerald-500
  semanticWorse: '#F43F5E',        // rose-500 — same hue as old rules by design
  chartGrid: '#F1F5F9',            // slate-100
  chartCutoff: '#94A3B8',          // slate-400
};

export const FONT_BODY = "'Plus Jakarta Sans', system-ui, sans-serif";
export const FONT_HEAD = "'DM Sans', system-ui, sans-serif";
export const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

export const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

export const HIDE_SPINNERS = `
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; appearance: textfield; }
  .slider-track { -webkit-appearance: none; appearance: none; height: 4px; background: ${C.border}; border-radius: 2px; outline: none; }
  .slider-track::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid ${C.white}; box-sizing: border-box; }
  .slider-track::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: ${C.teal}; cursor: pointer; border: 2px solid ${C.white}; }
`;

// ----------------------------------------------------------------------------
// Info copy
// ----------------------------------------------------------------------------

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

export function explainerForScenario(bucket, isPreCgt, incomeSupport) {
  if (isPreCgt && bucket === 'A') {
    return 'Pre-1985 asset sold before 1 July 2027 — exempt under existing CGT law. No tax under either regime.';
  }
  const table = incomeSupport ? BUCKET_EXPLAINERS_INCOME_SUPPORT : BUCKET_EXPLAINERS;
  return table[bucket] || '';
}

export const PRE_CGT_VALUE_INFO = "Pre-1985 assets are exempt under existing CGT law. From 1 July 2027 the announced rules bring them into the CGT net; the standard transitional approach (and the assumption this tool makes) is a deemed market value cost base at 1 July 2027, so only gains accruing from that date are taxable. Treasury hasn't yet specified the cost base treatment, so flag this as illustrative when discussing with the client. A formal valuation isn't required for modelling — a reasonable estimate is fine.";

export const INCOME_SUPPORT_INFO = 'Affects the new-rules calculation only: removes the 30% minimum tax floor on the gain. Per the 2026 Budget, recipients of Centrelink income support (Age Pension, JobSeeker, Disability Support Pension, Parenting Payment, etc.) pay their marginal rate without the minimum top-up. This only changes the outcome when the marginal rate on the gain would otherwise be below 30% — for clients whose income places them at or above the 30% bracket, toggling Yes has no visible effect.';

export const VALUATION_INFO = "For an asset bought before 1 July 2027 and sold after, the value at 1 July 2027 splits the gain into pre and post portions. ATO formula estimates this using compound growth from purchase to sale. Use 'Enter value' if you have a real market valuation at that date.";

export const CAPITAL_WORKS_INFO = "Division 43 capital works deductions claimed over the holding period reduce the cost base for CGT purposes. If you've claimed $10,000 of building depreciation, enter $10,000 here. Don't include plant & equipment (Div 40) — that's separate and may not affect cost base if acquired after May 2017.";

// ----------------------------------------------------------------------------
// Format helpers
// ----------------------------------------------------------------------------

export const fmt = (v) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(Math.round(v || 0));

export const fmtK = (v) => {
  const n = Number(v) || 0;
  return Math.abs(n) >= 1e6
    ? `$${(n / 1e6).toFixed(1)}M`
    : `$${Math.round(n / 1e3)}k`;
};

export const fmtPct = (v, decimals = 1) => `${((Number(v) || 0) * 100).toFixed(decimals)}%`;

export const fmtDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(dt);
};

// ----------------------------------------------------------------------------
// Atoms
// ----------------------------------------------------------------------------

export function Card({ children, style }) {
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

export function CardHeader({ title, subtitle, right }) {
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

export function InfoTooltip({ content, title }) {
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

export function Label({ children, info, infoTitle }) {
  return (
    <div style={{ marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {children}
      </span>
      {info && <InfoTooltip content={info} title={infoTitle} />}
    </div>
  );
}

export function pillButton(active) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: active ? C.healthyBg : C.white,
    border: `1px solid ${active ? C.healthy : C.border}`,
    color: active ? C.healthyText : C.textSecondary,
    padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
    fontSize: 12, fontFamily: FONT_BODY, fontWeight: 600,
  };
}

// ----------------------------------------------------------------------------
// Domain helpers (used by App + PDF report)
// ----------------------------------------------------------------------------

const today = new Date();
export const DEFAULT_INPUTS = {
  asset_type: 'shares',
  purchase_date: today.toISOString().slice(0, 10),
  purchase_price: 0,
  acquisition_costs: 0,
  capital_improvements: 0,
  depreciation_claimed: 0,
  sale_costs: 0,
  return_rate: 0.06,
  inflation: 0.025,
  other_income: 100000,
  income_support_recipient: false,
  value_2027: 0,
  value_2027_manual: false,
  valuation_method: 'ATO_formula',
  focus_years: 10,
};

export function buildCostBase(inputs, isPreCgt) {
  if (isPreCgt) return 0;
  const improvements = inputs.asset_type === 'property' ? (inputs.capital_improvements || 0) : 0;
  const dep = inputs.asset_type === 'property' ? (inputs.depreciation_claimed || 0) : 0;
  return (inputs.purchase_price || 0) +
    (inputs.acquisition_costs || 0) +
    improvements -
    dep;
}

export function derivedSalePrice({ inputs, isPreCgt, saleDate, costBase, yearsFromPurchase }) {
  if (isPreCgt) {
    const yearsPost = Math.max((saleDate - new Date(LEG.newRulesStart)) / MS_PER_YEAR, 0);
    return (inputs.value_2027 || 0) * Math.pow(1 + inputs.return_rate, yearsPost);
  }
  return costBase * Math.pow(1 + inputs.return_rate, yearsFromPurchase);
}
