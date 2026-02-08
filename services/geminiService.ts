import { Contact, EnrichmentData, Scores, AppSettings, StrategicFocus, ScoreProvenance } from '../types';
import { bridgeMemory } from './bridgeMemory';
import { extractLinkedInUrlFromContact, normalizeAnalysisOutput, parseToolCallFromText } from './enrichmentGuards';

// Declare Puter global (loaded via script tag)
declare const puter: {
    ai: {
        chat: (prompt: string | object[], options?: { model?: string; stream?: boolean }) => Promise<any>;
    };
};

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

function getModelForSettings(settings: AppSettings): string {
    return settings.analysisModel === 'fast'
        ? 'gemini-2.5-flash'
        : 'gemini-2.5-pro';
}

// Helper to extract JSON from markdown-wrapped responses
function extractJSON(text: string): string {
    // Remove markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        return jsonMatch[1].trim();
    }
    // Try to find raw JSON object
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        return objectMatch[0];
    }
    return text;
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
    const model = getModelForSettings(settings);
    const linkedInSeed = extractLinkedInUrlFromContact(contact);

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
- You must use web research, including LinkedIn when available, before scoring.
- Every non-trivial claim must map to at least one evidence URL.
- Use at least 2 evidence links across at least 2 domains when possible.
- If verification is weak, reduce identityConfidence and state uncertainty directly.

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
        const response = await puter.ai.chat(prompt, { model });

        // Handle response - Puter returns the text directly or as an object
        let responseText: string;
        if (typeof response === 'string') {
            responseText = response;
        } else if (response?.message?.content) {
            responseText = response.message.content;
        } else if (response?.text) {
            responseText = response.text;
        } else {
            responseText = JSON.stringify(response);
        }

        // Extract, parse, and normalize model output before it reaches UI state
        const jsonText = extractJSON(responseText);
        const parsedResult = JSON.parse(jsonText);
        return normalizeAnalysisOutput(parsedResult, contact);
    } catch (error) {
        console.error('Gemini analysis error:', error);

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
