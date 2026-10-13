/**
 * The published Terms of Use, Privacy Policy and Legal notices.
 *
 * Held as data rather than JSX so the wording can be reviewed and diffed
 * without reading markup, and so one renderer can lay out all three.
 *
 * The factual claims here describe the architecture in
 * docs/ZDR-Security-Whitepaper.md: borrower documents are parsed in an
 * ephemeral in-memory buffer and never written to disk, only structured
 * metadata is persisted, and a licensed underwriter approves every figure.
 * If that architecture changes, these notices have to change with it.
 *
 * COMPANY carries every value an operator or counsel needs to set. Anything
 * still reading TO BE COMPLETED must be filled in before these pages are
 * published, and LAST_UPDATED must be moved whenever the wording changes.
 */

export const COMPANY = {
  legalName: 'FreeFlow Mortgage Solutions LLC',
  shortName: 'FreeFlow',
  /** Registered entity form and state of organization. */
  entity: 'FreeFlow Mortgage Solutions LLC, an Arizona limited liability company',
  /** Notice address for legal process. */
  address: '21959 E. Bonanza Way, Queen Creek, AZ 85142',
  legalEmail: 'legal@freeflowmortgage.com',
  privacyEmail: 'privacy@freeflowmortgage.com',
  securityEmail: 'security@freeflowmortgage.com',
  salesEmail: 'sales@freeflowmortgage.com',
  /** Toll-free line the CCPA requires of a business that sells or shares; see the privacy notice. */
  privacyPhone: '(844) 356-1181',
  sites: ['freeflowmortgage.com', 'freeflowmortgagesolutions.com'],
  governingState: 'Arizona',
  governingVenue: 'the state and federal courts located in Maricopa County, Arizona',
} as const;

export const LAST_UPDATED = 'October 13, 2026';

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'callout'; title: string; text: string };

export interface Section {
  id: string;
  heading: string;
  blocks: Block[];
}

