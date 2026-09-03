import type { IntakeLang } from './detect-spoken-language';
import type { IntakeAnswers, IntakeChoice } from './intake-agent';
import { firstName } from './intake-agent';

type Copy = {
  kicker: string;
  title: string;
  subtitle: (detected: string | null, spoken: string) => string;
  startCall: string;
  endCall: string;
  speaking: string;
  listening: string;
  callMode: string;
  voiceOff: string;
  typeHere: string;
  replyLabel: string;
  liveUrla: string;
  coreFields: (n: number) => string;
  helperFallback: string;
  optionMiss: string;
  listeningPh: string;
  voiceBlocked: string;
  voiceTypeOnly: string;
  callOnIos: string;
  callOn: string;
  callSpeakOnly: string;
  exportAria: string;
  sendAria: string;
  micAria: string;
  stopAria: string;
  sectionBorrower: string;
  sectionLoan: string;
  sectionIncome: string;
  sectionAssets: string;
  sectionDebts: string;
  sectionDeclarations: string;
  sectionHmda: string;
  sectionAgency: string;
  labels: Record<string, string>;
  occupancy: Record<string, string>;
  employment: Record<string, string>;
  purpose: Record<string, string>;
  programUnsure: string;
  borrowerOnly: string;
  yes: string;
  no: string;
  choices: Record<string, string>;
  helpers: Record<string, string>;
  placeholders: Record<string, string>;
  gotIt: string;
};

