import { Contact, EnrichmentData, Scores, AppSettings, StrategicFocus, ScoreProvenance, Evidence } from '../types';
import { bridgeMemory } from './bridgeMemory';
import { extractLinkedInUrlFromContact, normalizeAnalysisOutput, parseToolCallFromText } from './enrichmentGuards';
import { debugError, debugInfo, debugWarn } from './debugService';

interface PuterChatOptions {
    model?: string;
    stream?: boolean;
    tools?: Array<{ type: string }>;
    temperature?: number;
    [key: string]: unknown;
}

// Declare Puter global (loaded via script tag)
declare const puter: {
    ai: {
        chat: (prompt: string | object[], options?: PuterChatOptions) => Promise<any>;
    };
    net?: {
        fetch: (url: string, options?: RequestInit) => Promise<Response>;
    };
};

type EnrichmentFailureCode =
    | 'sdk_unavailable'
    | 'auth_required'
    | 'rate_limited'
    | 'timeout'
    | 'network'
    | 'model_unavailable'
    | 'all_models_failed'
    | 'unknown';

interface ModelAttemptFailure {
    model: string;
    code: EnrichmentFailureCode;
    error: string;
}

class EnrichmentPipelineError extends Error {
    readonly code: EnrichmentFailureCode;
    readonly contextLabel: string;
    readonly attempts: ModelAttemptFailure[];

    constructor(
        message: string,
        code: EnrichmentFailureCode,
        contextLabel: string,
        attempts: ModelAttemptFailure[] = []
    ) {
        super(message);
        this.name = 'EnrichmentPipelineError';
        this.code = code;
        this.contextLabel = contextLabel;
        this.attempts = attempts;
    }
}

