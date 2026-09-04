import { firstName, type AgentTurn, type IntakeAnswers } from './intake-agent';
import type { IntakeLang } from './detect-spoken-language';
import { localizedDocumentPlan } from './uiCopy';

const PROMPTS: Record<string, Record<IntakeLang, string>> = {
  borrowerName: {
    'en-US': "Hi — I'll walk you through the full loan application (URLA / 1003). What is your full legal name?",
    'es-US': 'Hola — le guiaré por su solicitud de préstamo. ¿Cuál es su nombre legal completo?',
    'vi-VN': 'Xin chào — tôi sẽ hướng dẫn đơn vay. Họ tên pháp lý đầy đủ của bạn là gì?',
    'zh-CN': '您好，我将协助填写贷款申请。您的法定全名是？',
    'ko-KR': '안녕하세요. 대출 신청을 안내하겠습니다. 법적 성함은 어떻게 되시나요?',
  },
  email: {
    'en-US': 'Nice to meet you, {name}. What email should we use for this file?',
    'es-US': 'Mucho gusto, {name}. ¿Qué correo usamos para este expediente?',
    'vi-VN': 'Rất vui được gặp bạn, {name}. Email cho hồ sơ này là gì?',
    'zh-CN': '{name}，很高兴认识您。这个档案用哪个邮箱？',
    'ko-KR': '{name}님, 반갑습니다. 이 건에 사용할 이메일은요?',
  },
  phone: {
    'en-US': 'And a mobile number in case your loan officer needs to reach you?',
    'es-US': '¿Y un número de celular por si su oficial de crédito necesita llamarle?',
    'vi-VN': 'Số điện thoại di động để nhân viên tín dụng liên hệ?',
    'zh-CN': '贷款顾问需要时联系您的手机号？',
    'ko-KR': '담당자가 연락할 휴대폰 번호는요?',
  },
  loanPurpose: {
    'en-US': 'Are you purchasing a home or refinancing one you already own?',
    'es-US': '¿Está comprando una vivienda o refinanciando una que ya posee?',
    'vi-VN': 'Bạn đang mua nhà hay tái cấp vốn nhà đã sở hữu?',
    'zh-CN': '您是购房还是对现有房产再融资？',
    'ko-KR': '주택을 구매하시나요, 아니면 보유 주택을 재융자하시나요?',
  },
  purchasePrice: {
    'en-US': 'About what purchase price are you targeting?',
    'es-US': '¿Aproximadamente qué precio de compra busca?',
    'vi-VN': 'Giá mua nhà dự kiến khoảng bao nhiêu?',
    'zh-CN': '目标购房价格大约是多少？',
    'ko-KR': '목표 구매 가격은 어느 정도인가요?',
  },
  loanAmountPurchase: {
    'en-US': 'How much do you expect to borrow?',
    'es-US': '¿Cuánto espera pedir prestado?',
    'vi-VN': 'Bạn dự định vay bao nhiêu?',
    'zh-CN': '预计借款金额？',
    'ko-KR': '예상 대출 금액은요?',
  },
  loanAmountRefi: {
    'en-US': 'What loan amount are you looking to refinance?',
    'es-US': '¿Qué monto de préstamo desea refinanciar?',
    'vi-VN': 'Số tiền vay muốn tái cấp vốn?',
    'zh-CN': '再融资金额是多少？',
    'ko-KR': '재융자할 대출 금액은요?',
  },
  occupancy: {
    'en-US': 'Will this be your primary home, a second home, or an investment property?',
    'es-US': '¿Será residencia principal, segunda vivienda o inversión?',
    'vi-VN': 'Đây sẽ là nhà ở chính, nhà thứ hai, hay đầu tư?',
    'zh-CN': '这是主住宅、第二套房还是投资房？',
    'ko-KR': '주거용, 세컨드홈, 투자용 중 어떤가요?',
  },
  employmentType: {
    'en-US': 'How are you paid today?',
    'es-US': '¿Cómo le pagan actualmente?',
    'vi-VN': 'Hiện bạn nhận lương theo hình thức nào?',
    'zh-CN': '您目前如何取得收入？',
    'ko-KR': '현재 소득 형태는 어떻게 되나요?',
  },
  yearsInBusiness: {
    'en-US': 'How many years have you been self-employed in this same business?',
    'es-US': '¿Cuántos años lleva autoempleado en este mismo negocio?',
    'vi-VN': 'Bạn tự kinh doanh cùng doanh nghiệp này bao nhiêu năm?',
    'zh-CN': '您在同一家企业自雇多少年了？',
    'ko-KR': '같은 사업체로 자영업을 하신 지 몇 년인가요?',
  },
  sameBusinessFiveYears: {
    'en-US': 'Has that been the same business for five years or more, not a recent restart?',
    'es-US': '¿Ha sido el mismo negocio por cinco años o más, no un reinicio reciente?',
    'vi-VN': 'Đó có phải cùng doanh nghiệp năm năm trở lên, không phải thành lập lại gần đây?',
    'zh-CN': '是否为同一企业连续五年以上，而非近期新设？',
    'ko-KR': '최근 재창업이 아니라 같은 사업체로 5년 이상인가요?',
  },
  monthlyIncomeW2: {
    'en-US': 'What is your gross monthly income?',
    'es-US': '¿Cuál es su ingreso mensual bruto?',
    'vi-VN': 'Thu nhập gộp hàng tháng của bạn là bao nhiêu?',
    'zh-CN': '税前月收入是多少？',
    'ko-KR': '세전 월소득은 얼마인가요?',
  },
  monthlyIncomeSe: {
    'en-US': 'What is your typical monthly take-home from the business, before the 1084 audit?',
    'es-US': '¿Cuál es su ingreso mensual típico del negocio, antes de la auditoría 1084?',
    'vi-VN': 'Thu nhập hàng tháng từ doanh nghiệp, trước khi kiểm tra Form 1084?',
    'zh-CN': '1084 审核前，企业典型月收入？',
    'ko-KR': '1084 심사 전 사업 월소득은요?',
  },
  monthlyDebts: {
    'en-US': 'Roughly how much do you pay each month toward credit cards, auto, student loans, and other debts?',
    'es-US': '¿Aproximadamente cuánto paga al mes en tarjetas, auto, estudiantes y otras deudas?',
    'vi-VN': 'Mỗi tháng bạn trả khoảng bao nhiêu cho thẻ, xe, vay sinh viên và nợ khác?',
    'zh-CN': '每月信用卡、车贷、学贷及其他债务大约多少？',
    'ko-KR': '카드, 자동차, 학자금 등 월 부채 상환액은 대략 얼마인가요?',
  },
  program: {
    'en-US': 'Do you already know which loan program you want, or should your loan officer recommend one after credit?',
    'es-US': '¿Ya sabe qué programa de préstamo quiere, o debe recomendarlo su oficial después del crédito?',
    'vi-VN': 'Bạn đã chọn chương trình vay, hay để nhân viên tín dụng đề xuất sau khi có tín dụng?',
    'zh-CN': '您已确定贷款计划，还是等征信后由顾问推荐？',
    'ko-KR': '원하는 대출 프로그램이 있나요, 아니면 신용조회 후 담당자가 추천할까요?',
  },
  authorizeCaivrs: {
    'en-US': '{name}, FHA requires a CAIVRS check for federal debt. Can we run that?',
    'es-US': '{name}, FHA requiere una verificación CAIVRS de deuda federal. ¿Podemos ejecutarla?',
    'vi-VN': '{name}, FHA yêu cầu kiểm tra CAIVRS về nợ liên bang. Chúng tôi được phép chạy không?',
    'zh-CN': '{name}，FHA 需要 CAIVRS 联邦债务核查。可以执行吗？',
    'ko-KR': '{name}님, FHA는 연방 채무 CAIVRS 조회가 필요합니다. 진행해도 될까요?',
  },
  acknowledgeInformedChoice: {
    'en-US': 'HUD also needs you to acknowledge the FHA Informed Consumer Choice disclosure. Do you acknowledge that?',
    'es-US': 'HUD también requiere que reconozca la divulgación FHA Informed Consumer Choice. ¿Lo reconoce?',
    'vi-VN': 'HUD cũng cần bạn xác nhận công bố FHA Informed Consumer Choice. Bạn xác nhận chứ?',
    'zh-CN': 'HUD 还需要您确认 FHA 知情消费者选择披露。是否确认？',
    'ko-KR': 'HUD는 FHA 소비자 선택 고지 확인도 필요합니다. 확인하시나요?',
  },
  vaDisabilityRating: {
    'en-US': 'VA files need disability status for the funding-fee waiver. What applies?',
    'es-US': 'Los archivos VA necesitan el estatus de discapacidad para la exención de tarifa. ¿Cuál aplica?',
    'vi-VN': 'Hồ sơ VA cần tình trạng khuyết tật để miễn phí funding. Trường hợp nào?',
    'zh-CN': 'VA 档案需要残疾等级以判断融资费豁免。您属于哪一种？',
    'ko-KR': 'VA는 펀딩비 면제를 위해 장애 등급이 필요합니다. 해당 사항은요?',
  },
  vaChildCareExpenses: {
    'en-US': 'Any monthly child-care expense we should count in residual income? Enter 0 if none.',
    'es-US': '¿Algún gasto mensual de cuidado infantil para el ingreso residual? Ponga 0 si no hay.',
    'vi-VN': 'Chi phí trông trẻ hàng tháng cho thu nhập còn lại? Nhập 0 nếu không có.',
    'zh-CN': '残值收入中要计入的月托儿费？没有请填 0。',
    'ko-KR': '잔여소득에 넣을 월 보육비가 있나요? 없으면 0입니다.',
  },
  hasHousehold: {
    'en-US': 'USDA counts income for everyone living in the home. Anyone else in the household?',
    'es-US': 'USDA cuenta ingresos de todos en el hogar. ¿Hay alguien más?',
    'vi-VN': 'USDA tính thu nhập mọi người trong nhà. Còn ai khác không?',
    'zh-CN': 'USDA 计入同住所有人的收入。还有其他人吗？',
    'ko-KR': 'USDA는 동거인 소득도 산정합니다. 다른 가구원이 있나요?',
  },
  occupantName: {
    'en-US': 'What is their name?',
    'es-US': '¿Cuál es su nombre?',
    'vi-VN': 'Tên của họ là gì?',
    'zh-CN': '他们叫什么名字？',
    'ko-KR': '성함은 어떻게 되나요?',
  },
  occupantAge: {
    'en-US': 'How old is {name}?',
    'es-US': '¿Qué edad tiene {name}?',
    'vi-VN': '{name} bao nhiêu tuổi?',
    'zh-CN': '{name} 多大？',
    'ko-KR': '{name}님 연세는요?',
  },
  occupantIncome: {
    'en-US': "What is {name}'s annual income? Use 0 if they have none.",
    'es-US': '¿Cuál es el ingreso anual de {name}? Use 0 si no tiene.',
    'vi-VN': 'Thu nhập hàng năm của {name}? Dùng 0 nếu không có.',
    'zh-CN': '{name} 的年收入？没有请填 0。',
    'ko-KR': '{name}님의 연소득은요? 없으면 0입니다.',
  },
  addAnotherOccupant: {
    'en-US': 'Add another household occupant?',
    'es-US': '¿Agregar otro ocupante del hogar?',
    'vi-VN': 'Thêm người khác trong hộ?',
    'zh-CN': '再添加一位同住人？',
    'ko-KR': '다른 가구원을 추가할까요?',
  },
  done: {
    'en-US': '{name}, the Uniform Residential Loan Application is complete in this session. Download the 1003 JSON for your loan officer — FreeFlow does not keep a copy. Next they will pull credit, send disclosures, and collect the documents we listed.',
    'es-US': '{name}, la solicitud URLA está completa en esta sesión. Descargue el JSON del 1003 para su oficial — FreeFlow no guarda una copia. Luego obtendrán el crédito, enviarán divulgaciones y recolectarán los documentos.',
    'vi-VN': '{name}, đơn URLA đã hoàn tất trong phiên này. Tải JSON 1003 cho nhân viên tín dụng — FreeFlow không lưu bản sao. Tiếp theo họ sẽ kéo tín dụng, gửi công bố và thu giấy tờ.',
    'zh-CN': '{name}，本会话中的 URLA 已填完。请下载 1003 JSON 交给贷款顾问——FreeFlow 不保存副本。随后将拉取征信、发送披露并收集材料。',
    'ko-KR': '{name}님, 이 세션의 URLA가 완료되었습니다. 담당자에게 줄 1003 JSON을 다운로드하세요. FreeFlow는 사본을 보관하지 않습니다.',
  },
};

function fill(template: string, answers: IntakeAnswers) {
  return template.replace(/\{name\}/g, firstName(answers));
}

export function localizedPrompt(turn: AgentTurn, lang: IntakeLang, answers: IntakeAnswers): string {
  if (turn.id === 'acknowledgedDocPlan') return localizedDocumentPlan(answers, lang);
  let key = turn.id;
  if (turn.id === 'loanAmount') key = answers.loanPurpose === 'REFINANCE' ? 'loanAmountRefi' : 'loanAmountPurchase';
  if (turn.id === 'monthlyIncome') key = answers.employmentType === 'SELF_EMPLOYED' ? 'monthlyIncomeSe' : 'monthlyIncomeW2';
  const row = PROMPTS[key];
  if (!row) return turn.prompt;
  return fill(row[lang] ?? row['en-US'], answers);
}

export function localizedClosing(lang: IntakeLang, answers: IntakeAnswers): string {
  return fill(PROMPTS.done[lang] ?? PROMPTS.done['en-US'], answers);
}