const EN: Copy = {
  kicker: 'FreeFlow · Broker microservice',
  title: 'AI 1003',
  subtitle: (detected, spoken) => (detected ? `Detected ${detected}` : spoken),
  startCall: 'Chat now',
  endCall: 'Stop voice',
  speaking: 'Speaking…',
  listening: 'Listening…',
  callMode: 'Voice on',
  voiceOff: 'Voice off',
  typeHere: 'Type your answer here',
  replyLabel: 'Your reply',
  liveUrla: 'Live URLA / FNMA 1003',
  coreFields: (n) => `${n} URLA fields`,
  helperFallback: '',
  optionMiss: 'I did not catch which option. Say it again, tap a button, or type.',
  listeningPh: 'Listening…',
  voiceBlocked: 'Voice is not available in this browser. Chrome or Edge works best.',
  voiceTypeOnly: 'This browser cannot listen. Use Chrome or Edge, or type.',
  callOnIos: 'Voice is on. I will read each question; tap the mic to answer.',
  callOn: 'Voice is on. I will read each question, then listen.',
  callSpeakOnly: 'I can speak, but this browser cannot listen. Type your answers.',
  exportAria: 'Export',
  sendAria: 'Send',
  micAria: 'Mic',
  stopAria: 'Stop',
  sectionBorrower: 'Section 1a · Borrower information',
  sectionLoan: 'Section 4a · Loan & property',
  sectionIncome: 'Section 1b · Employment & income',
  sectionAssets: 'Section 2 · Assets & gifts',
  sectionDebts: 'Section 2c / 3a · Liabilities & REO',
  sectionDeclarations: 'Section 5 · Declarations',
  sectionHmda: 'Sections 7–8 · Military & HMDA',
  sectionAgency: 'Agency addenda',
  labels: {
    legalName: 'Legal name',
    email: 'Email',
    mobile: 'Mobile',
    ssnLast4: 'SSN last 4',
    dob: 'Date of birth',
    citizenship: 'Citizenship',
    marital: 'Marital status',
    dependents: 'Dependents',
    currentAddress: 'Current address',
    housing: 'Housing',
    housingPmt: 'Housing payment',
    coborrower: 'Co-borrower',
    purpose: 'Purpose',
    subjectProperty: 'Subject property',
    propertyType: 'Property type',
    purchasePrice: 'Purchase price',
    loanAmount: 'Loan amount',
    occupancy: 'Occupancy',
    program: 'Program',
    employment: 'Employment',
    employer: 'Employer / business',
    jobTitle: 'Title',
    yearsAtJob: 'Years at job / business',
    years: 'Years in business',
    sameBiz: 'Same business 5+ yrs',
    gross: 'Gross monthly',
    secondJob: 'Second job',
    otherIncome: 'Other income',
    checking: 'Checking',
    savings: 'Savings',
    retirement: 'Retirement',
    gift: 'Gift / grant',
    debts: 'Monthly debts',
    alimony: 'Alimony / support paid',
    reo: 'Other real estate',
    reoValue: 'REO value',
    reoMortgage: 'REO mortgage',
    declOccupy: 'Occupy as primary',
    declJudgment: 'Outstanding judgment',
    declBankruptcy: 'Bankruptcy (7 yr)',
    declForeclosure: 'Foreclosure / DIL / short sale',
    declLawsuit: 'Lawsuit',
    declFed: 'Federal debt delinquent',
    declBorrowed: 'Undisclosed borrowed funds',
    declCoMaker: 'Undisclosed co-signer',
    military: 'Military service',
    ethnicity: 'Ethnicity',
    race: 'Race',
    sex: 'Sex',
    caivrs: 'CAIVRS authorized',
    informed: 'Informed choice',
    disability: 'Disability rating',
    childcare: 'Child care / mo',
    household: 'Household occupants',
  },
  occupancy: { PRIMARY: 'Primary', SECOND_HOME: 'Second home', INVESTMENT: 'Investment' },
  employment: { W2: 'W-2', SELF_EMPLOYED: 'Self-employed' },
  purpose: { PURCHASE: 'Purchase', REFINANCE: 'Refinance' },
  programUnsure: 'LO to recommend',
  borrowerOnly: 'Borrower only',
  yes: 'Yes',
  no: 'No',
  choices: {
    yes: 'Yes',
    no: 'No',
    PURCHASE: 'Purchasing',
    REFINANCE: 'Refinancing',
    PRIMARY: 'Primary home',
    SECOND_HOME: 'Second home',
    INVESTMENT: 'Investment',
    W2: 'W-2 employee',
    SELF_EMPLOYED: 'Self-employed',
    CONVENTIONAL: 'Conventional',
    FHA: 'FHA',
    VA: 'VA',
    USDA: 'USDA',
    UNSURE: "I'm not sure — let my LO decide",
    got_it: 'Got it — continue',
    US_CITIZEN: 'U.S. citizen',
    PERM_RESIDENT: 'Permanent resident',
    NON_PERM: 'Non-permanent resident',
    MARRIED: 'Married',
    SEPARATED: 'Separated',
    UNMARRIED: 'Unmarried',
    OWN: 'Own',
    RENT: 'Rent',
    RENT_FREE: 'Live rent-free',
    SFR: 'Single-family',
    CONDO: 'Condo',
    '2_4_UNIT': '2–4 unit',
    PUD: 'PUD',
    MANUFACTURED: 'Manufactured',
    RELATIVE: 'Relative',
    EMPLOYER: 'Employer',
    UNMARRIED_PARTNER: 'Unmarried partner',
    OTHER: 'Other (grant / nonprofit)',
    NEVER: 'Never served',
    CURRENT: 'Currently serving',
    VETERAN: 'Veteran',
    RESERVE: 'Reserve / National Guard',
    HISPANIC: 'Hispanic or Latino',
    NOT_HISPANIC: 'Not Hispanic or Latino',
    WHITE: 'White',
    BLACK: 'Black or African American',
    ASIAN: 'Asian',
    AIAN: 'American Indian or Alaska Native',
    PACIFIC: 'Native Hawaiian or Other Pacific Islander',
    FEMALE: 'Female',
    MALE: 'Male',
    DECLINE: 'I do not wish to provide',
    '0': 'None / 0% disability',
    '10_plus': '10% or greater',
  },
  helpers: {
    purchasePrice: 'A round estimate is fine. We can tighten this later.',
    yearsInBusiness: 'Count years of ownership in this company, not total years working.',
    monthlyDebts: 'Skip $0 if you are not sure — credit will fill this in.',
    program: 'If you are not sure, we will start as Conventional and your LO can switch to FHA, VA, or USDA.',
    acknowledgedDocPlan: 'This checklist is based on typical Fannie/Freddie, FHA, VA, and USDA documentation — your LO still signs off.',
    ssnLast4: 'FreeFlow holds this session in memory only (ZDR). Your LOS collects the full SSN under the lender’s GLBA custody.',
    yearsAtJob: 'GSE files need a two-year work history. If this job is newer, we will ask about the prior employer.',
    checkingBalance: 'Section 2a assets. Credit and bank statements will confirm — a round number is fine.',
    hmdaEthnicity: 'Collected to monitor fair lending. It is not used to decide your loan.',
  },
  placeholders: {
    borrowerName: 'Type your full legal name',
    email: 'Type your email',
    phone: 'Type your mobile number',
    purchasePrice: 'Type the purchase price',
    loanAmount: 'Type the loan amount',
    yearsInBusiness: 'Type years in this business',
    monthlyIncome: 'Type monthly income',
    monthlyDebts: 'Type monthly debts, or 0',
    vaChildCareExpenses: 'Type child-care cost, or 0',
    occupantName: 'Type their name',
    occupantAge: 'Type their age',
    occupantIncome: 'Type annual income, or 0',
    ssnLast4: 'Last four digits only',
    dob: 'MM/DD/YYYY',
    currentAddress: 'Street, city, state, ZIP',
    propertyAddress: 'Subject property address',
    employerName: 'Employer or business name',
    jobTitle: 'Your title',
    checkingBalance: 'Checking balance',
    savingsBalance: 'Savings balance',
    retirementBalance: 'Retirement balance',
  },
  gotIt: 'Got it — continue',
};

