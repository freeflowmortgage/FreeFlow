/**
 * The panel computes its own 1084 rather than calling the engine, so the
 * distribution test has to hold here too. A recorded history is a claim; the
 * K-1 is the evidence, and when they disagree the evidence governs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  corpDistributionSupport,
  distributionShortfallBadge,
  distributionShortfallMessage,
  scheduleLQuickRatio,
  type CorpYear,
  type ScheduleL,
} from './components/selfEmployedIncome';

const EMPTY_SHEET: ScheduleL = {
  cash: 0, receivables: 0, allowance: 0, taxExempt: 0, otherCurrentAssets: 0,
  accountsPayable: 0, notesLt1Yr: 0, otherCurrentLiab: 0, currentLiabilities: 0,
};

/** Quick ratio 3.62 — comfortably liquid. */
const LIQUID_SHEET: ScheduleL = {
  ...EMPTY_SHEET,
  cash: 210_000, receivables: 18_000,
  accountsPayable: 42_000, notesLt1Yr: 15_000, otherCurrentLiab: 6_000,
};

/** Quick ratio 0.40 — not liquid. */
const ILLIQUID_SHEET: ScheduleL = {
  ...EMPTY_SHEET,
  cash: 20_000, receivables: 5_000,
  accountsPayable: 42_000, notesLt1Yr: 15_000, otherCurrentLiab: 6_000,
};

function year(overrides: Partial<CorpYear> = {}): CorpYear {
  return {
    year: 2025,
    ordinaryIncome: 0, netRentalRealEstate: 0, otherNetRental: 0,
    depreciation: 0, gain4797: 0, otherIncome: 0,
    depreciation1125A: 0, depreciation8825: 0, depletion: 0, mealsM1: 0,
    guaranteedPayments: 0, otherNoncash: 0, w2Wages: 0, distributions: 0,
    ...overrides,
  };
}

test('a recorded history the K-1 contradicts no longer passes the income through', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 48_000 });
  const support = corpDistributionSupport(row, 120_000, true, false);

  assert.equal(support.annual, 48_000);
  assert.deepEqual(support.shortfall, {
    businessIncome: 120_000,
    distributed: 48_000,
    restsOnLiquidity: false,
  });
});

test('a passing Schedule L carries the shortfall but still reports it', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 48_000 });
  const support = corpDistributionSupport(row, 120_000, true, true);

  assert.equal(support.annual, 120_000, 'liquidity is the other route Fannie Mae allows');
  assert.equal(support.shortfall?.restsOnLiquidity, true);
});

test('with no balance sheet to test there is nothing holding up the shortfall', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 48_000 });
  const support = corpDistributionSupport(row, 120_000, true, null);

  assert.equal(support.annual, 48_000);
  assert.equal(support.shortfall?.restsOnLiquidity, false);
});

test('distributions that cover the business income raise nothing', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 130_000 });
  const support = corpDistributionSupport(row, 120_000, true, null);

  assert.equal(support.annual, 120_000);
  assert.equal(support.shortfall, null);
});

test('guaranteed payments are a contractual draw and are not held against distributions', () => {
  const row = year({ ordinaryIncome: 96_000, guaranteedPayments: 24_000, distributions: 96_000 });
  const support = corpDistributionSupport(row, 120_000, true, null);

  assert.equal(support.annual, 120_000, 'only the $96k business share is tested');
  assert.equal(support.shortfall, null);
});

test('a capped business share still keeps the guaranteed payments whole', () => {
  const row = year({ ordinaryIncome: 96_000, guaranteedPayments: 24_000, distributions: 40_000 });
  const support = corpDistributionSupport(row, 120_000, true, null);

  assert.equal(support.annual, 64_000, '40,000 distributed plus 24,000 guaranteed');
  assert.equal(support.shortfall?.businessIncome, 96_000);
});

test('an unclaimed history caps as before and raises no contradiction', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 48_000 });
  const support = corpDistributionSupport(row, 120_000, false, true);

  assert.equal(support.annual, 48_000);
  assert.equal(support.shortfall, null, 'nothing was claimed, so nothing is contradicted');
});

test('the message names the ratio the income now rests on', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 48_000 });
  const ratio = scheduleLQuickRatio(LIQUID_SHEET);
  const support = corpDistributionSupport(row, 120_000, true, ratio.passes);

  const message = distributionShortfallMessage('Partnership', 'Box 19A', support.shortfall!, ratio);
  assert.match(message, /Box 19A reports distributions of \$48,000\.00/);
  assert.match(message, /\$72,000\.00 shortfall rests on the Schedule L quick ratio of 3\.62/);
  assert.equal(distributionShortfallBadge(support.shortfall), 'K-1 below income · carried by Schedule L');
});

test('the message says the balance sheet was never provided when it was not', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 48_000 });
  const ratio = scheduleLQuickRatio(EMPTY_SHEET);
  const support = corpDistributionSupport(row, 120_000, true, ratio.provided ? ratio.passes : null);

  const message = distributionShortfallMessage('Partnership', 'Box 19A', support.shortfall!, ratio);
  assert.match(message, /Schedule L liquidity was not provided/);
  assert.match(message, /capped at the \$48,000\.00 actually distributed/);
  assert.equal(distributionShortfallBadge(support.shortfall), 'K-1 below income · capped');
});

test('a failing balance sheet is reported as a failing ratio, not as a missing one', () => {
  const row = year({ ordinaryIncome: 120_000, distributions: 48_000 });
  const ratio = scheduleLQuickRatio(ILLIQUID_SHEET);
  const support = corpDistributionSupport(row, 120_000, true, ratio.passes);

  assert.equal(support.annual, 48_000);
  const message = distributionShortfallMessage('S-Corp', 'Box 16D', support.shortfall!, ratio);
  assert.match(message, /Schedule L quick ratio 0\.40 is below 1\.0/);
});
