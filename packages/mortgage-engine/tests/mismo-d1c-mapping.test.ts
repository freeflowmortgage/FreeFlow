import { 
  generateMismoD1cVerificationBlock, 
  generateMismoIncomeVerificationSourceBlock,
  VerificationServicePayload 
} from '../src/mismoD1cMapper';

describe('MISMO v3.4 Day 1 Certainty (D1C) XML Exporter Tests', () => {
  
  describe('generateMismoD1cVerificationBlock', () => {
    test('should correctly generate XML for Plaid with appropriate vendor codes and identifiers', () => {
      const payload: VerificationServicePayload = {
        vendorName: 'PLAID',
        reportIdentifier: 'plaid-rep-12345',
        verificationDate: '2026-08-28',
        monthlyIncomeAmount: 7500.00
      };

      const xml = generateMismoD1cVerificationBlock(payload);

      // Verify essential XML elements and structure
      expect(xml).toContain('<ServiceType>Verification</ServiceType>');
      expect(xml).toContain('<ServiceTypeOtherDescription>EmploymentAndIncomeVerification</ServiceTypeOtherDescription>');
      expect(xml).toContain('<VerificationServiceProductType>EmploymentAndIncomeVerification</VerificationServiceProductType>');
      expect(xml).toContain('<VerificationRequestDatetime>2026-08-28T00:00:00Z</VerificationRequestDatetime>');
      
      // Verify D1C vendor mapping fields
      expect(xml).toContain('<VerificationReportIdentifier>plaid-rep-12345</VerificationReportIdentifier>');
      expect(xml).toContain('<VerificationVendorIdentifier>Plaid_Income</VerificationVendorIdentifier>');
      expect(xml).toContain('<VerificationVendorName>Plaid Technologies Inc.</VerificationVendorName>');
    });

    test('should correctly generate XML for Truework with appropriate vendor codes', () => {
      const payload: VerificationServicePayload = {
        vendorName: 'TRUEWORK',
        reportIdentifier: 'tw-verification-9988',
        verificationDate: '2026-08-27',
        monthlyIncomeAmount: 9200.50
      };

      const xml = generateMismoD1cVerificationBlock(payload);

      expect(xml).toContain('<VerificationReportIdentifier>tw-verification-9988</VerificationReportIdentifier>');
      expect(xml).toContain('<VerificationVendorIdentifier>Truework_Income</VerificationVendorIdentifier>');
      expect(xml).toContain('<VerificationVendorName>Truework Inc.</VerificationVendorName>');
    });

    test('should correctly generate XML for Argyle', () => {
      const payload: VerificationServicePayload = {
        vendorName: 'ARGYLE',
        reportIdentifier: 'argyle-report-uuid-777',
        verificationDate: '2026-08-28',
        monthlyIncomeAmount: 6400.00
      };

      const xml = generateMismoD1cVerificationBlock(payload);

      expect(xml).toContain('<VerificationReportIdentifier>argyle-report-uuid-777</VerificationReportIdentifier>');
      expect(xml).toContain('<VerificationVendorIdentifier>Argyle_Employment</VerificationVendorIdentifier>');
      expect(xml).toContain('<VerificationVendorName>Argyle Outcomes Inc.</VerificationVendorName>');
    });

    test('should correctly generate XML for The Work Number (Equifax)', () => {
      const payload: VerificationServicePayload = {
        vendorName: 'THE_WORK_NUMBER',
        reportIdentifier: 'ewn-txn-443322',
        verificationDate: '2026-08-28',
        monthlyIncomeAmount: 11000.00
      };

      const xml = generateMismoD1cVerificationBlock(payload);

      expect(xml).toContain('<VerificationReportIdentifier>ewn-txn-443322</VerificationReportIdentifier>');
      expect(xml).toContain('<VerificationVendorIdentifier>The_Work_Number</VerificationVendorIdentifier>');
      expect(xml).toContain('<VerificationVendorName>Equifax Workforce Solutions</VerificationVendorName>');
    });

    test('should throw error for unsupported third-party vendors', () => {
      const invalidPayload = {
        vendorName: 'UNAUTHORIZED_SCRAPER' as any,
        reportIdentifier: 'bad-id-111',
        verificationDate: '2026-08-28',
        monthlyIncomeAmount: 5000.00
      };

      expect(() => {
        generateMismoD1cVerificationBlock(invalidPayload);
      }).toThrow('[MISMO EXPORT ERROR] Unsupported Day 1 Certainty Vendor: UNAUTHORIZED_SCRAPER');
    });
  });

  describe('generateMismoIncomeVerificationSourceBlock', () => {
    test('should set verification type to AutomatedIncomeVerificationService when API source is direct', () => {
      const xml = generateMismoIncomeVerificationSourceBlock(8500.25, true);

      expect(xml).toContain('<IncomeSourceAmount>8500.25</IncomeSourceAmount>');
      expect(xml).toContain('<IncomeSourceVerificationType>AutomatedIncomeVerificationService</IncomeSourceVerificationType>');
      expect(xml).toContain('<IncomeSourceFrequencyType>Monthly</IncomeSourceFrequencyType>');
    });

    test('should set verification type to Manual when direct API flag is false', () => {
      const xml = generateMismoIncomeVerificationSourceBlock(12000.00, false);

      expect(xml).toContain('<IncomeSourceAmount>12000.00</IncomeSourceAmount>');
      expect(xml).toContain('<IncomeSourceVerificationType>Manual</IncomeSourceVerificationType>');
    });

    test('should handle floating point numbers and round to standard currency format', () => {
      const xml = generateMismoIncomeVerificationSourceBlock(5432.19999, true);

      expect(xml).toContain('<IncomeSourceAmount>5432.20</IncomeSourceAmount>');
    });
  });

});