const ES: Copy = {
  ...EN,
  kicker: 'FreeFlow · Microservicio para brokers',
  title: 'AI 1003',
  subtitle: (detected, spoken) => (detected ? `Detectado: ${detected}` : spoken),
  startCall: 'Chatear ahora',
  endCall: 'Quitar voz',
  speaking: 'Hablando…',
  listening: 'Escuchando…',
  callMode: 'Voz activa',
  voiceOff: 'Voz apagada',
  typeHere: 'Escriba su respuesta aquí',
  replyLabel: 'Su respuesta',
  liveUrla: 'URLA / FNMA 1003 en vivo',
  coreFields: (n) => `${n} campos principales`,
  optionMiss: 'No entendí la opción. Dígala otra vez, toque un botón o escriba.',
  listeningPh: 'Escuchando…',
  voiceBlocked: 'La voz no está disponible en este navegador. Chrome o Edge funcionan mejor.',
  voiceTypeOnly: 'Este navegador no puede escuchar. Use Chrome o Edge, o escriba.',
  callOnIos: 'Voz activa. Leeré cada pregunta; toque el micrófono para responder.',
  callOn: 'Voz activa. Leeré cada pregunta y luego escucharé.',
  callSpeakOnly: 'Puedo hablar, pero este navegador no escucha. Escriba sus respuestas.',
  exportAria: 'Exportar',
  sendAria: 'Enviar',
  micAria: 'Micrófono',
  stopAria: 'Detener',
  sectionBorrower: 'Sección 1a · Información del prestatario',
  sectionLoan: 'Sección 4a · Préstamo y propiedad',
  sectionIncome: 'Sección 1b · Empleo e ingresos',
  sectionAssets: 'Sección 2 · Activos y regalos',
  sectionDebts: 'Sección 2c / 3a · Deudas y bienes raíces',
  sectionDeclarations: 'Sección 5 · Declaraciones',
  sectionHmda: 'Secciones 7–8 · Militar y HMDA',
  sectionAgency: 'Anexos de agencia',
  labels: {
    legalName: 'Nombre legal',
    email: 'Correo',
    mobile: 'Celular',
    purpose: 'Propósito',
    purchasePrice: 'Precio de compra',
    loanAmount: 'Monto del préstamo',
    occupancy: 'Ocupación',
    program: 'Programa',
    employment: 'Empleo',
    years: 'Años en el negocio',
    sameBiz: 'Mismo negocio 5+ años',
    gross: 'Ingreso mensual bruto',
    debts: 'Deudas mensuales',
    caivrs: 'CAIVRS autorizado',
    informed: 'Elección informada',
    disability: 'Discapacidad',
    childcare: 'Cuidado infantil / mes',
    household: 'Ocupantes del hogar',
  },
  occupancy: { PRIMARY: 'Residencia principal', SECOND_HOME: 'Segunda vivienda', INVESTMENT: 'Inversión' },
  employment: { W2: 'W-2', SELF_EMPLOYED: 'Autoempleado' },
  purpose: { PURCHASE: 'Compra', REFINANCE: 'Refinanciamiento' },
  programUnsure: 'El oficial recomendará',
  borrowerOnly: 'Solo el prestatario',
  yes: 'Sí',
  no: 'No',
  choices: {
    yes: 'Sí',
    no: 'No',
    PURCHASE: 'Comprando',
    REFINANCE: 'Refinanciando',
    PRIMARY: 'Residencia principal',
    SECOND_HOME: 'Segunda vivienda',
    INVESTMENT: 'Inversión',
    W2: 'Empleado W-2',
    SELF_EMPLOYED: 'Autoempleado',
    CONVENTIONAL: 'Convencional',
    FHA: 'FHA',
    VA: 'VA',
    USDA: 'USDA',
    UNSURE: 'No estoy seguro — que decida mi oficial',
    got_it: 'Entendido — continuar',
    '0': 'Ninguna / 0% de discapacidad',
    '10_plus': '10% o más',
  },
  helpers: {
    purchasePrice: 'Un estimado redondeado está bien. Lo afinamos después.',
    yearsInBusiness: 'Cuente años de dueño en esta empresa, no años totales trabajando.',
    monthlyDebts: 'Ponga 0 si no está seguro — el crédito lo completará.',
    program: 'Si no está seguro, empezamos como Convencional y su oficial puede cambiar a FHA, VA o USDA.',
    acknowledgedDocPlan: 'Esta lista sigue documentación típica de Fannie/Freddie, FHA, VA y USDA — su oficial confirma.',
  },
  placeholders: {
    borrowerName: 'Escriba su nombre legal completo',
    email: 'Escriba su correo',
    phone: 'Escriba su celular',
    purchasePrice: 'Escriba el precio de compra',
    loanAmount: 'Escriba el monto del préstamo',
    yearsInBusiness: 'Escriba los años en este negocio',
    monthlyIncome: 'Escriba el ingreso mensual',
    monthlyDebts: 'Escriba deudas mensuales, o 0',
    vaChildCareExpenses: 'Escriba cuidado infantil, o 0',
    occupantName: 'Escriba su nombre',
    occupantAge: 'Escriba la edad',
    occupantIncome: 'Escriba ingreso anual, o 0',
  },
  gotIt: 'Entendido — continuar',
};

