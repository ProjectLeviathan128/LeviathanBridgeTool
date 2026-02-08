import { describe, expect, it } from 'vitest';
import { Contact, OrganizationMember } from '../types';
import {
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
    const parsed = parseOrganizationInviteCode(code);
    expect(parsed.ok).toBe(true);
    expect(parsed.payload?.org.id).toBe(organization.id);

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
