import { SoftwareSourceReadError, type SoftwareSourceProviderBoundary } from './software-source-reader.ts';

export type RepositoryCollectionFailure = {
  code: 'RATE_LIMIT' | 'PROVIDER_REJECTED' | 'COLLECTION_UNAVAILABLE';
  providerBoundary: SoftwareSourceProviderBoundary | null;
};
/** Existing job snapshots retain every prior attempt in the immutable audit. */
export type RevenueRepositoryCollection = {
  attemptId: string;
  attempts: number;
  repository: string;
  state: 'PENDING' | 'FAILED' | 'COLLECTED';
  startedAt: string;
  completedAt: string | null;
  failure: RepositoryCollectionFailure | null;
  retryAt: string | null;
  snapshotDigest: string | null;
};
export const MAX_REPOSITORY_COLLECTION_ATTEMPTS = 3;

export function repositoryCollectionRetryDue(collection: RevenueRepositoryCollection, now: Date): boolean {
  return collection.state === 'FAILED' && collection.attempts < MAX_REPOSITORY_COLLECTION_ATTEMPTS
    && collection.retryAt !== null && Number.isFinite(Date.parse(collection.retryAt))
    && Date.parse(collection.retryAt) <= now.getTime();
}

export function repositoryCollectionFailure(error: unknown): RepositoryCollectionFailure {
  // Reconstruct from validated scalars; never persist Error.message, stack,
  // provider body, arbitrary headers or customer-controlled instructions.
  const source = error instanceof SoftwareSourceReadError ? error.providerBoundary : null;
  if (!source) return { code: 'COLLECTION_UNAVAILABLE', providerBoundary: null };
  const headers = new Headers();
  if (source.rateLimitRemaining !== null) headers.set('x-ratelimit-remaining', String(source.rateLimitRemaining));
  if (source.rateLimitResetUnixSeconds !== null) headers.set('x-ratelimit-reset', String(source.rateLimitResetUnixSeconds));
  if (source.retryAfterSeconds !== null) headers.set('retry-after', String(source.retryAfterSeconds));
  else if (source.retryAfterAt !== null) headers.set('retry-after', new Date(source.retryAfterAt).toUTCString());
  const checked = new SoftwareSourceReadError('PROVIDER_REJECTED', 'Public repository provider refused collection.', {status:source.httpStatus,headers}).providerBoundary;
  return checked ? {code:checked.classification,providerBoundary:checked} : {code:'COLLECTION_UNAVAILABLE',providerBoundary:null};
}

export function repositoryCollectionRetryAt(failure: RepositoryCollectionFailure, attempts: number, now: Date): string | null {
  if (attempts >= MAX_REPOSITORY_COLLECTION_ATTEMPTS || failure.code !== 'RATE_LIMIT') return null;
  const boundary = failure.providerBoundary;
  if (!boundary || ![403,429].includes(boundary.httpStatus)) return null;
  const candidates = [
    boundary.rateLimitResetUnixSeconds === null ? NaN : boundary.rateLimitResetUnixSeconds * 1000 + 1000,
    boundary.retryAfterSeconds === null ? NaN : now.getTime() + boundary.retryAfterSeconds * 1000,
    boundary.retryAfterAt === null ? NaN : Date.parse(boundary.retryAfterAt),
  ].filter(value => Number.isFinite(value) && value > now.getTime() && value <= 8_640_000_000_000_000);
  // Unknown/expired retry advice does not justify another request. Respect the
  // latest applicable lower bound; never accelerate an explicit provider limit.
  return candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
}

export function repositoryCollectionReason(collection: RevenueRepositoryCollection): string {
  if (collection.state === 'PENDING') return 'Repository collection is in progress or interrupted. Preserve its existing attempt and reconcile durable evidence before retry.';
  if (collection.state !== 'FAILED') return '';
  const status = collection.failure?.providerBoundary?.httpStatus;
  const detail = collection.failure?.code === 'RATE_LIMIT' ? 'GitHub quota exhausted' : status ? `GitHub refused collection (HTTP ${status})` : 'Repository evidence collection failed; provider cause is unknown';
  return `${detail}. ${collection.retryAt ? `A bounded retry is eligible no earlier than ${collection.retryAt}, under current payment and authority.` : `Automatic collection is blocked${collection.attempts >= MAX_REPOSITORY_COLLECTION_ATTEMPTS ? ' after three consumed attempts' : ' until supported changed evidence is reconciled'}.`} The paid obligation remains preserved.`;
}
