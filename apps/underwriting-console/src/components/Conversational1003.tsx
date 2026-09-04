import { FormEvent, useEffect, useRef, useState } from 'react';
import { Download, MessageCircle, Mic, MicOff, Send, Volume2 } from 'lucide-react';
import FreeFlowMascot from './FreeFlowMascot';
import {
  applyAnswer,
  filledFieldCount,
  getNextTurn,
  matchChoice,
  URLA_PROGRESS_TOTAL,
  type AgentTurn,
  type IntakeAnswers,
} from '../intake/intake-agent';
import { buildMismo34Xml } from '../intake/mismoExport';
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
import { clearIntakeSession, loadIntakeSession, saveIntakeSession, type SavedIntakeSession } from '../intake/sessionStore';
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
  const [delivery, setDelivery] = useState<{ state: 'idle' | 'sending' | 'delivered' | 'error'; receiptId?: string }>({
    state: 'idle',
  });
  const [resumable, setResumable] = useState<SavedIntakeSession | null>(null);
  const [leadSent, setLeadSent] = useState(false);
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
    const voice = browserVoiceSupport();
    setSupport(voice);
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIosDevice(ios);
    // Mobile defaults to speech-to-text: hands-free voice mode is on from the start
    // (spoken prompts + auto-listen; iOS requires a mic tap per platform rules).
    const mobile = window.matchMedia('(max-width: 1023px), (pointer: coarse)').matches;
    if (mobile && voice.listen) {
      setVoiceMode(true);
    }
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
    // Device-local draft (ZDR-safe): offer to resume a midstream session so a
    // phone lock or app switch never forces the borrower to start over.
    const saved = loadIntakeSession();
    if (saved) setResumable(saved);
    const first = getNextTurn({});
    if (isTurn(first)) {
      setTurn(first);
      setMessages([{ id: 'open', role: 'agent', text: localizedPrompt(first, lang, {}), turnId: first.id }]);
    }
    // Initial greeting only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft to the borrower's device on every answer (cleared on delivery)
  useEffect(() => {
    if (done || Object.keys(answers).length === 0) return;
    saveIntakeSession({ answers, lang, leadSent });
  }, [answers, lang, leadSent, done]);

  // Early lead relay: the moment we have a name and contact info, hand the lead
  // to the client's CRM API so an abandoned session still reaches the LO.
  useEffect(() => {
    if (leadSent || !answers.borrowerName || (!answers.email && !answers.phone)) return;
    setLeadSent(true); // optimistic; a failed relay retries on the next answer
    fetch('/api/intake/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'freeflow-ai-1003',
        status: 'IN_PROGRESS',
        borrowerName: answers.borrowerName,
        email: answers.email ?? null,
        phone: answers.phone ?? null,
        loanPurpose: answers.loanPurpose ?? null,
        lang,
      }),
    }).catch(() => setLeadSent(false));
  }, [answers.borrowerName, answers.email, answers.phone, answers.loanPurpose, lang, leadSent]);

  function resumeSavedSession() {
    if (!resumable) return;
    const savedAnswers = resumable.answers;
    setAnswers(savedAnswers);
    setLang(resumable.lang);
    setLeadSent(resumable.leadSent);
    setResumable(null);
    const nextTurn = getNextTurn(savedAnswers);
    if (isTurn(nextTurn)) {
      setTurn(nextTurn);
      setMessages([
        {
          id: 'resume',
          role: 'agent',
          text: `Welcome back${savedAnswers.borrowerName ? `, ${savedAnswers.borrowerName.split(/\s+/)[0]}` : ''}! I saved your progress on this device — picking up right where we left off.`,
        },
        {
          id: crypto.randomUUID(),
          role: 'agent',
          text: localizedPrompt(nextTurn, resumable.lang, savedAnswers),
          turnId: nextTurn.id,
        },
      ]);
    } else {
      setTurn(null);
      setDone(true);
    }
  }

  function discardSavedSession() {
    clearIntakeSession();
    setResumable(null);
  }

  // Screen Wake Lock: keep the phone awake while the conversation is active so
  // the screen does not idle-lock mid-application. Auto-releases when the tab
  // hides; re-acquired when the borrower comes back. Manual lock / app switch
  // is covered by the device-local resume draft instead.
  useEffect(() => {
    if (done) return;
    type WakeLockSentinel = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (!cancelled && document.visibilityState === 'visible') {
          sentinel = await nav.wakeLock!.request('screen');
        }
      } catch {
        // Low battery or platform denial — the resume draft still protects the session.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [done]);

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

  // ZDR client delivery: when the conversation completes, relay the MISMO 3.4
  // payload to the client's LOS API. The borrower downloads nothing; FreeFlow
  // holds the session in memory only until this handoff succeeds.
  useEffect(() => {
    if (!done || delivery.state !== 'idle') return;
    setDelivery({ state: 'sending' });
    const xml = buildMismo34Xml(answers);
    fetch('/api/intake/deliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Delivery returned ${response.status}`);
        return response.json() as Promise<{ receiptId: string }>;
      })
      .then((receipt) => {
        setDelivery({ state: 'delivered', receiptId: receipt.receiptId });
        // Application is in the lender's custody now — wipe the device draft (ZDR)
        clearIntakeSession();
      })
      .catch(() => setDelivery({ state: 'error' }));
  }, [done, delivery.state, answers]);

  /** LO-side backup: download the same MISMO 3.4 XML that was delivered via API */
  function exportSession() {
    const xml = buildMismo34Xml(answers);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'urla-1003-mismo34.xml';
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
      className="flex h-full min-h-[780px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex-row"
    >
      <div className="flex min-h-[60vh] w-full min-w-0 flex-col border-b border-slate-200 lg:min-h-0 lg:w-[52%] lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
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
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={!support.listen}
              onClick={() => {
                if (voiceMode) {
                  stopSpeaking();
                  stopListening();
                  setSpeaking(false);
                  setVoiceMode(false);
                } else {
                  setVoiceMode(true);
                  lastSpokenIdRef.current = null; // speak the current prompt
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40 ${
                voiceMode ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              aria-pressed={voiceMode}
            >
              {voiceMode ? <Volume2 className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              {voiceMode ? copy.callMode : copy.voiceOff}
            </button>
            <button
              type="button"
              onClick={focusComposer}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {copy.startCall}
            </button>
          </div>
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
          {resumable && !done && (
            <div className="mx-auto w-full max-w-lg rounded-2xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
              <p className="text-sm font-bold text-emerald-950">
                Welcome back{resumable.answers.borrowerName ? `, ${resumable.answers.borrowerName.split(/\s+/)[0]}` : ''}!
              </p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-900">
                Your application draft is saved on this device only — FreeFlow servers keep nothing. Pick up where you
                left off, or start fresh.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={resumeSavedSession}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  Resume application
                </button>
                <button
                  type="button"
                  onClick={discardSavedSession}
                  className="rounded-full border border-emerald-300 bg-white px-4 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                >
                  Start over
                </button>
              </div>
            </div>
          )}
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
            <div className="mx-auto max-w-lg space-y-3">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-relaxed text-emerald-950">
                {localizedCompletion(answers, lang)}
              </div>
              <div
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
                  delivery.state === 'delivered'
                    ? 'border-emerald-300 bg-white text-emerald-800'
                    : delivery.state === 'error'
                      ? 'border-rose-300 bg-rose-50 text-rose-800'
                      : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {delivery.state === 'sending' && <span className="font-semibold">Delivering MISMO 3.4 to the lender’s API…</span>}
                {delivery.state === 'delivered' && (
                  <span className="font-semibold">
                    Delivered to client LOS API · receipt {delivery.receiptId?.slice(0, 8)} · ZDR relay, no copy retained
                  </span>
                )}
                {delivery.state === 'error' && (
                  <>
                    <span className="font-semibold">Delivery failed — the loan officer can retry or use the MISMO backup download.</span>
                    <button
                      type="button"
                      onClick={() => setDelivery({ state: 'idle' })}
                      className="shrink-0 rounded-full bg-rose-600 px-3 py-1 text-[10px] font-black uppercase text-white hover:bg-rose-700"
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
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
