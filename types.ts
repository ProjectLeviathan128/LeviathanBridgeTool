
export type Track = 'Investment' | 'Government' | 'Strategic Partner' | 'Unknown';

export interface IngestionMetadata {
  uploader: string;
  uploadDate: string;
  sourceLabel: string;
  trustLevel: 'Manual' | 'Scraped' | 'Third-Party';
  batchId?: string;
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
  batchId?: string;
  recordCount?: number;
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
  thesis: string;
  strategicContext: string;
  ownerId: string;
  members: OrganizationMember[];
  inviteCode: string;
  createdAt: number;
  updatedAt: number;
}

export interface OrganizationMember {
  userId: string;
  username: string;
  email?: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface OrganizationInvitePayload {
  v: 1;
  org: {
    id: string;
    name: string;
    thesis: string;
    strategicContext: string;
    ownerId: string;
    createdAt: number;
    updatedAt: number;
  };
  inviter: {
    userId: string;
    username: string;
    email?: string;
  };
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface ContactMergeResult {
  contacts: Contact[];
  added: number;
  duplicates: number;
  merged: number;
}

export interface OrganizationSyncPackage {
  version: 1;
  exportedAt: string;
  exportedBy: string;
  organization: Organization;
  contacts: Contact[];
}
