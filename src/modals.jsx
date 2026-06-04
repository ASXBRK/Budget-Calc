import React from 'react';
import { X } from 'lucide-react';
import { LEG } from './engine.js';
import { C, FONT_HEAD, FONT_MONO, fmt, fmtPct, fmtDate, useIsMobile } from './shared.jsx';

export function Modal({ title, onClose, children, wide }) {
  const isMobile = useIsMobile();
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17, 24, 39, 0.5)',
        display: 'flex',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          borderRadius: isMobile ? 0 : 12,
          padding: isMobile ? 16 : 24,
          width: isMobile ? '100vw' : (wide ? 720 : 520),
          maxWidth: isMobile ? '100vw' : '90vw',
          maxHeight: isMobile ? '100vh' : '90vh',
          overflowY: 'auto',
          border: isMobile ? 'none' : `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_HEAD, fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: C.textMuted,
              padding: isMobile ? 10 : 4,
              minWidth: isMobile ? 44 : undefined,
              minHeight: isMobile ? 44 : undefined,
            }}
            aria-label="Close"
          >
            <X size={isMobile ? 22 : 18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BucketsDiagram() {
  const rows = [
    { key: 'A', desc: 'Bought & sold before 1 Jul 2027', pre: 100, post: 0, preColor: C.oldRules },
    { key: 'B', desc: 'Bought before, sold after', pre: 60, post: 40, preColor: C.oldRules },
    { key: 'C', desc: 'Bought after 1 Jul 2027', pre: 0, post: 100, preColor: C.oldRules },
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

export function ParamsModal({ onClose }) {
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

export function AssumptionsModal({ diagnostics, onClose }) {
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