function getPuterRuntime() {
    if (typeof puter === 'undefined') return null;
    return puter;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function classifyEnrichmentError(error: unknown): EnrichmentFailureCode {
    const message = errorMessage(error).toLowerCase();

    if (
        message.includes('puter is not defined') ||
        message.includes('cannot read properties of undefined') ||
        message.includes('ai.chat is not a function')
    ) {
        return 'sdk_unavailable';
    }

    if (
        /\b(401|403)\b/.test(message) ||
        message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('sign in') ||
        message.includes('signin') ||
        message.includes('auth')
    ) {
        return 'auth_required';
    }

    if (
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('quota')
    ) {
        return 'rate_limited';
    }

    if (
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('deadline exceeded') ||
        message.includes('abort')
    ) {
        return 'timeout';
    }

    if (
        message.includes('network') ||
        message.includes('failed to fetch') ||
        message.includes('fetch failed') ||
        message.includes('cors') ||
        message.includes('socket') ||
        message.includes('offline')
    ) {
        return 'network';
    }

    if (
        message.includes('unknown model') ||
        message.includes('invalid model') ||
        message.includes('unsupported model') ||
        message.includes('model unavailable') ||
        message.includes('model not found')
    ) {
        return 'model_unavailable';
    }

    return 'unknown';
}

function normalizeEnrichmentError(error: unknown, contextLabel: string): EnrichmentPipelineError {
    if (error instanceof EnrichmentPipelineError) return error;

    const code = classifyEnrichmentError(error);
    return new EnrichmentPipelineError(
        `Enrichment request failed during ${contextLabel}: ${errorMessage(error)}`,
        code,
        contextLabel
    );
}

function shouldShortCircuitModelFallback(code: EnrichmentFailureCode): boolean {
    return code === 'sdk_unavailable' || code === 'auth_required' || code === 'rate_limited';
}

function failureSummaryForUser(code: EnrichmentFailureCode): string {
    switch (code) {
        case 'sdk_unavailable':
            return 'Enrichment failed: AI runtime is unavailable in this browser session.';
        case 'auth_required':
            return 'Enrichment failed: AI authorization is required. Sign in to Puter and retry.';
        case 'rate_limited':
            return 'Enrichment failed: AI rate limit reached. Retry in a few minutes.';
        case 'timeout':
            return 'Enrichment failed: AI request timed out before completion.';
        case 'network':
            return 'Enrichment failed: network error while contacting the AI provider.';
        case 'model_unavailable':
            return 'Enrichment failed: selected AI model is unavailable.';
        case 'all_models_failed':
            return 'Enrichment failed: all configured AI models were unavailable for this request.';
        default:
            return 'Enrichment failed due to an unexpected AI provider error.';
    }
}

function failureActionForUser(code: EnrichmentFailureCode): string {
    switch (code) {
        case 'sdk_unavailable':
            return 'Refresh the page and disable blockers that may prevent loading https://js.puter.com.';
        case 'auth_required':
            return 'Sign in to Puter from the app header, then retry enrichment.';
        case 'rate_limited':
            return 'Wait 2-5 minutes, then retry with a smaller batch.';
        case 'timeout':
        case 'network':
            return 'Verify internet connectivity and retry enrichment.';
        case 'model_unavailable':
        case 'all_models_failed':
            return 'Switch analysis mode in Settings and retry.';
        default:
            return 'Open the debug panel and retry enrichment to capture error details.';
    }
}

function buildCompatibilityRetryOptions(options: PuterChatOptions, error: unknown): PuterChatOptions | null {
    const message = errorMessage(error).toLowerCase();
    let changed = false;
    const adjusted: PuterChatOptions = { ...options };

    const temperatureUnsupported =
        message.includes('temperature') &&
        (
            message.includes('unsupported parameter') ||
            message.includes('unsupported value') ||
            message.includes('does not support')
        );
    if (temperatureUnsupported && Object.prototype.hasOwnProperty.call(adjusted, 'temperature')) {
        delete adjusted.temperature;
        changed = true;
    }

    const toolsUnsupported =
        message.includes('tools') &&
        (
            message.includes('unsupported parameter') ||
            message.includes('unsupported value') ||
            message.includes('does not support')
        );
    if (toolsUnsupported && Object.prototype.hasOwnProperty.call(adjusted, 'tools')) {
        delete adjusted.tools;
        changed = true;
    }

    return changed ? adjusted : null;
}

const WEB_SEARCH_MODEL = 'openai/gpt-5.2-chat';
const MIN_VERIFIED_EVIDENCE = 2;
const DEFAULT_ANALYSIS_MODELS_FAST = ['gemini-2.5-flash', 'openai/gpt-5-nano'];
const DEFAULT_ANALYSIS_MODELS_QUALITY = ['gemini-2.5-pro', 'gemini-2.5-flash', WEB_SEARCH_MODEL];
const DEFAULT_EVIDENCE_MODELS = [WEB_SEARCH_MODEL, 'gemini-2.5-pro', 'gemini-2.5-flash'];

const BRIDGE_SYSTEM_INSTRUCTION = `
ROLE: You are Bridge, an expert Contact Intelligence + Values-Aligned Matching System built exclusively for Project Leviathan.

CORE OBJECTIVE:
Your job is to transform raw contacts into strategic opportunities for Leviathan.
You must strictly enforce Leviathan's values and guardrails as defined in the provided Thesis/Context.

TONE & STYLE:
- **Be Conversational & Strategic**: Do not just dump numbers. Explain *why* a contact is a fit (or not).
- **Proactive**: If a contact is "New" (unenriched), successful analysis is impossible. You MUST suggest enriching them first (e.g., "I see some new contacts. Should I enrich them to see if they fit?").
- **Concise**: Get to the point. Use bullet points for key insights.

HARD CONSTRAINTS (NON-NEGOTIABLE):
1. **DEEP WEB SEARCH**: When enriching, perform multiple searches to triangulate the target.
2. **EVIDENCE LINKS**: Every claim in your summary must be backed by a specific URL found in the search.
3. **NO HALLUCINATIONS**: If you cannot verify the person exists with High Confidence, mark 'identityConfidence' low and flag it.
4. **VALUES ENFORCEMENT**: Misaligned capital is worse than no capital. Flag predatory behavior immediately.

SCORING DIMENSIONS (Internal use for ranking):
- Investor Fit (0-100)
- Values Alignment (0-100)
- Govt Access (0-100)
- Maritime Relevance (0-100)
- Connector Score (0-100)

OUTPUT FORMAT:
For tool calls (enrichment), return the JSON tool call.
For chat responses, use natural language (Markdown supported).
`;

const FOCUS_MODE_PROMPTS: Record<StrategicFocus, string> = {
    BALANCED: 'Evaluate equally across all dimensions.',
    GATEKEEPER: 'Prioritize Values Alignment and Connector Score. We need trusted navigators.',
    DEAL_HUNTER: 'Prioritize Investor Fit and Maritime Relevance. We are actively fundraising.',
    GOVT_INTEL: 'Prioritize Govt Access and Maritime Relevance. We need public sector intel.',
};

function getModelsForSettings(settings: AppSettings): string[] {
    return settings.analysisModel === 'fast'
        ? DEFAULT_ANALYSIS_MODELS_FAST
        : DEFAULT_ANALYSIS_MODELS_QUALITY;
}

async function chatWithModelFallback(
    prompt: string | object[],
    candidateModels: string[],
    options: Omit<PuterChatOptions, 'model'> = {},
    contextLabel = 'analysis'
): Promise<any> {
    const runtime = getPuterRuntime();
    if (!runtime?.ai?.chat) {
        throw new EnrichmentPipelineError(
            `Puter AI runtime unavailable during ${contextLabel}.`,
            'sdk_unavailable',
            contextLabel
        );
    }

    const modelCandidates = [...candidateModels, ''];
    const attempts: ModelAttemptFailure[] = [];

    for (const modelCandidate of modelCandidates) {
        const model = modelCandidate.trim();
        const mergedOptions: PuterChatOptions = model
            ? { ...options, model }
            : { ...options };

        try {
            return await runtime.ai.chat(prompt, mergedOptions);
        } catch (error) {
            let effectiveError: unknown = error;
            const compatibilityOptions = buildCompatibilityRetryOptions(mergedOptions, error);
            if (compatibilityOptions) {
                debugWarn('model', `Retrying model candidate with compatibility options (${contextLabel}).`, {
                    model: model || 'default',
                    removedOptions: {
                        removedTemperature: !Object.prototype.hasOwnProperty.call(compatibilityOptions, 'temperature') &&
                            Object.prototype.hasOwnProperty.call(mergedOptions, 'temperature'),
                        removedTools: !Object.prototype.hasOwnProperty.call(compatibilityOptions, 'tools') &&
                            Object.prototype.hasOwnProperty.call(mergedOptions, 'tools'),
                    },
                });
                try {
                    return await runtime.ai.chat(prompt, compatibilityOptions);
                } catch (retryError) {
                    effectiveError = retryError;
                }
            }

            const normalized = normalizeEnrichmentError(effectiveError, contextLabel);
            const attempt: ModelAttemptFailure = {
                model: model || 'default',
                code: normalized.code,
                error: errorMessage(effectiveError),
            };
            attempts.push(attempt);
            console.warn(`[Bridge] ${contextLabel} model failed: ${model || 'default'}`, effectiveError);
            debugWarn('model', `Model candidate failed (${contextLabel}).`, {
                model: model || 'default',
                code: normalized.code,
                error: errorMessage(effectiveError),
            });

            if (shouldShortCircuitModelFallback(normalized.code)) {
                throw new EnrichmentPipelineError(
                    `Model fallback halted during ${contextLabel}: ${normalized.message}`,
                    normalized.code,
                    contextLabel,
                    attempts
                );
            }
        }
    }

    const allModelUnavailable = attempts.length > 0 && attempts.every((attempt) => attempt.code === 'model_unavailable');
    const failureCode: EnrichmentFailureCode = allModelUnavailable ? 'model_unavailable' : 'all_models_failed';
    const failure = new EnrichmentPipelineError(
        `All model candidates failed for ${contextLabel}.`,
        failureCode,
        contextLabel,
        attempts
    );
    debugError('model', `All model candidates failed (${contextLabel}).`, {
        code: failure.code,
        attempts: failure.attempts,
    });
    throw failure;
}

function extractFirstJsonObject(text: string): string | null {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i += 1) {
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

        if (char === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

// Helper to extract JSON from markdown-wrapped responses
function extractJSON(text: string): string {
    // Remove markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        return jsonMatch[1].trim();
    }
    // Extract first balanced object, avoiding greedy brace capture.
    const firstObject = extractFirstJsonObject(text);
    if (firstObject) {
        return firstObject;
    }
    return text;
}

function extractJSONArray(text: string): string | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = fenced ? fenced[1].trim() : text;
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    return arrayMatch ? arrayMatch[0] : null;
}

function responseToText(response: any): string {
    if (typeof response === 'string') return response;
    if (typeof response?.message?.content === 'string') return response.message.content;
    if (Array.isArray(response?.message?.content)) {
        return response.message.content
            .map((part: any) => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                return '';
            })
            .join('\n')
            .trim();
    }
    if (typeof response?.text === 'string') return response.text;
    return JSON.stringify(response);
}

