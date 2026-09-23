import {
  buildEncompassLoanUpdate,
  type Form1084EncompassIncome,
  type Urla1003Intake,
} from '@mortgage-pos/mortgage-engine';
import type { IntakeAnswers } from './intake-agent';

/**
 * AI 1003 session → Encompass loan PATCH + fieldWriter contract.
 * IntakeAnswers is a structural Urla1003Intake; 1084 income is optional.
 */
export function buildEncompassPayloadFromIntake(
  answers: IntakeAnswers,
  income1084?: Form1084EncompassIncome,
) {
  return buildEncompassLoanUpdate({
    urla: answers as Urla1003Intake,
    income1084,
  });
}