export interface Notice {
  slug: 'legal' | 'terms' | 'privacy';
  navLabel: string;
  title: string;
  kicker: string;
  summary: string;
  sections: Section[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Terms of Use — the income tool
// ─────────────────────────────────────────────────────────────────────────────

const TERMS: Notice = {
  slug: 'terms',
  navLabel: 'Terms of Use',
  title: 'Terms of Use — Income Intelligence',
  kicker: 'Agreement',
  summary:
    `These terms govern access to ${COMPANY.shortName}'s income analysis tool, which reads borrower income ` +
    'documents and returns structured figures for a licensed underwriter to verify. The tool supports an ' +
    'underwriting decision. It does not make one.',
  sections: [
    {
      id: 'acceptance',
      heading: '1. Acceptance and parties',
      blocks: [
        {
          kind: 'p',
          text:
            `These Terms of Use form a binding agreement between ${COMPANY.legalName} ("${COMPANY.shortName}", "we", "us") ` +
            'and the entity that subscribes to or accesses the Income Intelligence service (the "Customer", "you"). ' +
            'If you access the service on behalf of an employer or client, you represent that you are authorized to ' +
            'bind that organization, and "you" means that organization.',
        },
        {
          kind: 'p',
          text:
            'Where you and we have signed an order form, master services agreement, pilot agreement or data processing ' +
            'agreement covering the service, that document controls over these terms to the extent of any conflict. ' +
            'These terms otherwise apply in full.',
        },
        {
          kind: 'p',
          text:
            'The service is offered to financial institutions, mortgage lenders, brokers and their service providers ' +
            'for business use. It is not offered to consumers, and no part of it creates a relationship between us and ' +
            'any loan applicant whose documents pass through it.',
        },
      ],
    },
    {
      id: 'service',
      heading: '2. What the service does',
      blocks: [
        {
          kind: 'p',
          text:
            'Income Intelligence accepts income documents you upload — tax returns and their schedules, W-2s, pay stubs, ' +
            'verifications of employment and related forms — locates the line items a self-employed or wage income ' +
            'analysis depends on, and presents each figure beside the page and box it was read from. It computes ' +
            'qualifying income in the form of a Fannie Mae Form 1084 style cash flow analysis and can deliver the ' +
            'result to your loan origination system or as a MISMO v3.4 export.',
        },
        {
          kind: 'callout',
          title: 'A licensed underwriter decides',
          text:
            'Every figure the tool produces is presented for human review and must be verified against the source ' +
            'document before it is used. The tool highlights where a number came from precisely so that it can be ' +
            'checked. It does not approve, deny, price, or condition a loan, and it does not determine whether income ' +
            'is stable, continuous or eligible under any guideline.',
        },
        {
          kind: 'p',
          text:
            'We may change, improve or discontinue features. Where a change would materially reduce core functionality ' +
            'during a paid term, we will give you reasonable advance notice.',
        },
      ],
    },
    {
      id: 'license',
      heading: '3. Licence and permitted use',
      blocks: [
        {
          kind: 'p',
          text:
            'We grant you a non-exclusive, non-transferable, revocable right to access and use the service during your ' +
            'subscription term, for your internal business purposes, through the accounts we issue to your authorized ' +
            'users. You may use the output in your loan files, credit decisions, investor deliveries and audits.',
        },
        { kind: 'p', text: 'You will not, and will not permit anyone to:' },
        {
          kind: 'ul',
          items: [
            'resell, sublicense, rent or provide the service to a third party except as a service to your own loan files',
            'copy, decompile, reverse engineer or attempt to derive the source code, models, prompts or extraction logic',
            'use the service to build or train a competing product, or benchmark it for publication without our written consent',
            'circumvent authentication, rate limits, tenancy boundaries or audit logging, or access another tenant\u2019s data',
            'upload malware, or content you have no lawful right to process',
            'use the service where a human underwriter will not review the output',
            'remove or obscure any proprietary notice, or misrepresent the output as an agency or investor determination',
          ],
        },
        {
          kind: 'p',
          text:
            'You are responsible for your users\u2019 activity and for keeping credentials confidential. Tell us promptly at ' +
            `${COMPANY.securityEmail} if you suspect unauthorized access.`,
        },
      ],
    },
    {
      id: 'responsibility',
      heading: '4. Underwriting responsibility and regulatory allocation',
      blocks: [
        {
          kind: 'p',
          text:
            'You are the lender, broker or authorized party of record for every loan file you process. Responsibility for ' +
            'underwriting accuracy, income calculation, debt-to-income determination, guideline eligibility, adverse ' +
            'action notices, disclosure timing and loan salability rests with you. That allocation reflects how the ' +
            'governing rules assign it; it is not a transfer of your obligations to us, and nothing in these terms ' +
            'purports to transfer them.',
        },
        {
          kind: 'p',
          text: 'Accordingly, you agree that you alone are responsible for:',
        },
        {
          kind: 'ul',
          items: [
            'verifying each extracted figure against the source document before relying on it',
            'applying the correct agency, investor or portfolio guideline to the figures, including any overlay',
            'obtaining and documenting the borrower consents and authorizations your processing requires',
            'compliance with ECOA, TILA/RESPA and TRID, HMDA, FCRA, the GLBA Safeguards Rule, state licensing law and any applicable fair lending obligation',
            'all decisions communicated to an applicant',
          ],
        },
        {
          kind: 'p',
          text:
            `${COMPANY.shortName} is not a consumer reporting agency, is not a creditor, is not a mortgage lender or broker, ` +
            'and is not an agency, government-sponsored enterprise or investor. We do not furnish consumer reports and ' +
            'the output is not a consumer report, a credit score, an appraisal, a tax return transcript, or legal, tax or ' +
            'accounting advice.',
        },
      ],
    },
    {
      id: 'data',
      heading: '5. Your data, borrower information and security',
      blocks: [
        {
          kind: 'p',
          text:
            'Documents you upload and the figures derived from them are your data. You grant us only the rights needed ' +
            'to host, process, transmit and support the service for you, and to maintain the audit record the service ' +
            'produces. We do not sell your data, and we do not use borrower documents to train models for other customers.',
        },
        {
          kind: 'p',
          text:
            'Borrower documents are processed in an ephemeral in-memory buffer and are not written to persistent storage ' +
            'by the extraction service. What persists is the structured result — figures, form and page references, ' +
            'coordinates, entity identifiers and the audit trail of human review. Our Privacy Policy describes this in ' +
            'detail, and the Zero-Data-Retention whitepaper describes the architecture behind it.',
        },
        {
          kind: 'p',
          text:
            'When we process borrower non-public personal information on your behalf we act as your service provider and ' +
            'processor, under your instructions and for no independent purpose. You remain the financial institution with ' +
            'the direct relationship to the applicant and the obligations that come with it, including those under the ' +
            'GLBA Privacy Rule and Safeguards Rule.',
        },
        {
          kind: 'p',
          text:
            'We maintain administrative, technical and physical safeguards appropriate to the sensitivity of the data, ' +
            'including encryption in transit, encryption of persisted metadata at rest, tenant isolation enforced in the ' +
            'database, least-privilege access and dependency scanning in our build pipeline. No safeguard is perfect, and ' +
            'we do not warrant that the service will be uninterrupted or free of vulnerabilities.',
        },
        {
          kind: 'p',
          text:
            'Do not upload data you are not authorized to disclose to a service provider, and do not upload categories of ' +
            'data the service is not built for — health records, biometric identifiers or payment card data have no place ' +
            'in an income file.',
        },
      ],
    },
    {
      id: 'ip',
      heading: '6. Intellectual property and feedback',
      blocks: [
        {
          kind: 'p',
          text:
            `The service, including its software, extraction logic, templates, field maps, calculation engine, user ` +
            `interface and documentation, is owned by ${COMPANY.legalName} and its licensors and is protected by ` +
            'intellectual property law. These terms grant access, not ownership, and all rights not expressly granted ' +
            'are reserved.',
        },
        {
          kind: 'p',
          text:
            'If you send us feedback, suggestions or bug reports, we may use them without restriction or obligation. We ' +
            'may also use aggregated, de-identified operational statistics — throughput, accuracy and reliability ' +
            'measures that identify neither you nor any applicant — to operate and improve the service.',
        },
        {
          kind: 'p',
          text:
            'Form names and line references are used descriptively to identify the documents the service reads. Third-party ' +
            'marks belong to their owners and their use does not imply endorsement or affiliation.',
        },
      ],
    },
    {
      id: 'fees',
      heading: '7. Fees, term and termination',
      blocks: [
        {
          kind: 'p',
          text:
            'Fees, billing frequency, usage limits and term are set in your order form. Fees are exclusive of taxes other ' +
            'than those on our net income. Undisputed invoices are due as stated on the order form, and we may suspend ' +
            'access for material non-payment after written notice and a reasonable cure period.',
        },
        {
          kind: 'p',
          text:
            'Either party may terminate for material breach that remains uncured thirty days after written notice. We may ' +
            'suspend access immediately where continued use presents a security risk, a legal risk, or a risk to other ' +
            'customers, and we will restore access once the cause is resolved.',
        },
        {
          kind: 'p',
          text:
            'On termination your licence ends and you must stop using the service. Export your data before the term ends; ' +
            'on request within thirty days after termination we will provide a reasonable export of the structured data ' +
            'associated with your tenant. We will then delete or de-identify it, except where retention is required by law ' +
            'or by a records obligation you have asked us to honour. Sections on responsibility, data, intellectual ' +
            'property, disclaimers, liability, indemnity and governing law survive.',
        },
      ],
    },
    {
      id: 'disclaimer',
      heading: '8. Disclaimer of warranties',
      blocks: [
        {
          kind: 'p',
          text:
            'To the fullest extent permitted by law, the service is provided "as is" and "as available". We disclaim all ' +
            'implied warranties, including merchantability, fitness for a particular purpose, title and non-infringement.',
        },
        {
          kind: 'p',
          text:
            'We do not warrant that extraction will be complete or correct for every document, that a figure will be ' +
            'located on every layout, or that a calculation will match any particular agency, investor or auditor ' +
            'conclusion. Documents vary: substitute forms, preparer software, scan quality, handwriting and amended ' +
            'returns all affect what can be read from a page. Human verification is a condition of use, not a courtesy.',
        },
        {
          kind: 'p',
          text:
            'Demonstration and sandbox surfaces use synthetic data for illustration and must not be relied on for a real ' +
            'loan file.',
        },
      ],
    },
    {
      id: 'liability',
      heading: '9. Limitation of liability',
      blocks: [
        {
          kind: 'p',
          text:
            'Neither party is liable for indirect, incidental, special, consequential, exemplary or punitive damages, or ' +
            'for lost profits, lost revenue, lost data, or loss of goodwill, even if advised of the possibility.',
        },
        {
          kind: 'p',
          text:
            'Our aggregate liability arising out of or relating to the service is limited to the fees you paid or owed for ' +
            'the service in the twelve months before the event giving rise to the claim.',
        },
        {
          kind: 'p',
          text:
            'These limits do not apply to a party\u2019s fraud, wilful misconduct, or liability that cannot be limited by law, ' +
            'and they do not limit your obligation to pay fees due. The limits are an essential basis of the bargain and ' +
            'apply even if a remedy fails of its essential purpose.',
        },
      ],
    },
    {
      id: 'indemnity',
      heading: '10. Indemnification',
      blocks: [
        {
          kind: 'p',
          text:
            'We will defend you against a third-party claim that the service as provided by us infringes that party\u2019s ' +
            'intellectual property right, and pay damages finally awarded or amounts we agree in settlement. We may ' +
            'modify or replace the service, or terminate the affected subscription with a pro-rata refund, to resolve ' +
            'such a claim. This does not cover a claim arising from your data, your combination of the service with ' +
            'anything we did not supply, or use outside these terms.',
        },
        {
          kind: 'p',
          text:
            'You will defend us against a third-party claim arising from your data, your use of the output in a loan ' +
            'decision, your failure to obtain a required consent or authorization, or your breach of these terms, and ' +
            'pay damages finally awarded or amounts you agree in settlement.',
        },
        {
          kind: 'p',
          text:
            'Each indemnity is conditioned on prompt notice, sole control of the defence by the indemnifying party, and ' +
            'reasonable cooperation. No settlement that admits liability or imposes an obligation on the other party may ' +
            'be made without that party\u2019s consent.',
        },
      ],
    },
    {
      id: 'general',
      heading: '11. Governing law, disputes and general terms',
      blocks: [
        {
          kind: 'p',
          text:
            `These terms are governed by the laws of the State of ${COMPANY.governingState}, excluding its conflict-of-laws ` +
            `rules and the UN Convention on Contracts for the International Sale of Goods. The exclusive venue for any ` +
            `dispute is ${COMPANY.governingVenue}, and each party consents to that jurisdiction. Each party waives trial ` +
            'by jury to the extent permitted by law. Either party may seek injunctive relief to protect its intellectual ' +
            'property or confidential information in any competent court.',
        },
        {
          kind: 'p',
          text:
            'This choice of law does not reduce a right that cannot be waived by agreement. A consumer whose personal ' +
            'information we handle keeps every protection the law of their own state of residence gives them, including ' +
            'the California rights described in our Privacy Policy, and may exercise those rights and any remedy that ' +
            'law provides regardless of the governing law and venue stated above.',
        },
        {
          kind: 'p',
          text:
            'You will comply with applicable export control and economic sanctions law and will not make the service ' +
            'available to a prohibited party or region. Neither party may assign these terms without the other\u2019s consent, ' +
            'except to a successor in a merger or sale of substantially all assets.',
        },
        {
          kind: 'p',
          text:
            'If a provision is unenforceable it is limited to the minimum extent necessary and the rest remains in effect. ' +
            'Failure to enforce a provision is not a waiver. These terms, with your order form and any referenced ' +
            'agreement, are the entire agreement on this subject.',
        },
        {
          kind: 'p',
          text:
            'We may update these terms. Material changes take effect at the start of your next renewal term, or thirty ' +
            'days after we post them if you have no fixed term. Continued use after that date is acceptance. Legal ' +
            `notices to us go to ${COMPANY.legalEmail} and to ${COMPANY.address}.`,
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Privacy Policy — including the California notices
// ─────────────────────────────────────────────────────────────────────────────

const PRIVACY: Notice = {
  slug: 'privacy',
  navLabel: 'Privacy Policy',
  title: 'Privacy Policy',
  kicker: 'Privacy',
  summary:
    `How ${COMPANY.legalName} handles personal information, including the notices California law requires. ` +
    'Borrower income documents are processed for our lender customers as their service provider and are not ' +
    'retained after extraction.',
  sections: [
    {
      id: 'scope',
      heading: '1. Scope, and the two roles we play',
      blocks: [
        {
          kind: 'p',
          text:
            `This policy covers ${COMPANY.legalName}'s websites (${COMPANY.sites.join(', ')}), our Income Intelligence ` +
            'tool and the other products in the console. Read it with our Terms of Use.',
        },
        {
          kind: 'p',
          text:
            'We handle personal information in two distinct roles, and your rights differ between them:',
        },
        {
          kind: 'table',
          head: ['Role', 'Whose information', 'Who decides how it is used'],
          rows: [
            [
              'Service provider / processor',
              'Loan applicant information inside documents a lender or broker uploads',
              'Our customer, the financial institution. We act only on its instructions.',
            ],
            [
              'Business / controller',
              'Information about our own users, prospects and website visitors',
              `${COMPANY.shortName}, as described in this policy.`,
            ],
          ],
        },
        {
          kind: 'callout',
          title: 'If you are a loan applicant',
          text:
            'We do not have a direct relationship with you and cannot verify your identity against a loan file. Contact ' +
            'the lender or broker handling your application — they are the financial institution responsible for your ' +
            'information and for responding to your requests. If you contact us, we will refer you to them, and we will ' +
            `help them respond. You can still reach us at ${COMPANY.privacyEmail}.`,
        },
      ],
    },
    {
      id: 'collected',
      heading: '2. Information we collect',
      blocks: [
        {
          kind: 'p',
          text:
            'The California Consumer Privacy Act, as amended by the California Privacy Rights Act, asks us to describe ' +
            'personal information by category. This is our notice at collection.',
        },
        {
          kind: 'table',
          head: ['Category (Civ. Code § 1798.140(v))', 'Examples', 'Why we collect it', 'How long we keep it'],
          rows: [
            [
              'Identifiers',
              'Name, work email, employer, account ID, IP address',
              'Create and secure accounts, support, billing, communications',
              'For the account term plus the period our records and tax obligations require',
            ],
            [
              'Commercial information',
              'Subscription, order form, usage volumes, invoices',
              'Billing, contract administration, capacity planning',
              'Seven years, for tax and audit purposes',
            ],
            [
              'Internet or network activity',
              'Pages viewed, feature usage, error and performance logs',
              'Operate the service, debug failures, prevent abuse',
              'Up to 13 months in operational logs, then aggregated or deleted',
            ],
            [
              'Professional or employment information',
              'Job title, licensing role, underwriting permissions',
              'Role-based access control and audit attribution',
              'For the account term plus the audit retention period',
            ],
            [
              'Audit records of human review',
              'The extracted value, the value a user entered instead, the user, the stated reason, the timestamp',
              'Defensibility of the loan file under investor and regulatory audit',
              'As the customer instructs, to meet its own records obligations',
            ],
            [
              'Applicant information inside uploaded documents',
              'Name, address, SSN, EIN, wages, business income, balance-sheet figures',
              'Extract the figures our customer asked us to extract',
              'The document binary is purged after extraction; structured figures persist for the customer',
            ],
          ],
        },
        {
          kind: 'p',
          text:
            'Sensitive personal information. Income documents can contain a Social Security number, a taxpayer ' +
            'identification number and precise financial account information. We process these only to locate and return ' +
            'the figures our customer requested. We do not use or disclose sensitive personal information to infer ' +
            'characteristics about anyone, which is the use the CPRA gives consumers the right to limit. We do not ' +
            'knowingly collect information from anyone under 16, and the service is not directed to minors.',
        },
        {
          kind: 'p',
          text:
            'Sources. We collect information directly from you, from your organization when it provisions your account, ' +
            'from documents our customers upload, automatically from your device when you use the service, and from ' +
            'service providers who support hosting, error reporting and billing.',
        },
      ],
    },
    {
      id: 'retention',
      heading: '3. How borrower documents are handled',
      blocks: [
        {
          kind: 'p',
          text:
            'Our extraction pipeline is built so that borrower documents do not come to rest on our systems. An uploaded ' +
            'document is transmitted over TLS into an isolated, stateless container with no persistent volume mounted, ' +
            'mapped into memory, read for the figures and page coordinates the analysis needs, and then purged from ' +
            'memory. The document binary is not written to disk and no redacted or re-assembled copy is kept.',
        },
        {
          kind: 'p',
          text:
            'What remains is the structured result: the figures, the form and line they came from, the box coordinates ' +
            'that let an underwriter see the source, business identifiers, and the audit trail of what a human changed and ' +
            'why. That metadata is encrypted at rest, scoped to the customer\u2019s tenant by row-level security enforced in ' +
            'the database, and retained on the customer\u2019s instructions.',
        },
        {
          kind: 'p',
          text:
            'Some surfaces are stricter still. The conversational application and the comparison preview hold their data ' +
            'in the browser session and relay it to the customer\u2019s system without persisting a copy on our side.',
        },
      ],
    },
    {
      id: 'uses',
      heading: '4. How we use information, and automated processing',
      blocks: [
        {
          kind: 'p',
          text:
            'We use personal information to provide, secure, support, bill for and improve the service; to communicate ' +
            'with you about it; to detect and prevent fraud and abuse; and to meet our legal obligations. We rely on the ' +
            'performance of our contract with your organization, our legitimate interest in operating and securing the ' +
            'service, and our legal obligations.',
        },
        {
          kind: 'p',
          text:
            'We do not use personal information for cross-context behavioural advertising, and we do not use borrower ' +
            'documents to train models for other customers. We may use aggregated and de-identified statistics that ' +
            'cannot reasonably be re-identified, and we will not attempt to re-identify them.',
        },
        {
          kind: 'p',
          text:
            'Automated processing. The service reads documents and computes income figures automatically. It does not ' +
            'make a decision about anyone. A licensed underwriter at our customer reviews each figure against the source ' +
            'document and makes the lending decision, and the interface is built to require that review. We therefore do ' +
            'not use automated decisionmaking technology to make a significant decision about a consumer. Any ' +
            'explanation of a credit decision comes from the lender, which holds the file and the decision.',
        },
      ],
    },
    {
      id: 'disclosure',
      heading: '5. Who we disclose information to',
      blocks: [
        {
          kind: 'p',
          text:
            'We disclose personal information for business purposes to the following, under contracts that restrict them ' +
            'to our instructions:',
        },
        {
          kind: 'ul',
          items: [
            'the customer organization whose loan file the information belongs to, and the users it authorizes',
            'cloud hosting and database providers that run the service',
            'the customer\u2019s loan origination system or connector, when the customer directs delivery',
            'billing, support, error-reporting and communication providers',
            'professional advisers, auditors and insurers, where confidentiality applies',
            'an acquirer or successor in a merger, financing or sale of assets, subject to this policy',
            'authorities, where a valid legal process or a legal obligation requires it, or to protect rights and safety',
          ],
        },
        {
          kind: 'callout',
          title: 'We do not sell or share personal information',
          text:
            'In the twelve months before the date of this policy we did not sell personal information, and we did not ' +
            'share it for cross-context behavioural advertising, as those terms are defined by the CCPA. We do not offer ' +
            'financial incentives for personal information, and we are not registered as a data broker under the ' +
            'California Delete Act because we do not sell personal information to parties with which consumers lack a ' +
            'direct relationship.',
        },
      ],
    },
    {
      id: 'ca-rights',
      heading: '6. California privacy rights (CCPA / CPRA)',
      blocks: [
        {
          kind: 'p',
          text:
            'If you are a California resident, the CCPA as amended by the CPRA gives you the following rights in the ' +
            'personal information for which we are the business:',
        },
        {
          kind: 'ul',
          items: [
            'Know and access — the categories and specific pieces we hold, the sources, our purposes, and the categories of recipients, including beyond the prior 12 months where we hold it',
            'Delete — subject to the exceptions the statute allows, such as completing a transaction, security, and legal compliance',
            'Correct — inaccurate personal information about you',
            'Portability — a copy in a readily usable format',
            'Opt out of sale or sharing — we do neither, so there is nothing to opt out of and we publish no "Do Not Sell or Share My Personal Information" link',
            'Limit the use of sensitive personal information — we use it only for permitted purposes, so this right is already satisfied',
            'Non-discrimination and no retaliation for exercising any of these rights',
          ],
        },
        {
          kind: 'p',
          text:
            `To make a request, email ${COMPANY.privacyEmail} or call ${COMPANY.privacyPhone}, with enough detail for us ` +
            'to identify the information at ' +
            'issue. We will acknowledge within 10 business days and respond within 45 calendar days, extendable once by a ' +
            'further 45 days with notice to you. We verify requests by matching the request against information we ' +
            'already hold, and may ask for additional confirmation proportionate to the sensitivity of what is requested. ' +
            'We will not require you to create an account to make a request.',
        },
        {
          kind: 'p',
          text:
            'An authorized agent may act for you with your signed permission; we may still ask you to verify your own ' +
            'identity and confirm the agent\u2019s authority. If we deny a request we will explain why, and you may ask us to ' +
            'reconsider at the same address or complain to the California Privacy Protection Agency or the Attorney General.',
        },
        {
          kind: 'callout',
          title: 'Information covered by the GLBA',
          text:
            'Much of the borrower information that passes through the service is non-public personal information collected ' +
            'by a financial institution under the Gramm-Leach-Bliley Act. The CCPA expressly exempts that information, ' +
            'and California\u2019s own financial privacy statute governs it instead. For anything in that category, the ' +
            'lender or broker that collected it is the right place to direct a request. We will support our customer in ' +
            'responding, as our contracts require.',
        },
      ],
    },
    {
      id: 'ca-other',
      heading: '7. Other California notices',
      blocks: [
        {
          kind: 'p',
          text:
            'California Financial Information Privacy Act (SB 1, Fin. Code § 4050 et seq.). When we process a borrower\u2019s ' +
            'non-public personal information we do so solely as the financial institution\u2019s service provider, to perform ' +
            'the services it has engaged us for. We do not disclose that information to a third party for that party\u2019s own ' +
            'marketing, and the consent and opt-out notices this statute requires come from the financial institution that ' +
            'holds the customer relationship.',
        },
        {
          kind: 'p',
          text:
            'Shine the Light (Civ. Code § 1798.83). We do not disclose personal information to third parties for their ' +
            'direct marketing purposes. A California resident may nonetheless request confirmation once per year, free of ' +
            `charge, by writing to ${COMPANY.privacyEmail}.`,
        },
        {
          kind: 'p',
          text:
            'California Online Privacy Protection Act (Bus. & Prof. Code § 22575 et seq.). This policy is linked from the ' +
            'footer of our sites and names the categories we collect and share, the process for reviewing changes, and the ' +
            'date it was last revised. Our sites do not track visitors across third-party sites, so we have no behavioural ' +
            'tracking to disable; we honour Global Privacy Control and Do Not Track signals by not engaging in that ' +
            'tracking at all.',
        },
        {
          kind: 'p',
          text:
            'Rights of minors (Bus. & Prof. Code § 22581). Our service is a business tool and is not directed to minors, ' +
            'and we do not permit users under 18 to register. If a registered minor in California has posted content ' +
            `through our sites, they may request its removal at ${COMPANY.privacyEmail}.`,
        },
        {
          kind: 'p',
          text:
            'Breach notification (Civ. Code § 1798.82). If we determine that unencrypted or unredacted personal ' +
            'information was acquired by an unauthorized person, we will notify affected individuals and our affected ' +
            'customers in the most expedient time possible and without unreasonable delay, and will make any report the ' +
            'statute requires to the Attorney General. Our contracts commit us to prompt notice to the customer so that ' +
            'it can meet its own obligations.',
        },
      ],
    },
    {
      id: 'cookies',
      heading: '8. Cookies and analytics',
      blocks: [
        {
          kind: 'p',
          text:
            'We use the cookies and local storage the service needs to work: keeping you signed in, remembering your ' +
            'workspace state, holding an in-progress draft on your own device, and protecting against abuse. These are ' +
            'strictly necessary and cannot be switched off without breaking the product.',
        },
        {
          kind: 'p',
          text:
            'Where we measure product performance we do so with first-party, aggregated measurement. We do not run ' +
            'third-party advertising or cross-site tracking cookies. Your browser can block or delete cookies, which may ' +
            'sign you out or lose an unsaved draft.',
        },
      ],
    },
    {
      id: 'transfers',
      heading: '9. Security, transfers and other jurisdictions',
      blocks: [
        {
          kind: 'p',
          text:
            'Safeguards include TLS in transit, AES-256 encryption of persisted metadata with managed keys, tenant ' +
            'isolation enforced at the database level, least-privilege and audited administrative access, and automated ' +
            'dependency and static analysis in our build pipeline. No system is perfectly secure, and we cannot guarantee ' +
            'absolute security.',
        },
        {
          kind: 'p',
          text:
            'We operate in the United States and information is processed there. Where we process information subject to ' +
            'another jurisdiction\u2019s law, including the laws of other US states with comprehensive privacy statutes, we ' +
            'extend the access, correction, deletion and portability rights described above on the same terms, and we ' +
            'will honour any additional right that law requires.',
        },
      ],
    },
    {
      id: 'contact',
      heading: '10. Changes and contact',
      blocks: [
        {
          kind: 'p',
          text:
            'We will revise this policy as the service changes and will update the date at the top. Where a change ' +
            'materially affects how we handle personal information we will give notice through the service or by email ' +
            'before it takes effect.',
        },
        {
          kind: 'p',
          text:
            `Privacy questions and requests: ${COMPANY.privacyEmail}. Security reports: ${COMPANY.securityEmail}. ` +
            `Legal notices: ${COMPANY.legalEmail}. Postal address: ${COMPANY.address}. Privacy request line: ` +
            `${COMPANY.privacyPhone}.`,
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Legal — the hub
// ─────────────────────────────────────────────────────────────────────────────

const LEGAL: Notice = {
  slug: 'legal',
  navLabel: 'Legal',
  title: 'Legal',
  kicker: 'Notices',
  summary:
    `The agreements, disclosures and notices that govern ${COMPANY.legalName}'s software, in one place.`,
  sections: [
    {
      id: 'documents',
      heading: 'Published agreements',
      blocks: [
        {
          kind: 'table',
          head: ['Document', 'What it covers', 'Where'],
          rows: [
            [
              'Terms of Use',
              'Access to the income tool, permitted use, underwriting responsibility, warranties and liability',
              '#terms',
            ],
            [
              'Privacy Policy',
              'How personal information is handled, including the California notices and privacy rights',
              '#privacy',
            ],
            [
              'Zero-Data-Retention whitepaper',
              'The security architecture behind the retention claims, for your TPRM and security review',
              `Available from ${COMPANY.salesEmail}`,
            ],
            [
              'Order form and master agreement',
              'Fees, term, service levels, support and any negotiated data processing terms',
              'Issued to each customer',
            ],
          ],
        },
      ],
    },
    {
      id: 'nature',
      heading: 'What this software is, and is not',
      blocks: [
        {
          kind: 'p',
          text:
            `${COMPANY.legalName} builds software that reads mortgage documents and presents the figures to a licensed ` +
            'professional for verification. Our products support a decision made by our customer. They do not make it.',
        },
        {
          kind: 'ul',
          items: [
            `${COMPANY.shortName} is not a mortgage lender, broker, correspondent or servicer, and originates no loans`,
            'we are not a consumer reporting agency and the output is not a consumer report under the FCRA',
            'we are not an appraiser and the appraisal review tools do not produce an opinion of value',
            'we are not an agency, a government-sponsored enterprise, or an investor, and we speak for none of them',
            'nothing we publish or output is legal, tax, accounting or compliance advice',
            'figures are calculated from the documents supplied and must be verified against those documents before use',
          ],
        },
        {
          kind: 'p',
          text:
            'Responsibility for underwriting accuracy, guideline eligibility, disclosures and every communication to an ' +
            'applicant rests with the lender or broker of record. The Terms of Use set out that allocation in full.',
        },
      ],
    },
    {
      id: 'demo',
      heading: 'Demonstration data',
      blocks: [
        {
          kind: 'p',
          text:
            'Public demonstrations, sandbox surfaces and sample documents use synthetic data. Borrower names, Social ' +
            'Security numbers, employer identification numbers, addresses and figures in those surfaces are fabricated ' +
            'for illustration, describe no real person or business, and must never be used in a live loan file.',
        },
      ],
    },
    {
      id: 'trademarks',
      heading: 'Trademarks and third-party references',
      blocks: [
        {
          kind: 'p',
          text:
            `${COMPANY.legalName}, ${COMPANY.shortName} and our logos are marks of ${COMPANY.legalName}. All other marks ` +
            'belong to their respective owners.',
        },
        {
          kind: 'p',
          text:
            'We name IRS forms and schedules, agency forms and worksheets, MISMO standards, and loan origination systems ' +
            'descriptively, to identify the documents our software reads and the systems it delivers to. Fannie Mae, ' +
            'Freddie Mac, MISMO, ICE Mortgage Technology and Encompass, among others, are marks of their owners. Their ' +
            'use here is nominative and implies no affiliation, sponsorship, endorsement, certification or approval.',
        },
        {
          kind: 'p',
          text:
            'Our software includes open-source components used under their own licences. A current list of components and ' +
            `licences is available on request from ${COMPANY.legalEmail}.`,
        },
      ],
    },
    {
      id: 'security',
      heading: 'Security and vulnerability reporting',
      blocks: [
        {
          kind: 'p',
          text:
            `Report a suspected vulnerability to ${COMPANY.securityEmail}. Please give us enough detail to reproduce the ` +
            'issue and a reasonable period to remediate before disclosing it. We will acknowledge your report, keep you ' +
            'informed, and will not pursue a researcher who acts in good faith, avoids privacy violations and data ' +
            'destruction, and stays within scope.',
        },
        {
          kind: 'p',
          text:
            'Do not test against production tenants, do not access data that is not yours, and do not upload real ' +
            'borrower documents in the course of testing.',
        },
      ],
    },
    {
      id: 'accessibility',
      heading: 'Accessibility',
      blocks: [
        {
          kind: 'p',
          text:
            'We aim to meet WCAG 2.1 Level AA in the underwriting console and are improving against it as we go. If any ' +
            `part of the product presents a barrier, write to ${COMPANY.legalEmail} describing what you were trying to do ` +
            'and the assistive technology you use, and we will work with you on an accessible route to the same outcome.',
        },
      ],
    },
    {
      id: 'notices',
      heading: 'Notices and contact',
      blocks: [
        {
          kind: 'table',
          head: ['Subject', 'Contact'],
          rows: [
            ['Legal notices and service of process', `${COMPANY.legalEmail} · ${COMPANY.address}`],
            ['Privacy requests', `${COMPANY.privacyEmail} · ${COMPANY.privacyPhone}`],
            ['Security reports', COMPANY.securityEmail],
            ['Sales and security review packets', COMPANY.salesEmail],
          ],
        },
        {
          kind: 'p',
          text: `Registered entity: ${COMPANY.entity}.`,
        },
      ],
    },
  ],
};

export const NOTICES: Notice[] = [LEGAL, TERMS, PRIVACY];

export function noticeFor(slug: Notice['slug']): Notice {
  return NOTICES.find((notice) => notice.slug === slug) ?? LEGAL;
}
