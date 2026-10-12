import {
  ELAPSED_MONTHS_TOLERANCE,
  daysInYear,
  dayOfYear,
  elapsedMonthsAgree,
  isLeapYear,
  parseStubDate,
  paystubCoverage,
} from '../src/paystubCoverage';
import { annualizePaystub } from '../src/paystubAnnualization';

describe('paystubCoverage', () => {
  test('a year-end stub is the last pay period of the year, not a 12/31 date', () => {
    // Every one of these is the final stub of 2025 for its own payroll calendar.
    const lastOfYear = [
      { periodEnd: '12/31/2025', payFrequency: 'SEMIMONTHLY' as const },
      { periodEnd: '12/28/2025', payFrequency: 'WEEKLY' as const },
      { periodEnd: '12/26/2025', payFrequency: 'BIWEEKLY' as const },
      { periodEnd: '12/20/2025', payFrequency: 'BIWEEKLY' as const },
      { periodEnd: '12/18/2025', payFrequency: 'BIWEEKLY' as const },
      { periodEnd: '12/15/2025', payFrequency: 'MONTHLY' as const },
      { periodEnd: '12/02/2025', payFrequency: 'MONTHLY' as const },
    ];
    for (const stub of lastOfYear) {
      const coverage = paystubCoverage({ taxYear: 2025, ...stub });
      expect(coverage.status).toBe('READY');
      expect(coverage.coversFullYear).toBe(true);
      expect(coverage.elapsedMonths).toBe(12);
    }
  });

  test('a December stub with another period still to come does not cover the full year', () => {
    const semimonthly = paystubCoverage({ taxYear: 2025, periodEnd: '12/15/2025', payFrequency: 'SEMIMONTHLY' });
    expect(semimonthly.coversFullYear).toBe(false);
    expect(semimonthly.elapsedMonths).toBeCloseTo((349 / 365) * 12, 2);
    const biweekly = paystubCoverage({ taxYear: 2025, periodEnd: '12/12/2025', payFrequency: 'BIWEEKLY' });
    expect(biweekly.coversFullYear).toBe(false);
    const weekly = paystubCoverage({ taxYear: 2025, periodEnd: '12/21/2025', payFrequency: 'WEEKLY' });
    expect(weekly.coversFullYear).toBe(false);
  });

  test('a mid-year stub is measured by the share of the year its period end reached', () => {
    const august = paystubCoverage({ taxYear: 2025, periodEnd: '08/15/2025', payFrequency: 'SEMIMONTHLY' });
    expect(august.coversFullYear).toBe(false);
    expect(august.elapsedMonths).toBeCloseTo(7.5, 1);
    expect(august.daysRemainingInTaxYear).toBe(138);
    const january = paystubCoverage({ taxYear: 2025, periodEnd: '01/15/2025', payFrequency: 'SEMIMONTHLY' });
    expect(january.elapsedMonths).toBeCloseTo(0.49, 2);
    expect(january.status).toBe('READY');
  });

  test('leap years shift the day count', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInYear(2024)).toBe(366);
    expect(dayOfYear({ year: 2024, month: 3, day: 1 })).toBe(61);
    expect(dayOfYear({ year: 2025, month: 3, day: 1 })).toBe(60);
    expect(paystubCoverage({ taxYear: 2024, periodEnd: '12/29/2024', payFrequency: 'BIWEEKLY' }).coversFullYear).toBe(true);
  });

  test('reads the formats payroll vendors print and refuses the rest', () => {
    expect(parseStubDate('12/31/2025')).toEqual({ year: 2025, month: 12, day: 31 });
    expect(parseStubDate('1/5/26')).toEqual({ year: 2026, month: 1, day: 5 });
    expect(parseStubDate('2025-12-26')).toEqual({ year: 2025, month: 12, day: 26 });
    expect(parseStubDate('12-26-2025')).toEqual({ year: 2025, month: 12, day: 26 });
    expect(parseStubDate('02/30/2025')).toBeNull();
    expect(parseStubDate('13/01/2025')).toBeNull();
    expect(parseStubDate('December 26, 2025')).toBeNull();
    expect(parseStubDate('')).toBeNull();
    expect(parseStubDate(undefined)).toBeNull();
  });

  test('falls back to the pay date and fails closed without either', () => {
    const byPayDate = paystubCoverage({ taxYear: 2025, payDate: '12/26/2025', payFrequency: 'BIWEEKLY' });
    expect(byPayDate.coversFullYear).toBe(true);
    expect(byPayDate.periodEndIso).toBe('2025-12-26');
    expect(paystubCoverage({ taxYear: 2025, payFrequency: 'BIWEEKLY' }).gaps).toEqual(['PERIOD_END_REQUIRED']);
    expect(paystubCoverage({ taxYear: 2025, periodEnd: 'n/a' }).gaps).toEqual(['PERIOD_END_UNREADABLE']);
  });

  test('a period end outside the tax year is a gap, not a silent divisor', () => {
    const coverage = paystubCoverage({ taxYear: 2025, periodEnd: '01/09/2026', payFrequency: 'BIWEEKLY' });
    expect(coverage.status).toBe('GAPS');
    expect(coverage.gaps).toEqual(['PERIOD_END_OUTSIDE_TAX_YEAR']);
    expect(coverage.elapsedMonths).toBeNull();
  });

  test('a stub near the year end needs the pay frequency to answer the year-end question', () => {
    const december = paystubCoverage({ taxYear: 2025, periodEnd: '12/20/2025' });
    expect(december.status).toBe('GAPS');
    expect(december.gaps).toEqual(['PAY_FREQUENCY_REQUIRED_FOR_YEAR_END']);
    expect(december.elapsedMonths).toBeNull();
    expect(december.daysRemainingInTaxYear).toBe(11);
    // Outside that window the frequency cannot change the answer.
    const june = paystubCoverage({ taxYear: 2025, periodEnd: '06/30/2025' });
    expect(june.status).toBe('READY');
    expect(june.elapsedMonths).toBeCloseTo(5.95, 2);
  });

  test('the derived figure is what annualizePaystub needs to read a year-end stub', () => {
    const coverage = paystubCoverage({ taxYear: 2025, periodEnd: '12/26/2025', payFrequency: 'BIWEEKLY' });
    const annualized = annualizePaystub({
      baseYtd: 96000, overtimeYtd: 12000, bonusYtd: 6000,
      elapsedMonths: coverage.elapsedMonths ?? undefined, baseMethod: 'ytd',
    });
    expect(annualized.status).toBe('READY');
    expect(annualized.annualBase).toBe(96000);
    expect(annualized.annualVariable).toBe(18000);
    // The mid-year default on the same document is what this replaces.
    expect(annualizePaystub({ baseYtd: 96000, elapsedMonths: 7.5, baseMethod: 'ytd' }).annualBase).toBe(153600);
  });

  test('agreement is tolerant of a payroll calendar but not of a wrong divisor', () => {
    expect(ELAPSED_MONTHS_TOLERANCE).toBe(0.5);
    expect(elapsedMonthsAgree(12, 12)).toBe(true);
    expect(elapsedMonthsAgree(11.84, 12)).toBe(true);
    expect(elapsedMonthsAgree(7.5, 7.56)).toBe(true);
    expect(elapsedMonthsAgree(7.5, 12)).toBe(false);
    expect(elapsedMonthsAgree(12, 6)).toBe(false);
  });
});