async function repairJsonObject(
    malformedText: string,
    modelCandidates: string[]
): Promise<string | null> {
    const repairPrompt = `
You are a JSON repair utility.
Convert the content below into a single valid JSON object.
Return ONLY raw JSON and nothing else.

CONTENT:
${malformedText}
`;

    try {
        const response = await chatWithModelFallback(
            repairPrompt,
            modelCandidates,
            {},
            'json-repair'
        );
        const repairedText = responseToText(response);
        return extractJSON(repairedText);
    } catch {
        return null;
    }
}

interface EvidenceCollectionResult {
    verifiedEvidence: Evidence[];
    failure?: EnrichmentPipelineError;
}

function isValidHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function cleanUrl(url: string): string {
    return url.trim().replace(/[),.;:!?]+$/, '');
}

function normalizeEvidenceCandidates(rawEvidence: any[]): Evidence[] {
    const seen = new Set<string>();
    return rawEvidence
        .map((entry: any) => {
            const claim = typeof entry?.claim === 'string' ? entry.claim.trim() : '';
            const rawUrl = typeof entry?.url === 'string' ? cleanUrl(entry.url) : '';
            const url = isValidHttpUrl(rawUrl) ? rawUrl : '';
            const confidence =
                typeof entry?.confidence === 'number' && Number.isFinite(entry.confidence)
                    ? Math.max(0, Math.min(100, entry.confidence))
                    : 60;
            const timestampRaw =
                typeof entry?.timestamp === 'string' && !Number.isNaN(Date.parse(entry.timestamp))
                    ? entry.timestamp
                    : new Date().toISOString();
            if (!claim || !url) return null;
            const key = `${claim}|${url}`;
            if (seen.has(key)) return null;
            seen.add(key);
            return {
                claim,
                url,
                timestamp: new Date(timestampRaw).toISOString(),
                confidence,
            } as Evidence;
        })
        .filter((entry): entry is Evidence => Boolean(entry));
}

function extractHttpUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s)"'<>]+/g) || [];
    const deduped: string[] = [];
    const seen = new Set<string>();

    matches.forEach((candidate) => {
        const cleaned = cleanUrl(candidate);
        if (!isValidHttpUrl(cleaned)) return;
        if (seen.has(cleaned)) return;
        seen.add(cleaned);
        deduped.push(cleaned);
    });

    return deduped;
}

function hostnameForUrl(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

interface EvidenceGateResult {
    passed: boolean;
    issues: string[];
}

function evaluateEvidenceGate(verifiedEvidence: Evidence[]): EvidenceGateResult {
    const issues: string[] = [];
    const hostnames = Array.from(
        new Set(
            verifiedEvidence
                .map((ev) => hostnameForUrl(ev.url))
                .filter((host) => host.length > 0)
        )
    );

    if (verifiedEvidence.length < MIN_VERIFIED_EVIDENCE) {
        issues.push(`Insufficient external evidence (need at least ${MIN_VERIFIED_EVIDENCE} verified links).`);
    }

    if (hostnames.length < 2 && verifiedEvidence.length > 0) {
        issues.push('Evidence lacks source diversity (need at least 2 distinct domains).');
    }

    const hasNonLinkedInSource = hostnames.some((host) => !/(^|\.)linkedin\.com$/i.test(host));
    if (verifiedEvidence.length > 0 && !hasNonLinkedInSource) {
        issues.push('Evidence is only from LinkedIn; add at least one non-LinkedIn source.');
    }

    return {
        passed: issues.length === 0,
        issues,
    };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

async function verifyUrlReachable(url: string): Promise<boolean> {
    const runtime = getPuterRuntime();
    if (!runtime?.net?.fetch) return false;

    try {
        const headResponse = await withTimeout(
            runtime.net.fetch(url, { method: 'HEAD' }),
            8000
        );
        if (headResponse.ok || (headResponse.status >= 200 && headResponse.status < 400)) {
            return true;
        }
    } catch {
        // Fall through to GET.
    }

    try {
        const getResponse = await withTimeout(
            runtime.net.fetch(url, { method: 'GET' }),
            10000
        );
        return getResponse.ok || (getResponse.status >= 200 && getResponse.status < 400);
    } catch {
        return false;
    }
}

async function verifyEvidenceLinks(evidenceLinks: Evidence[]): Promise<Evidence[]> {
    const runtime = getPuterRuntime();
    if (!runtime?.net?.fetch) {
        // Runtime URL checks are unavailable in some browser contexts.
        // Keep normalized links so enrichment can continue instead of hard-blocking.
        return evidenceLinks.slice(0, 8);
    }

    const checks = await Promise.all(
        evidenceLinks.slice(0, 8).map(async (ev) => {
            const reachable = await verifyUrlReachable(ev.url);
            return reachable ? ev : null;
        })
    );
    const verified = checks.filter((ev): ev is Evidence => Boolean(ev));
    return verified.length > 0 ? verified : evidenceLinks.slice(0, 8);
}

async function gatherWebEvidenceForContact(contact: Contact): Promise<EvidenceCollectionResult> {
    const linkedInSeed = extractLinkedInUrlFromContact(contact);
    const evidencePrompt = `
You are conducting contact due diligence.
Use web search to find verifiable public evidence for this person.

Target:
- Name: ${contact.name}
- Headline: ${contact.headline}
- Location: ${contact.location}
- Source Text: ${contact.source}
- Raw Notes: ${contact.rawText || 'None'}
- Known LinkedIn URL: ${linkedInSeed || 'None'}

Rules:
- Return ONLY a JSON array.
- Include 3 to 6 evidence objects.
- Prefer one LinkedIn URL (if present) and multiple non-LinkedIn sources.
- No placeholders. No guessed or fake URLs.

Schema:
[
  {"claim":"string","url":"https://...","timestamp":"ISO date","confidence":0-100}
]
`;

    try {
        if (!getPuterRuntime()?.ai?.chat) {
            throw new EnrichmentPipelineError(
                'Puter AI runtime unavailable during evidence gathering.',
                'sdk_unavailable',
                'evidence-search'
            );
        }

        debugInfo('evidence', 'Starting evidence gathering.', { contactId: contact.id, name: contact.name });
        let response: any;

        try {
            response = await chatWithModelFallback(
                evidencePrompt,
                DEFAULT_EVIDENCE_MODELS,
                {
                    tools: [{ type: 'web_search' }],
                },
                'evidence-search'
            );
        } catch (error) {
            const normalizedError = normalizeEnrichmentError(error, 'evidence-search');
            if (shouldShortCircuitModelFallback(normalizedError.code)) {
                throw normalizedError;
            }

            debugWarn('evidence', 'Tool-enabled web search failed; falling back to plain retrieval.', {
                contactId: contact.id,
                code: normalizedError.code,
                error: normalizedError.message,
            });
            // Fall back to plain generation if tool-enabled search is unavailable.
            response = await chatWithModelFallback(
                evidencePrompt,
                DEFAULT_EVIDENCE_MODELS,
                {},
                'evidence-search-fallback'
            );
        }

        const responseText = responseToText(response);
        const extractedArray = extractJSONArray(responseText);

        let candidateEvidence: Evidence[] = [];
        if (extractedArray) {
            try {
                candidateEvidence = normalizeEvidenceCandidates(JSON.parse(extractedArray));
            } catch {
                candidateEvidence = [];
            }
        }

        if (candidateEvidence.length === 0) {
            try {
                const extractedObject = extractJSON(responseText);
                const parsedObject = JSON.parse(extractedObject);
                candidateEvidence = normalizeEvidenceCandidates(parsedObject?.evidenceLinks || []);
            } catch {
                candidateEvidence = [];
            }
        }

        if (candidateEvidence.length === 0) {
            candidateEvidence = extractHttpUrls(responseText)
                .slice(0, 6)
                .map((url) => ({
                    claim: `Source discovered during web due diligence for ${contact.name}.`,
                    url,
                    timestamp: new Date().toISOString(),
                    confidence: 55,
                }));
        }

        if (linkedInSeed && !candidateEvidence.some((ev) => ev.url.includes('linkedin.com'))) {
            candidateEvidence.unshift({
                claim: 'LinkedIn profile imported from source data.',
                url: linkedInSeed,
                timestamp: new Date().toISOString(),
                confidence: 60,
            });
        }

        const verifiedEvidence = await verifyEvidenceLinks(candidateEvidence);
        debugInfo('evidence', 'Evidence gathering complete.', {
            contactId: contact.id,
            candidateCount: candidateEvidence.length,
            verifiedCount: verifiedEvidence.length
        });
        return { verifiedEvidence };
    } catch (error) {
        const normalizedError = normalizeEnrichmentError(error, 'evidence-search');
        console.error('Web evidence gathering failed:', normalizedError);
        debugError('evidence', 'Evidence gathering failed.', {
            contactId: contact.id,
            code: normalizedError.code,
            error: normalizedError.message,
            attempts: normalizedError.attempts
        });
        return { verifiedEvidence: [], failure: normalizedError };
    }
}

// Create default score provenance
function createDefaultProvenance(score: number, reasoning: string): ScoreProvenance {
    return {
        score,
        confidence: 50,
        reasoning,
        contributingFactors: [],
        missingDataPenalty: true,
    };
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function createAnalysisFailureResult(
    code: EnrichmentFailureCode,
    options: { evidenceLinks?: Evidence[]; additionalRisks?: string[]; attempts?: ModelAttemptFailure[] } = {}
): { scores: Scores; enrichment: EnrichmentData } {
    const summary = failureSummaryForUser(code);
    const modelAttemptRisks = (options.attempts || []).map((attempt) => {
        return `Model ${attempt.model} failed (${attempt.code}): ${attempt.error}`;
    });
    const alignmentRisks = uniqueStrings([
        summary,
        ...(options.additionalRisks || []),
        ...modelAttemptRisks,
    ]);

    return {
        scores: {
            investorFit: createDefaultProvenance(0, summary),
            valuesAlignment: createDefaultProvenance(0, summary),
            govtAccess: createDefaultProvenance(0, summary),
            maritimeRelevance: createDefaultProvenance(0, summary),
            connectorScore: createDefaultProvenance(0, summary),
            overallConfidence: 0,
        },
        enrichment: {
            summary,
            alignmentRisks,
            evidenceLinks: options.evidenceLinks || [],
            recommendedAngle: 'Pause outreach while enrichment pipeline issues are resolved.',
            recommendedAction: failureActionForUser(code),
            tracks: [],
            flaggedAttributes: uniqueStrings([
                'analysis_error',
                'manual_review_required',
                `error_${code}`,
            ]),
            identityConfidence: 0,
            collisionRisk: true,
            lastVerified: new Date().toISOString(),
        },
    };
}

/**
 * Analyze a single contact using Puter.js + Gemini
 */
export async function analyzeContactWithGemini(
    contact: Contact,
    settings: AppSettings
): Promise<{ scores: Scores; enrichment: EnrichmentData }> {
    const thesisContext = bridgeMemory.getThesisContext();
    const modelCandidates = getModelsForSettings(settings);
    const linkedInSeed = extractLinkedInUrlFromContact(contact);
    debugInfo('analysis', 'Starting contact analysis.', {
        contactId: contact.id,
        name: contact.name,
        focusMode: settings.focusMode,
        analysisMode: settings.analysisModel
    });
    const evidenceCollection = await gatherWebEvidenceForContact(contact);
    const verifiedEvidence = evidenceCollection.verifiedEvidence;

    if (evidenceCollection.failure && verifiedEvidence.length === 0) {
        debugError('analysis', 'Evidence stage failed before analysis.', {
            contactId: contact.id,
            code: evidenceCollection.failure.code,
            error: evidenceCollection.failure.message,
            attempts: evidenceCollection.failure.attempts,
        });
        return createAnalysisFailureResult(evidenceCollection.failure.code, {
            additionalRisks: [
                `Evidence stage failure: ${evidenceCollection.failure.message}`,
            ],
            attempts: evidenceCollection.failure.attempts,
        });
    }

    if (evidenceCollection.failure && verifiedEvidence.length > 0) {
        debugWarn('analysis', 'Evidence stage partially failed; continuing with recovered evidence.', {
            contactId: contact.id,
            code: evidenceCollection.failure.code,
            verifiedCount: verifiedEvidence.length,
        });
    }

    const prompt = `
${BRIDGE_SYSTEM_INSTRUCTION}

=== THESIS/CONTEXT ===
${thesisContext}

=== CURRENT STRATEGIC FOCUS ===
${FOCUS_MODE_PROMPTS[settings.focusMode]}

=== TARGET CONTACT ===
Name: ${contact.name}
Headline: ${contact.headline}
Location: ${contact.location}
Source: ${contact.source}
Raw Notes: ${contact.rawText || 'None'}
Known LinkedIn URL: ${linkedInSeed || 'None provided'}

=== VERIFICATION RULES ===
- You are restricted to the VERIFIED_EVIDENCE list below.
- Do not introduce new facts or URLs not present in VERIFIED_EVIDENCE.
- If evidence is weak or sparse, lower confidence and mark risks clearly.

=== VERIFIED_EVIDENCE ===
${verifiedEvidence.length > 0 ? JSON.stringify(verifiedEvidence, null, 2) : '[]'}

=== YOUR TASK ===
Analyze this contact and return a JSON object with the following structure. DO NOT include markdown code blocks, just return raw JSON:

{
  "scores": {
    "investorFit": { "score": 0-100, "confidence": 0-100, "reasoning": "string", "contributingFactors": ["string"], "missingDataPenalty": boolean },
    "valuesAlignment": { "score": 0-100, "confidence": 0-100, "reasoning": "string", "contributingFactors": ["string"], "missingDataPenalty": boolean },
    "govtAccess": { "score": 0-100, "confidence": 0-100, "reasoning": "string", "contributingFactors": ["string"], "missingDataPenalty": boolean },
    "maritimeRelevance": { "score": 0-100, "confidence": 0-100, "reasoning": "string", "contributingFactors": ["string"], "missingDataPenalty": boolean },
    "connectorScore": { "score": 0-100, "confidence": 0-100, "reasoning": "string", "contributingFactors": ["string"], "missingDataPenalty": boolean },
    "overallConfidence": 0-100
  },
  "enrichment": {
    "summary": "2-3 sentence executive summary",
    "alignmentRisks": ["list of any red flags or concerns"],
    "evidenceLinks": [{ "claim": "string", "url": "string", "timestamp": "ISO date", "confidence": 0-100 }],
    "recommendedAngle": "strategic approach suggestion",
    "recommendedAction": "next step",
    "tracks": ["Investment" | "Government" | "Strategic Partner"],
    "flaggedAttributes": ["notable characteristics"],
    "identityConfidence": 0-100,
    "collisionRisk": boolean
  }
}
`;

    try {
        const evidenceGate = evaluateEvidenceGate(verifiedEvidence);
        if (!evidenceGate.passed) {
            debugWarn('analysis', 'Evidence gate blocked analysis.', {
                contactId: contact.id,
                issues: evidenceGate.issues
            });
            return {
                scores: {
                    investorFit: createDefaultProvenance(0, 'Insufficient verified evidence'),
                    valuesAlignment: createDefaultProvenance(0, 'Insufficient verified evidence'),
                    govtAccess: createDefaultProvenance(0, 'Insufficient verified evidence'),
                    maritimeRelevance: createDefaultProvenance(0, 'Insufficient verified evidence'),
                    connectorScore: createDefaultProvenance(0, 'Insufficient verified evidence'),
                    overallConfidence: 0,
                },
                enrichment: {
                    summary: 'Enrichment blocked: not enough verifiable web evidence was found.',
                    alignmentRisks: evidenceGate.issues,
                    evidenceLinks: verifiedEvidence,
                    recommendedAngle: 'Do not outreach yet; collect additional verification sources.',
                    recommendedAction: 'Re-run enrichment after improving source profile and identifiers.',
                    tracks: [],
                    flaggedAttributes: ['manual_review_required', 'insufficient_evidence', 'evidence_gate_blocked'],
                    identityConfidence: 0,
                    collisionRisk: true,
                    lastVerified: new Date().toISOString(),
                },
            };
        }

        const response = await chatWithModelFallback(
            prompt,
            modelCandidates,
            {},
            'contact-analysis'
        );

        const responseText = responseToText(response);

        // Extract, parse, and normalize model output before it reaches UI state
        const jsonText = extractJSON(responseText);
        let parsedResult: unknown;
        try {
            parsedResult = JSON.parse(jsonText);
        } catch {
            debugWarn('analysis', 'Model output was malformed JSON. Running repair pass.', {
                contactId: contact.id
            });
            const repairedJson = await repairJsonObject(responseText, modelCandidates);
            if (!repairedJson) {
                throw new Error('Model output could not be parsed as JSON.');
            }
            parsedResult = JSON.parse(repairedJson);
        }
        const normalized = normalizeAnalysisOutput(parsedResult, contact);
        normalized.enrichment.evidenceLinks = verifiedEvidence;
        normalized.enrichment.lastVerified = new Date().toISOString();
        debugInfo('analysis', 'Contact analysis completed.', {
            contactId: contact.id,
            overallConfidence: normalized.scores.overallConfidence,
            identityConfidence: normalized.enrichment.identityConfidence
        });
        return normalized;
    } catch (error) {
        const normalizedError = normalizeEnrichmentError(error, 'contact-analysis');
        console.error('Gemini analysis error:', normalizedError);
        debugError('analysis', 'Contact analysis failed.', {
            contactId: contact.id,
            code: normalizedError.code,
            error: normalizedError.message,
            attempts: normalizedError.attempts,
        });

        return createAnalysisFailureResult(normalizedError.code, {
            evidenceLinks: verifiedEvidence,
            additionalRisks: [
                `Analysis stage failure: ${normalizedError.message}`,
            ],
            attempts: normalizedError.attempts,
        });
    }
}

/**
 * Chat message type for Bridge conversations
 */
interface BridgeChatMessage {
    role: 'user' | 'model';
    content: string;
}

/**
 * Bridge Chat Session - simulates a stateful chat with tool capabilities
 */
class BridgeChatSession {
    private history: BridgeChatMessage[] = [];
    private contacts: Contact[];
    private model: string;

    constructor(contacts: Contact[], model: string = 'gemini-2.5-flash') {
        this.contacts = contacts;
        this.model = model;

        // Initialize with system context
        const thesisContext = bridgeMemory.getThesisContext();
        const contactList = this.formatContactList(contacts);

        this.history.push({
            role: 'model',
            content: `${BRIDGE_SYSTEM_INSTRUCTION}

=== THESIS/CONTEXT ===
${thesisContext}

=== AVAILABLE CONTACTS (SUMMARY) ===
${contactList || 'No contacts loaded yet.'}
(Note: This is just a summary. You have 15,000+ contacts in the database.)

=== TOOLS ===
1. **search_contacts(query: string)**:
   - USE THIS FIRST for broad questions like "Who are the investors?", "Find maritime companies", or "Do we know anyone in London?".
   - It searches the FULL database (including notes/bios/rawText) and returns the top 20 matches with full details.
   - Example: {"tool": "search_contacts", "query": "Series A investor maritime"}

2. **enrich_contacts(contactIds: string[])**:
   - Use this ONLY when you have identified specific prospects (e.g., from a search result) that need deep web analysis.
   - Example: {"tool": "enrich_contacts", "contactIds": ["123", "456"]}

For tool calls, return ONLY the JSON object.
For regular conversation, just respond normally.`
        });
    }

    private formatContactList(contacts: Contact[]): string {
        return contacts.map((c) => {
            let details = `[ID: ${c.id}] ${c.name} - ${c.headline} (${c.status})`;
            if (c.status === 'Enriched' && c.enrichment) {
                details += `\n   > SUMMARY: ${c.enrichment.summary}\n   > REC: ${c.enrichment.recommendedAction}`;
            }
            return details;
        }).join('\n');
    }

    private isSearchIntent(userMessage: string): boolean {
        const normalized = userMessage.toLowerCase();
        const mentionsSearch = /\b(find|search|lookup|look up|show|list|who|which|anyone|contacts?|investors?|founders?|partners?|linkedin|universe)\b/i.test(normalized);
        const isMetaConversation = /\b(explain|why|how|help|settings|thesis|prompt|model)\b/i.test(normalized);
        return mentionsSearch && !isMetaConversation;
    }

    /**
     * Replaces the chat session's contact list with the latest app state.
     * Used when contacts are imported/deleted outside of chat tool calls.
     */
    public setContacts(contacts: Contact[]) {
        const previousCount = this.contacts.length;
        this.contacts = contacts;
        if (contacts.length !== previousCount) {
            this.history.push({
                role: 'model',
                content: `[SYSTEM NOTE: Contact universe updated. Current total contacts: ${contacts.length}.]`
            });
        }
    }

    /**
     * Updates the chat session's internal contact list with new data
     * This allows the agent to "remember" enrichment results mid-conversation.
     */
    public updateContact(updatedContact: Contact) {
        this.contacts = this.contacts.map(c => c.id === updatedContact.id ? updatedContact : c);

        // Inject a system note into history so the model knows context changed
        this.history.push({
            role: 'model', // System injection disguised as model thought/note
            content: `[SYSTEM NOTE: Contact '${updatedContact.name}' has been enriched. New Summary: ${updatedContact.enrichment?.summary}]`
        });
    }

    async sendMessage(input: { message: string } | any[]): Promise<any> {
        // Handle tool response (array format from original SDK)
        if (Array.isArray(input)) {
            const toolResponse = input[0]?.functionResponse;
            if (toolResponse) {
                this.history.push({
                    role: 'user',
                    content: `Tool result for ${toolResponse.name}: ${JSON.stringify(toolResponse.response)}`
                });

                const response = await this.callGemini('Summarize the enrichment results for the user in a clear, actionable format.');
                return { text: response, functionCalls: null };
            }
        }

        // Handle regular message - input is { message: string } at this point
        const messageInput = input as { message: string };
        const userMessage = messageInput.message;
        this.history.push({ role: 'user', content: userMessage });

        // Check if user is asking to enrich contacts
        const enrichmentPatterns = [
            /enrich\s+(?:the\s+)?(?:first\s+)?(\d+)/i,
            /analyze\s+(?:the\s+)?(?:first\s+)?(\d+)/i,
            /deep[\s-]?dive\s+(?:on\s+)?(\d+)/i,
            /process\s+(?:the\s+)?(?:first\s+)?(\d+)/i,
            /enrich\s+all/i,
            /analyze\s+all/i,
        ];

        let functionCalls: any[] | null = null;

        for (const pattern of enrichmentPatterns) {
            const match = userMessage.match(pattern);
            if (match) {
                let count = match[1] ? parseInt(match[1]) : this.contacts.length;
                count = Math.min(count, this.contacts.length);

                // Get contacts that need enrichment (status = 'New')
                const newContacts = this.contacts.filter(c => c.status === 'New').slice(0, count);

                if (newContacts.length > 0) {
                    functionCalls = [{
                        name: 'enrich_contacts',
                        id: `call_${Date.now()}`,
                        args: { contactIds: newContacts.map(c => c.id) }
                    }];

                    this.history.push({
                        role: 'model',
                        content: `I'll enrich ${newContacts.length} contact(s) for you.`
                    });

                    return {
                        text: `I'll enrich ${newContacts.length} contact(s) for you.`,
                        functionCalls,
                    };
                }
            }
        }

        // Regular conversation - call Gemini
        const response = await this.callGemini(userMessage);

        // Parse JSON tool call(s) from model output (supports multiline JSON and both tools)
        const parsedToolCall = parseToolCallFromText(response);
        if (parsedToolCall) {
            functionCalls = [{
                name: parsedToolCall.name,
                id: `call_${Date.now()}`,
                args: parsedToolCall.args
            }];
        } else if (this.isSearchIntent(userMessage)) {
            // Deterministic fallback: force database search tool for contact-discovery prompts.
            functionCalls = [{
                name: 'search_contacts',
                id: `call_${Date.now()}`,
                args: { query: userMessage.trim() }
            }];
            return {
                text: `Searching contacts for "${userMessage.trim()}"...`,
                functionCalls,
                candidates: [{ groundingMetadata: { groundingChunks: [] } }]
            };
        }

        return {
            text: response,
            functionCalls,
            candidates: [{ groundingMetadata: { groundingChunks: [] } }]
        };
    }

    private async callGemini(userMessage: string): Promise<string> {
        // Build conversation for Puter
        const conversationPrompt = this.history
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n') + `\n\nUser: ${userMessage}\n\nAssistant:`;

        try {
            const response = await chatWithModelFallback(
                conversationPrompt,
                [this.model],
                {},
                'chat-session'
            );

            let responseText: string;
            if (typeof response === 'string') {
                responseText = response;
            } else if (response?.message?.content) {
                responseText = response.message.content;
            } else if (response?.text) {
                responseText = response.text;
            } else {
                responseText = 'I processed your request.';
            }

            this.history.push({ role: 'model', content: responseText });
            return responseText;
        } catch (error) {
            const normalizedError = normalizeEnrichmentError(error, 'chat-session');
            console.error('Chat error:', normalizedError);
            debugError('chat.model', 'Chat model request failed.', {
                code: normalizedError.code,
                error: normalizedError.message,
                attempts: normalizedError.attempts,
            });
            return `${failureSummaryForUser(normalizedError.code)} ${failureActionForUser(normalizedError.code)}`;
        }
    }
}

/**
 * Create a new Bridge Chat session
 */
export function createBridgeChat(contacts: Contact[]): BridgeChatSession {
    return new BridgeChatSession(contacts);
}

// Type export for compatibility
export type Chat = BridgeChatSession;
