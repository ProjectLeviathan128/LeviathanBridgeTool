import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Contact } from '../types';
import { createBridgeChat } from './geminiService';

function score(value: number) {
  return {
    score: value,
    confidence: value,
    reasoning: 'test',
    contributingFactors: [],
    missingDataPenalty: false,
  };
}

const contacts: Contact[] = [
  {
    id: 'c-1',
    name: 'Alex Harbor',
    headline: 'Managing Partner, Port Capital',
    location: 'Boston',
    source: 'import.csv',
    status: 'Enriched',
    ingestionMeta: {
      uploader: 'test',
      uploadDate: new Date('2026-02-01T00:00:00.000Z').toISOString(),
      sourceLabel: 'import.csv',
      trustLevel: 'Manual',
    },
    scores: {
      investorFit: score(92),
      valuesAlignment: score(85),
      govtAccess: score(50),
      maritimeRelevance: score(88),
      connectorScore: score(90),
      overallConfidence: 88,
    },
    enrichment: {
      summary: 'Top-tier maritime investor.',
      alignmentRisks: [],
      evidenceLinks: [
        {
          claim: 'Firm profile',
          url: 'https://example.com/alex-harbor',
          timestamp: new Date('2026-02-01T00:00:00.000Z').toISOString(),
          confidence: 90,
        },
        {
          claim: 'Conference bio',
          url: 'https://marineforum.org/speakers/alex-harbor',
          timestamp: new Date('2026-02-01T00:00:00.000Z').toISOString(),
          confidence: 86,
        },
      ],
      recommendedAngle: 'Lead with mission alignment.',
      recommendedAction: 'Request intro via mutual operator network.',
      tracks: ['Investment'],
      flaggedAttributes: [],
      identityConfidence: 90,
      collisionRisk: false,
      lastVerified: new Date('2026-02-05T12:00:00.000Z').toISOString(),
    },
  },
  {
    id: 'c-2',
    name: 'Jordan Quay',
    headline: 'Policy Advisor',
    location: 'DC',
    source: 'import.csv',
    status: 'Review Needed',
    ingestionMeta: {
      uploader: 'test',
      uploadDate: new Date('2026-02-01T00:00:00.000Z').toISOString(),
      sourceLabel: 'import.csv',
      trustLevel: 'Manual',
    },
    scores: {
      investorFit: score(42),
      valuesAlignment: score(52),
      govtAccess: score(78),
      maritimeRelevance: score(60),
      connectorScore: score(58),
      overallConfidence: 52,
    },
    enrichment: {
      summary: 'Possible government pathway but weak identity confidence.',
      alignmentRisks: ['Low identity confidence.'],
      evidenceLinks: [],
      recommendedAngle: 'Hold pending verification.',
      recommendedAction: 'Collect stronger source evidence before outreach.',
      tracks: ['Government'],
      flaggedAttributes: ['manual_review_required'],
      identityConfidence: 45,
      collisionRisk: true,
      lastVerified: new Date('2026-02-05T12:00:00.000Z').toISOString(),
    },
  },
  {
    id: 'c-3',
    name: 'Morgan Tide',
    headline: 'Founder',
    location: 'SF',
    source: 'import.csv',
    status: 'New',
    ingestionMeta: {
      uploader: 'test',
      uploadDate: new Date('2026-02-01T00:00:00.000Z').toISOString(),
      sourceLabel: 'import.csv',
      trustLevel: 'Manual',
    },
  },
];

describe('Bridge chat assistant deterministic intelligence', () => {
  const chatMock = vi.fn();

  beforeEach(() => {
    chatMock.mockReset();
    chatMock.mockResolvedValue('General assistant response.');
    (globalThis as any).puter = {
      ai: { chat: chatMock },
    };
  });

  afterEach(() => {
    delete (globalThis as any).puter;
  });

  it('returns deterministic pipeline snapshot without model call', async () => {
    const chat = createBridgeChat(contacts);
    const result = await chat.sendMessage({ message: 'give me a pipeline status snapshot' });

    expect(result.functionCalls).toBeNull();
    expect(result.text).toContain('Pipeline Snapshot');
    expect(result.text).toContain('Total contacts: 3');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('returns deterministic priority targets without model call', async () => {
    const chat = createBridgeChat(contacts);
    const result = await chat.sendMessage({ message: 'who should we prioritize next?' });

    expect(result.functionCalls).toBeNull();
    expect(result.text).toContain('Priority Targets');
    expect(result.text).toContain('Alex Harbor');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('keeps search tool fallback for discovery prompts', async () => {
    const chat = createBridgeChat(contacts);
    const result = await chat.sendMessage({ message: 'find maritime investors in boston' });

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(result.functionCalls?.[0]?.name).toBe('search_contacts');
    expect(result.functionCalls?.[0]?.args?.query).toBe('find maritime investors in boston');
  });
});
