export const PERMISSIONS = [
  'loan:read',
  'income:process',
  'income:calculate',
  'income:approve',
  'encompass:pull',
  'encompass:sync',
  'billing:admin',
  'appraisal:review',
  'share:create',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type ApplicationRole =
  | 'SUPER_ADMIN'
  | 'BROKER_OWNER'
  | 'LOAN_OFFICER'
  | 'PROCESSOR'
  | 'UNDERWRITER'
  | 'BORROWER';

const ROLE_PERMISSIONS: Readonly<Record<ApplicationRole, readonly Permission[]>> = Object.freeze({
  SUPER_ADMIN: PERMISSIONS,
  BROKER_OWNER: PERMISSIONS,
  UNDERWRITER: [
    'loan:read',
    'income:process',
    'income:calculate',
    'income:approve',
    'encompass:pull',
    'encompass:sync',
    'appraisal:review',
    'share:create',
  ],
  PROCESSOR: ['loan:read', 'income:process', 'income:calculate', 'encompass:pull', 'appraisal:review'],
  LOAN_OFFICER: ['loan:read'],
  BORROWER: [],
});

export function permissionsForRole(role: ApplicationRole): readonly Permission[] {
  return Object.freeze([...(ROLE_PERMISSIONS[role] ?? [])]);
}
