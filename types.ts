
export type Track = 'Investment' | 'Government' | 'Strategic Partner' | 'Unknown';

export interface IngestionMetadata {
  uploader: string;
  uploadDate: string;
  sourceLabel: string;
  trustLevel: 'Manual' | 'Scraped' | 'Third-Party';
}

export interface ThesisChunk {
  id: string;
  content: string;
  source: string;
  version: string;
  tags: string[];
}

export interface Evidence {
  claim: string;
  url: string;
  timestamp: string;
  confidence: number;
}

export interface ScoreProvenance {
  score: number;
  confidence: number;
  reasoning: string;
  contributingFactors: string[]; // e.g., "Cited Thesis Chunk #12"
  missingDataPenalty: boolean;
}

export interface Scores {
  investorFit: ScoreProvenance;
  valuesAlignment: ScoreProvenance;
  govtAccess: ScoreProvenance;
  maritimeRelevance: ScoreProvenance;
  connectorScore: ScoreProvenance;
  overallConfidence: number;
}

export interface EnrichmentData {
  summary: string;
  alignmentRisks: string[];
  evidenceLinks: Evidence[];
  recommendedAngle: string;
  recommendedAction: string;
  tracks: Track[];
  flaggedAttributes: string[];
  lastVerified?: string;
  identityConfidence: number; // 0-100
  collisionRisk: boolean;
}

export interface Contact {
  id: string;
  name: string;
  headline: string;
  location: string;
  source: string;
  tags?: string[];
  rawText?: string;
  status: 'New' | 'Enriched' | 'Review Needed' | 'Discarded';

  // Operational Metadata
  ingestionMeta: IngestionMetadata;

  // Analysis Data
  scores?: Scores;
  enrichment?: EnrichmentData;
}

export interface DashboardStats {
  totalContacts: number;
  highValueCount: number;
  needsReviewCount: number;
  trackDistribution: { name: string; value: number }[];
}

export type StrategicFocus = 'BALANCED' | 'GATEKEEPER' | 'DEAL_HUNTER' | 'GOVT_INTEL';

export interface AppSettings {
  focusMode: StrategicFocus;
  analysisModel: 'fast' | 'quality'; // 'fast' -> gemini-3-flash, 'quality' -> gemini-3-pro
}

export interface IngestionHistoryItem {
  id: string;
  name: string;
  type: string;
  timestamp: string;
  status: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  groundingSources?: { title: string; uri: string }[];
  isToolUse?: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  status: 'idle' | 'thinking' | 'tool_use';
  toolStatus?: string; // e.g., "Auto-Enriching 5 contacts..."
  createdAt: number;
  updatedAt: number;
}

// =====================
// AUTH & SYNC TYPES
// =====================

export interface UserProfile {
  id: string;
  username: string;
  email?: string;
  organizationId?: string;
  role?: 'owner' | 'member';
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  error?: string;
}

// =====================
// ORGANIZATION TYPES
// =====================

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  inviteCode: string;
  createdAt: number;
}

