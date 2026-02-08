import {
  Contact,
  ContactMergeResult,
  Organization,
  OrganizationInvitePayload,
  OrganizationMember,
  OrganizationSyncPackage,
} from '../types';
import { extractLinkedInUrlFromContact } from './enrichmentGuards';

const INVITE_PREFIX = 'LBRG1';
const INVITE_PIN_LENGTH = 5;
export const INTRO_REQUEST_LIST = 'intro-requests';

function randomToken(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function randomDigits(length: number): string {
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += Math.floor(Math.random() * 10).toString();
  }
  return output;
}

export function createInvitePin(): string {
  return randomDigits(INVITE_PIN_LENGTH);
}

function normalizeInvitePin(pin?: string): string {
  if (pin && /^\d{5}$/.test(pin)) return pin;
  return createInvitePin();
}

function toBase64Url(value: string): string {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  const globalBuffer = (globalThis as { Buffer?: { from: (input: string, encoding?: string) => { toString: (encoding?: string) => string } } }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(value, 'utf8').toString('base64url');
  }
  throw new Error('No base64 encoder available in this runtime.');
}

function fromBase64Url(value: string): string {
  if (typeof atob === 'function') {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  const globalBuffer = (globalThis as { Buffer?: { from: (input: string, encoding?: string) => { toString: (encoding?: string) => string } } }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(value, 'base64url').toString('utf8');
  }
  throw new Error('No base64 decoder available in this runtime.');
}

function checksum(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 0x7fffffff;
  }
  return hash.toString(36);
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeToken(value: string): string {
  return cleanText(value).toLowerCase();
}

function normalizeLocationToken(value: string): string {
  return normalizeToken(value)
    .replace(/\bnew york city\b/g, 'new york')
    .replace(/\bnyc\b/g, 'new york')
    .replace(/\bsan francisco\b/g, 'sf')
    .replace(/\bu\.?s\.?a?\b/g, 'us')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function bestString(current: string, incoming: string): string {
  const a = current.trim();
  const b = incoming.trim();
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function bestStatus(current: Contact['status'], incoming: Contact['status']): Contact['status'] {
  const rank: Record<Contact['status'], number> = {
    Enriched: 4,
    'Review Needed': 3,
    New: 2,
    Discarded: 1,
  };
  return rank[incoming] > rank[current] ? incoming : current;
}

function pickBestScores(current: Contact, incoming: Contact): Contact['scores'] {
  if (!current.scores && !incoming.scores) return undefined;
  if (!current.scores) return incoming.scores;
  if (!incoming.scores) return current.scores;
  return incoming.scores.overallConfidence >= current.scores.overallConfidence
    ? incoming.scores
    : current.scores;
}

function pickBestEnrichment(current: Contact, incoming: Contact): Contact['enrichment'] {
  if (!current.enrichment && !incoming.enrichment) return undefined;
  if (!current.enrichment) return incoming.enrichment;
  if (!incoming.enrichment) return current.enrichment;

  const currentEvidence = current.enrichment.evidenceLinks.length;
  const incomingEvidence = incoming.enrichment.evidenceLinks.length;
  if (incomingEvidence !== currentEvidence) {
    return incomingEvidence > currentEvidence ? incoming.enrichment : current.enrichment;
  }

  return incoming.enrichment.identityConfidence >= current.enrichment.identityConfidence
    ? incoming.enrichment
    : current.enrichment;
}

function parseTimestampMs(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(a?: string, b?: string): string | undefined {
  const aMs = parseTimestampMs(a);
  const bMs = parseTimestampMs(b);
  if (aMs === 0 && bMs === 0) return a || b;
  return bMs > aMs ? b : a;
}

function normalizeLists(lists?: string[]): string[] {
  return [...new Set((lists || []).map((list) => list.trim()).filter(Boolean))];
}

function pickLatestBoolean(
  currentValue: boolean | undefined,
  currentUpdatedAt: string | undefined,
  incomingValue: boolean | undefined,
  incomingUpdatedAt: string | undefined,
  fallback: () => boolean
): boolean {
  const currentMs = parseTimestampMs(currentUpdatedAt);
  const incomingMs = parseTimestampMs(incomingUpdatedAt);
  if (currentMs === 0 && incomingMs === 0) return fallback();
  if (incomingMs > currentMs) return Boolean(incomingValue);
  if (currentMs > incomingMs) return Boolean(currentValue);
  if (incomingValue !== undefined) return Boolean(incomingValue);
  return Boolean(currentValue);
}

export function mergeContactRecords(primary: Contact, duplicate: Contact): Contact {
  const combinedTags = [
    ...(primary.tags || []),
    ...(duplicate.tags || []),
  ];
  const primaryLists = normalizeLists(primary.lists);
  const duplicateLists = normalizeLists(duplicate.lists);

  const mergedRawText = (() => {
    const first = primary.rawText?.trim() ?? '';
    const second = duplicate.rawText?.trim() ?? '';
    if (!first) return second;
    if (!second || first === second) return first;
    return `${first}\n\n---\n\n${second}`;
  })();

  const primaryListMs = parseTimestampMs(primary.collaboration?.listsUpdatedAt);
  const duplicateListMs = parseTimestampMs(duplicate.collaboration?.listsUpdatedAt);
  let lists = (() => {
    if (primaryListMs === 0 && duplicateListMs === 0) {
      return [...new Set([...primaryLists, ...duplicateLists])];
    }
    if (duplicateListMs > primaryListMs) return duplicateLists;
    if (primaryListMs > duplicateListMs) return primaryLists;
    return duplicateLists;
  })();

  const introRequested = pickLatestBoolean(
    primary.introRequested,
    primary.collaboration?.introUpdatedAt,
    duplicate.introRequested,
    duplicate.collaboration?.introUpdatedAt,
    () => Boolean(
      primary.introRequested ||
      duplicate.introRequested ||
      primaryLists.includes(INTRO_REQUEST_LIST) ||
      duplicateLists.includes(INTRO_REQUEST_LIST)
    )
  );

  lists = introRequested
    ? [...new Set([...lists.filter((list) => list !== INTRO_REQUEST_LIST), INTRO_REQUEST_LIST])]
    : lists.filter((list) => list !== INTRO_REQUEST_LIST);

  const introRequestedAt = introRequested
    ? (
      [primary.introRequestedAt, duplicate.introRequestedAt]
        .filter((value): value is string => Boolean(value))
        .sort()[0] || new Date().toISOString()
    )
    : undefined;

  const teamFlagged = pickLatestBoolean(
    primary.teamFlagged,
    primary.collaboration?.teamFlaggedUpdatedAt,
    duplicate.teamFlagged,
    duplicate.collaboration?.teamFlaggedUpdatedAt,
    () => Boolean(primary.teamFlagged || duplicate.teamFlagged)
  );

  const collaboration = {
    listsUpdatedAt: latestTimestamp(primary.collaboration?.listsUpdatedAt, duplicate.collaboration?.listsUpdatedAt),
    teamFlaggedUpdatedAt: latestTimestamp(
      primary.collaboration?.teamFlaggedUpdatedAt,
      duplicate.collaboration?.teamFlaggedUpdatedAt
    ),
    introUpdatedAt: latestTimestamp(primary.collaboration?.introUpdatedAt, duplicate.collaboration?.introUpdatedAt),
  };
  const hasCollaborationMetadata = Boolean(
    collaboration.listsUpdatedAt || collaboration.teamFlaggedUpdatedAt || collaboration.introUpdatedAt
  );

  const outreachDrafts: NonNullable<Contact['outreachDrafts']> = [];
  [...(primary.outreachDrafts || []), ...(duplicate.outreachDrafts || [])].forEach((draft) => {
    const key = `${draft.channel}|${draft.senderId}|${draft.generatedAt}`;
    const exists = outreachDrafts.some(
      (existing) => `${existing.channel}|${existing.senderId}|${existing.generatedAt}` === key
    );
    if (!exists) outreachDrafts.push(draft);
  });

  return {
    ...primary,
    name: bestString(primary.name, duplicate.name),
    headline: bestString(primary.headline, duplicate.headline),
    location: bestString(primary.location, duplicate.location),
    source: bestString(primary.source, duplicate.source),
    tags: [...new Set(combinedTags.map((tag) => tag.trim()).filter(Boolean))],
    lists,
    teamFlagged,
    introRequested,
    introRequestedAt,
    collaboration: hasCollaborationMetadata ? collaboration : undefined,
    outreachDrafts: outreachDrafts.slice(0, 8),
    rawText: mergedRawText,
    status: bestStatus(primary.status, duplicate.status),
    ingestionMeta: {
      ...primary.ingestionMeta,
      uploadDate: new Date(
        Math.min(
          Date.parse(primary.ingestionMeta.uploadDate || new Date().toISOString()),
          Date.parse(duplicate.ingestionMeta.uploadDate || new Date().toISOString())
        )
      ).toISOString(),
      sourceLabel: bestString(primary.ingestionMeta.sourceLabel, duplicate.ingestionMeta.sourceLabel),
      batchId: primary.ingestionMeta.batchId || duplicate.ingestionMeta.batchId,
      uploader: bestString(primary.ingestionMeta.uploader, duplicate.ingestionMeta.uploader),
    },
    scores: pickBestScores(primary, duplicate),
    enrichment: pickBestEnrichment(primary, duplicate),
  };
}

export function buildContactMergeKey(contact: Contact): string {
  const linkedIn = extractLinkedInUrlFromContact(contact);
  if (linkedIn) return `linkedin:${normalizeToken(linkedIn)}`;

  const name = normalizeToken(contact.name);
  const location = normalizeLocationToken(contact.location);
  if (name && location) return `${name}|${location}`;

  const headline = normalizeToken(contact.headline).replace(/[^a-z0-9 ]/g, '').slice(0, 60);
  if (name && headline) return `${name}|${headline}`;

  return `${name}|${normalizeToken(contact.source).slice(0, 40)}`;
}

export function mergeContactsWithDedupe(existing: Contact[], incoming: Contact[]): ContactMergeResult {
  const merged: Contact[] = [...existing];
  const keyToIndex = new Map<string, number>();

  merged.forEach((contact, index) => {
    keyToIndex.set(buildContactMergeKey(contact), index);
  });

  let added = 0;
  let duplicates = 0;
  let touched = 0;

  incoming.forEach((candidate) => {
    const key = buildContactMergeKey(candidate);
    const existingIndex = keyToIndex.get(key);

    if (typeof existingIndex === 'number') {
      duplicates += 1;
      const current = merged[existingIndex];
      const updated = mergeContactRecords(current, candidate);
      if (JSON.stringify(current) !== JSON.stringify(updated)) touched += 1;
      merged[existingIndex] = updated;
      return;
    }

    keyToIndex.set(key, merged.length);
    merged.push(candidate);
    added += 1;
  });

  return {
    contacts: merged,
    added,
    duplicates,
    merged: touched,
  };
}

export function dedupeContacts(contacts: Contact[]): ContactMergeResult {
  return mergeContactsWithDedupe([], contacts);
}

export function createOrganization(args: {
  name: string;
  thesis: string;
  strategicContext: string;
  owner: OrganizationMember;
}): Organization {
  const now = Date.now();
  const invitePin = createInvitePin();
  const organization: Organization = {
    id: `org-${now}-${randomToken(6)}`,
    name: cleanText(args.name),
    thesis: args.thesis.trim(),
    strategicContext: args.strategicContext.trim(),
    ownerId: args.owner.userId,
    members: [{
      ...args.owner,
      role: 'owner',
      joinedAt: args.owner.joinedAt || new Date(now).toISOString(),
    }],
    inviteCode: '',
    invitePin,
    createdAt: now,
    updatedAt: now,
  };

  organization.inviteCode = createOrganizationInviteCode(organization, args.owner);
  return organization;
}

export function upsertOrganizationMember(organization: Organization, member: OrganizationMember): Organization {
  const normalizedMember: OrganizationMember = {
    ...member,
    role: organization.ownerId === member.userId ? 'owner' : member.role,
  };
  const existingIndex = organization.members.findIndex((m) => m.userId === normalizedMember.userId);
  if (existingIndex >= 0) {
    const existing = organization.members[existingIndex];
    const mergedMember: OrganizationMember = {
      ...existing,
      ...normalizedMember,
      joinedAt: existing.joinedAt || normalizedMember.joinedAt,
    };

    const unchanged =
      existing.userId === mergedMember.userId &&
      existing.username === mergedMember.username &&
      existing.email === mergedMember.email &&
      existing.role === mergedMember.role &&
      existing.joinedAt === mergedMember.joinedAt;

    if (unchanged) return organization;

    const members = [...organization.members];
    members[existingIndex] = mergedMember;
    return {
      ...organization,
      members,
      updatedAt: Date.now(),
    };
  }

  return {
    ...organization,
    members: [...organization.members, normalizedMember],
    updatedAt: Date.now(),
  };
}

export function createOrganizationInviteCode(
  organization: Organization,
  inviter: Pick<OrganizationMember, 'userId' | 'username' | 'email'>,
  expiresInDays = 14
): string {
  const now = Date.now();
  const invitePin = normalizeInvitePin(organization.invitePin);
  const payload: OrganizationInvitePayload = {
    v: 1,
    pin: invitePin,
    org: {
      id: organization.id,
      name: organization.name,
      thesis: organization.thesis,
      strategicContext: organization.strategicContext,
      ownerId: organization.ownerId,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    },
    inviter: {
      userId: inviter.userId,
      username: inviter.username,
      email: inviter.email,
    },
    issuedAt: now,
    expiresAt: now + Math.max(1, expiresInDays) * 24 * 60 * 60 * 1000,
    nonce: randomToken(10),
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = checksum(encodedPayload);
  return `${invitePin}-${INVITE_PREFIX}.${encodedPayload}.${signature}`;
}

export function parseOrganizationInviteCode(code: string): {
  ok: boolean;
  payload?: OrganizationInvitePayload;
  error?: string;
} {
  const trimmed = code.trim();
  if (/^\d{5}$/.test(trimmed)) {
    return {
      ok: false,
      error: 'Quick PIN alone is not enough. Ask your teammate to copy the full invite code.',
    };
  }

  let pinPrefix: string | undefined;
  let token = trimmed;

  const prefixedMatch = trimmed.match(/^(\d{5})-(LBRG1\.[A-Za-z0-9_-]+\.[a-z0-9]+)$/);
  if (prefixedMatch) {
    pinPrefix = prefixedMatch[1];
    token = prefixedMatch[2];
  }

  const plainMatch = token.match(/^(LBRG1\.[A-Za-z0-9_-]+\.[a-z0-9]+)$/);
  if (!plainMatch) {
    return { ok: false, error: 'Invalid invite format.' };
  }

  const [prefix, encodedPayload, incomingSignature] = plainMatch[1].split('.');
  if (prefix !== INVITE_PREFIX || !encodedPayload || !incomingSignature) {
    return { ok: false, error: 'Invalid invite format.' };
  }

  if (checksum(encodedPayload) !== incomingSignature) {
    return { ok: false, error: 'Invite checksum mismatch. The code may be corrupted.' };
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as OrganizationInvitePayload;
    if (payload.v !== 1) return { ok: false, error: 'Unsupported invite version.' };
    if (Date.now() > payload.expiresAt) return { ok: false, error: 'Invite expired.' };
    if (pinPrefix && payload.pin && pinPrefix !== payload.pin) {
      return { ok: false, error: 'Invite PIN mismatch.' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'Failed to decode invite payload.' };
  }
}

export function organizationFromInvite(
  payload: OrganizationInvitePayload,
  joiningMember: OrganizationMember
): Organization {
  const invitePin = normalizeInvitePin(payload.pin);
  const ownerMember: OrganizationMember = {
    userId: payload.inviter.userId,
    username: payload.inviter.username,
    email: payload.inviter.email,
    role: 'owner',
    joinedAt: new Date(payload.issuedAt).toISOString(),
  };

  let organization: Organization = {
    id: payload.org.id,
    name: payload.org.name,
    thesis: payload.org.thesis,
    strategicContext: payload.org.strategicContext,
    ownerId: payload.org.ownerId,
    members: [ownerMember],
    inviteCode: '',
    invitePin,
    createdAt: payload.org.createdAt,
    updatedAt: Date.now(),
  };

  organization = upsertOrganizationMember(organization, joiningMember);
  organization.inviteCode = createOrganizationInviteCode(organization, ownerMember);
  return organization;
}

export function createOrganizationSyncPackage(args: {
  organization: Organization;
  contacts: Contact[];
  exportedBy: string;
}): OrganizationSyncPackage {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: args.exportedBy,
    organization: args.organization,
    contacts: args.contacts,
  };
}

export function parseOrganizationSyncPackage(raw: string): {
  ok: boolean;
  payload?: OrganizationSyncPackage;
  error?: string;
} {
  try {
    const parsed = JSON.parse(raw) as Partial<OrganizationSyncPackage>;
    if (parsed.version !== 1) return { ok: false, error: 'Unsupported package version.' };
    if (!parsed.organization || !Array.isArray(parsed.contacts)) {
      return { ok: false, error: 'Malformed package payload.' };
    }
    return { ok: true, payload: parsed as OrganizationSyncPackage };
  } catch {
    return { ok: false, error: 'Failed to parse package JSON.' };
  }
}
