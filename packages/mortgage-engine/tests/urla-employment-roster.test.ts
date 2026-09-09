import { buildMismo34Xml } from '../../../apps/underwriting-console/src/intake/mismoExport';
import {
  DEMO_URLA_ENTITIES,
  employmentEntitiesFromMismo,
  employmentEntitiesFromUrlA,
  namesMatch,
  resolveUrlARoster,
} from '../../../apps/underwriting-console/src/urlaEmploymentRoster';

describe('1003 / URLA employment roster', () => {
  test('lists every employer, second job, prior employer, and REO from intake', () => {
    const roster = employmentEntitiesFromUrlA({
      employmentType: 'SELF_EMPLOYED',
      employerName: 'Vance Technology Consulting',
      yearsInBusiness: '6',
      monthlyIncome: '9200',
      hasSecondJob: true,
      secondEmployer: 'Meridian Health Systems',
      secondMonthlyIncome: '1200',
      previousEmployer: 'Digital Solutions Corp',
      previousEmployerYears: '3',
      ownsOtherRE: true,
      otherReAddress: '742 Evergreen Terrace, Springfield, IL',
    });

    expect(roster.map((entity) => `${entity.classification}:${entity.name}`)).toEqual([
      'Primary:Vance Technology Consulting',
      'Secondary:Meridian Health Systems',
      'Previous:Digital Solutions Corp',
      'REO:742 Evergreen Terrace, Springfield, IL',
    ]);
    expect(roster[0].selfEmployed).toBe(true);
    expect(roster[0].kind).toBe('self-employed');
    expect(roster[1].kind).toBe('wages');
    expect(roster[3].kind).toBe('rental');
  });

  test('reads every EMPLOYER block from a MISMO 1003 export and does not stop at the first', () => {
    const xml = buildMismo34Xml({
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
    });

    const roster = employmentEntitiesFromMismo(xml);
    expect(roster).toHaveLength(3);
    expect(roster.map((entity) => entity.name)).toEqual([
      'Apex Technology Partners LLC',
      'Meridian Health Systems',
      'Digital Solutions Corp',
    ]);
    expect(roster.map((entity) => entity.classification)).toEqual(['Primary', 'Secondary', 'Previous']);
  });

  test('falls back to the demo 1003 list when no live application is present', () => {
    expect(resolveUrlARoster({ fallbackToDemo: true }).length).toBe(DEMO_URLA_ENTITIES.length);
    expect(resolveUrlARoster({}).length).toBe(0);
  });

  test('matches legal-suffix variants of the same 1003 business name', () => {
    expect(namesMatch('Apex Advisory Holdings LLC', 'Apex Advisory Holdings')).toBe(true);
    expect(namesMatch('Horizon Property Partners', 'Horizon Property Partners LLP')).toBe(true);
    expect(namesMatch('Vance Technology Consulting', 'Meridian Health Systems')).toBe(false);
  });
});
