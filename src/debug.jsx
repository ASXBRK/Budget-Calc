import React, { useMemo } from 'react';
import { runCGTProjection, LEG } from './engine.js';
import { DEBUG_SCENARIOS, buildScenarioInputs } from './debugScenarios.js';
import { C, FONT_BODY, FONT_HEAD, FONT_MONO, Card, fmt, fmtPct } from './shared.jsx';

export function DebugTable() {
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
