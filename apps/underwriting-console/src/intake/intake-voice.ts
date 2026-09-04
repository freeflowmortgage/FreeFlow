import type { InputKind } from './intake-agent';
import type { IntakeLang } from './detect-spoken-language';

type RecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

const SMALL_NUMBERS: Record<string, string> = {
  zero: '0',
  none: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

export function browserVoiceSupport() {
  if (typeof window === 'undefined') {
    return { speak: false, listen: false };
  }
  const SpeechWindow = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return {
    speak: 'speechSynthesis' in window,
    listen: Boolean(SpeechWindow.SpeechRecognition || SpeechWindow.webkitSpeechRecognition),
  };
}

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const SpeechWindow = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return SpeechWindow.SpeechRecognition ?? SpeechWindow.webkitSpeechRecognition ?? null;
}

export function spokenToInput(raw: string, kind: InputKind): string {
  const trimmed = raw.trim();
  if (kind === 'email') {
    return trimmed.replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '');
  }
  if (kind === 'tel') {
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 10 ? digits : trimmed;
  }
  if (kind === 'number') {
    const asWord = SMALL_NUMBERS[trimmed.toLowerCase()];
    if (asWord) return asWord;
    const digits = trimmed.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return digits?.[0] ?? trimmed;
  }
  return trimmed;
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function speakText(text: string, lang: IntakeLang = 'en-US'): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve();
  }
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return Promise.resolve();
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.rate = 1.02;
  utterance.lang = lang;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
    }
  });
}

export function createListener(
  options: {
    onInterim: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  },
  lang: IntakeLang = 'en-US',
) {
  const Ctor = recognitionConstructor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = lang;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    if (interim) options.onInterim(interim);
    if (finalText.trim()) options.onFinal(finalText.trim());
  };
  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'canceled') {
      options.onEnd();
      return;
    }
    if (event.error === 'not-allowed') {
      options.onError('Microphone permission is blocked. Allow it for this site, then try again.');
    } else if (event.error === 'network') {
      options.onError('Speech service is unavailable (needs internet). Tap the mic again or type.');
    } else {
      options.onError('I could not hear that. Tap the mic or type your answer.');
    }
    options.onEnd();
  };
  recognition.onend = () => options.onEnd();

  return {
    start() {
      try {
        recognition.start();
      } catch {
        options.onEnd();
      }
    },
    stop() {
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}
