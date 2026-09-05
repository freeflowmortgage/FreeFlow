import { PrismaClient, UserRole, ApplicationStatus, PropertyType } from '@prisma/client';

const prisma = new PrismaClient();

const STAGING_TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const STAGING_USER_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const STAGING_LOAN_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const STAGING_APPRAISAL_ID = 'd4e5f6a7-b8c9-0123-def0-234567890123';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: STAGING_TENANT_ID },
    update: {
      companyName: 'FreeFlow Staging Brokerage',
      nmlsId: '123456',
      primaryContactEmail: 'uw-staging@freeflow.local',
      isBillingActive: true,
    },
    create: {
      id: STAGING_TENANT_ID,
      companyName: 'FreeFlow Staging Brokerage',
      nmlsId: '123456',
      primaryContactEmail: 'uw-staging@freeflow.local',
      isBillingActive: true,
    },
  });

  await prisma.tenantConfiguration.upsert({
    where: { tenantId: tenant.id },
    update: {
      enable1084Ocr: true,
      enableEncompassSync: true,
      enableUshdaValidation: true,
      enableAppraisalReview: true,
    },
    create: {
      tenantId: tenant.id,
      enable1084Ocr: true,
      enableEncompassSync: true,
      enableUshdaValidation: true,
      enableAppraisalReview: true,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'underwriter.staging@freeflow.local' },
    update: {
      oidcSubject: 'freeflow-staging-underwriter',
      tenantId: tenant.id,
      firstName: 'Avery',
      lastName: 'Underwood',
      role: UserRole.UNDERWRITER,
    },
    create: {
      id: STAGING_USER_ID,
      oidcSubject: 'freeflow-staging-underwriter',
      tenantId: tenant.id,
      email: 'underwriter.staging@freeflow.local',
      firstName: 'Avery',
      lastName: 'Underwood',
      role: UserRole.UNDERWRITER,
    },
  });

  const loan = await prisma.loanApplication.upsert({
    where: { id: STAGING_LOAN_ID },
    update: {
      tenantId: tenant.id,
      primaryBorrowerName: 'Alex M. Morgan',
      primaryBorrowerEmail: 'alex.morgan@example.test',
      status: ApplicationStatus.IN_QA_REVIEW,
    },
    create: {
      id: STAGING_LOAN_ID,
      tenantId: tenant.id,
      primaryBorrowerName: 'Alex M. Morgan',
      primaryBorrowerEmail: 'alex.morgan@example.test',
      status: ApplicationStatus.IN_QA_REVIEW,
    },
  });

  await prisma.appraisalAudit.upsert({
    where: { id: STAGING_APPRAISAL_ID },
    update: {
      loanId: loan.id,
      caseNumber: 'CA-1928005-A',
      intendedUse: 'FHA purchase underwriting',
      extractedCompsGrid: {
        highlights: [
          { code: 'URAR_SUBJECT_CONTRACT', pageIndex: 0, box: [12, 18, 76, 5] },
          { code: 'URAR_CRAWLSPACE_ACC_VIOLATION', pageIndex: 2, box: [15, 60, 70, 5] },
        ],
      },
    },
    create: {
      id: STAGING_APPRAISAL_ID,
      loanId: loan.id,
      caseNumber: 'CA-1928005-A',
      intendedUse: 'FHA purchase underwriting',
      highestAndBestUse: true,
      loanMaturityDate: new Date('2056-09-01'),
      yearBuilt: 1968,
      propertyType: PropertyType.SINGLE_FAMILY,
      neighborhoodTrend: 'STABLE',
      mcMedianPriceCurrentQuarter: 1150000,
      mcMedianPricePriorYearQuarter: 1120000,
      mcMonthsSupplyCurrentQuarter: 2.5,
      extractedCompsGrid: {
        program: 'FHA',
        highlights: [
          { code: 'URAR_SUBJECT_CONTRACT', pageIndex: 0, box: [12, 18, 76, 5] },
          { code: 'URAR_PHYSICAL_REPAIRS', pageIndex: 1, box: [12, 55, 76, 6] },
          { code: 'URAR_CRAWLSPACE_ACC_VIOLATION', pageIndex: 2, box: [15, 60, 70, 5] },
        ],
      },
      verifiedByUserId: user.id,
    },
  });

  console.log('Seeded staging tenant configurations:');
  console.log(`  tenant=${tenant.id}`);
  console.log(`  user=${user.email}`);
  console.log(`  loan=${loan.id}`);
  console.log(`  appraisal=${STAGING_APPRAISAL_ID}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
