import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Copy, Link as LinkIcon, Settings, Info, Check, FileText } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { runCGTProjection, LEG, INPUT_LIMITS } from './engine.js';
import {
  C, FONT_BODY, FONT_HEAD,
  HIDE_SPINNERS, MS_PER_YEAR,
  Card, fmt, fmtDate, pillButton,
  DEFAULT_INPUTS, buildCostBase, derivedSalePrice,
  explainerForScenario, isValidPurchaseDate,
} from './shared.jsx';
import { UnifiedInputs } from './inputs.jsx';
import { DiffPanel, ProceedsPanel, RatePanel } from './charts.jsx';
import { ParamsModal, AssumptionsModal } from './modals.jsx';
import { TimelineStrip, SummaryCards, AssetTypeFootnote } from './timeline.jsx';
import { PdfReport } from './pdf.jsx';
import { DebugTable, ScenarioDebugPanel } from './debug.jsx';

// ----------------------------------------------------------------------------
// Debug gating — opt-in via ?debug=1
// ----------------------------------------------------------------------------
// Read once at module load. Debug surfaces (ScenarioDebugPanel, the seed-
// scenario loader, their toggles, and the related localStorage keys) only
// activate when the flag is present. The reform isn't legislated yet, so
// these stay shipped but invisible to normal users.

const DEBUG_MODE = (() => {
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
})();

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
  value_2027_manual: 'v27m',
  focus_years: 'fy',
};
const REVERSE_KEY_MAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);
const STRING_KEYS = new Set(['asset_type', 'purchase_date']);
const BOOLEAN_KEYS = new Set(['income_support_recipient', 'value_2027_manual']);

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
      // Drop non-finite numerics so they fall back to DEFAULT_INPUTS.
      if (Number.isFinite(num)) out[longKey] = num;
    }
  }
  // Drop malformed / out-of-range purchase dates so they fall back to default.
  if (out.purchase_date != null && !isValidPurchaseDate(out.purchase_date)) {
    delete out.purchase_date;
  }
  return out;
}

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------

