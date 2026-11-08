import { useEffect } from 'react';
import { useAuth } from '../../auth/useAuth';
import styles from '../../styles/console.module.css';

/**
 * Compact auth state for the far-right column.
 *
 * Three honest presentations:
 *   * FIREBASE + signed in  -> shows the account, offers sign-out
 *   * FIREBASE + signed out -> shows a sign-in button
 *   * DEMO                  -> shows a DEMO badge and says saved data is shared
 *
 * There is no "pretend signed in" path: when the backend has no Firebase
 * project the chip says so.
 */
export function AuthChip() {
  const { status, email, mode, notice, persistent, busy, error, init, signIn, signOut } = useAuth();

  useEffect(() => {
    void init();
  }, [init]);

  const signedIn = status === 'signed-in';
  const volatile = mode === 'firebase' && !persistent;

  const label = signedIn && email
    ? email.split('@')[0]
    : volatile
      ? 'ACCOUNTS · MEMORY'
      : mode === 'demo' || status === 'unavailable'
        ? 'DEMO · SHARED'
        : status === 'signed-out'
          ? 'NOT SIGNED IN'
          : '…';

  return (
    <div className={styles.authRow} title={notice || 'Authentication state'}>
      <span className={styles.authChip} data-demo={!signedIn || volatile}>
        {label}
      </span>
      {mode === 'firebase' && status === 'signed-out' && (
        <button className={styles.authBtn} onClick={() => void signIn()} disabled={busy}>
          {busy ? '…' : 'SIGN IN'}
        </button>
      )}
      {mode === 'firebase' && status === 'signed-in' && (
        <button className={styles.authBtn} onClick={() => void signOut()} disabled={busy}>
          OUT
        </button>
      )}
      {error && (
        <span className={styles.authChip} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
          AUTH ERR
        </span>
      )}
    </div>
  );
}
