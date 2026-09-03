import { FormEvent, useEffect, useRef, useState } from 'react';
import { Download, MessageCircle, Mic, MicOff, Send, Volume2 } from 'lucide-react';
import FreeFlowMascot from './FreeFlowMascot';
import {
  applyAnswer,
  filledFieldCount,
  getNextTurn,
  matchChoice,
  toApplyBody,
  URLA_PROGRESS_TOTAL,
  type AgentTurn,
  type IntakeAnswers,
} from '../intake/intake-agent';
import {
  detectSpokenLanguage,
  INTAKE_LANGS,
  localeForSpoken,
  spokenForLocale,
  type IntakeLang,
} from '../intake/detect-spoken-language';
import {
  browserVoiceSupport,
  createListener,
  speakText,
  spokenToInput,
  stopSpeaking,
} from '../intake/intake-voice';
import { localizedClosing, localizedPrompt } from '../intake/prompts';
import {
  localizedChoiceLabel,
  localizedChoices,
  localizedCompletion,
  localizedHelper,
  localizedPlaceholder,
  ui,
} from '../intake/uiCopy';
import LiveUrlaForm from './LiveUrlaForm';

interface ChatMessage {
  id: string;
  role: 'agent' | 'user';
  text: string;
  turnId?: string;
  choiceId?: string;
}

function isTurn(value: ReturnType<typeof getNextTurn>): value is AgentTurn {
  return 'prompt' in value;
}

