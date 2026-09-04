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
    'en-US': '{name}, that completes your application — thank you! I am delivering it securely to your lender right now, and FreeFlow keeps no copy. Your loan officer will reach out shortly. Nothing else is needed from you.',
    'es-US': '{name}, ¡su solicitud está completa — gracias! La estoy entregando de forma segura a su prestamista ahora mismo y FreeFlow no guarda copia. Su oficial se comunicará pronto. No necesita hacer nada más.',
    'vi-VN': '{name}, đơn của bạn đã hoàn tất — cảm ơn bạn! Tôi đang gửi an toàn đến bên cho vay ngay bây giờ và FreeFlow không lưu bản sao. Nhân viên tín dụng sẽ sớm liên hệ. Bạn không cần làm gì thêm.',
    'zh-CN': '{name}，您的申请已完成——谢谢！我正在将其安全送达您的贷款机构，FreeFlow 不保留副本。贷款顾问会尽快联系您，您无需再做任何事情。',
    'ko-KR': '{name}님, 신청이 완료되었습니다 — 감사합니다! 지금 대출 기관에 안전하게 전달하고 있으며 FreeFlow는 사본을 보관하지 않습니다. 담당자가 곧 연락드립니다. 더 하실 일은 없습니다.',
  },
  previousAddress: {
    'en-US': 'You have been there under two years — what was your previous street address, city, state, and ZIP?',
    'es-US': 'Lleva menos de dos años allí — ¿cuál era su dirección anterior (calle, ciudad, estado y código postal)?',
    'vi-VN': 'Bạn ở đó chưa đủ hai năm — địa chỉ trước đây của bạn là gì (đường, thành phố, tiểu bang, ZIP)?',
    'zh-CN': '您在现址居住不满两年——之前的地址是什么（街道、城市、州、邮编）？',
    'ko-KR': '현재 주소 거주 기간이 2년 미만입니다 — 이전 주소(도로명, 도시, 주, 우편번호)를 알려주세요.',
  },
  yearsAtPreviousAddress: {
    'en-US': 'How many years were you at that previous address?',
    'es-US': '¿Cuántos años vivió en esa dirección anterior?',
    'vi-VN': 'Bạn đã ở địa chỉ trước đó bao nhiêu năm?',
    'zh-CN': '您在之前的地址住了几年？',
    'ko-KR': '이전 주소에서 몇 년 거주하셨나요?',
  },
  previousEmployerYears: {
    'en-US': 'How many years were you with that previous employer?',
    'es-US': '¿Cuántos años estuvo con ese empleador anterior?',
    'vi-VN': 'Bạn đã làm cho chủ trước đó bao nhiêu năm?',
    'zh-CN': '您在上一家雇主工作了几年？',
    'ko-KR': '이전 직장에서 몇 년 근무하셨나요?',
  },
  creditPullType: {
    'en-US': 'Almost done. To review your options, your lender needs a look at your credit. Would you like to start with a soft credit check — it does not affect your score and does not notify other lenders — or authorize the full credit report now? A full tri-merge report is required before final approval either way.',
    'es-US': 'Casi terminamos. Para revisar sus opciones, su prestamista necesita ver su crédito. ¿Prefiere comenzar con una consulta suave — no afecta su puntaje ni notifica a otros prestamistas — o autorizar el informe completo ahora? El informe tri-merge completo se requiere antes de la aprobación final de todos modos.',
    'vi-VN': 'Sắp xong rồi. Để xem các lựa chọn, bên cho vay cần xem tín dụng của bạn. Bạn muốn bắt đầu với kiểm tra tín dụng mềm — không ảnh hưởng điểm số và không báo cho bên cho vay khác — hay ủy quyền báo cáo tín dụng đầy đủ ngay? Dù sao báo cáo tri-merge đầy đủ vẫn cần trước khi phê duyệt cuối cùng.',
    'zh-CN': '快完成了。为了评估您的方案，贷款机构需要查看您的信用。您想先做一次软查询（不影响信用分数、不会通知其他贷款机构），还是现在就授权完整的信用报告？无论如何，最终批准前都需要完整的三合一报告。',
    'ko-KR': '거의 다 됐습니다. 대출 옵션 검토를 위해 신용 확인이 필요합니다. 점수에 영향이 없고 다른 대출 기관에 통보되지 않는 소프트 조회로 시작하시겠어요, 아니면 지금 전체 신용조회를 승인하시겠어요? 최종 승인 전에는 어차피 전체 트라이머지 보고서가 필요합니다.',
  },
  assetLinkConsent: {
    'en-US': 'Last question: for your bank and asset verification, would you like to securely connect your accounts online (takes about two minutes, no paper statements), or send statements to your loan officer instead?',
    'es-US': 'Última pregunta: para verificar sus cuentas y activos, ¿prefiere conectarlas en línea de forma segura (unos dos minutos, sin estados de cuenta en papel) o enviar los estados a su oficial?',
    'vi-VN': 'Câu hỏi cuối: để xác minh tài khoản và tài sản, bạn muốn kết nối tài khoản trực tuyến an toàn (khoảng hai phút, không cần sao kê giấy) hay gửi sao kê cho nhân viên tín dụng?',
    'zh-CN': '最后一个问题：关于银行和资产验证，您是想在线安全连接您的账户（约两分钟，无需纸质对账单），还是把对账单发给贷款顾问？',
    'ko-KR': '마지막 질문입니다. 은행 및 자산 확인을 위해 계좌를 온라인으로 안전하게 연결하시겠어요(약 2분, 종이 명세서 불필요), 아니면 명세서를 담당자에게 보내시겠어요?',
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