const VI: Copy = {
  ...EN,
  kicker: 'FreeFlow · Dịch vụ môi giới',
  startCall: 'Nhắn tin ngay',
  endCall: 'Tắt giọng nói',
  typeHere: 'Nhập câu trả lời tại đây',
  replyLabel: 'Câu trả lời của bạn',
  speaking: 'Đang nói…',
  listening: 'Đang nghe…',
  liveUrla: 'URLA / FNMA 1003 trực tiếp',
  coreFields: (n) => `${n} trường chính`,
  optionMiss: 'Tôi chưa rõ lựa chọn. Nói lại, bấm nút, hoặc gõ.',
  sectionBorrower: 'Mục 1 · Thông tin người vay',
  sectionLoan: 'Mục 2 · Khoản vay & tài sản',
  sectionIncome: 'Mục 3 · Việc làm & thu nhập',
  sectionDebts: 'Mục 4 · Nợ',
  sectionAgency: 'Mục 5 · Phụ lục cơ quan',
  choices: {
    ...EN.choices,
    yes: 'Có',
    no: 'Không',
    PURCHASE: 'Mua nhà',
    REFINANCE: 'Tái cấp vốn',
    got_it: 'Đã hiểu — tiếp tục',
    UNSURE: 'Chưa chắc — để nhân viên quyết',
  },
};

const ZH: Copy = {
  ...EN,
  kicker: 'FreeFlow · 经纪人微服务',
  startCall: '开始聊天',
  endCall: '关闭语音',
  typeHere: '在此输入您的回答',
  replyLabel: '您的回复',
  speaking: '正在朗读…',
  listening: '正在聆听…',
  liveUrla: '实时 URLA / FNMA 1003',
  coreFields: (n) => `${n} 个核心字段`,
  optionMiss: '没有听清选项。请再说一次、点按钮或输入。',
  sectionBorrower: '第 1 部分 · 借款人信息',
  sectionLoan: '第 2 部分 · 贷款与房产',
  sectionIncome: '第 3 部分 · 就业与收入',
  sectionDebts: '第 4 部分 · 负债',
  sectionAgency: '第 5 部分 · 机构附录',
  choices: {
    ...EN.choices,
    yes: '是',
    no: '否',
    PURCHASE: '购房',
    REFINANCE: '再融资',
    got_it: '明白了 — 继续',
    UNSURE: '不确定 — 由贷款顾问决定',
  },
};

