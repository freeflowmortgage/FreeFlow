import { resolve1065Ownership } from '../src/calculateForm1084Income';
import type { Form1065Entry } from '../src/calculateForm1084Income';

function entry(overrides: Partial<Form1065Entry>): Form1065Entry {
  return {
    year: 2024,
    ownershipPercentage: 50,
    k1OrdinaryIncome: 0,
    ...overrides,
  } as Form1065Entry;
}

describe('K-1 Item J ownership basis', () => {
  test('FNMA uses ending capital when the two agree', () => {
    const resolved = resolve1065Ownership(
      entry({ profitPercentageEnd: 40, capitalPercentageEnd: 40 }),
      'FNMA',
    );
    expect(resolved.percentage).toBe(40);
    expect(resolved.basis).toBe('ENDING_CAPITAL');
    expect(resolved.note).toBeUndefined();
  });

  test('Freddie uses ending profit when the two agree', () => {
    const resolved = resolve1065Ownership(
      entry({ profitPercentageEnd: 40, capitalPercentageEnd: 40 }),
      'FREDDIE',
    );
    expect(resolved.percentage).toBe(40);
    expect(resolved.basis).toBe('ENDING_PROFIT');
  });

  test('takes the lower figure when profit and capital disagree', () => {
    // A partnership agreement can split profit and capital differently. Taking
    // the agency's own figure at face value would share more income to the
    // borrower than the other agency would allow.
    const forFnma = resolve1065Ownership(
      entry({ profitPercentageEnd: 50, capitalPercentageEnd: 30 }),
      'FNMA',
    );
    expect(forFnma.percentage).toBe(30);
    expect(forFnma.basis).toBe('ENDING_CAPITAL');

    const forFreddie = resolve1065Ownership(
      entry({ profitPercentageEnd: 50, capitalPercentageEnd: 30 }),
      'FREDDIE',
    );
    expect(forFreddie.percentage).toBe(30);
    expect(forFreddie.basis).toBe('ENDING_CAPITAL');
  });

  test('explains which figure was applied and why', () => {
    const resolved = resolve1065Ownership(
      entry({ profitPercentageEnd: 25, capitalPercentageEnd: 60 }),
      'FNMA',
    );
    expect(resolved.percentage).toBe(25);
    expect(resolved.basis).toBe('ENDING_PROFIT');
    expect(resolved.note).toContain('ending profit 25%');
    expect(resolved.note).toContain('ending capital 60%');
    expect(resolved.note).toContain('FNMA');
    expect(resolved.note).toContain('partnership agreement');
  });

  test('falls back to the stated percentage when Item J is missing', () => {
    const resolved = resolve1065Ownership(entry({ ownershipPercentage: 75 }), 'FNMA');
    expect(resolved.percentage).toBe(75);
    expect(resolved.basis).toBe('STATED');
  });

  test('uses whichever Item J figure is present when only one was read', () => {
    const onlyCapital = resolve1065Ownership(entry({ capitalPercentageEnd: 33 }), 'FREDDIE');
    expect(onlyCapital.percentage).toBe(33);
    expect(onlyCapital.basis).toBe('ENDING_CAPITAL');

    const onlyProfit = resolve1065Ownership(entry({ profitPercentageEnd: 44 }), 'FNMA');
    expect(onlyProfit.percentage).toBe(44);
    expect(onlyProfit.basis).toBe('ENDING_PROFIT');
  });
});
