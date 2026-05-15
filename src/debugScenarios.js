// Debug scenarios for engine verification. Not part of end-user flow.
// Add more by appending to DEBUG_SCENARIOS.

import { LEG } from './engine.js';

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

// Build engine inputs from a scenario spec. Derives sale_price from the
// scenario's growth assumption so each row is self-contained.
export function buildScenarioInputs(spec) {
  const pd = new Date(spec.purchase_date);
  const sd = new Date(spec.sale_date);
  const totalYears = Math.max((sd - pd) / MS_PER_YEAR, 0);
  let salePrice;

  // Sale price always derives from purchase price × growth over the full hold.
  // For pre-CGT post-2027 scenarios this lets us compare different value_2027
  // assumptions for the *same* underlying asset.
  salePrice = (spec.purchase_price || 50000) * Math.pow(1 + spec.return_rate, totalYears);

  return {
    mode: 'specific',
    asset_type: spec.asset_type || 'shares',
    purchase_date: spec.purchase_date,
    sale_date: spec.sale_date,
    purchase_price: spec.purchase_price || 0,
    acquisition_costs: 0,
    capital_improvements: 0,
    depreciation_claimed: 0,
    sale_costs: 0,
    sale_price: Math.round(salePrice),
    inflation: spec.inflation,
    other_income: spec.other_income,
    income_support_recipient: !!spec.income_support_recipient,
    valuation_method: spec.valuation_method || 'ATO_formula',
    value_2027: spec.value_2027 || 0,
    is_pre_cgt: !!spec.is_pre_cgt,
    return_rate: spec.return_rate,
  };
}

export const DEBUG_SCENARIOS = [
  {
    name: 'Bucket A — low gain, low income',
    purchase_date: '2025-05-15',
    sale_date: '2026-06-01',
    purchase_price: 100000,
    return_rate: 0.06,
    inflation: 0.025,
    other_income: 0,
    income_support_recipient: false,
    notes: 'Discounted gain sits inside the $18,200 tax-free threshold. Both lines should be 0%.',
  },
  {
    name: 'Bucket A — high gain, top MTR',
    purchase_date: '2024-05-15',
    sale_date: '2027-06-01',
    purchase_price: 500000,
    return_rate: 0.08,
    inflation: 0.025,
    other_income: 250000,
    income_support_recipient: false,
    notes: 'Sale pre-2027. Both regimes apply the same rules → both ~23.5% (50% disc × 47% MTR).',
  },
  {
    name: 'Bucket B — low income, modest hold',
    purchase_date: '2022-01-01',
    sale_date: '2032-01-01',
    purchase_price: 100000,
    return_rate: 0.06,
    inflation: 0.025,
    other_income: 0,
    income_support_recipient: false,
    valuation_method: 'ATO_formula',
    notes: 'Split. Old very low (threshold absorbs); new higher because 30% floor bites on post-2027 portion.',
  },
  {
    name: 'Bucket B — top MTR, long hold',
    purchase_date: '2015-01-01',
    sale_date: '2040-01-01',
    purchase_price: 200000,
    return_rate: 0.07,
    inflation: 0.025,
    other_income: 300000,
    income_support_recipient: false,
    valuation_method: 'ATO_formula',
    notes: 'Old ~23.5% (50% disc on whole gain). New climbs above as indexation removes the shelter and 47% MTR applies to real gain.',
  },
  {
    name: 'Bucket C — short hold, top MTR',
    purchase_date: '2027-08-01',
    sale_date: '2029-08-01',
    purchase_price: 100000,
    return_rate: 0.06,
    inflation: 0.025,
    other_income: 250000,
    income_support_recipient: false,
    notes: 'Old counterfactual ~23.5%. New higher: full MTR on real gain, indexation light over 2 years.',
  },
  {
    name: 'Bucket C — long hold, top MTR',
    purchase_date: '2027-08-01',
    sale_date: '2047-08-01',
    purchase_price: 100000,
    return_rate: 0.07,
    inflation: 0.03,
    other_income: 250000,
    income_support_recipient: false,
    notes: 'Indexation eats much of the gain over 20y. New can sit lower than old (~23.5%).',
  },
  {
    name: 'Bucket C — income support, low MTR (floor lifted)',
    purchase_date: '2027-08-01',
    sale_date: '2037-08-01',
    purchase_price: 100000,
    return_rate: 0.06,
    inflation: 0.025,
    other_income: 30000,
    income_support_recipient: true,
    notes: '30% floor removed. New = marginal only on real gain. Compare with row 8.',
  },
  {
    name: 'Bucket C — no income support, low MTR (floor binds)',
    purchase_date: '2027-08-01',
    sale_date: '2037-08-01',
    purchase_price: 100000,
    return_rate: 0.06,
    inflation: 0.025,
    other_income: 30000,
    income_support_recipient: false,
    notes: '30% floor applies. New should be higher than row 7 — direct comparison.',
  },
  {
    name: 'Pre-CGT — pre-2027 sale',
    purchase_date: '1980-01-01',
    sale_date: '2027-06-01',
    purchase_price: 50000,
    return_rate: 0.08,
    inflation: 0.03,
    other_income: 100000,
    income_support_recipient: false,
    is_pre_cgt: true,
    notes: 'Pre-CGT, sale pre-commencement. Exempt under both regimes — both lines 0%.',
  },
  {
    name: 'Pre-CGT — post-2027 sale, ATO formula proxy',
    purchase_date: '1980-01-01',
    sale_date: '2040-06-01',
    purchase_price: 50000,
    return_rate: 0.08,
    inflation: 0.03,
    other_income: 100000,
    income_support_recipient: false,
    is_pre_cgt: true,
    valuation_method: 'ATO_formula',
    // 50k * 1.08^47 ≈ $1.86M by 1 Jul 2027 — used as the deemed cost base.
    value_2027: 1860000,
    notes: 'Old line stays 0% (pre-CGT exempt counterfactually). New > 0% on post-2027 growth from MV reset.',
  },
  {
    name: 'Pre-CGT — post-2027 sale, manual valuation higher than ATO formula',
    purchase_date: '1980-01-01',
    sale_date: '2040-06-01',
    purchase_price: 50000,
    return_rate: 0.08,
    inflation: 0.03,
    other_income: 100000,
    income_support_recipient: false,
    is_pre_cgt: true,
    valuation_method: 'use_entered_value',
    value_2027: 2400000,
    notes: 'Higher cost base than row 10. New tax lower (less taxable post-2027 real gain).',
  },
  {
    name: 'Edge case — exactly 12 months held',
    purchase_date: '2028-01-01',
    sale_date: '2029-01-01',
    purchase_price: 100000,
    return_rate: 0.06,
    inflation: 0.025,
    other_income: 80000,
    income_support_recipient: false,
    notes: 'Engine: holdingYears >= 1 → 50% discount eligible under old. Indexation factor ≈ 1.025.',
  },
];