export default function Conversational1003() {
  const [answers, setAnswers] = useState<IntakeAnswers>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turn, setTurn] = useState<AgentTurn | null>(null);
  const [done, setDone] = useState(false);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [lang, setLang] = useState<IntakeLang>('en-US');
  const [detected, setDetected] = useState<string | null>(null);
  const [support, setSupport] = useState({ speak: true, listen: true });
  const [iosDevice, setIosDevice] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const listenerRef = useRef<ReturnType<typeof createListener>>(null);
  const submitSpokenRef = useRef<(text: string) => void>(() => undefined);
  const voiceModeRef = useRef(false);
  const doneRef = useRef(false);
  const typingRef = useRef(false);
  const langRef = useRef<IntakeLang>('en-US');
  const lastSpokenIdRef = useRef<string | null>(null);

  useEffect(() => {
    setSupport(browserVoiceSupport());
    setIosDevice(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
  }, []);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  useEffect(() => {
    doneRef.current = done;
  }, [done]);
  useEffect(() => {
    typingRef.current = typing;
  }, [typing]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    setMessages((current) =>
      current.map((message) => {
        if (message.role === 'user' && message.choiceId) {
          return { ...message, text: localizedChoiceLabel(message.choiceId, lang, message.text) };
        }
        if (message.role === 'agent' && message.turnId === 'done') {
          return { ...message, text: localizedClosing(lang, answers) };
        }
        if (message.role === 'agent' && message.turnId) {
          return {
            ...message,
            text: localizedPrompt({ id: message.turnId, prompt: message.text, kind: 'text' }, lang, answers),
          };
        }
        return message;
      }),
    );
    lastSpokenIdRef.current = null;
    // Relocalize visible copy when the borrower taps a language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  useEffect(() => {
    const first = getNextTurn({});
    if (isTurn(first)) {
      setTurn(first);
      setMessages([{ id: 'open', role: 'agent', text: localizedPrompt(first, lang, {}), turnId: first.id }]);
    }
    // Initial greeting only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing, turn, listening]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [turn?.id, lang]);

  function stopListening() {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListening(false);
  }

  function startListening() {
    if (typingRef.current || doneRef.current) return;
    stopListening();
    const listener = createListener(
      {
        onInterim: (text) => {
          setDraft(text);
          const found = detectSpokenLanguage(text);
          if (found) {
            const nextLang = localeForSpoken(found);
            if (nextLang !== langRef.current) {
              setLang(nextLang);
              setDetected(found);
            }
          }
        },
        onFinal: (text) => {
          stopListening();
          setDraft(text);
          const found = detectSpokenLanguage(text);
          if (found) {
            setLang(localeForSpoken(found));
            setDetected(found);
          }
          try {
            submitSpokenRef.current(text);
          } catch (error) {
            setVoiceHint(error instanceof Error ? error.message : 'Could not use that answer. Try typing it.');
          }
        },
        onError: (message) => setVoiceHint(message),
        onEnd: () => setListening(false),
      },
      langRef.current,
    );
    if (!listener) {
      setVoiceHint(ui(langRef.current).voiceTypeOnly);
      return;
    }
    listenerRef.current = listener;
    setListening(true);
    setVoiceHint(null);
    listener.start();
  }

  function pushAgent(text: string, turnId?: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'agent', text, turnId }]);
  }

  function advance(nextAnswers: IntakeAnswers) {
    const following = getNextTurn(nextAnswers);
    if (!isTurn(following)) {
      setTurn(null);
      setDone(true);
      setTyping(true);
      window.setTimeout(() => {
        setTyping(false);
        pushAgent(localizedClosing(langRef.current, nextAnswers), 'done');
      }, 350);
      return;
    }
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      setTurn(following);
      pushAgent(localizedPrompt(following, langRef.current, nextAnswers), following.id);
    }, 350);
  }

  function submitValue(raw: string) {
    if (!turn || typing) return;
    stopListening();
    let value = spokenToInput(raw, turn.kind);
    if (!value && turn.kind !== 'number') return;
    if (turn.kind === 'number' && !value) value = '0';
    if (turn.choices) {
      const matched = matchChoice(value, turn.choices) ?? turn.choices.find((choice) => choice.id === value)?.id;
      if (!matched) {
        pushAgent(ui(langRef.current).optionMiss, turn.id);
        return;
      }
      value = matched;
    }
    const label = localizedChoiceLabel(value, langRef.current, turn.choices?.find((choice) => choice.id === value)?.label ?? value);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: label || value, choiceId: turn.choices ? value : undefined }]);
    setDraft('');
    const nextAnswers = applyAnswer(answers, turn.id, value);
    setAnswers(nextAnswers);
    advance(nextAnswers);
  }

  submitSpokenRef.current = submitValue;

  useEffect(() => {
    const lastAgent = [...messages].reverse().find((message) => message.role === 'agent');
    if (!voiceMode || typing || !lastAgent || lastSpokenIdRef.current === lastAgent.id) return;
    lastSpokenIdRef.current = lastAgent.id;
    let cancelled = false;
    setSpeaking(true);
    stopListening();
    void speakText(lastAgent.text, lang).then(() => {
      if (cancelled) return;
      setSpeaking(false);
      if (!voiceModeRef.current || doneRef.current) return;
      if (iosDevice) {
        setVoiceHint(ui(langRef.current).callOnIos);
        return;
      }
      window.setTimeout(() => {
        if (voiceModeRef.current && !doneRef.current && !typingRef.current) startListening();
      }, 350);
    });
    return () => {
      cancelled = true;
      stopSpeaking();
      setSpeaking(false);
    };
  }, [messages, typing, voiceMode, done, lang, iosDevice]);

  useEffect(() => {
    return () => {
      stopSpeaking();
      listenerRef.current?.stop();
    };
  }, []);

  function focusComposer() {
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submitValue(draft);
  }

  function exportSession() {
    const payload = {
      product: 'freeflow-ai-1003-microservice',
      form: 'FNMA 1003 / URLA',
      lang,
      detectedLanguage: detected,
      ...toApplyBody(answers),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'urla-1003-session.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  const complete = filledFieldCount(answers);
  const copy = ui(lang);
  const voiceLabel = speaking ? copy.speaking : listening ? copy.listening : voiceMode ? copy.callMode : copy.voiceOff;
  const choiceButtons = localizedChoices(turn?.choices, lang);

  return (
    <div
      data-testid="ai-1003-workspace"
      className="flex h-full min-h-[780px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex w-[52%] min-w-0 flex-col border-r border-slate-200">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
              <FreeFlowMascot size={56} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">{copy.kicker}</p>
              <h2 className="text-lg font-black tracking-tight text-slate-950">{copy.title}</h2>
              <p className="text-xs text-slate-500">{copy.subtitle(detected, spokenForLocale(lang))}</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                In-session URLA · ZDR — nothing stored on FreeFlow
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={focusComposer}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {copy.startCall}
          </button>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-5 py-2">
          {INTAKE_LANGS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setLang(item.id);
                setDetected(item.id === 'en-US' ? null : item.label);
                stopSpeaking();
                stopListening();
              }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                lang === item.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50">
          <div className="flex min-h-full flex-col justify-center gap-6 px-6 py-8">
          <div className="space-y-3">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className={`flex max-w-[92%] items-end gap-2 ${message.role === 'agent' ? '' : 'ml-auto flex-row-reverse'}`}
            >
              {message.role === 'agent' && (
                <div className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                  <FreeFlowMascot size={32} />
                </div>
              )}
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  message.role === 'agent' ? 'bg-white text-slate-800 shadow-sm' : 'bg-emerald-600 text-white'
                }`}
              >
                {message.role === 'agent' && index === 0 && (
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">FreeFlow</p>
                )}
                {message.text}
              </div>
            </div>
          ))}
          {typing ? <div className="text-xs text-slate-400">…</div> : null}
          {voiceMode && (speaking || listening) ? (
            <div className="flex items-center gap-2 text-[11px] font-medium text-emerald-700">
              {speaking ? <Volume2 className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5 animate-pulse" />}
              {voiceLabel}
            </div>
          ) : null}
          <div ref={bottomRef} />
          </div>

        <div ref={composerRef} className="w-full">
          {done ? (
            <div className="mx-auto max-w-lg rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-relaxed text-emerald-950">
              {localizedCompletion(answers, lang)}
            </div>
          ) : (
            <div className="mx-auto max-w-lg space-y-3">
              <p className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">{copy.replyLabel}</p>
              {localizedHelper(turn?.id ?? '', lang, turn?.helper) ? (
                <p className="text-center text-[11px] text-slate-500">{localizedHelper(turn?.id ?? '', lang, turn?.helper)}</p>
              ) : null}
              {voiceHint ? <p className="text-center text-[11px] text-emerald-700">{voiceHint}</p> : null}
              {choiceButtons.length ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {choiceButtons.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      disabled={typing}
                      onClick={() => submitValue(choice.id)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-2xl border-2 border-emerald-400 bg-white px-3 py-2 shadow-[0_10px_30px_rgba(16,185,129,0.12)]">
                <input
                  ref={inputRef}
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={listening ? copy.listeningPh : localizedPlaceholder(turn?.id ?? '', lang, copy.typeHere)}
                  className="min-h-12 flex-1 bg-transparent px-3 py-2 text-base text-slate-900 outline-none placeholder:text-slate-400"
                  disabled={typing}
                />
                <button
                  type="button"
                  disabled={typing || !support.listen}
                  onClick={() => {
                    if (listening) {
                      stopListening();
                      return;
                    }
                    stopSpeaking();
                    setSpeaking(false);
                    startListening();
                  }}
                  className={`grid h-11 w-11 place-items-center rounded-full ${
                    listening ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  } disabled:opacity-40`}
                  aria-label={listening ? copy.stopAria : copy.micAria}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <button
                  type="submit"
                  disabled={typing}
                  className="grid h-11 w-11 place-items-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                  aria-label={copy.sendAria}
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}
        </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-slate-50 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{copy.liveUrla}</p>
            <p className="text-sm font-bold text-slate-950">{copy.coreFields(complete)}</p>
          </div>
          <button
            type="button"
            onClick={exportSession}
            aria-label={copy.exportAria}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 hover:border-emerald-400"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (complete / URLA_PROGRESS_TOTAL) * 100)}%` }} />
        </div>
        <LiveUrlaForm answers={answers} turn={turn} lang={lang} />
      </div>
    </div>
  );
}
