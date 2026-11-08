/**
 * Voice I/O using browser APIs only (no audio leaves the device unless the
 * browser's own speech service is used — see `remoteAudioNotice`).
 *
 *  * SpeechRecognition (Chrome/Edge/Safari): push-to-talk by default
 *  * speechSynthesis for replies, muted by default with a volume control
 *  * wake word requires a dedicated engine (e.g. Porcupine) + licence key
 */

import { create } from 'zustand';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number;[i: number]: { isFinal: boolean;[j: number]: { transcript: string } } };
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupported = {
  recognition: () => typeof window !== 'undefined' && getRecognitionCtor() !== null,
  synthesis: () => typeof window !== 'undefined' && 'speechSynthesis' in window,
};

export interface VoiceState {
  listening: boolean;
  speaking: boolean;
  muted: boolean;
  volume: number;
  transcript: string;
  error: string | null;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setListening: (v: boolean) => void;
  setSpeaking: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  listening: false,
  speaking: false,
  muted: true,
  volume: 0.7,
  transcript: '',
  error: null,
  setVolume: (volume) => set({ volume }),
  toggleMute: () => set({ muted: !get().muted }),
  setListening: (listening) => set({ listening }),
  setSpeaking: (speaking) => set({ speaking }),
  setError: (error) => set({ error }),
}));

let recognition: SpeechRecognitionLike | null = null;

export const remoteAudioNotice =
  'Speech recognition uses the browser speech service. Depending on the browser, audio may be processed by a remote vendor service. Use text input if that is not acceptable.';

export function startListening(handlers: {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (msg: string) => void;
}): boolean {
  const Ctor = getRecognitionCtor();
  const store = useVoiceStore.getState();
  if (!Ctor) {
    store.setError('Speech recognition is not supported in this browser. Use text input.');
    handlers.onError?.('Speech recognition is not supported in this browser. Use text input instead.');
    return false;
  }
  if (recognition) {
    try {
      recognition.abort();
    } catch {
      /* noop */
    }
  }
  recognition = new Ctor();
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (ev) => {
    let interim = '';
    let final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      const text = res[0]?.transcript ?? '';
      if (res.isFinal) final += text;
      else interim += text;
    }
    if (interim) {
      useVoiceStore.setState({ transcript: interim });
      handlers.onInterim?.(interim);
    }
    if (final) {
      useVoiceStore.setState({ transcript: final });
      handlers.onFinal(final.trim());
    }
  };
  recognition.onerror = (ev) => {
    const msg =
      ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
        ? 'Microphone permission denied. Enable it in browser settings or type your command.'
        : ev.error === 'no-speech'
          ? 'No speech detected. Try again.'
          : `Speech recognition error: ${ev.error}`;
    useVoiceStore.setState({ listening: false, error: msg });
    handlers.onError?.(msg);
  };
  recognition.onend = () => {
    useVoiceStore.setState({ listening: false });
  };
  try {
    recognition.start();
    useVoiceStore.setState({ listening: true, error: null, transcript: '' });
    return true;
  } catch (e) {
    useVoiceStore.setState({ listening: false, error: e instanceof Error ? e.message : 'Could not start microphone.' });
    return false;
  }
}

export function stopListening() {
  try {
    recognition?.stop();
  } catch {
    /* noop */
  }
  useVoiceStore.setState({ listening: false });
}

/** Speaks a reply. No-ops when muted or synthesis unsupported. */
export function speak(text: string) {
  const state = useVoiceStore.getState();
  if (state.muted || !voiceSupported.synthesis() || !text) return;
  const clean = text.replace(/[*_`#]/g, '').slice(0, 420);
  const utter = new SpeechSynthesisUtterance(clean);
  utter.volume = state.volume;
  utter.rate = 1.02;
  utter.pitch = 0.95;
  utter.onstart = () => state.setSpeaking(true);
  utter.onend = () => state.setSpeaking(false);
  utter.onerror = () => state.setSpeaking(false);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  useVoiceStore.getState().setSpeaking(false);
}