const KO: Copy = {
  ...EN,
  kicker: 'FreeFlow · 브로커 마이크로서비스',
  startCall: '지금 채팅',
  endCall: '음성 끄기',
  typeHere: '여기에 답변을 입력하세요',
  replyLabel: '답변',
  speaking: '말하는 중…',
  listening: '듣는 중…',
  liveUrla: '실시간 URLA / FNMA 1003',
  coreFields: (n) => `핵심 필드 ${n}개`,
  optionMiss: '옵션을 이해하지 못했습니다. 다시 말하거나 버튼을 누르거나 입력하세요.',
  sectionBorrower: '섹션 1 · 차입자 정보',
  sectionLoan: '섹션 2 · 대출 및 담보',
  sectionIncome: '섹션 3 · 고용 및 소득',
  sectionDebts: '섹션 4 · 부채',
  sectionAgency: '섹션 5 · 기관 부록',
  choices: {
    ...EN.choices,
    yes: '예',
    no: '아니요',
    PURCHASE: '주택 구매',
    REFINANCE: '재융자',
    got_it: '알겠습니다 — 계속',
    UNSURE: '잘 모르겠음 — 담당자가 결정',
  },
};

const PACK: Record<IntakeLang, Copy> = {
  'en-US': EN,
  'es-US': ES,
  'vi-VN': VI,
  'zh-CN': ZH,
  'ko-KR': KO,
};

export function ui(lang: IntakeLang): Copy {
  return PACK[lang] ?? EN;
}

export function localizedChoices(choices: IntakeChoice[] | undefined, lang: IntakeLang): IntakeChoice[] {
  if (!choices) return [];
  const pack = ui(lang);
  return choices.map((choice) => ({
    ...choice,
    label: pack.choices[choice.id] ?? choice.label,
  }));
}

export function localizedChoiceLabel(choiceId: string, lang: IntakeLang, fallback = choiceId): string {
  return ui(lang).choices[choiceId] ?? fallback;
}

export function localizedHelper(turnId: string, lang: IntakeLang, fallback?: string): string | undefined {
  return ui(lang).helpers[turnId] ?? fallback;
}

export function localizedPlaceholder(turnId: string, lang: IntakeLang, fallback?: string): string {
  return ui(lang).placeholders[turnId] ?? fallback ?? '';
}

export function localizedYn(value: boolean | undefined, lang: IntakeLang): string {
  if (value == null) return '—';
  return value ? ui(lang).yes : ui(lang).no;
}

const DOC_PLAN: Record<IntakeLang, (answers: IntakeAnswers) => string[]> = {
  'en-US': (answers) => englishPlan(answers),
  'es-US': (answers) => spanishPlan(answers),
  'vi-VN': (answers) => englishPlan(answers),
  'zh-CN': (answers) => englishPlan(answers),
  'ko-KR': (answers) => englishPlan(answers),
};

function years(answers: IntakeAnswers) {
  const parsed = Number(answers.yearsInBusiness);
  return Number.isFinite(parsed) ? parsed : 0;
}

function programOf(answers: IntakeAnswers) {
  if (answers.program === 'FHA' || answers.program === 'VA' || answers.program === 'USDA') return answers.program;
  return 'CONVENTIONAL';
}

