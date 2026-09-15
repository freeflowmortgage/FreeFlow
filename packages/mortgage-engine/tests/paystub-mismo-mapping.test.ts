import {
  canonicalPaystubFromFields,
  generatePaystubCurrentIncomeItemsXml,
  generatePaystubMismo34Message,
  mapPaystubToCanonical,
  normalizePaymentFrequencyType,
} from '../src/paystubMismoMapper';
import { buildMismo34Xml } from '../../../apps/underwriting-console/src/intake/mismoExport';

describe('paystub MISMO canonical mapping', () => {
  const fields = [
    { sourceFieldId: 'ps-employer-name', value: 'Apex Technology Partners LLC', numericValue: 0 },
    { sourceFieldId: 'ps-pay-frequency', value: 'SemiMonthly', numericValue: 0 },
    { sourceFieldId: 'ps-hourly-rate', numericValue: 45 },
    { sourceFieldId: 'ps-hours-week', numericValue: 40 },
    { sourceFieldId: 'ps-current-base', numericValue: 3600 },
    { sourceFieldId: 'ps-base-ytd', numericValue: 54800 },
    { sourceFieldId: 'ps-ot-ytd', numericValue: 4200 },
    { sourceFieldId: 'ps-bonus-ytd', numericValue: 11000 },
    { sourceFieldId: 'ps-commission-ytd', numericValue: 6000 },
    { sourceFieldId: 'ps-tips-ytd', numericValue: 1800 },
    { sourceFieldId: 'ps-rsu-ytd', numericValue: 7500 },
  ];

  test('normalizes UI and payroll frequency labels to MISMO enums', () => {
    expect(normalizePaymentFrequencyType('SEMIMONTHLY')).toBe('SemiMonthly');
    expect(normalizePaymentFrequencyType('bi-weekly')).toBe('Biweekly');
    expect(normalizePaymentFrequencyType('Weekly')).toBe('Weekly');
  });

  test('keeps sick-inclusive base, tips, and RSU as first-class buckets', () => {
    const document = canonicalPaystubFromFields(fields, {
      employeeFirstName: 'Sarah',
      employeeLastName: 'Vance',
    });

    expect(document.documentMetadata.paymentFrequencyType).toBe('SemiMonthly');
    expect(document.calculatedUnderwritingSummary).toMatchObject({
      totalBasePayYTD: 54800,
      totalOvertimeYTD: 4200,
      totalBonusYTD: 11000,
      totalCommissionYTD: 6000,
      totalTipsYTD: 1800,
      totalRsuYTD: 7500,
      derivedCalculatedMonthlyBase: 7200,
    });
    expect(document.earningsLineItems.map((item) => item.mismoIncomeType)).toEqual([
      'BasePay',
      'Overtime',
      'Bonus',
      'Commissions',
      'Tips',
      'RestrictedStockUnits',
    ]);
    expect(document.earningsLineItems.find((item) => item.mismoIncomeType === 'BasePay')?.isQualifyingBase).toBe(true);
    expect(document.earningsLineItems.find((item) => item.mismoIncomeType === 'RestrictedStockUnits')?.ytdAmount).toBe(
      7500,
    );
  });

  test('does not alias RSU onto OtherIncome when otherYtd is the same amount', () => {
    const document = mapPaystubToCanonical({
      rsuYtd: 7500,
      otherYtd: 7500,
      tipsYtd: 1800,
    });
    expect(document.calculatedUnderwritingSummary.totalRsuYTD).toBe(7500);
    expect(document.earningsLineItems.some((item) => item.mismoIncomeType === 'OtherIncome')).toBe(false);
    expect(document.earningsLineItems.some((item) => item.mismoIncomeType === 'Tips')).toBe(true);
  });

  test('emits CURRENT_INCOME XML with RSU and Tips buckets', () => {
    const document = canonicalPaystubFromFields(fields, {
      employeeFirstName: 'Sarah',
      employeeLastName: 'Vance',
    });
    const xml = generatePaystubMismo34Message(document);

    expect(xml).toContain('<PaymentFrequencyType>SemiMonthly</PaymentFrequencyType>');
    expect(xml).toContain('<IncomeType>BasePay</IncomeType>');
    expect(xml).toContain('<CurrentIncomeMonthlyTotalAmount>7200.00</CurrentIncomeMonthlyTotalAmount>');
    expect(xml).toContain('<IncomeType>Overtime</IncomeType>');
    expect(xml).toContain('<IncomeType>Bonus</IncomeType>');
    expect(xml).toContain('<IncomeType>Commissions</IncomeType>');
    expect(xml).toContain('<IncomeTypeOtherDescription>Tips</IncomeTypeOtherDescription>');
    expect(xml).toContain('<IncomeTypeOtherDescription>RestrictedStockUnits</IncomeTypeOtherDescription>');
    expect(xml).toMatch(/RestrictedStockUnits[\s\S]*<YearToDateAmount>7500.00<\/YearToDateAmount>/);
    expect(xml).toMatch(/Tips[\s\S]*<YearToDateAmount>1800.00<\/YearToDateAmount>/);
    expect(xml).toContain('<FullName>Apex Technology Partners LLC</FullName>');
  });

  test('nests paystub CURRENT_INCOME into the URLA MISMO export without dropping employers', () => {
    const document = canonicalPaystubFromFields(fields);
    const xml = buildMismo34Xml(
      {
        borrowerName: 'Sarah K. Vance',
        employmentType: 'W2',
        employerName: 'Apex Technology Partners LLC',
        yearsAtJob: '2',
        monthlyIncome: '6500',
        hasSecondJob: true,
        secondEmployer: 'Meridian Health Systems',
        secondMonthlyIncome: '900',
        previousEmployer: 'Digital Solutions Corp',
        previousEmployerYears: '4',
      },
      document,
    );

    expect(xml).toContain('<EmploymentMonthlyIncomeAmount>6500</EmploymentMonthlyIncomeAmount>');
    expect(xml).toContain('<PaymentFrequencyType>SemiMonthly</PaymentFrequencyType>');
    expect(xml).toContain('<EmploymentStatusType>Current</EmploymentStatusType>');
    expect(generatePaystubCurrentIncomeItemsXml(document)).toContain(
      '<IncomeTypeOtherDescription>RestrictedStockUnits</IncomeTypeOtherDescription>',
    );
    expect(xml).toContain('<IncomeTypeOtherDescription>RestrictedStockUnits</IncomeTypeOtherDescription>');
    expect(xml).toContain('Meridian Health Systems');
    expect(xml).toContain('Digital Solutions Corp');
  });
});
