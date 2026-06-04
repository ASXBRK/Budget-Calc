import React from 'react';
import { LEG } from './engine.js';
import {
  C, FONT_BODY, FONT_HEAD, FONT_MONO,
  Card, fmt, fmtDate, useIsMobile,
} from './shared.jsx';

export function TimelineStrip({ purchaseDate, saleDate, isPreCgt, bucket, incomeSupport }) {
  const pdate = purchaseDate ? new Date(purchaseDate) : null;
  const sdate = saleDate ? new Date(saleDate) : null;
  if (!pdate || !sdate) return null;

  const isSplit = bucket === 'B' || bucket === 'D';
  const newRulesLabel = incomeSupport ? 'Indexation' : 'Indexation + 30% min';
  const newRulesLabelFromValue =
    incomeSupport
      ? 'Indexation from market value at 1 July 2027'
      : 'Indexation + 30% min from market value at 1 July 2027';

  let leftLabel, leftColor, rightLabel, rightColor, singleLabel, singleColor;
  if (isSplit) {
    if (bucket === 'B') {
      leftLabel = '50% discount';
      leftColor = C.oldRules;
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
    singleColor = isPreCgt ? C.preCgt : C.oldRules;
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

export function SummaryCards({ result, verdict }) {
  const toneStyles = {
    good: { bg: C.healthyBg, fg: C.healthyText, border: C.healthy },
    bad: { bg: C.riskBg, fg: C.riskText, border: C.risk },
    warn: { bg: C.warningBg, fg: C.warningText, border: C.warning },
    neutral: { bg: C.offWhite, fg: C.textSecondary, border: C.border },
  };
  const v = verdict ? toneStyles[verdict.tone] : toneStyles.neutral;
  const isMobile = useIsMobile();

  const isPreCommencement = result.bucket === 'A';
  const card1Label = isPreCommencement
    ? 'After-tax proceeds'
    : 'After-tax proceeds (actual)';
  const card2Label = isPreCommencement
    ? 'Tax payable (current rules)'
    : 'After-tax (old rules counterfactual)';
  const card1 = result.actual?.afterTaxProceeds ?? 0;
  const card2 = isPreCommencement
    ? (result.actual?.taxOnGain ?? 0)
    : (result.oldRules?.afterTaxProceeds ?? 0);
  const diff = (result.actual?.afterTaxProceeds ?? 0) - (result.oldRules?.afterTaxProceeds ?? 0);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      gap: 12,
    }}>
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
          {isPreCommencement ? 'Difference vs new rules' : 'Difference (after-tax proceeds)'}
        </div>
        {isPreCommencement ? (
          <>
            <div style={{ fontFamily: FONT_HEAD, fontSize: 18, fontWeight: 700, color: C.textSecondary }}>
              Not applicable
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              New rules commence 1 July 2027.
            </div>
          </>
        ) : (
          <div style={{
            fontFamily: FONT_HEAD, fontSize: 26, fontWeight: 700,
            color: diff < 0 ? C.risk : C.healthy,
          }}>
            {diff >= 0 ? '+' : ''}{fmt(diff)}
          </div>
        )}
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

export function AssetTypeFootnote({ assetType }) {
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
