import React, { useState, useEffect, useRef } from 'react';
import { Contact, AppSettings, ChatThread, ChatMessage } from '../types';
import { createBridgeChat, analyzeContactWithGemini, Chat } from '../services/geminiService';
import { assessEnrichmentQuality } from '../services/enrichmentGuards';
import { debugError, debugInfo, debugWarn, requestDebugPanelOpen } from '../services/debugService';
import { Send, Bot, User, Search, Loader2, ExternalLink, Zap, Plus, Trash2, RefreshCw, XCircle } from 'lucide-react';
import EnrichmentModal, { EnrichmentProgress, EnrichmentStep } from './EnrichmentModal';

interface ChatInterfaceProps {
    contacts: Contact[];
    onBatchUpdateContacts: (contacts: Contact[]) => void;
    settings: AppSettings;
    threads: ChatThread[];
    activeThreadId: string;
    onUpdateThreads: (threads: ChatThread[]) => void;
    onSetActiveThread: (id: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
    contacts,
    onBatchUpdateContacts,
    settings,
    threads,
    activeThreadId,
    onUpdateThreads,
    onSetActiveThread
}) => {
    const [input, setInput] = useState('');

    // Enrichment progress modal state
    const [enrichmentProgress, setEnrichmentProgress] = useState<EnrichmentProgress>({
        isOpen: false,
        currentContact: '',
        currentContactIndex: 0,
        totalContacts: 0,
        currentStep: '',
        steps: [],
        cancelled: false
    });

    // Cancel controller for stopping enrichment
    const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

    // Maintain a map of initialized Gemini Chat sessions in memory
    // This prevents losing context/history when switching threads
    const chatSessions = useRef<Map<string, Chat>>(new Map());
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const activeThread = threads.find(t => t.id === activeThreadId) || threads[0];

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeThread?.messages, activeThread?.status]);

    useEffect(() => {
        chatSessions.current.forEach((chat) => {
            chat.setContacts(contacts);
        });
    }, [contacts]);

    // Guard: If no threads exist yet (initial load), show loading state
    if (!activeThread) {
        return (
            <div className="flex h-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800 items-center justify-center">
                <div className="text-slate-500 text-sm">Loading chat...</div>
            </div>
        );
    }

    // Cancel handler
    const handleCancelOperation = () => {
        if (!activeThread) return;
        cancelRef.current.cancelled = true;
        setEnrichmentProgress(prev => ({ ...prev, isOpen: false, cancelled: true }));
        debugWarn('chat', 'Enrichment operation cancelled by user.', { threadId: activeThreadId });
        updateThread(activeThreadId, {
            status: 'idle',
            toolStatus: undefined,
            messages: [...activeThread.messages, {
                id: Date.now().toString(),
                role: 'model',
                text: '⚠️ Operation cancelled by user. Partial results may have been saved.',
                isToolUse: true
            }]
        });
    };

    // Helper to update a specific thread safely
    const updateThread = (id: string, updates: Partial<ChatThread>) => {
        onUpdateThreads(threads.map(t => t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t));
    };

    const handleCreateThread = () => {
        const newId = Date.now().toString();
        const newThread: ChatThread = {
            id: newId,
            title: 'New Chat',
            messages: [{
                id: 'welcome',
                role: 'model',
                text: "Ready for a new task. What are we analyzing?"
            }],
            status: 'idle',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        onUpdateThreads([newThread, ...threads]);
        onSetActiveThread(newId);
        debugInfo('chat', 'New chat thread created.', { threadId: newId });
    };

    const handleDeleteThread = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (threads.length === 1) return; // Don't delete last thread
        const newThreads = threads.filter(t => t.id !== id);
        onUpdateThreads(newThreads);
        if (activeThreadId === id) {
            onSetActiveThread(newThreads[0].id);
        }
        chatSessions.current.delete(id);
        debugWarn('chat', 'Chat thread deleted.', { threadId: id });
    };

    const handleRefreshContext = () => {
        chatSessions.current.delete(activeThreadId);
        debugInfo('chat', 'Chat context refreshed for active thread.', { threadId: activeThreadId });
        updateThread(activeThreadId, {
            messages: [...activeThread.messages, {
                id: Date.now().toString(),
                role: 'model',
                text: "Context refreshed. I am now aware of the latest contacts and thesis rules."
            }]
        });
    };

    const handleSend = async () => {
        if (!input.trim()) return;

        // 1. Setup Message
        const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: input };
        const currentThreadId = activeThreadId; // Capture ID in closure
        debugInfo('chat', 'User message sent.', { threadId: currentThreadId, preview: input.slice(0, 120) });

        // 2. Optimistic Update
        const updatedMessages = [...activeThread.messages, userMsg];
        updateThread(currentThreadId, {
            messages: updatedMessages,
            status: 'thinking',
            title: activeThread.messages.length <= 1 ? input.slice(0, 30) : activeThread.title
        });
        setInput('');

        try {
            // 3. Get or Init Chat Session
            let chat = chatSessions.current.get(currentThreadId);
            if (!chat) {
                chat = createBridgeChat(contacts);
                chatSessions.current.set(currentThreadId, chat);
            }

            // 4. Send to Gemini
            const result = await chat.sendMessage({ message: userMsg.text });

            // 5. Handle Tool Use (Enrichment)
            const functionCalls = result.functionCalls;

            if (functionCalls && functionCalls.length > 0) {
                const searchCall = functionCalls.find((fc: any) => fc.name === 'search_contacts');
                const enrichCall = functionCalls.find((fc: any) => fc.name === 'enrich_contacts');

                if (searchCall) {
                    const query = ((searchCall.args as any).query || '').toLowerCase().trim();
                    updateThread(currentThreadId, { toolStatus: `Searching database for "${query}"...` });
                    debugInfo('chat.tool', 'Executing search_contacts tool.', { threadId: currentThreadId, query });

                    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'from', 'this', 'into', 'are', 'who', 'what', 'where']);
                    const tokens = query
                        .split(/[\s,.;:!?()\/\\-]+/)
                        .map((t: string) => t.trim())
                        .filter((t: string) => t.length > 1 && !stopWords.has(t));

                    // Tokenized relevance search to handle natural language queries.
                    const scoredMatches = contacts.map((c) => {
                        const name = c.name.toLowerCase();
                        const headline = c.headline.toLowerCase();
                        const location = c.location.toLowerCase();
                        const rawText = (c.rawText || '').toLowerCase();
                        const haystack = `${name} ${headline} ${location} ${rawText}`;

                        let score = 0;
                        if (query && haystack.includes(query)) score += 20;

                        tokens.forEach((token: string) => {
                            if (name.includes(token)) score += 6;
                            if (headline.includes(token)) score += 5;
                            if (location.includes(token)) score += 3;
                            if (rawText.includes(token)) score += 2;
                        });

                        return { contact: c, score };
                    });

                    const matches = scoredMatches
                        .filter(m => m.score > 0)
                        .sort((a, b) => b.score - a.score)
                        .map(m => m.contact);
                    debugInfo('chat.tool', 'Search completed.', { query, matches: matches.length });

                    // Limit to top 20 results to fit in context
                    const topMatches = matches.slice(0, 20).map(c => ({
                        id: c.id,
                        name: c.name,
                        headline: c.headline,
                        location: c.location,
                        status: c.status,
                        // Include snippets of raw text for context
                        notes: c.rawText ? c.rawText.slice(0, 300) + (c.rawText.length > 300 ? '...' : '') : 'No notes'
                    }));

                    const toolResponse = [{
                        functionResponse: {
                            name: searchCall.name,
                            response: {
                                count: matches.length,
                                topResults: topMatches,
                                message: matches.length > 20 ? `Showing top 20 of ${matches.length} matches.` : `Found ${matches.length} matches.`
                            },
                            id: searchCall.id
                        }
                    }];

                    const finalResult = await chat.sendMessage(toolResponse);

                    updateThread(currentThreadId, {
                        status: 'idle',
                        toolStatus: undefined,
                        messages: [...updatedMessages, {
                            id: (Date.now() + 1).toString(),
                            role: 'model',
                            text: finalResult.text,
                            isToolUse: true
                        }]
                    });

                } else if (enrichCall) {
                    // ... existing enrich logic ...
                    const args = enrichCall.args as any;
                    // ... (keep existing enrich logic exactly as is, just wrapped in else if)
                    let contactIds = args?.contactIds || [];
                    // RATE LIMIT: Max 3 contacts per batch to avoid API overload
                    const MAX_BATCH_SIZE = 3;
                    if (contactIds.length > MAX_BATCH_SIZE) {
                        contactIds = contactIds.slice(0, MAX_BATCH_SIZE);
                    }
                    debugInfo('chat.tool', 'Executing enrich_contacts tool.', {
                        threadId: currentThreadId,
                        count: contactIds.length
                    });
                    requestDebugPanelOpen();

                    // Update Status to "Tool Use"
                    updateThread(currentThreadId, {
                        status: 'tool_use',
                        toolStatus: `Starting enrichment of ${contactIds.length} contact(s)...`
                    });

                    // EXECUTE CLIENT-SIDE LOGIC WITH PROGRESS
                    const enrichedResults: Contact[] = [];
                    const summaries: string[] = [];
                    let reviewNeededCount = 0;
                    let processed = 0;

                    // Open the enrichment modal
                    const defaultSteps: EnrichmentStep[] = [
                        { id: 'context', label: 'Loading thesis context...', status: 'pending', icon: 'database' },
                        { id: 'analyze', label: 'Analyzing with Gemini AI...', status: 'pending', icon: 'brain' },
                        { id: 'score', label: 'Computing alignment scores...', status: 'pending', icon: 'brain' },
                        { id: 'save', label: 'Saving enrichment data...', status: 'pending', icon: 'database' },
                    ];

                    for (const id of contactIds) {
                        // Check for cancellation before each contact
                        if (cancelRef.current.cancelled) {
                            summaries.push('\n\u26a0\ufe0f Cancelled by user');
                            break;
                        }

                        const contact = contacts.find(c => c.id === id);
                        if (contact) {
                            processed++;
                            debugInfo('chat.enrich', 'Starting contact analysis.', {
                                contactId: contact.id,
                                name: contact.name,
                                position: `${processed}/${contactIds.length}`
                            });

                            // Reset steps for this contact and open modal
                            const steps = defaultSteps.map(s => ({ ...s, status: 'pending' as const }));
                            setEnrichmentProgress({
                                isOpen: true,
                                currentContact: contact.name,
                                currentContactIndex: processed,
                                totalContacts: contactIds.length,
                                currentStep: 'Loading context...',
                                steps,
                                cancelled: false
                            });

                            // Update progress for each contact
                            updateThread(currentThreadId, {
                                toolStatus: `[${processed}/${contactIds.length}] Analyzing: ${contact.name}...`
                            });

                            try {
                                // Step 1: Loading context
                                setEnrichmentProgress(prev => ({
                                    ...prev,
                                    currentStep: 'Loading thesis context...',
                                    steps: prev.steps.map(s => s.id === 'context' ? { ...s, status: 'running' } : s)
                                }));
                                await new Promise(r => setTimeout(r, 200)); // Brief delay for UI

                                // Step 2: Analyzing
                                setEnrichmentProgress(prev => ({
                                    ...prev,
                                    currentStep: 'Analyzing with AI...',
                                    steps: prev.steps.map(s =>
                                        s.id === 'context' ? { ...s, status: 'done' } :
                                            s.id === 'analyze' ? { ...s, status: 'running' } : s
                                    )
                                }));

                                const analysis = await analyzeContactWithGemini(contact, settings);
                                const quality = assessEnrichmentQuality(analysis.enrichment);
                                const finalStatus: Contact['status'] = quality.requiresReview ? 'Review Needed' : 'Enriched';
                                if (quality.requiresReview) {
                                    reviewNeededCount += 1;
                                }

                                // Step 3: Scoring
                                setEnrichmentProgress(prev => ({
                                    ...prev,
                                    currentStep: 'Computing scores...',
                                    steps: prev.steps.map(s =>
                                        s.id === 'analyze' ? { ...s, status: 'done' } :
                                            s.id === 'score' ? { ...s, status: 'running' } : s
                                    )
                                }));
                                await new Promise(r => setTimeout(r, 150));

                                // Step 4: Saving
                                setEnrichmentProgress(prev => ({
                                    ...prev,
                                    currentStep: 'Saving results...',
                                    steps: prev.steps.map(s =>
                                        s.id === 'score' ? { ...s, status: 'done' } :
                                            s.id === 'save' ? { ...s, status: 'running' } : s
                                    )
                                }));

                                const updatedContact = {
                                    ...contact,
                                    status: finalStatus,
                                    scores: analysis.scores,
                                    enrichment: analysis.enrichment
                                };
                                enrichedResults.push(updatedContact);

                                // Show brief summary in progress
                                const shortSummary = analysis.enrichment.summary.slice(0, 80) + '...';
                                if (quality.requiresReview) {
                                    summaries.push(`\u26a0 ${contact.name}: Review Needed - ${quality.issues.join(' ')}`);
                                } else {
                                    summaries.push(`\u2713 ${contact.name}: ${shortSummary}`);
                                }
                                debugInfo('chat.enrich', 'Contact analysis completed.', {
                                    contactId: contact.id,
                                    name: contact.name,
                                    status: finalStatus
                                });

                                // Update UI immediately with this contact's result
                                onBatchUpdateContacts([updatedContact]);

                                // IMPORTANT: Sync new data to the active chat session so the agent "knows" it
                                chat.updateContact(updatedContact);

                                // Mark save as done
                                setEnrichmentProgress(prev => ({
                                    ...prev,
                                    steps: prev.steps.map(s => s.id === 'save' ? { ...s, status: 'done' } : s)
                                }));

                                // Rate limit delay between calls (1 second)
                                if (processed < contactIds.length) {
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                }
                            } catch (e) {
                                console.error(`Failed to enrich ${contact.name}:`, e);
                                summaries.push(`✗ ${contact.name}: Failed - ${e instanceof Error ? e.message : 'Unknown error'}`);
                                debugError('chat.enrich', 'Contact analysis failed.', {
                                    contactId: contact.id,
                                    name: contact.name,
                                    error: e instanceof Error ? e.message : String(e)
                                });
                                requestDebugPanelOpen();
                            }
                        }
                    }

                    // Send Tool Result Back
                    updateThread(currentThreadId, { toolStatus: "Generating summary report..." });

                    const toolResponse = [{
                        functionResponse: {
                            name: enrichCall.name,
                            response: {
                                result: `Enrichment Complete (${enrichedResults.length}/${contactIds.length} processed): ${Math.max(0, enrichedResults.length - reviewNeededCount)} enriched, ${reviewNeededCount} review needed.\n${summaries.join('\n')}`
                            },
                            id: enrichCall.id
                        }
                    }];

                    const finalResult = await chat.sendMessage(toolResponse);
                    debugInfo('chat.tool', 'Enrichment tool run completed.', {
                        processed: enrichedResults.length,
                        requested: contactIds.length,
                        reviewNeeded: reviewNeededCount
                    });

                    // Close the enrichment modal
                    setEnrichmentProgress(prev => ({ ...prev, isOpen: false }));

                    updateThread(currentThreadId, {
                        status: 'idle',
                        toolStatus: undefined,
                        messages: [...updatedMessages, {
                            id: (Date.now() + 1).toString(),
                            role: 'model',
                            text: finalResult.text || `Enriched ${enrichedResults.length} contact(s). Check the Universe tab to review results.`,
                            isToolUse: true
                        }]
                    });

                } else {
                    // Unknown tool
                    debugWarn('chat.tool', 'Unknown tool call requested by model.', { threadId: currentThreadId });
                    updateThread(currentThreadId, {
                        status: 'idle',
                        messages: [...updatedMessages, { id: Date.now().toString(), role: 'model', text: "Tool not supported." }]
                    });
                }
            } else {
                // Standard Text Response
                let groundingSources: { title: string; uri: string }[] = [];
                if (result.candidates?.[0]?.groundingMetadata?.groundingChunks) {
                    result.candidates[0].groundingMetadata.groundingChunks.forEach((chunk: any) => {
                        if (chunk.web?.uri && chunk.web?.title) {
                            groundingSources.push({ title: chunk.web.title, uri: chunk.web.uri });
                        }
                    });
                }

                updateThread(currentThreadId, {
                    status: 'idle',
                    messages: [...updatedMessages, {
                        id: (Date.now() + 1).toString(),
                        role: 'model',
                        text: result.text || "I processed that.",
                        groundingSources: groundingSources.length > 0 ? groundingSources : undefined
                    }]
                });
            }

        } catch (err) {
            console.error("Chat error", err);
            debugError('chat', 'Chat request failed.', err);
            requestDebugPanelOpen();
            updateThread(currentThreadId, {
                status: 'idle',
                messages: [...updatedMessages, { id: Date.now().toString(), role: 'model', text: "Error: Connection interrupted." }]
            });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Safety: If no threads exist yet (initial load), show loading state
    if (!activeThread) {
        return (
            <div className="flex h-full items-center justify-center bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-sm">Loading chat...</div>
            </div>
        );
    }

    return (<>
        <div className="flex h-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800">

            {/* LEFT SIDEBAR (Thread List) */}
            <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
                <div className="p-4 border-b border-slate-800">
                    <button
                        onClick={handleCreateThread}
                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-sm font-medium transition-colors"
                    >
                        <Plus size={16} /> New Chat
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                    {threads.map(thread => (
                        <div
                            key={thread.id}
                            onClick={() => onSetActiveThread(thread.id)}
                            className={`px-4 py-3 cursor-pointer flex items-center justify-between group transition-colors ${activeThreadId === thread.id
                                ? 'bg-slate-800 border-l-2 border-blue-500'
                                : 'hover:bg-slate-900 border-l-2 border-transparent'
                                }`}
                        >
                            <div className="flex flex-col overflow-hidden">
                                <span className={`text-sm truncate font-medium ${activeThreadId === thread.id ? 'text-white' : 'text-slate-400'}`}>
                                    {thread.title}
                                </span>
                                <span className="text-[10px] text-slate-600 truncate">
                                    {new Date(thread.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {thread.status !== 'idle' && ' • Thinking...'}
                                </span>
                            </div>
                            {threads.length > 1 && (
                                <button
                                    onClick={(e) => handleDeleteThread(e, thread.id)}
                                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-1"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT MAIN CHAT AREA */}
            <div className="flex-1 flex flex-col min-w-0">

                {/* Chat Header */}
                <div className="p-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Bot className="text-emerald-500" size={20} />
                        <div>
                            <h3 className="text-white font-mono font-bold text-sm">{activeThread.title}</h3>
                            {activeThread.status === 'tool_use' ? (
                                <span className="text-[10px] text-amber-400 flex items-center gap-1">
                                    <Zap size={10} /> Auto-Enrichment Active
                                </span>
                            ) : (
                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Online
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleRefreshContext}
                            className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-emerald-400 transition-colors"
                            title="Refresh Context (New Contacts/Rules)"
                        >
                            <RefreshCw size={14} />
                        </button>
                        <div className="text-[10px] text-slate-500 border border-slate-700 px-2 py-1 rounded">
                            Bridge v1.1
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {activeThread.messages.map((msg) => (
                        <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                                {msg.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className="text-emerald-400" />}
                            </div>
                            <div className={`max-w-[85%] space-y-2`}>
                                <div className={`p-3 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-blue-900/40 text-blue-100 border border-blue-800' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
                                    {msg.isToolUse && (
                                        <div className="mb-2 text-xs text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                            <Zap size={10} /> Action Executed
                                        </div>
                                    )}
                                    {msg.text}
                                </div>
                                {msg.groundingSources && msg.groundingSources.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {Array.from(new Set(msg.groundingSources.map(s => JSON.stringify(s)))).map((json) => JSON.parse(json as string)).map((source: any, idx) => (
                                            <a key={idx} href={source.uri} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-400 hover:text-blue-400 transition-colors">
                                                <Search size={10} />
                                                <span className="truncate max-w-[150px]">{source.title}</span>
                                                <ExternalLink size={8} />
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Tool Status / Activity Log */}
                    {activeThread.toolStatus && (
                        <div className="bg-slate-900 border border-amber-900/50 rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
                                    <Zap size={14} />
                                    Bridge Activity Log
                                </div>
                                <button
                                    onClick={handleCancelOperation}
                                    className="flex items-center gap-1.5 px-3 py-1 bg-red-900/50 hover:bg-red-800 text-red-300 hover:text-white text-xs font-medium rounded transition-colors border border-red-800"
                                >
                                    <XCircle size={12} />
                                    Cancel
                                </button>
                            </div>
                            <div className="flex items-center gap-3 bg-slate-800 p-3 rounded border border-slate-700">
                                <Loader2 className="animate-spin text-amber-400" size={18} />
                                <div className="flex-1">
                                    <div className="text-sm text-white font-medium">{activeThread.toolStatus}</div>
                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                        Using {settings.analysisModel === 'fast' ? 'Gemini Flash' : 'Gemini Pro'} • Rate limited to 3 contacts/batch
                                    </div>
                                </div>
                            </div>
                            <div className="text-[10px] text-slate-600 italic">
                                Tip: Enrichment uses your thesis rules to score each contact. Check the Thesis tab to customize.
                            </div>
                        </div>
                    )}

                    {/* General Thinking Indicator */}
                    {activeThread.status === 'thinking' && !activeThread.toolStatus && (
                        <div className="flex gap-4">
                            <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center shrink-0">
                                <Bot size={16} className="text-emerald-400" />
                            </div>
                            <div className="flex items-center gap-2 text-slate-500 text-sm italic">
                                <Loader2 className="animate-spin" size={14} />
                                Processing...
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 border-t border-slate-800 bg-slate-900/50">
                    <div className="relative">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Message Bridge..."
                            className="w-full bg-slate-950 text-white rounded-lg border border-slate-700 p-3 pr-12 focus:outline-none focus:border-blue-500 text-sm resize-none h-14 scrollbar-hide"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || activeThread.status !== 'idle'}
                            className="absolute right-2 top-2 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded transition-colors"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>

            </div>
        </div>

        {/* Enrichment Progress Modal */}
        <EnrichmentModal
            progress={enrichmentProgress}
            onCancel={handleCancelOperation}
        />
    </>);
};

export default ChatInterface;