function englishPlan(answers: IntakeAnswers): string[] {
  const name = firstName(answers);
  const program = programOf(answers);
  const selfEmployed = answers.employmentType === 'SELF_EMPLOYED';
  const n = years(answers);
  const fivePlus = n >= 5 && answers.sameBusinessFiveYears !== false;
  const lines: string[] = [`${name}, here is what we will collect next so underwriting is not guessing.`];
  if (selfEmployed) {
    if (program === 'CONVENTIONAL' && fivePlus) {
      lines.push(
        `You have about ${n} years in this business. On Conventional, Fannie/Freddie can allow one year of personal and matching business tax returns when you have at least five years of self-employment in the same business and income is stable. We will still run a Form 1084.`,
      );
    } else {
      lines.push(
        `${program} typically wants two years of personal and matching business tax returns. We will complete a Form 1084.`,
      );
    }
  } else {
    lines.push('As a W-2 borrower we will collect your most recent paystubs covering 30 days and two years of W-2s.');
  }
  if (answers.loanPurpose === 'PURCHASE') {
    lines.push('Assets: two months of bank statements to source the down payment and closing funds.');
  } else {
    lines.push('On a refinance we still need assets if there is cash to close. Two months of statements is enough unless you are drawing business funds.');
  }
  lines.push('Your loan officer can still add conditions. This is the starting checklist, not a final underwrite.');
  return lines;
}

function spanishPlan(answers: IntakeAnswers): string[] {
  const name = firstName(answers);
  const program = programOf(answers);
  const selfEmployed = answers.employmentType === 'SELF_EMPLOYED';
  const n = years(answers);
  const fivePlus = n >= 5 && answers.sameBusinessFiveYears !== false;
  const lines: string[] = [`${name}, esto es lo que recolectaremos ahora para que suscripción no adivine.`];
  if (selfEmployed) {
    if (program === 'CONVENTIONAL' && fivePlus) {
      lines.push(
        `Lleva unos ${n} años en este negocio. En Convencional, Fannie/Freddie puede aceptar un año de declaraciones personales y del negocio cuando hay al menos cinco años de autoempleo en la misma empresa e ingresos estables. Aun así haremos el Formulario 1084.`,
      );
    } else {
      lines.push(
        `${program} suele pedir dos años de declaraciones personales y del negocio. Completaremos el Formulario 1084.`,
      );
    }
  } else {
    lines.push('Como empleado W-2 recolectaremos los recibos de pago más recientes (30 días) y dos años de W-2.');
  }
  if (answers.loanPurpose === 'PURCHASE') {
    lines.push('Activos: dos meses de estados de cuenta para documentar el enganche y los costos de cierre.');
  } else {
    lines.push('En un refinanciamiento igual necesitamos activos si hay efectivo al cierre. Dos meses de estados suelen bastar.');
  }
  lines.push('Su oficial de crédito aún puede agregar condiciones. Esta es la lista inicial, no un underwrite final.');
  return lines;
}

export function localizedDocumentPlan(answers: IntakeAnswers, lang: IntakeLang): string {
  return (DOC_PLAN[lang] ?? englishPlan)(answers).join('\n\n');
}

export function localizedCompletion(answers: IntakeAnswers, lang: IntakeLang): string {
  const name = firstName(answers);
  if (lang === 'es-US') {
    return `${name}, la solicitud URLA está completa en esta sesión. Descargue el JSON del 1003 para su oficial — FreeFlow no guarda una copia. Luego obtendrán el crédito, enviarán divulgaciones y recolectarán los documentos.`;
  }
  if (lang === 'vi-VN') {
    return `${name}, hồ sơ đã được mở. Tiếp theo nhân viên tín dụng sẽ kéo tín dụng, gửi công bố qua email, và nhờ bạn tải lên giấy tờ vừa liệt kê. Kiểm tra hộp thư — không cần làm gì thêm trong khung chat này.`;
  }
  if (lang === 'zh-CN') {
    return `${name}，申请已启动。接下来贷款顾问会拉取征信、把披露文件发到您邮箱，并请您上传刚才列出的材料。请留意收件箱——此聊天无需再操作。`;
  }
  if (lang === 'ko-KR') {
    return `${name}님, 신청이 시작되었습니다. 다음으로 담당자가 신용조회를 하고, 고지서를 이메일로 보내며, 방금 안내한 서류를 업로드해 달라고 요청합니다. 받은편지함을 확인하세요. 이 채팅에서는 더 할 일이 없습니다.`;
  }
  return `${name}, the Uniform Residential Loan Application is complete in this session. Download the 1003 JSON for your loan officer — FreeFlow does not keep a copy. Next they will pull credit, send disclosures, and collect the documents we listed.`;
}
