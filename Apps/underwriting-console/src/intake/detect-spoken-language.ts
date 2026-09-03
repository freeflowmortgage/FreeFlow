export type SpokenLanguage = 'English' | 'Spanish' | 'Vietnamese' | 'Chinese' | 'Korean';
export type IntakeLang = 'en-US' | 'es-US' | 'vi-VN' | 'zh-CN' | 'ko-KR';

export const INTAKE_LANGS: { id: IntakeLang; label: string; spoken: SpokenLanguage }[] = [
  { id: 'en-US', label: 'English', spoken: 'English' },
  { id: 'es-US', label: 'Español', spoken: 'Spanish' },
  { id: 'vi-VN', label: 'Tiếng Việt', spoken: 'Vietnamese' },
  { id: 'zh-CN', label: '中文', spoken: 'Chinese' },
  { id: 'ko-KR', label: '한국어', spoken: 'Korean' },
];

const SPANISH_MARKERS =
  /\b(el|la|los|las|de|que|y|en|un|una|es|por|para|con|hola|gracias|quiero|casa|préstamo|prestamo|hipoteca|sí|estoy|necesito|comprar|refinanciar|ingreso|trabajo)\b/gi;
const SPANISH_CHARS = /[áéíóúñü¿¡]/i;
const ENGLISH_MARKERS =
  /\b(the|and|you|that|have|with|for|this|from|want|need|house|home|loan|mortgage|income|job|hello|hi|yes|please)\b/gi;
const VIET_MARKERS = /\b(tôi|bạn|của|là|không|có|nhà|vay|thu nhập|cảm ơn|xin chào)\b/gi;
const VIET_CHARS = /[ăâêôơưđáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/i;
const KOREAN_CHARS = /[\uac00-\ud7af]/;
const CHINESE_CHARS = /[\u4e00-\u9fff]/;

export function detectSpokenLanguage(text: string): SpokenLanguage | null {
  const sample = text.trim();
  if (sample.length < 4) return null;
  if (KOREAN_CHARS.test(sample)) return 'Korean';
  if (CHINESE_CHARS.test(sample)) return 'Chinese';
  if (VIET_CHARS.test(sample) || (sample.match(VIET_MARKERS) || []).length >= 2) return 'Vietnamese';

  const spanishHits = (sample.match(SPANISH_MARKERS) || []).length + (SPANISH_CHARS.test(sample) ? 2 : 0);
  const englishHits = (sample.match(ENGLISH_MARKERS) || []).length;
  if (spanishHits === 0 && englishHits === 0) return null;
  if (spanishHits >= englishHits + 1) return 'Spanish';
  if (englishHits >= spanishHits + 1) return 'English';
  return spanishHits > englishHits ? 'Spanish' : 'English';
}

export function localeForSpoken(language: SpokenLanguage | null): IntakeLang {
  if (language === 'Spanish') return 'es-US';
  if (language === 'Vietnamese') return 'vi-VN';
  if (language === 'Chinese') return 'zh-CN';
  if (language === 'Korean') return 'ko-KR';
  return 'en-US';
}

export function spokenForLocale(lang: IntakeLang): SpokenLanguage {
  return INTAKE_LANGS.find((item) => item.id === lang)?.spoken ?? 'English';
}
