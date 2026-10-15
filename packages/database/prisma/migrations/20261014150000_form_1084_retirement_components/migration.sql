-- Form 1040 Social Security (Line 6a/6b) and retirement income (pension Line 5a/5b
-- plus IRA Line 4a/4b) are exported as their own approved income components so the
-- JSON and MISMO drops reconcile to the qualifying total.
ALTER TABLE "form_1084_audits"
  ADD COLUMN "socialSecurityMonthly" DECIMAL(12, 2),
  ADD COLUMN "retirementIncomeMonthly" DECIMAL(12, 2);
