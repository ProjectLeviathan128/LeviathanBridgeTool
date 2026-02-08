import { Contact, EnrichmentData, Evidence, ScoreProvenance, Scores, Track } from '../types';

type UnknownRecord = Record<string, unknown>;

export interface ParsedToolCall {
  name: 'search_contacts' | 'enrich_contacts';
  args: { query?: string; contactIds?: string[] };
}

export interface EnrichmentQualityAssessment {
  requiresReview: boolean;
  issues: string[];
}

interface EnrichmentQualityOptions {
  minEvidenceLinks?: number;
  requireNonLinkedInSource?: boolean;
  minIdentityConfidence?: number;
}

const VALID_TRACKS: Track[] = ['Investment', 'Government', 'Strategic Partner'];

function clampNumber(value: unknown, fallback: number, min = 0, max = 100): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function toObject(value: unknown): UnknownRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  return {};
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseScore(rawScore: unknown, fallbackReason: string): ScoreProvenance {
  const parsed = toObject(rawScore);
  return {
    score: clampNumber(parsed.score, 0),
    confidence: clampNumber(parsed.confidence, 40),
    reasoning: stringValue(parsed.reasoning, fallbackReason),
    contributingFactors: stringList(parsed.contributingFactors),
    missingDataPenalty: typeof parsed.missingDataPenalty === 'boolean' ? parsed.missingDataPenalty : true,
  };
}

