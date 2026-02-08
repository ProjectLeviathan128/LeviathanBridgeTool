import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettings, Contact } from '../types';
import { analyzeContactWithGemini } from './geminiService';

const baseContact: Contact = {
  id: 'contact-1',
  name: 'Jordan Example',
  headline: 'Principal at Harbor Ventures',
  location: 'Boston, MA',
  source: 'csv-import',
  rawText: 'LinkedIn: https://www.linkedin.com/in/jordan-example/',
  status: 'New',
  ingestionMeta: {
    uploader: 'test',
    uploadDate: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    sourceLabel: 'test.csv',
    trustLevel: 'Manual',
  },
};

const settings: AppSettings = {
  focusMode: 'BALANCED',
  analysisModel: 'quality',
};

function score(scoreValue: number) {
  return {
    score: scoreValue,
    confidence: 80,
    reasoning: 'Backed by verified evidence.',
    contributingFactors: ['Verified public profile data'],
    missingDataPenalty: false,
  };
}

function analysisPayload(summary = 'Verified operator with maritime-focused investment activity.') {
  return {
    scores: {
      investorFit: score(81),
      valuesAlignment: score(78),
      govtAccess: score(40),
      maritimeRelevance: score(86),
      connectorScore: score(73),
      overallConfidence: 80,
    },
    enrichment: {
      summary,
      alignmentRisks: [],
      evidenceLinks: [],
      recommendedAngle: 'Lead with maritime commercialization fit.',
      recommendedAction: 'Request warm intro via shared conference network.',
      tracks: ['Investment'],
      flaggedAttributes: [],
      identityConfidence: 90,
      collisionRisk: false,
    },
  };
}

describe('analyzeContactWithGemini evidence gate', () => {
  const chatMock = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    chatMock.mockReset();
    fetchMock.mockReset();
    (globalThis as any).puter = {
      ai: { chat: chatMock },
      net: { fetch: fetchMock },
    };
  });

  afterEach(() => {
    delete (globalThis as any).puter;
  });

  it('blocks enrichment when verified evidence is insufficient', async () => {
    chatMock.mockResolvedValue('[]');
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

    const result = await analyzeContactWithGemini(baseContact, settings);

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(result.scores.overallConfidence).toBe(0);
    expect(result.enrichment.summary).toContain('Enrichment blocked');
    expect(result.enrichment.flaggedAttributes).toContain('evidence_gate_blocked');
    expect(result.enrichment.collisionRisk).toBe(true);
  });

  it('blocks enrichment when evidence is LinkedIn-only', async () => {
    chatMock.mockResolvedValueOnce(
      JSON.stringify([
        {
          claim: 'Official profile',
          url: 'https://www.linkedin.com/in/jordan-example/',
          timestamp: '2026-02-01T00:00:00.000Z',
          confidence: 92,
        },
        {
          claim: 'Company profile',
          url: 'https://www.linkedin.com/company/harbor-ventures/',
          timestamp: '2026-02-01T00:00:00.000Z',
          confidence: 88,
        },
      ])
    );

    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    const result = await analyzeContactWithGemini(baseContact, settings);

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(result.enrichment.flaggedAttributes).toContain('evidence_gate_blocked');
    expect(result.enrichment.alignmentRisks).toContain('Evidence is only from LinkedIn; add at least one non-LinkedIn source.');
  });

  it('runs full analysis when verified multi-source evidence exists', async () => {
    chatMock
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            claim: 'Official profile',
            url: 'https://www.linkedin.com/in/jordan-example/',
            timestamp: '2026-02-01T00:00:00.000Z',
            confidence: 93,
          },
          {
            claim: 'Conference speaker bio',
            url: 'https://www.maritimeforum.org/speakers/jordan-example',
            timestamp: '2026-02-01T00:00:00.000Z',
            confidence: 84,
          },
        ])
      )
      .mockResolvedValueOnce(JSON.stringify(analysisPayload()));

    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    const result = await analyzeContactWithGemini(baseContact, settings);

    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalled();
    expect(result.enrichment.evidenceLinks).toHaveLength(2);
    expect(result.enrichment.evidenceLinks.some((ev) => ev.url.includes('linkedin.com'))).toBe(true);
    expect(result.enrichment.evidenceLinks.some((ev) => ev.url.includes('maritimeforum.org'))).toBe(true);
    expect(result.enrichment.summary).toContain('Verified operator');

    const analysisPrompt = String(chatMock.mock.calls[1][0]);
    expect(analysisPrompt).toContain('=== VERIFIED_EVIDENCE ===');
  });

  it('falls back to secondary analysis model when primary fails', async () => {
    chatMock
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            claim: 'Official profile',
            url: 'https://www.linkedin.com/in/jordan-example/',
            timestamp: '2026-02-01T00:00:00.000Z',
            confidence: 90,
          },
          {
            claim: 'Conference speaker bio',
            url: 'https://www.maritimeforum.org/speakers/jordan-example',
            timestamp: '2026-02-01T00:00:00.000Z',
            confidence: 84,
          },
        ])
      )
      .mockRejectedValueOnce(new Error('primary model unavailable'))
      .mockResolvedValueOnce(JSON.stringify(analysisPayload('Recovered on fallback model.')));

    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    const result = await analyzeContactWithGemini(baseContact, settings);

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(chatMock.mock.calls[1][1]?.model).toBe('gemini-2.5-pro');
    expect(chatMock.mock.calls[2][1]?.model).toBe('gemini-2.5-flash');
    expect(result.enrichment.summary).toContain('Recovered on fallback model.');
  });

  it('repairs malformed analysis JSON instead of failing enrichment', async () => {
    chatMock
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            claim: 'Official profile',
            url: 'https://www.linkedin.com/in/jordan-example/',
            timestamp: '2026-02-01T00:00:00.000Z',
            confidence: 90,
          },
          {
            claim: 'Conference speaker bio',
            url: 'https://www.maritimeforum.org/speakers/jordan-example',
            timestamp: '2026-02-01T00:00:00.000Z',
            confidence: 84,
          },
        ])
      )
      .mockResolvedValueOnce('Result:\n{"scores":{"investorFit": }\n')
      .mockResolvedValueOnce(JSON.stringify(analysisPayload('Recovered by JSON repair pass.')));

    fetchMock.mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    const result = await analyzeContactWithGemini(baseContact, settings);

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(String(chatMock.mock.calls[2][0])).toContain('JSON repair utility');
    expect(result.enrichment.summary).toContain('Recovered by JSON repair pass.');
  });

  it('returns explicit SDK failure when Puter runtime is unavailable', async () => {
    delete (globalThis as any).puter;

    const result = await analyzeContactWithGemini(baseContact, settings);

    expect(result.scores.overallConfidence).toBe(0);
    expect(result.enrichment.summary).toContain('AI runtime is unavailable');
    expect(result.enrichment.flaggedAttributes).toContain('error_sdk_unavailable');
    expect(result.enrichment.recommendedAction).toContain('Refresh the page');
  });

  it('returns explicit auth failure when provider requires sign-in', async () => {
    chatMock.mockRejectedValue(new Error('401 Unauthorized'));

    const result = await analyzeContactWithGemini(baseContact, settings);

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(result.scores.overallConfidence).toBe(0);
    expect(result.enrichment.summary).toContain('AI authorization is required');
    expect(result.enrichment.flaggedAttributes).toContain('error_auth_required');
    expect(result.enrichment.recommendedAction).toContain('Sign in to Puter');
  });
});
