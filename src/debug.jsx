import React, { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { runCGTProjection, LEG } from './engine.js';
import { DEBUG_SCENARIOS, buildScenarioInputs } from './debugScenarios.js';
import {
  C, FONT_BODY, FONT_HEAD, FONT_MONO,
  Card, fmt, fmtPct, fmtDate, pillButton,
  explainerForScenario,
} from './shared.jsx';

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
// Scenario debug panel — dumps the current scenario's inputs + engine output
// as a copyable plain-text block. Built from the live App state; doesn't
// recompute anything itself.
// ----------------------------------------------------------------------------

function mtrFor(otherIncome, fy = '2027-28') {
  const brackets = LEG.brackets[fy] || [];
  for (const [floor, ceiling, rate] of brackets) {
    if (otherIncome >= floor && otherIncome < ceiling) return rate;
  }
  return 0;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function buildDebugText({ inputs, focusScenario, result, chartData, isPreCgt, costBase, verdict }) {
  const lines = [];
  const ts = new Date().toISOString();
  lines.push(`SCENARIO DEBUG — ${ts}`);
  lines.push('');

  // INPUTS
  lines.push('=== INPUTS ===');
  lines.push(`Asset type: ${inputs.asset_type}`);
  const pdRaw = new Date(inputs.purchase_date);
  const yearsFromToday = (new Date() - pdRaw) / (365.25 * 24 * 3600 * 1000);
  lines.push(`Purchase date: ${inputs.purchase_date} (${fmtDate(inputs.purchase_date)}, ${yearsFromToday.toFixed(2)} years from today)`);
  lines.push(`Sale date: ${focusScenario.sale_date} (${fmtDate(focusScenario.sale_date)}, focus_years = ${inputs.focus_years})`);
  lines.push(`Sale price (derived): ${fmt(focusScenario.sale_price)}`);
  if (!isPreCgt) {
    lines.push(`Purchase price: ${fmt(inputs.purchase_price)}`);
    if (inputs.asset_type === 'property') {
      lines.push(`Acquisition costs: ${fmt(inputs.acquisition_costs)}`);
      lines.push(`Capital improvements: ${fmt(inputs.capital_improvements)}`);
      lines.push(`Capital works deductions: ${fmt(inputs.depreciation_claimed)}`);
      lines.push(`Sale costs: ${fmt(inputs.sale_costs)}`);
    }
  } else {
    lines.push(`Market value at 1 Jul 2027: ${fmt(inputs.value_2027)}`);
  }
  lines.push(`Cost base (computed): ${fmt(costBase)}`);
  lines.push(`Annual return: ${fmtPct(inputs.return_rate, 2)}`);
  lines.push(`Annual inflation: ${fmtPct(inputs.inflation, 2)}`);
  const fy = '2027-28';
  const mtr = mtrFor(inputs.other_income, fy);
  lines.push(`Other taxable income: ${fmt(inputs.other_income)} (MTR for FY ${fy}: ${fmtPct(mtr, 0)})`);
  lines.push(`Income support recipient: ${inputs.income_support_recipient ? 'yes' : 'no'}`);
  lines.push(`Is pre-CGT (auto-detected): ${isPreCgt ? 'yes' : 'no'}`);
  lines.push('');

  if (result.error) {
    lines.push('=== ENGINE ERROR ===');
    lines.push(result.error);
    lines.push('');
    lines.push('=== END ===');
    return lines.join('\n');
  }

  // BUCKET
  lines.push('=== BUCKET ===');
  const bucketLabel = LEG.buckets[result.bucket] || '';
  const bucketDesc = bucketLabel.split(' — ')[1] || bucketLabel;
  lines.push(`Bucket: ${result.bucket} (${bucketDesc})`);
  const commencement = fmtDate(LEG.newRulesStart);
  const purchasePre = pdRaw < LEG.newRulesStart;
  const salePre = new Date(focusScenario.sale_date) < LEG.newRulesStart;
  let reasoning;
  if (isPreCgt && salePre) {
    reasoning = `Pre-1985 asset AND sale ${focusScenario.sale_date} < commencement ${commencement} → Bucket A (pre-CGT exempt)`;
  } else if (isPreCgt) {
    reasoning = `Pre-1985 asset AND sale ${focusScenario.sale_date} ≥ commencement ${commencement} → Bucket D (pre-CGT, split with deemed reset)`;
  } else if (purchasePre && salePre) {
    reasoning = `Purchase ${inputs.purchase_date} < commencement AND sale ${focusScenario.sale_date} < commencement → Bucket A (old rules whole gain)`;
  } else if (purchasePre) {
    reasoning = `Purchase ${inputs.purchase_date} < commencement AND sale ${focusScenario.sale_date} ≥ commencement → Bucket B (split)`;
  } else {
    reasoning = `Purchase ${inputs.purchase_date} ≥ commencement → Bucket C (new rules whole gain)`;
  }
  lines.push(`Reasoning: ${reasoning}`);
  lines.push(`Explainer: ${explainerForScenario(result.bucket, isPreCgt, inputs.income_support_recipient)}`);
  lines.push('');

  // ENGINE OUTPUT
  lines.push('=== ENGINE OUTPUT ===');
  lines.push(`Nominal gain: ${fmt(result.nominalGain)}`);
  if (result.holdingYears != null) {
    lines.push(`Holding years: ${Number(result.holdingYears).toFixed(2)}`);
  }
  lines.push('');

  const fmtRegime = (label, r) => {
    if (!r) return;
    lines.push(`${label}:`);
    lines.push(`  Taxable gain: ${fmt(r.taxableGain)}`);
    lines.push(`  Tax on gain: ${fmt(r.taxOnGain)}`);
    lines.push(`  After-tax proceeds: ${fmt(r.afterTaxProceeds)}`);
    lines.push(`  Effective rate: ${fmtPct(r.effectiveRate, 2)}`);
    if (r.indexedCostBase != null) lines.push(`  Indexed cost base: ${fmt(r.indexedCostBase)}`);
    if (r.indexationFactor != null) lines.push(`  Indexation factor: ${Number(r.indexationFactor).toFixed(4)}`);
    if (r.minTaxApplied != null) lines.push(`  30% min tax applied: ${r.minTaxApplied ? 'yes' : 'no'}`);
  };
  fmtRegime('OLD RULES (counterfactual)', result.oldRules);
  lines.push('');
  fmtRegime('NEW RULES (counterfactual)', result.newRules);
  lines.push('');

  if (result.split) {
    const s = result.split;
    lines.push('SPLIT TREATMENT (actual):');
    lines.push(`  Value at 1 Jul 2027: ${fmt(s.value2027)}`);
    lines.push(`  Years pre-commencement: ${Number(s.yearsToCutoff).toFixed(2)}`);
    lines.push(`  Years post-commencement: ${Number(s.yearsPost).toFixed(2)}`);
    lines.push(`  Pre-2027 nominal gain: ${fmt(s.preGain)}`);
    lines.push(`  Pre-2027 taxable (50% disc): ${fmt(s.prePortionTaxable)}`);
    // Nominal post-gain = salePrice − value_2027 (before indexation). The
    // engine's `split.postGain` field happens to alias postPortionTaxable
    // (post-indexation taxable amount) — surface the true nominal here.
    const postNominal = Math.max(0, (focusScenario.sale_price || 0) - (s.value2027 || 0));
    lines.push(`  Post-2027 nominal gain: ${fmt(postNominal)}`);
    lines.push(`  Post-2027 indexed value at 2027: ${fmt(s.indexedValue2027)}`);
    lines.push(`  Post-2027 taxable (real): ${fmt(s.postPortionTaxable)}`);
    lines.push(`  Total taxable: ${fmt(s.totalTaxable)}`);
    lines.push(`  Tax on pre-portion: ${fmt(s.taxPre)}`);
    lines.push(`  Tax on post-portion: ${fmt(s.taxPost)}`);
    lines.push(`  Medicare levy: ${fmt(s.medicare)}`);
    lines.push(`  Total tax: ${fmt(s.totalTax)}`);
    lines.push(`  30% min tax applied: ${s.minTaxApplied ? 'yes' : 'no'}`);
    lines.push('');
  }

  fmtRegime('ACTUAL RESULT', result.actual);
  lines.push('');

  // VERDICT
  lines.push('=== VERDICT ===');
  if (verdict) {
    lines.push(`Label: ${verdict.label}`);
    lines.push(`Description: ${verdict.desc}`);
  }
  const oldAfter = result.oldRules?.afterTaxProceeds ?? 0;
  const newAfter = result.actual?.afterTaxProceeds ?? 0;
  lines.push(`Difference (actual − old counterfactual): ${fmt(newAfter - oldAfter)}`);
  lines.push('');

  // CHART DATA POINTS
  lines.push('=== CHART DATA POINTS ===');
  const cellW = { year: 6, money: 11, rate: 8 };
  const fmtMoney = (v) => v == null ? '(null)' : fmt(v);
  const fmtRate = (v) => v == null ? '(null)' : `${Number(v).toFixed(2)}%`;
  lines.push(
    pad('Year', cellW.year) + '| '
    + pad('TaxOld', cellW.money) + '| '
    + pad('TaxNew', cellW.money) + '| '
    + pad('AfterTaxOld', cellW.money + 2) + '| '
    + pad('AfterTaxNew', cellW.money + 2) + '| '
    + pad('RateOld', cellW.rate) + '| '
    + pad('RateNew', cellW.rate)
  );
  lines.push(
    '-'.repeat(cellW.year) + '+-'
    + '-'.repeat(cellW.money) + '+-'
    + '-'.repeat(cellW.money) + '+-'
    + '-'.repeat(cellW.money + 2) + '+-'
    + '-'.repeat(cellW.money + 2) + '+-'
    + '-'.repeat(cellW.rate) + '+-'
    + '-'.repeat(cellW.rate)
  );
  for (const p of chartData) {
    lines.push(
      pad(p.x, cellW.year) + '| '
      + pad(fmtMoney(p.taxOld), cellW.money) + '| '
      + pad(fmtMoney(p.taxNew), cellW.money) + '| '
      + pad(fmtMoney(p.afterTaxOld), cellW.money + 2) + '| '
      + pad(fmtMoney(p.afterTaxNew), cellW.money + 2) + '| '
      + pad(fmtRate(p.rateOld), cellW.rate) + '| '
      + pad(fmtRate(p.rateNew), cellW.rate)
    );
  }
  lines.push('');

  // HEADLINE
  lines.push('=== HEADLINE TEXT ===');
  lines.push(result.headline || '(no headline)');
  lines.push('');
  lines.push('=== END ===');

  return lines.join('\n');
}

export function ScenarioDebugPanel(props) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => buildDebugText(props), [props]);

  const copyText = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card style={{ padding: 12, marginTop: 12 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: FONT_HEAD, fontSize: 12, fontWeight: 700, color: C.textPrimary,
        }}>
          Scenario debug
        </div>
        <button onClick={copyText} style={pillButton(copied)}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy debug output'}
        </button>
      </div>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 8, fontFamily: FONT_BODY }}>
        Plain-text dump of every input + computed value for the current scenario. Paste into chat to verify the math.
      </div>
      <pre style={{
        background: C.offWhite, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: 12, fontSize: 11, fontFamily: FONT_MONO, color: C.textPrimary,
        whiteSpace: 'pre', overflowX: 'auto', margin: 0, lineHeight: 1.5,
      }}>
        {text}
      </pre>
    </Card>
  );
}
