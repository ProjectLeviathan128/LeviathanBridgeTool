import { AppSettings, OutreachChannel, OutreachSenderId, StrategicFocus } from '../types';

const VALID_FOCUS_MODES: StrategicFocus[] = ['BALANCED', 'GATEKEEPER', 'DEAL_HUNTER', 'GOVT_INTEL'];
const VALID_ANALYSIS_MODELS: Array<AppSettings['analysisModel']> = ['fast', 'quality'];
const VALID_OUTREACH_CHANNELS: OutreachChannel[] = ['linkedin', 'email'];
const VALID_OUTREACH_SENDERS: OutreachSenderId[] = ['nathan', 'matthew'];

const DEFAULT_SETTINGS: AppSettings = {
  focusMode: 'BALANCED',
  analysisModel: 'quality',
  analysis: {
    minEvidenceLinks: 2,
    maxEvidenceLinks: 8,
    minDistinctDomains: 2,
    requireNonLinkedInSource: true,
    minIdentityConfidence: 60,
    highPriorityScoreThreshold: 75,
  },
  chat: {
    searchResultLimit: 20,
    searchSnippetLength: 300,
    enrichmentBatchSize: 3,
    enrichmentDelayMs: 1000,
    showGroundingSources: true,
  },
  outreach: {
    defaultChannel: 'linkedin',
    defaultSender: 'nathan',
    maxDraftsPerContact: 8,
    linkedInCharacterLimit: 300,
    emailSubjectMaxLength: 70,
    modelTemperature: 0.35,
  },
  dashboard: {
    priorityQueueSize: 8,
    riskQueueSize: 8,
    highValueInvestorMin: 80,
    highValueValuesMin: 70,
    highValueConnectorMin: 75,
    riskLowConfidenceThreshold: 60,
  },
  automation: {
    autoSwitchToContactsOnIngest: true,
    autoSyncToCloud: true,
    autoOpenDebugOnFailure: true,
  },
  sync: {
    confirmBeforePull: true,
  },
};

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Number(numeric.toFixed(2))));
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T;
  }
  return fallback;
}

export function createDefaultSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    analysis: { ...DEFAULT_SETTINGS.analysis },
    chat: { ...DEFAULT_SETTINGS.chat },
    outreach: { ...DEFAULT_SETTINGS.outreach },
    dashboard: { ...DEFAULT_SETTINGS.dashboard },
    automation: { ...DEFAULT_SETTINGS.automation },
    sync: { ...DEFAULT_SETTINGS.sync },
  };
}

export function normalizeSettings(raw: unknown): AppSettings {
  const defaults = createDefaultSettings();
  const root = toObject(raw);

  const analysisInput = toObject(root.analysis);
  const chatInput = toObject(root.chat);
  const outreachInput = toObject(root.outreach);
  const dashboardInput = toObject(root.dashboard);
  const automationInput = toObject(root.automation);
  const syncInput = toObject(root.sync);

  const minEvidenceLinks = clampInt(
    analysisInput.minEvidenceLinks,
    defaults.analysis.minEvidenceLinks,
    1,
    6
  );
  const maxEvidenceLinks = clampInt(
    analysisInput.maxEvidenceLinks,
    defaults.analysis.maxEvidenceLinks,
    minEvidenceLinks,
    12
  );

  return {
    focusMode: pickEnum(root.focusMode, VALID_FOCUS_MODES, defaults.focusMode),
    analysisModel: pickEnum(root.analysisModel, VALID_ANALYSIS_MODELS, defaults.analysisModel),
    analysis: {
      minEvidenceLinks,
      maxEvidenceLinks,
      minDistinctDomains: clampInt(analysisInput.minDistinctDomains, defaults.analysis.minDistinctDomains, 1, 4),
      requireNonLinkedInSource: toBoolean(
        analysisInput.requireNonLinkedInSource,
        defaults.analysis.requireNonLinkedInSource
      ),
      minIdentityConfidence: clampInt(
        analysisInput.minIdentityConfidence,
        defaults.analysis.minIdentityConfidence,
        0,
        100
      ),
      highPriorityScoreThreshold: clampInt(
        analysisInput.highPriorityScoreThreshold,
        defaults.analysis.highPriorityScoreThreshold,
        40,
        100
      ),
    },
    chat: {
      searchResultLimit: clampInt(chatInput.searchResultLimit, defaults.chat.searchResultLimit, 5, 100),
      searchSnippetLength: clampInt(chatInput.searchSnippetLength, defaults.chat.searchSnippetLength, 80, 1200),
      enrichmentBatchSize: clampInt(chatInput.enrichmentBatchSize, defaults.chat.enrichmentBatchSize, 1, 10),
      enrichmentDelayMs: clampInt(chatInput.enrichmentDelayMs, defaults.chat.enrichmentDelayMs, 0, 5000),
      showGroundingSources: toBoolean(chatInput.showGroundingSources, defaults.chat.showGroundingSources),
    },
    outreach: {
      defaultChannel: pickEnum(outreachInput.defaultChannel, VALID_OUTREACH_CHANNELS, defaults.outreach.defaultChannel),
      defaultSender: pickEnum(outreachInput.defaultSender, VALID_OUTREACH_SENDERS, defaults.outreach.defaultSender),
      maxDraftsPerContact: clampInt(
        outreachInput.maxDraftsPerContact,
        defaults.outreach.maxDraftsPerContact,
        1,
        20
      ),
      linkedInCharacterLimit: clampInt(
        outreachInput.linkedInCharacterLimit,
        defaults.outreach.linkedInCharacterLimit,
        120,
        1200
      ),
      emailSubjectMaxLength: clampInt(
        outreachInput.emailSubjectMaxLength,
        defaults.outreach.emailSubjectMaxLength,
        30,
        140
      ),
      modelTemperature: clampFloat(outreachInput.modelTemperature, defaults.outreach.modelTemperature, 0, 1),
    },
    dashboard: {
      priorityQueueSize: clampInt(dashboardInput.priorityQueueSize, defaults.dashboard.priorityQueueSize, 3, 20),
      riskQueueSize: clampInt(dashboardInput.riskQueueSize, defaults.dashboard.riskQueueSize, 3, 20),
      highValueInvestorMin: clampInt(
        dashboardInput.highValueInvestorMin,
        defaults.dashboard.highValueInvestorMin,
        0,
        100
      ),
      highValueValuesMin: clampInt(
        dashboardInput.highValueValuesMin,
        defaults.dashboard.highValueValuesMin,
        0,
        100
      ),
      highValueConnectorMin: clampInt(
        dashboardInput.highValueConnectorMin,
        defaults.dashboard.highValueConnectorMin,
        0,
        100
      ),
      riskLowConfidenceThreshold: clampInt(
        dashboardInput.riskLowConfidenceThreshold,
        defaults.dashboard.riskLowConfidenceThreshold,
        0,
        100
      ),
    },
    automation: {
      autoSwitchToContactsOnIngest: toBoolean(
        automationInput.autoSwitchToContactsOnIngest,
        defaults.automation.autoSwitchToContactsOnIngest
      ),
      autoSyncToCloud: toBoolean(automationInput.autoSyncToCloud, defaults.automation.autoSyncToCloud),
      autoOpenDebugOnFailure: toBoolean(
        automationInput.autoOpenDebugOnFailure,
        defaults.automation.autoOpenDebugOnFailure
      ),
    },
    sync: {
      confirmBeforePull: toBoolean(syncInput.confirmBeforePull, defaults.sync.confirmBeforePull),
    },
  };
}

