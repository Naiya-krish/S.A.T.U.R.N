import { PRODUCT } from '../config';
import styles from '../styles/console.module.css';

export function TitleFrame() {
  return (
    <div className={styles.titleFrame} aria-label={`${PRODUCT.name} — ${PRODUCT.short}`}>
      <div className={styles.titleTicks} aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      <div className={styles.titleText}>
        {PRODUCT.spaced.trim()
          .replace(/\.\s/g, '.')
          .split('')
          .map((ch, i) => (
            <span key={i} className={ch === '.' ? styles.titleDot : undefined}>
              {ch}
            </span>
          ))}
      </div>
      <div className={styles.titleRule} />
      <div className={styles.titleSub}>{PRODUCT.short}</div>
    </div>
  );
}
