import { useEffect, useRef, useState } from 'react';
import { useAgentStream } from '../hooks/useAgentStream';
import { remoteAudioNotice, startListening, stopListening, useVoiceStore, voiceSupported } from '../hooks/useVoice';
import { useSaturnStore } from '../state/useSaturnStore';
import { IconMic, IconSend, IconStop } from './icons';
import styles from '../styles/console.module.css';

export function CommandBar({ compact = false }: { compact?: boolean }) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const { submit, stop } = useAgentStream();
  const stage = useSaturnStore((s) => s.agent.stage);
  const taskId = useSaturnStore((s) => s.agent.taskId);
  const busy = stage !== 'idle';
  const messages = useSaturnStore((s) => s.messages);
  const listening = useVoiceStore((s) => s.listening);
  const speaking = useVoiceStore((s) => s.speaking);
  const voiceError = useVoiceStore((s) => s.error);
  const muted = useVoiceStore((s) => s.muted);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && listening) stopListening();
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening]);

  const pushToTalk = () => {
    if (listening) {
      stopListening();
      return;
    }
    if (!voiceSupported.recognition()) {
      setHint('Speech recognition is not supported in this browser — type the command instead.');
      return;
    }
    setHint(`Listening… ${remoteAudioNotice}`);
    startListening({
      onFinal: (t) => {
        setText(t);
        void submit(t, 'voice');
        window.setTimeout(() => setText(''), 600);
      },
      onInterim: (t) => setText(t),
      onError: (msg) => setHint(msg),
    });
  };

  const send = () => {
    if (!text.trim()) return;
    void submit(text.trim(), 'text');
    setText('');
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <div className={styles.commandBar} role="form" aria-label="Agent command bar">
      <button
        className={styles.micBtn}
        data-listening={listening}
        data-speaking={speaking}
        onClick={pushToTalk}
        aria-label={listening ? 'Stop listening' : 'Push to talk'}
        title={listening ? 'Stop listening (Esc)' : 'Push to talk'}
      >
        <IconMic />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <span className={styles.cmdPrompt}>S.A.T.U.R.N.&gt;</span>
        <input
          ref={inputRef}
          className={styles.cmdInput}
          value={text}
          placeholder={
            listening
              ? 'LISTENING…'
              : busy
                ? 'AGENT CONTROLLING…'
                : 'ASK S.A.T.U.R.N. — "SHOW SOUTH KOREA WITH THE LATEST SATELLITE IMAGERY"'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          disabled={busy}
          aria-label="Command input"
          spellCheck={false}
        />
      </div>
      <button
        className={styles.cmdBtn}
        onClick={() => toggleMute()}
        style={{ opacity: muted ? 0.55 : 1 }}
        aria-label="Toggle voice output"
        title={muted ? 'Voice output muted' : 'Voice output on'}
      >
        {muted ? 'MUTE' : 'VOICE'}
      </button>
      {busy && taskId ? (
        <button className={styles.cmdBtn} data-danger="true" onClick={() => void stop()} aria-label="Stop agent">
          <IconStop />
          STOP
        </button>
      ) : (
        <button className={styles.cmdBtn} onClick={send} disabled={!text.trim()} aria-label="Send command">
          <IconSend />
          EXEC
        </button>
      )}
      {busy && !taskId && (
        <button className={styles.cmdBtn} onClick={() => void stop()} aria-label="Cancel">
          <IconStop />
        </button>
      )}
      {!compact && (
        <div className={styles.replyLine} aria-live="polite">
          <b>{stage === 'idle' ? 'IDLE' : stage.toUpperCase()}</b>
          <span className={styles.replyText}>
            {voiceError ?? hint ?? lastAssistant?.text ?? 'AWAITING INSTRUCTION · VOICE OR TEXT'}
          </span>
        </div>
      )}
    </div>
  );
}