export default function App() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfState, setPdfState] = useState('idle'); // 'idle' | 'rendering' | 'capturing'
  const pdfRef = useRef(null);
  // Debug toggles + persistence are inert outside DEBUG_MODE — no
  // localStorage reads, no writes, no UI surface. The state still exists
  // (useState calls run unconditionally per the rules of hooks) but it's
  // initialised to false and never displayed.
  const [debugVisible, setDebugVisible] = useState(() => {
    if (!DEBUG_MODE) return false;
    try { return localStorage.getItem('cgtDebugVisible') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (!DEBUG_MODE) return;
    try { localStorage.setItem('cgtDebugVisible', debugVisible ? '1' : '0'); } catch {}
  }, [debugVisible]);
  const [scenarioDebugVisible, setScenarioDebugVisible] = useState(() => {
    if (!DEBUG_MODE) return false;
    try { return localStorage.getItem('cgtScenarioDebugVisible') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (!DEBUG_MODE) return;
    try { localStorage.setItem('cgtScenarioDebugVisible', scenarioDebugVisible ? '1' : '0'); } catch {}
  }, [scenarioDebugVisible]);

  useEffect(() => {
    const decoded = decodeState(window.location.search);
    if (Object.keys(decoded).length > 0) {
      const clamped = { ...decoded };
      for (const [key, { min, max }] of Object.entries(INPUT_LIMITS)) {
        if (clamped[key] != null && Number.isFinite(Number(clamped[key]))) {
          clamped[key] = Math.min(max, Math.max(min, Number(clamped[key])));
        }
      }
      const at = clamped.asset_type ?? DEFAULT_INPUTS.asset_type;
      if (at !== 'property') {
        delete clamped.capital_improvements;
        delete clamped.depreciation_claimed;
      }
      setInputs((s) => ({ ...s, ...clamped }));
    }
  }, []);

  useEffect(() => {
    const qs = encodeState(inputs);
    const url = `${window.location.pathname}?${qs}`;
    window.history.replaceState(null, '', url);
  }, [inputs]);

  const update = useCallback((patch) => setInputs((s) => ({ ...s, ...patch })), []);

  const [v2027CapNotice, setV2027CapNotice] = useState(false);

  // Side-effect on input changes:
  // 1. Keep focus_years inside the slider's valid window when purchase_date
  //    shifts (old asset → wider window; recent asset → narrower).
  // 2. Auto-populate value_2027 for pre-CGT scenarios when ALL preconditions
  //    are satisfied. Cap at $100M and flag the notice.
  useEffect(() => {
    const pdRaw = new Date(inputs.purchase_date);
    const py = pdRaw.getFullYear();
    if (Number.isNaN(py)) return;
    const patch = {};

    const minF = Math.max(1, 2026 - py);
    const maxF = Math.max(25, 2050 - py);
    if (inputs.focus_years < minF || inputs.focus_years > maxF) {
      const defaultSaleYear = Math.max(py + 10, 2035);
      patch.focus_years = Math.min(maxF, Math.max(minF, defaultSaleYear - py));
    }

    const isPreCgtDate = pdRaw < LEG.preCgtCutoff;
    const price = Number.isFinite(inputs.purchase_price) ? inputs.purchase_price : 0;
    // Auto-seed uses the user's nominal return rate as the backward growth
    // assumption — inflation alone (~2.5%) badly underestimates property /
    // share growth over decades.
    const rate = Number.isFinite(inputs.return_rate) ? inputs.return_rate : 0;
    const manuallyEdited = !!inputs.value_2027_manual;
    if (isPreCgtDate && price > 0 && rate > 0 && !manuallyEdited) {
      const yearsTo2027 = Math.max(2027 - py, 1);
      const seedRaw = price * Math.pow(1 + rate, yearsTo2027);
      const cap = INPUT_LIMITS.value_2027.max;
      if (Number.isFinite(seedRaw) && seedRaw > 0) {
        const exceedsCap = seedRaw > cap;
        patch.value_2027 = exceedsCap ? cap : Math.round(seedRaw);
        setV2027CapNotice(exceedsCap);
      }
    } else {
      setV2027CapNotice(false);
    }

    if (Object.keys(patch).length > 0) {
      setInputs((s) => ({ ...s, ...patch }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.purchase_date, inputs.purchase_price, inputs.return_rate, inputs.value_2027_manual]);

  const isPreCgt = useMemo(() => {
    if (!inputs.purchase_date) return false;
    return new Date(inputs.purchase_date) < LEG.preCgtCutoff;
  }, [inputs.purchase_date]);

  const costBase = useMemo(
    () => buildCostBase(inputs, isPreCgt),
    [inputs, isPreCgt]
  );

  const focusScenario = useMemo(() => {
    const pd = new Date(inputs.purchase_date);
    const sale = new Date(pd);
    sale.setFullYear(pd.getFullYear() + Math.round(inputs.focus_years));
    const sp = derivedSalePrice({ inputs, isPreCgt, saleDate: sale });
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
    // Final safety check: a bad date that slipped past earlier guards would
    // produce NaN x-values and crash Recharts. Bail with an empty series.
    if (isNaN(pd.getTime())) return [];
    const points = [];

    const buildPoint = (saleDate, years, xValue, xLabel) => {
      const sp = derivedSalePrice({ inputs, isPreCgt, saleDate });
      try {
        const r = runCGTProjection({
          ...inputs,
          mode: 'specific',
          sale_date: saleDate.toISOString().slice(0, 10),
          sale_price: Math.round(sp),
        });
        const saleDatePost = saleDate >= new Date(LEG.newRulesStart);
        const spRounded = Math.round(sp);
        const taxOld = r.oldRules?.taxOnGain ?? 0;
        const taxNew = r.actual?.taxOnGain ?? 0;
        const afterTaxOld = r.oldRules?.afterTaxProceeds ?? (spRounded - taxOld);
        const afterTaxNew = r.actual?.afterTaxProceeds ?? (spRounded - taxNew);
        const rateOld = (r.oldRules?.effectiveRate ?? 0) * 100;
        const rateNew = (r.actual?.effectiveRate ?? 0) * 100;
        return {
          x: xValue,
          xLabel,
          taxOld,
          taxNew: saleDatePost ? taxNew : null,
          afterTaxOld,
          afterTaxNew: saleDatePost ? afterTaxNew : null,
          rateOld,
          rateNew: saleDatePost ? rateNew : null,
        };
      } catch {
        return null;
      }
    };

    // For old assets, start the visible chart in 2026 rather than purchaseYear+1
    // so the regime change is always visible. Pre-2026 history is summarised
    // in the chartCallout above.
    const earlyCutoff = new Date('2026-07-01T00:00:00+10:00');
    const useTrimmedStart = pd < earlyCutoff;
    const startYear = useTrimmedStart ? 2026 : pd.getFullYear() + 1;
    const requestedEnd = pd.getFullYear() + Math.max(1, Math.round(inputs.focus_years));
    const endYear = Math.max(startYear + 1, requestedEnd);
    for (let y = startYear; y <= endYear; y++) {
      // Use the commencement date itself for the 2027 tick so the engine
      // computes the new rules treatment (Bucket B) at the boundary rather
      // than Bucket A. Other years use 30 June (end of FY).
      const sale = y === 2027
        ? new Date('2027-07-01T00:00:00+10:00')
        : new Date(`${y}-06-30T00:00:00+10:00`);
      const years = Math.max((sale - pd) / MS_PER_YEAR, 0);
      const p = buildPoint(sale, years, y, y);
      if (p) points.push(p);
    }
    // Drop any point with non-finite values — Recharts treats NaN as a normal
    // y-coordinate and crashes during layout.
    return points.filter((p) =>
      Number.isFinite(p.x)
      && Number.isFinite(p.taxOld)
      && Number.isFinite(p.afterTaxOld)
      && Number.isFinite(p.rateOld)
    );
  }, [inputs, costBase, isPreCgt, result.error]);

  const chartCallout = useMemo(() => {
    const pd = new Date(inputs.purchase_date);
    const earlyCutoff = new Date('2026-07-01T00:00:00+10:00');
    if (pd >= earlyCutoff) return null;
    if (isPreCgt) {
      return 'Asset acquired pre-20 September 1985 (pre-CGT). Asset was exempt from CGT before 1 July 2027. Cost base resets to market value at 1 July 2027 under the new rules. Chart starts at 2026 — pre-2026 history not shown.';
    }
    return `Asset purchased ${fmtDate(inputs.purchase_date)}. Pre-2026 period not shown — old rules applied throughout (effective rate ≈ 50% × your MTR).`;
  }, [inputs.purchase_date, isPreCgt]);

  const verdict = useMemo(() => {
    if (result.error) return null;
    const oldVal = result.oldRules?.afterTaxProceeds ?? 0;
    const newVal = result.actual?.afterTaxProceeds ?? 0;
    const diff = newVal - oldVal;
    const pct = oldVal > 0 ? Math.abs(diff) / oldVal : 0;

    if (isPreCgt && result.bucket === 'A') {
      return {
        tone: 'good',
        label: 'Pre-CGT exempt',
        desc: 'Asset exempt under existing CGT rules.',
      };
    }
    if (result.bucket === 'D') {
      const preCgtSubtext =
        'Pre-2027 gains exempt; post-2027 gains taxed under new rules (cost base resets to market value at 1 July 2027).';
      if (pct < 0.05) return { tone: 'warn', label: 'Roughly equal', desc: preCgtSubtext };
      if (diff > 0) return { tone: 'good', label: 'New rules cheaper', desc: preCgtSubtext };
      return { tone: 'bad', label: 'New rules costlier', desc: preCgtSubtext };
    }
    if (result.bucket === 'A') {
      return { tone: 'neutral', label: 'Pre-2027 sale', desc: 'Old rules apply.' };
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
    lines.push(`Tax payable: ${fmt(r.actual.taxOnGain)}`);
    lines.push(`After-tax proceeds: ${fmt(r.actual.afterTaxProceeds)}`);
    if (r.bucket === 'A') {
      lines.push(`Sale before 1 July 2027 — new rules do not apply to this sale.`);
    } else {
      lines.push(`Counterfactual old-rules after-tax: ${fmt(r.oldRules.afterTaxProceeds)}`);
      const diff = r.actual.afterTaxProceeds - r.oldRules.afterTaxProceeds;
      lines.push(`Difference: ${fmt(Math.abs(diff))} (${diff >= 0 ? 'new regime better' : 'new regime costs more'})`);
    }
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <UnifiedInputs inputs={inputs} update={update} isPreCgt={isPreCgt} v2027CapNotice={v2027CapNotice} />
        </div>

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

          {showResults && chartCallout && (
            <div style={{
              fontSize: 12, color: C.textSecondary, lineHeight: 1.5,
              borderLeft: `3px solid ${C.chartCutoff}`,
              background: C.offWhite,
              padding: '8px 12px',
            }}>
              {chartCallout}
            </div>
          )}

          {showResults && chartData.length > 0 && (
            <Card>
              <DiffPanel data={chartData} height={220} />
              <div style={{ height: 32 }} />
              <ProceedsPanel data={chartData} height={220} />
              <div style={{ height: 32 }} />
              <RatePanel data={chartData} height={220} />
            </Card>
          )}

          {showResults && <AssetTypeFootnote assetType={inputs.asset_type} />}

          <div style={{ fontSize: 11, color: C.textMuted, padding: '8px 4px', lineHeight: 1.5 }}>
            Illustrative model based on the May 2026 Budget announcement and industry analysis. Calculations are subject to final legislation.
          </div>
        </div>
      </div>

      {/* Debug surfaces — gated behind ?debug=1 for engine reverification.
          Invisible to normal users; the reform isn't legislated so we
          keep the capability rather than deleting. */}
      {DEBUG_MODE && (
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 20px 24px' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
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
            {showResults && (
              <button
                onClick={() => setScenarioDebugVisible((v) => !v)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.textSubtle, fontSize: 11, fontFamily: FONT_BODY,
                  padding: '6px 0', textDecoration: 'underline dotted', textUnderlineOffset: 3,
                }}
              >
                {scenarioDebugVisible ? 'Hide scenario debug' : 'Show scenario debug'}
              </button>
            )}
          </div>
          {debugVisible && <DebugTable />}
          {scenarioDebugVisible && showResults && (
            <ScenarioDebugPanel
              inputs={inputs}
              focusScenario={focusScenario}
              result={result}
              chartData={chartData}
              isPreCgt={isPreCgt}
              costBase={costBase}
              verdict={verdict}
            />
          )}
        </div>
      )}

      {paramsOpen && <ParamsModal onClose={() => setParamsOpen(false)} />}
      {assumptionsOpen && showResults && (
        <AssumptionsModal diagnostics={result.diagnostics || {}} onClose={() => setAssumptionsOpen(false)} />
      )}

      {/* Offscreen PDF report — rendered only during export */}
      {pdfState !== 'idle' && showResults && (
        <div
          aria-hidden
          style={{
            position: 'fixed', left: -10000, top: 0,
            width: 794,
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