function normalizeEvidenceLinks(rawEvidence: unknown): Evidence[] {
  const evidenceArray = Array.isArray(rawEvidence) ? rawEvidence : [];
  const seen = new Set<string>();

  return evidenceArray
    .map((entry) => {
      const parsed = toObject(entry);
      const claim = stringValue(parsed.claim).trim();
      const url = stringValue(parsed.url).trim();
      const timestamp = stringValue(parsed.timestamp, new Date().toISOString());
      const confidence = clampNumber(parsed.confidence, 50);

      if (!claim || !url || !isHttpUrl(url)) return null;
      const dedupeKey = `${claim}|${url}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);

      const normalizedTimestamp = Number.isNaN(Date.parse(timestamp))
        ? new Date().toISOString()
        : new Date(timestamp).toISOString();

      return {
        claim,
        url,
        timestamp: normalizedTimestamp,
        confidence,
      } as Evidence;
    })
    .filter((entry): entry is Evidence => Boolean(entry));
}

function normalizeTracks(rawTracks: unknown): Track[] {
  if (!Array.isArray(rawTracks)) return [];
  const parsedTracks = rawTracks
    .map((track) => (typeof track === 'string' ? track.trim() : ''))
    .filter((track) => VALID_TRACKS.includes(track as Track)) as Track[];
  return [...new Set(parsedTracks)];
}

export function extractLinkedInUrlFromContact(contact: Contact): string | null {
  const candidateText = [contact.source, contact.rawText, contact.headline].filter(Boolean).join(' ');
  const match = candidateText.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/[^\s)"'<>]+/i);
  return match ? match[0].replace(/[.,;:!?)]$/, '') : null;
}

function hasLinkedInEvidence(evidenceLinks: Evidence[]): boolean {
  return evidenceLinks.some((ev) => /(^|\.)linkedin\.com$/i.test(new URL(ev.url).hostname));
}

function hasNonLinkedInEvidence(evidenceLinks: Evidence[]): boolean {
  return evidenceLinks.some((ev) => !/(^|\.)linkedin\.com$/i.test(new URL(ev.url).hostname));
}

export function assessEnrichmentQuality(
  enrichment: EnrichmentData,
  options: EnrichmentQualityOptions = {}
): EnrichmentQualityAssessment {
  const issues: string[] = [];
  const evidenceCount = enrichment.evidenceLinks.length;
  const linkedInCount = enrichment.evidenceLinks.filter((ev) =>
    /(^|\.)linkedin\.com$/i.test(new URL(ev.url).hostname)
  ).length;
  const minEvidenceLinks = typeof options.minEvidenceLinks === 'number' ? options.minEvidenceLinks : 2;
  const minIdentityConfidence = typeof options.minIdentityConfidence === 'number' ? options.minIdentityConfidence : 60;
  const requireNonLinkedInSource = typeof options.requireNonLinkedInSource === 'boolean'
    ? options.requireNonLinkedInSource
    : true;

  if (evidenceCount < minEvidenceLinks) {
    issues.push(`Insufficient external evidence (need at least ${minEvidenceLinks} links).`);
  }

  if (requireNonLinkedInSource && evidenceCount > 0 && linkedInCount === evidenceCount) {
    issues.push('Evidence is only from LinkedIn; add at least one non-LinkedIn source.');
  }

  if (enrichment.identityConfidence < minIdentityConfidence) {
    issues.push('Low identity confidence.');
  }

  if (enrichment.collisionRisk) {
    issues.push('Potential identity collision risk.');
  }

  return {
    requiresReview: issues.length > 0,
    issues,
  };
}

export function normalizeAnalysisOutput(rawResult: unknown, contact: Contact): { scores: Scores; enrichment: EnrichmentData } {
  const result = toObject(rawResult);
  const rawScores = toObject(result.scores);
  const rawEnrichment = toObject(result.enrichment);

  const scores: Scores = {
    investorFit: parseScore(rawScores.investorFit, 'Insufficient investor data'),
    valuesAlignment: parseScore(rawScores.valuesAlignment, 'Insufficient values-alignment data'),
    govtAccess: parseScore(rawScores.govtAccess, 'Insufficient government-access data'),
    maritimeRelevance: parseScore(rawScores.maritimeRelevance, 'Insufficient maritime relevance data'),
    connectorScore: parseScore(rawScores.connectorScore, 'Insufficient connector data'),
    overallConfidence: clampNumber(rawScores.overallConfidence, 0),
  };

  const evidenceLinks = normalizeEvidenceLinks(rawEnrichment.evidenceLinks);
  const seedLinkedIn = extractLinkedInUrlFromContact(contact);
  const flaggedAttributes = stringList(rawEnrichment.flaggedAttributes);
  const alignmentRisks = stringList(rawEnrichment.alignmentRisks);

  if (seedLinkedIn && !hasLinkedInEvidence(evidenceLinks)) {
    evidenceLinks.unshift({
      claim: 'Seed LinkedIn profile imported with contact record.',
      url: seedLinkedIn,
      timestamp: new Date().toISOString(),
      confidence: 60,
    });
    if (!flaggedAttributes.includes('linkedin_not_verified_by_model')) {
      flaggedAttributes.push('linkedin_not_verified_by_model');
    }
  }

  if (evidenceLinks.length === 0) {
    if (!flaggedAttributes.includes('insufficient_evidence')) {
      flaggedAttributes.push('insufficient_evidence');
    }
    if (!alignmentRisks.includes('No verifiable evidence links were returned by the model.')) {
      alignmentRisks.push('No verifiable evidence links were returned by the model.');
    }
  }

  let identityConfidence = clampNumber(rawEnrichment.identityConfidence, 30);
  if (evidenceLinks.length === 0) {
    identityConfidence = Math.min(identityConfidence, 25);
  } else if (!hasNonLinkedInEvidence(evidenceLinks)) {
    identityConfidence = Math.min(identityConfidence, 55);
  }

  const enrichment: EnrichmentData = {
    summary: stringValue(rawEnrichment.summary, 'Insufficient verified information to produce a reliable enrichment summary.'),
    alignmentRisks,
    evidenceLinks,
    recommendedAngle: stringValue(rawEnrichment.recommendedAngle, 'Gather more verified information before outreach.'),
    recommendedAction: stringValue(rawEnrichment.recommendedAction, 'Run additional verification and review manually.'),
    tracks: normalizeTracks(rawEnrichment.tracks),
    flaggedAttributes,
    identityConfidence,
    collisionRisk: typeof rawEnrichment.collisionRisk === 'boolean' ? rawEnrichment.collisionRisk : false,
    lastVerified: new Date().toISOString(),
  };

  const quality = assessEnrichmentQuality(enrichment);
  if (quality.requiresReview) {
    quality.issues.forEach((issue) => {
      if (!enrichment.alignmentRisks.includes(issue)) {
        enrichment.alignmentRisks.push(issue);
      }
    });
    if (!enrichment.flaggedAttributes.includes('manual_review_required')) {
      enrichment.flaggedAttributes.push('manual_review_required');
    }
  }

  scores.overallConfidence = clampNumber(
    rawScores.overallConfidence,
    Math.round(
      (scores.investorFit.confidence +
        scores.valuesAlignment.confidence +
        scores.govtAccess.confidence +
        scores.maritimeRelevance.confidence +
        scores.connectorScore.confidence +
        enrichment.identityConfidence) /
        6
    )
  );

  return { scores, enrichment };
}

interface JsonObjectSlice {
  text: string;
  endIndex: number;
}

function extractNextJsonObject(text: string, cursor: number): JsonObjectSlice | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = cursor; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth > 0) {
        depth -= 1;
      }
      if (depth === 0 && start >= 0) {
        return { text: text.slice(start, i + 1), endIndex: i + 1 };
      }
    }
  }

  return null;
}

export function parseToolCallFromText(responseText: string): ParsedToolCall | null {
  let cursor = 0;

  while (cursor < responseText.length) {
    const nextObject = extractNextJsonObject(responseText, cursor);
    if (!nextObject) return null;
    cursor = nextObject.endIndex;

    try {
      const parsed = JSON.parse(nextObject.text) as UnknownRecord;
      if (parsed.tool === 'search_contacts') {
        const query = stringValue(parsed.query).trim();
        if (query) {
          return {
            name: 'search_contacts',
            args: { query },
          };
        }
      }

      if (parsed.tool === 'enrich_contacts') {
        const contactIds = Array.isArray(parsed.contactIds)
          ? parsed.contactIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          : [];

        if (contactIds.length > 0) {
          return {
            name: 'enrich_contacts',
            args: { contactIds },
          };
        }
      }
    } catch {
      // Continue scanning for the next JSON object.
    }
  }

  return null;
}
