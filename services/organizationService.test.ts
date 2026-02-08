import { describe, expect, it } from 'vitest';
import { Contact, OrganizationMember } from '../types';
import {
  INTRO_REQUEST_LIST,
  createOrganization,
  createOrganizationInviteCode,
  createOrganizationSyncPackage,
  dedupeContacts,
  mergeContactsWithDedupe,
  organizationFromInvite,
  parseOrganizationInviteCode,
  parseOrganizationSyncPackage,
} from './organizationService';

function makeContact(overrides: Partial<Contact>): Contact {
  return {
    id: overrides.id || `c-${Math.random().toString(36).slice(2, 9)}`,
    name: overrides.name || 'Unknown',
    headline: overrides.headline || '',
    location: overrides.location || '',
    source: overrides.source || 'import.csv',
    status: overrides.status || 'New',
    tags: overrides.tags || [],
    rawText: overrides.rawText || '',
    ingestionMeta: overrides.ingestionMeta || {
      uploader: 'test',
      uploadDate: new Date('2026-02-01T00:00:00.000Z').toISOString(),
      sourceLabel: 'import.csv',
      trustLevel: 'Manual',
    },
    scores: overrides.scores,
    enrichment: overrides.enrichment,
  };
}

describe('organizationService', () => {
  it('merges duplicate contacts by deterministic merge key', () => {
    const existing = [
      makeContact({
        id: 'existing-1',
        name: 'Jane Harbor',
        headline: 'Investor',
        location: 'NYC',
        tags: ['shipping'],
      }),
    ];

    const incoming = [
      makeContact({
        id: 'incoming-1',
        name: 'Jane Harbor',
        headline: 'Maritime Investor',
        location: 'New York',
        tags: ['ports'],
      }),
    ];

    const result = mergeContactsWithDedupe(existing, incoming);
    expect(result.contacts).toHaveLength(1);
    expect(result.duplicates).toBe(1);
    expect(result.added).toBe(0);
    expect(result.contacts[0].tags).toEqual(expect.arrayContaining(['shipping', 'ports']));
    expect(result.contacts[0].headline).toBe('Maritime Investor');
  });

  it('deduplicates in-place contact lists', () => {
    const contacts = [
      makeContact({
        id: 'c1',
        name: 'Alex Tide',
        headline: 'Partner',
        location: 'Boston',
        rawText: 'https://linkedin.com/in/alextide',
      }),
      makeContact({
        id: 'c2',
        name: 'Alex Tide',
        headline: 'Partner',
        location: 'Boston',
        rawText: 'https://linkedin.com/in/alextide',
      }),
      makeContact({
        id: 'c3',
        name: 'Morgan Bay',
        headline: 'Operator',
        location: 'SF',
      }),
    ];

    const result = dedupeContacts(contacts);
    expect(result.contacts).toHaveLength(2);
    expect(result.duplicates).toBe(1);
  });

  it('honors latest collaboration timestamps when intro queue is removed', () => {
    const older = makeContact({
      id: 'c-intro-old',
      name: 'Taylor Harbor',
      location: 'Boston',
      introRequested: true,
      introRequestedAt: new Date('2026-02-01T10:00:00.000Z').toISOString(),
      lists: [INTRO_REQUEST_LIST],
      collaboration: {
        introUpdatedAt: new Date('2026-02-01T10:00:00.000Z').toISOString(),
        listsUpdatedAt: new Date('2026-02-01T10:00:00.000Z').toISOString(),
      },
    });

    const newer = makeContact({
      id: 'c-intro-new',
      name: 'Taylor Harbor',
      location: 'Boston',
      introRequested: false,
      lists: [],
      collaboration: {
        introUpdatedAt: new Date('2026-02-03T10:00:00.000Z').toISOString(),
        listsUpdatedAt: new Date('2026-02-03T10:00:00.000Z').toISOString(),
      },
    });

    const result = mergeContactsWithDedupe([older], [newer]);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].introRequested).toBe(false);
    expect(result.contacts[0].lists || []).not.toContain(INTRO_REQUEST_LIST);
  });

  it('honors latest collaboration timestamps when team flags are cleared', () => {
    const older = makeContact({
      id: 'c-flag-old',
      name: 'Casey Anchor',
      location: 'Miami',
      teamFlagged: true,
      collaboration: {
        teamFlaggedUpdatedAt: new Date('2026-02-01T10:00:00.000Z').toISOString(),
      },
    });

    const newer = makeContact({
      id: 'c-flag-new',
      name: 'Casey Anchor',
      location: 'Miami',
      teamFlagged: false,
      collaboration: {
        teamFlaggedUpdatedAt: new Date('2026-02-02T10:00:00.000Z').toISOString(),
      },
    });

    const result = mergeContactsWithDedupe([older], [newer]);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].teamFlagged).toBe(false);
  });

  it('creates, validates, and materializes invite codes', () => {
    const owner: OrganizationMember = {
      userId: 'u-owner',
      username: 'owner',
      role: 'owner',
      joinedAt: new Date('2026-02-01T00:00:00.000Z').toISOString(),
    };

    const organization = createOrganization({
      name: 'Leviathan Ops',
      thesis: 'Mission-aligned capital only.',
      strategicContext: 'Focus on maritime resilience.',
      owner,
    });

    const code = createOrganizationInviteCode(organization, owner);
    expect(code).toMatch(/^\d{5}-LBRG1\./);
    const parsed = parseOrganizationInviteCode(code);
    expect(parsed.ok).toBe(true);
    expect(parsed.payload?.org.id).toBe(organization.id);
    expect(parsed.payload?.pin).toMatch(/^\d{5}$/);

    const joined = organizationFromInvite(parsed.payload!, {
      userId: 'u-member',
      username: 'member',
      role: 'member',
      joinedAt: new Date('2026-02-02T00:00:00.000Z').toISOString(),
    });
    expect(joined.members.map((m) => m.userId)).toContain('u-member');
  });

  it('rejects tampered invite codes', () => {
    const owner: OrganizationMember = {
      userId: 'u-owner',
      username: 'owner',
      role: 'owner',
      joinedAt: new Date('2026-02-01T00:00:00.000Z').toISOString(),
    };

    const organization = createOrganization({
      name: 'Leviathan Ops',
      thesis: 'Mission-aligned capital only.',
      strategicContext: 'Focus on maritime resilience.',
      owner,
    });

    const code = createOrganizationInviteCode(organization, owner);
    const tampered = `${code}x`;
    const parsed = parseOrganizationInviteCode(tampered);
    expect(parsed.ok).toBe(false);
  });

  it('rejects pin-only invite input', () => {
    const parsed = parseOrganizationInviteCode('12345');
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.toLowerCase()).toContain('full invite code');
  });

  it('round-trips organization sync package', () => {
    const owner: OrganizationMember = {
      userId: 'u-owner',
      username: 'owner',
      role: 'owner',
      joinedAt: new Date('2026-02-01T00:00:00.000Z').toISOString(),
    };

    const organization = createOrganization({
      name: 'Leviathan Ops',
      thesis: 'Mission-aligned capital only.',
      strategicContext: 'Focus on maritime resilience.',
      owner,
    });

    const pkg = createOrganizationSyncPackage({
      organization,
      contacts: [makeContact({ id: 'c1', name: 'Dana Port' })],
      exportedBy: 'owner',
    });

    const parsed = parseOrganizationSyncPackage(JSON.stringify(pkg));
    expect(parsed.ok).toBe(true);
    expect(parsed.payload?.organization.id).toBe(organization.id);
    expect(parsed.payload?.contacts).toHaveLength(1);
  });
});
