import React, { useState } from 'react';
import { LEG, INPUT_LIMITS } from './engine.js';
import {
  C, FONT_BODY, FONT_MONO,
  Card, CardHeader, Label,
  PRE_CGT_VALUE_INFO, INCOME_SUPPORT_INFO, VALUATION_INFO, CAPITAL_WORKS_INFO,
  MAX_PURCHASE_DATE_STR, isValidPurchaseDate,
} from './shared.jsx';

export function NumberInput({
  value, onChange, prefix = '$', step = 1, min, max,
  helperText, formatCap = (n) => `${prefix}${n.toLocaleString('en-AU')}`,
}) {
  const [notice, setNotice] = useState(null);
  const handle = (raw) => {
    let v = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(v)) v = 0;
    if (Number.isFinite(max) && v > max) {
      v = max;
      setNotice(`Value capped at ${formatCap(max)} — please review`);
      setTimeout(() => setNotice(null), 4000);
    }
    if (Number.isFinite(min) && v < min) v = min;
    onChange(v);
  };
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', border: `1px solid ${notice ? C.warning : C.border}`,
        borderRadius: 8, padding: '6px 10px', background: C.white,
      }}>
        {prefix && <span style={{ color: C.textMuted, marginRight: 6, fontSize: 13 }}>{prefix}</span>}
        <input
          type="number"
          value={value === '' ? '' : value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => handle(e.target.value)}
          style={{
            border: 'none', outline: 'none', width: '100%', fontSize: 14,
            fontFamily: FONT_MONO, color: C.textPrimary, background: 'transparent',
          }}
        />
      </div>
      {(notice || helperText) && (
        <div style={{
          fontSize: 10, marginTop: 4,
          color: notice ? C.warningText : C.textMuted,
        }}>
          {notice || helperText}
        </div>
      )}
    </div>
  );
}

export function DateInput({ value, onChange }) {
  return (
    <input
      type="date"
      value={value}
      min="1900-01-01"
      max={MAX_PURCHASE_DATE_STR}
      onChange={(e) => {
        // Silently reject malformed/out-of-range dates. The browser allows
        // pasting or typing past min/max in some configurations; this is the
        // last line of UI defence before state.
        if (isValidPurchaseDate(e.target.value)) onChange(e.target.value);
      }}
      style={{
        border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px',
        fontSize: 13, fontFamily: FONT_BODY, color: C.textPrimary, background: C.white,
        width: '100%', boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
}

export function Select({ value, onChange, options }) {
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

export function Slider({ value, onChange, min, max, step, format }) {
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

export function Toggle({ value, onChange, options, disabled }) {
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

export function UnifiedInputs({ inputs, update, isPreCgt, v2027CapNotice }) {
  const purchase = new Date(inputs.purchase_date);
  const showValuationToggle = !isPreCgt && purchase < LEG.newRulesStart;
  const showValue2027ManualInput = showValuationToggle && inputs.valuation_method === 'use_entered_value';
  const isProperty = inputs.asset_type === 'property';
  const purchaseYear = purchase.getFullYear();
  // Slider range, decoupled from purchase date for old assets so the user
  // can always reach post-commencement sale dates.
  const focusYearsMin = Math.max(1, 2026 - purchaseYear);
  const focusYearsMax = Math.max(25, 2050 - purchaseYear);

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
              onChange={(v) => update(
                v === 'property'
                  ? { asset_type: v }
                  : { asset_type: v, capital_improvements: 0, depreciation_claimed: 0 }
              )}
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
              <NumberInput
                value={inputs.value_2027}
                onChange={(v) => update({ value_2027: v, value_2027_manual: v > 0 })}
                min={INPUT_LIMITS.value_2027.min}
                max={INPUT_LIMITS.value_2027.max}
                helperText={
                  v2027CapNotice
                    ? 'ATO formula estimate exceeds cap. Manual valuation recommended.'
                    : 'Min $0, max $100M'
                }
              />
            </div>
          )}
          {!isPreCgt && (
            <>
              <div>
                <Label>Purchase price</Label>
                <NumberInput
                  value={inputs.purchase_price}
                  onChange={(v) => update({ purchase_price: v })}
                  min={INPUT_LIMITS.purchase_price.min}
                  max={INPUT_LIMITS.purchase_price.max}
                  helperText="Min $1, max $100M"
                />
              </div>
              {isProperty && (
                <>
                  <div>
                    <Label>{acqLabel}</Label>
                    <NumberInput
                      value={inputs.acquisition_costs}
                      onChange={(v) => update({ acquisition_costs: v })}
                      min={INPUT_LIMITS.acquisition_costs.min}
                      max={INPUT_LIMITS.acquisition_costs.max}
                      helperText="Max $10M"
                    />
                  </div>
                  <div>
                    <Label>{improvementsLabel}</Label>
                    <NumberInput
                      value={inputs.capital_improvements}
                      onChange={(v) => update({ capital_improvements: v })}
                      min={INPUT_LIMITS.capital_improvements.min}
                      max={INPUT_LIMITS.capital_improvements.max}
                      helperText="Total spent on additions, renovations, or extensions. Max $10M."
                    />
                  </div>
                  <div>
                    <Label info={CAPITAL_WORKS_INFO} infoTitle="Capital works deductions">
                      Capital works deductions claimed
                    </Label>
                    <NumberInput
                      value={inputs.depreciation_claimed}
                      onChange={(v) => update({ depreciation_claimed: v })}
                      min={INPUT_LIMITS.depreciation_claimed.min}
                      max={INPUT_LIMITS.depreciation_claimed.max}
                      helperText="Max $10M"
                    />
                  </div>
                  <div>
                    <Label>Sale costs (agent, conveyancing)</Label>
                    <NumberInput
                      value={inputs.sale_costs}
                      onChange={(v) => update({ sale_costs: v })}
                      min={INPUT_LIMITS.sale_costs.min}
                      max={INPUT_LIMITS.sale_costs.max}
                      helperText="Max $10M"
                    />
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
            value={Math.min(focusYearsMax, Math.max(focusYearsMin, inputs.focus_years))}
            onChange={(v) => update({ focus_years: v })}
            min={focusYearsMin}
            max={focusYearsMax}
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
              value={Math.min(25, Math.max(0, inputs.return_rate * 100))}
              onChange={(v) => update({ return_rate: v / 100 })}
              min={0} max={25} step={0.1}
              format={(v) => `${v.toFixed(1)}%`}
            />
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>Max 25% per year</div>
          </div>
          <div>
            <Label>Annual inflation</Label>
            <Slider
              value={Math.min(10, Math.max(0, inputs.inflation * 100))}
              onChange={(v) => update({ inflation: v / 100 })}
              min={0} max={10} step={0.1}
              format={(v) => `${v.toFixed(1)}%`}
            />
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>Max 10% per year</div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Tax position" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Label>Other taxable income (drives marginal rate)</Label>
            <NumberInput
              value={inputs.other_income}
              onChange={(v) => update({ other_income: v })}
              min={INPUT_LIMITS.other_income.min}
              max={INPUT_LIMITS.other_income.max}
              helperText="Max $5M"
            />
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
              <NumberInput
                value={inputs.value_2027}
                onChange={(v) => update({ value_2027: v, value_2027_manual: v > 0 })}
                min={INPUT_LIMITS.value_2027.min}
                max={INPUT_LIMITS.value_2027.max}
                helperText="Min $0, max $100M"
              />
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
