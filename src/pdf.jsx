import React from 'react';
import { LEG } from './engine.js';
import {
  C, FONT_HEAD, FONT_MONO,
  fmt, fmtPct, fmtDate, explainerForScenario,
} from './shared.jsx';
import { DiffPanel, ProceedsPanel, RatePanel } from './charts.jsx';
import { TimelineStrip } from './timeline.jsx';

const pdfSectionTitle = {
  fontFamily: FONT_HEAD, fontSize: 12, fontWeight: 700,
  color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5,
  marginBottom: 6,
};

export function PdfReport({ inputs, focusScenario, result, chartData, isPreCgt }) {
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
  } else if (result.bucket === 'A') {
    headline = `Selling on ${saleDateStr} produces approximately ${fmt(oldAfter)} after tax under existing CGT rules. The new rules announced in the May 2026 Budget commence 1 July 2027 and do not apply to this sale.`;
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

      <div style={{ marginTop: 14 }}>
        <div style={pdfSectionTitle}>Headline result at {saleDateStr}</div>
        <div style={{ fontSize: 12.5, color: C.textPrimary, lineHeight: 1.55 }}>
          {headline}
        </div>
      </div>

      {/* Three-panel stack — PDF heights compressed to fit one A4 page */}
      <div style={{ marginTop: 10, width: 700 }}>
        <DiffPanel data={chartData} height={140} compact={false} />
      </div>
      <div style={{ marginTop: 6, width: 700 }}>
        <ProceedsPanel data={chartData} height={140} compact={false} />
      </div>
      <div style={{ marginTop: 6, width: 700 }}>
        <RatePanel data={chartData} height={140} compact={false} />
      </div>

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
