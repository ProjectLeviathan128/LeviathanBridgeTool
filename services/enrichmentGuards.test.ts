import { describe, expect, it } from 'vitest';
import { Contact } from '../types';
import { assessEnrichmentQuality, normalizeAnalysisOutput, parseToolCallFromText } from './enrichmentGuards';

const baseContact: Contact = {
  id: 'c1',
  name: 'Jane Doe',
  headline: 'Partner at Example Capital',
  location: 'San Francisco, CA',
  source: 'Import',
  rawText: 'Profile: https://www.linkedin.com/in/jane-doe/',
  status: 'New',
  ingestionMeta: {
    uploader: 'test',
    uploadDate: new Date().toISOString(),
    sourceLabel: 'test.csv',
    trustLevel: 'Manual',
  },
};

describe('parseToolCallFromText', () => {
  it('parses multiline search tool JSON', () => {
    const response = `
      Sure - running search now.
      {
        "tool": "search_contacts",
        "query": "maritime investors in california"
      }
    `;

    const parsed = parseToolCallFromText(response);
    expect(parsed).toEqual({
      name: 'search_contacts',
      args: { query: 'maritime investors in california' },
    });
  });

  it('parses enrich tool JSON with contactIds', () => {
    const response = '{"tool":"enrich_contacts","contactIds":["1","2","3"]}';
    const parsed = parseToolCallFromText(response);
    expect(parsed).toEqual({
      name: 'enrich_contacts',
      args: { contactIds: ['1', '2', '3'] },
    });
  });
});

describe('normalizeAnalysisOutput', () => {
  it('downgrades confidence and flags review when evidence is missing', () => {
    const normalized = normalizeAnalysisOutput(
      {
        scores: {
          investorFit: { score: 88, confidence: 91, reasoning: 'Strong fit', contributingFactors: [], missingDataPenalty: false },
          valuesAlignment: { score: 80, confidence: 85, reasoning: 'Aligned', contributingFactors: [], missingDataPenalty: false },
          govtAccess: { score: 45, confidence: 70, reasoning: 'Moderate', contributingFactors: [], missingDataPenalty: true },
          maritimeRelevance: { score: 76, confidence: 75, reasoning: 'Good', contributingFactors: [], missingDataPenalty: false },
          connectorScore: { score: 68, confidence: 60, reasoning: 'Decent', contributingFactors: [], missingDataPenalty: false },
          overallConfidence: 92,
        },
        enrichment: {
          summary: 'High potential partner.',
          alignmentRisks: [],
          evidenceLinks: [],
          recommendedAngle: 'Warm intro',
          recommendedAction: 'Reach out',
          tracks: ['Investment'],
          flaggedAttributes: [],
          identityConfidence: 95,
          collisionRisk: false,
        },
      },
      baseContact
    );

    const quality = assessEnrichmentQuality(normalized.enrichment);
    expect(quality.requiresReview).toBe(true);
    expect(normalized.enrichment.identityConfidence).toBeLessThanOrEqual(55);
    expect(normalized.enrichment.flaggedAttributes).toContain('manual_review_required');
  });
});

