import type { AgentTurn, IntakeAnswers } from '../intake/intake-agent';
import type { IntakeLang } from '../intake/detect-spoken-language';
import { localizedYn, ui } from '../intake/uiCopy';

function money(value?: string) {
  if (!value) return '—';
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return value;
  return `$${n.toLocaleString()}`;
}

function yn(value: boolean | undefined, lang: IntakeLang) {
  if (value == null) return '—';
  return localizedYn(value, lang);
}

function Row({
  label,
  value,
  active,
}: {
  label: string;
  value?: string;
  active?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[1fr_1.2fr] gap-2 border-b border-slate-100 px-3 py-2 text-[12px] last:border-0 ${
        active ? 'bg-emerald-50' : ''
      }`}
    >
      <span className="font-semibold text-slate-500">{label}</span>
      <span className={`text-right font-bold ${value && value !== '—' ? 'text-slate-950' : 'text-slate-300'}`}>
        {value || '—'}
      </span>
    </div>
  );
}

export default function LiveUrlaForm({
  answers,
  turn,
  lang = 'en-US',
}: {
  answers: IntakeAnswers;
  turn: AgentTurn | null;
  lang?: IntakeLang;
}) {
  const copy = ui(lang);
  const L = { ...ui('en-US').labels, ...copy.labels };
  const active = turn?.id;
  const occupancy = answers.occupancy ? copy.occupancy[answers.occupancy] : undefined;
  const program = answers.program === 'UNSURE' ? copy.programUnsure : answers.program;
  const employment = answers.employmentType ? copy.employment[answers.employmentType] : undefined;
  const purpose = answers.loanPurpose ? copy.purpose[answers.loanPurpose] : undefined;

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
          {copy.sectionBorrower}
        </h3>
        <Row label={L.legalName} value={answers.borrowerName} active={active === 'borrowerName'} />
        <Row label={L.email} value={answers.email} active={active === 'email'} />
        <Row label={L.mobile} value={answers.phone} active={active === 'phone'} />
        <Row label={L.ssnLast4} value={answers.ssnLast4 ? `•••-••-${answers.ssnLast4}` : undefined} active={active === 'ssnLast4'} />
        <Row label={L.dob} value={answers.dob} active={active === 'dob'} />
        <Row label={L.citizenship} value={answers.citizenship} active={active === 'citizenship'} />
        <Row label={L.marital} value={answers.maritalStatus} active={active === 'maritalStatus'} />
        <Row label={L.dependents} value={answers.dependentsCount} active={active === 'dependentsCount'} />
        <Row label={L.currentAddress} value={answers.currentAddress} active={active === 'currentAddress'} />
        <Row label={L.housing} value={answers.housingStatus} active={active === 'housingStatus'} />
        <Row label={L.housingPmt} value={money(answers.monthlyHousing)} active={active === 'monthlyHousing'} />
        <Row
          label={L.coborrower}
          value={answers.hasCoborrower ? answers.coborrowerName : answers.hasCoborrower === false ? copy.borrowerOnly : undefined}
          active={active === 'hasCoborrower' || active === 'coborrowerName'}
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
          {copy.sectionLoan}
        </h3>
        <Row label={L.purpose} value={purpose} active={active === 'loanPurpose'} />
        <Row label={L.subjectProperty} value={answers.propertyAddress} active={active === 'propertyAddress'} />
        <Row label={L.propertyType} value={answers.propertyType} active={active === 'propertyType'} />
        <Row label={L.occupancy} value={occupancy} active={active === 'occupancy'} />
        <Row label={L.purchasePrice} value={money(answers.purchasePrice)} active={active === 'purchasePrice'} />
        <Row label={L.loanAmount} value={money(answers.loanAmount)} active={active === 'loanAmount'} />
        <Row label={L.program} value={program} active={active === 'program'} />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
          {copy.sectionIncome}
        </h3>
        <Row label={L.employment} value={employment} active={active === 'employmentType'} />
        <Row label={L.employer} value={answers.employerName} active={active === 'employerName'} />
        <Row label={L.jobTitle} value={answers.jobTitle} active={active === 'jobTitle'} />
        <Row label={L.yearsAtJob} value={answers.yearsAtJob || answers.yearsInBusiness} active={active === 'yearsAtJob' || active === 'yearsInBusiness'} />
        <Row label={L.gross} value={money(answers.monthlyIncome)} active={active === 'monthlyIncome'} />
        <Row
          label={L.secondJob}
          value={answers.hasSecondJob ? `${answers.secondEmployer ?? ''} ${money(answers.secondMonthlyIncome)}` : yn(answers.hasSecondJob, lang)}
          active={active === 'hasSecondJob' || active === 'secondEmployer'}
        />
        <Row
          label={L.otherIncome}
          value={answers.hasOtherIncome ? `${answers.otherIncomeType ?? ''} ${money(answers.otherIncomeMonthly)}` : yn(answers.hasOtherIncome, lang)}
          active={active === 'hasOtherIncome' || active === 'otherIncomeType'}
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
          {copy.sectionAssets}
        </h3>
        <Row label={L.checking} value={money(answers.checkingBalance)} active={active === 'checkingBalance'} />
        <Row label={L.savings} value={money(answers.savingsBalance)} active={active === 'savingsBalance'} />
        <Row label={L.retirement} value={money(answers.retirementBalance)} active={active === 'retirementBalance'} />
        <Row
          label={L.gift}
          value={answers.receivingGift ? `${money(answers.giftAmount)} · ${answers.giftSource ?? ''}` : yn(answers.receivingGift, lang)}
          active={active === 'receivingGift' || active === 'giftAmount'}
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
          {copy.sectionDebts}
        </h3>
        <Row label={L.debts} value={money(answers.monthlyDebts)} active={active === 'monthlyDebts'} />
        <Row
          label={L.alimony}
          value={answers.hasAlimonyOrSupport ? money(answers.alimonyMonthly) : yn(answers.hasAlimonyOrSupport, lang)}
          active={active === 'hasAlimonyOrSupport' || active === 'alimonyMonthly'}
        />
        <Row
          label={L.reo}
          value={answers.ownsOtherRE ? answers.otherReAddress : yn(answers.ownsOtherRE, lang)}
          active={active === 'ownsOtherRE' || active === 'otherReAddress'}
        />
        {answers.ownsOtherRE ? (
          <>
            <Row label={L.reoValue} value={money(answers.otherReValue)} active={active === 'otherReValue'} />
            <Row label={L.reoMortgage} value={money(answers.otherReMortgage)} active={active === 'otherReMortgage'} />
          </>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
          {copy.sectionDeclarations}
        </h3>
        <Row label={L.declOccupy} value={yn(answers.declOccupyPrimary, lang)} active={active === 'declOccupyPrimary'} />
        <Row label={L.declJudgment} value={yn(answers.declJudgment, lang)} active={active === 'declJudgment'} />
        <Row label={L.declBankruptcy} value={yn(answers.declBankruptcy, lang)} active={active === 'declBankruptcy'} />
        <Row label={L.declForeclosure} value={yn(answers.declForeclosure, lang)} active={active === 'declForeclosure'} />
        <Row label={L.declLawsuit} value={yn(answers.declLawsuit, lang)} active={active === 'declLawsuit'} />
        <Row label={L.declFed} value={yn(answers.declDelinquentFed, lang)} active={active === 'declDelinquentFed'} />
        <Row label={L.declBorrowed} value={yn(answers.declBorrowedDown, lang)} active={active === 'declBorrowedDown'} />
        <Row label={L.declCoMaker} value={yn(answers.declCoMaker, lang)} active={active === 'declCoMaker'} />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
          {copy.sectionHmda}
        </h3>
        <Row label={L.military} value={answers.militaryService} active={active === 'militaryService'} />
        <Row label={L.ethnicity} value={answers.hmdaEthnicity} active={active === 'hmdaEthnicity'} />
        <Row label={L.race} value={answers.hmdaRace} active={active === 'hmdaRace'} />
        <Row label={L.sex} value={answers.hmdaSex} active={active === 'hmdaSex'} />
      </section>

      {(answers.program === 'FHA' || answers.program === 'VA' || answers.program === 'USDA') && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
            {copy.sectionAgency}
          </h3>
          {answers.program === 'FHA' && (
            <>
              <Row label={copy.labels.caivrs} value={localizedYn(answers.authorizeCaivrs, lang)} active={active === 'authorizeCaivrs'} />
              <Row
                label={copy.labels.informed}
                value={localizedYn(answers.acknowledgeInformedChoice, lang)}
                active={active === 'acknowledgeInformedChoice'}
              />
            </>
          )}
          {answers.program === 'VA' && (
            <>
              <Row label={copy.labels.disability} value={answers.vaDisabilityRating} active={active === 'vaDisabilityRating'} />
              <Row label={copy.labels.childcare} value={money(answers.vaChildCareExpenses)} active={active === 'vaChildCareExpenses'} />
            </>
          )}
          {answers.program === 'USDA' && (
            <Row
              label={copy.labels.household}
              value={
                answers.householdOccupants?.length
                  ? answers.householdOccupants.map((item) => item.name).join(', ')
                  : answers.addAnotherOccupant === false
                    ? copy.borrowerOnly
                    : undefined
              }
              active={active === 'hasHousehold' || active === 'occupantName'}
            />
          )}
        </section>
      )}
    </div>
  );
}
