import type { Freshness } from '../../state/types';

const LABEL: Record<Freshness, string> = {
  RECENT_OBSERVATION: 'RECENT OBS',
  HISTORICAL: 'HISTORICAL',
  FORECAST: 'FORECAST',
  STALE: 'STALE',
  UNAVAILABLE: 'UNAVAILABLE',
};

const CLS: Record<Freshness, string> = {
  RECENT_OBSERVATION: 'badge--recent',
  HISTORICAL: 'badge--hist',
  FORECAST: 'badge--forecast',
  STALE: 'badge--stale',
  UNAVAILABLE: 'badge--unavail',
};

export function FreshnessBadge({ freshness, text }: { freshness: Freshness; text?: string }) {
  return (
    <span className={`badge ${CLS[freshness]}`} title={`Freshness: ${freshness}`}>
      {text ?? LABEL[freshness]}
    </span>
  );
}
