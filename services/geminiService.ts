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
    const modelCandidates = [...candidateModels, ''];
    let lastError: unknown = null;

    for (const modelCandidate of modelCandidates) {
        const model = modelCandidate.trim();
        const mergedOptions: PuterChatOptions = model
            ? { ...options, model }
            : { ...options };

        try {
            return await puter.ai.chat(prompt, mergedOptions);
        } catch (error) {
            lastError = error;
            console.warn(`[Bridge] ${contextLabel} model failed: ${model || 'default'}`, error);
            debugWarn('model', `Model candidate failed (${contextLabel}).`, {
                model: model || 'default',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    debugError('model', `All model candidates failed (${contextLabel}).`, lastError);
    throw lastError instanceof Error
        ? lastError
        : new Error(`All model candidates failed for ${contextLabel}.`);
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
            { temperature: 0 },
            'json-repair'
        );
        const repairedText = responseToText(response);
        return extractJSON(repairedText);
    } catch {
        return null;
    }
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
    if (!puter?.net?.fetch) return false;

    try {
        const headResponse = await withTimeout(
            puter.net.fetch(url, { method: 'HEAD' }),
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
            puter.net.fetch(url, { method: 'GET' }),
            10000
        );
        return getResponse.ok || (getResponse.status >= 200 && getResponse.status < 400);
    } catch {
        return false;
    }
}

async function verifyEvidenceLinks(evidenceLinks: Evidence[]): Promise<Evidence[]> {
    if (!puter?.net?.fetch) {
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

async function gatherWebEvidenceForContact(contact: Contact): Promise<Evidence[]> {
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
        debugInfo('evidence', 'Starting evidence gathering.', { contactId: contact.id, name: contact.name });
        let response: any;

        try {
            response = await chatWithModelFallback(
                evidencePrompt,
                DEFAULT_EVIDENCE_MODELS,
                {
                    tools: [{ type: 'web_search' }],
                    temperature: 0.1,
                },
                'evidence-search'
            );
        } catch {
            // Fall back to plain generation if tool-enabled search is unavailable.
            response = await chatWithModelFallback(
                evidencePrompt,
                DEFAULT_EVIDENCE_MODELS,
                { temperature: 0.1 },
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
        return verifiedEvidence;
    } catch (error) {
        console.error('Web evidence gathering failed:', error);
        debugError('evidence', 'Evidence gathering failed.', {
            contactId: contact.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return [];
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
    const verifiedEvidence = await gatherWebEvidenceForContact(contact);

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
        console.error('Gemini analysis error:', error);
        debugError('analysis', 'Contact analysis failed.', {
            contactId: contact.id,
            error: error instanceof Error ? error.message : String(error)
        });

        // Return default scores on error
        return {
            scores: {
                investorFit: createDefaultProvenance(0, 'Analysis failed'),
                valuesAlignment: createDefaultProvenance(0, 'Analysis failed'),
                govtAccess: createDefaultProvenance(0, 'Analysis failed'),
                maritimeRelevance: createDefaultProvenance(0, 'Analysis failed'),
                connectorScore: createDefaultProvenance(0, 'Analysis failed'),
                overallConfidence: 0,
            },
            enrichment: {
                summary: 'Analysis failed - please try again',
                alignmentRisks: [],
                evidenceLinks: [],
                recommendedAngle: 'N/A',
                recommendedAction: 'Retry analysis',
                tracks: [],
                flaggedAttributes: ['analysis_error'],
                identityConfidence: 0,
                collisionRisk: false,
            },
        };
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
            const response = await puter.ai.chat(conversationPrompt, { model: this.model });

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
            console.error('Chat error:', error);
            return 'I encountered an error processing your request. Please try again.';
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
