import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle, Loader2, Plus, Terminal, FileText, Database, Shield, X } from 'lucide-react';
import { bridgeMemory } from '../services/bridgeMemory';
import { debugError, debugInfo, debugWarn } from '../services/debugService';
import { Contact, IngestionHistoryItem } from '../types';

interface UploadZoneProps {
    onIngestContacts: (newContacts: Contact[]) => void;
    onThesisUpdate: () => void;
    history: IngestionHistoryItem[];
    onAddHistory: (name: string, type: string, metadata?: { batchId?: string; recordCount?: number }) => void;
    onDeleteHistoryItem: (item: IngestionHistoryItem) => void;
}

const UploadZone: React.FC<UploadZoneProps> = ({ onIngestContacts, onThesisUpdate, history, onAddHistory, onDeleteHistoryItem }) => {
    const [isProcessing, setIsProcessing] = useState(false);

    // Separate states for Manual Entry
    const [manualThesis, setManualThesis] = useState('');
    const [manualContext, setManualContext] = useState('');

    // Refs for file inputs
    const contactInputRef = useRef<HTMLInputElement>(null);
    const thesisInputRef = useRef<HTMLInputElement>(null);
    const contextInputRef = useRef<HTMLInputElement>(null);

    const processFile = (file: File, callback: (text: string) => void) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            callback(text);
        };
        reader.readAsText(file);
    };

    const handleContactFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        debugInfo('upload', 'Contact file upload started.', { fileName: file.name, size: file.size });
        setIsProcessing(true);
        try {
            // Import dynamically to avoid circular dependencies if any, though not expected here
            const { parseAndMapCSV } = await import('../services/csvService');

            const parsedContacts = await parseAndMapCSV(file);
            const batchId = `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const newContacts = parsedContacts.map((contact) => ({
                ...contact,
                ingestionMeta: {
                    ...contact.ingestionMeta,
                    batchId
                }
            }));

            if (newContacts.length > 0) {
                onIngestContacts(newContacts);
                onAddHistory(file.name, 'Contacts', {
                    batchId,
                    recordCount: newContacts.length
                });
                debugInfo('upload', 'Contact file processed successfully.', {
                    fileName: file.name,
                    count: newContacts.length,
                    batchId
                });
            } else {
                alert("No valid contacts found. Please check CSV format.");
                debugWarn('upload', 'Contact file had no valid contacts.', { fileName: file.name });
            }
        } catch (err) {
            console.error(err);
            alert("Failed to parse contact file: " + (err instanceof Error ? err.message : String(err)));
            debugError('upload', 'Contact file processing failed.', err);
        } finally {
            setIsProcessing(false);
            if (contactInputRef.current) contactInputRef.current.value = '';
        }
    };

    const handleKnowledgeFile = (e: React.ChangeEvent<HTMLInputElement>, type: 'thesis' | 'context') => {
        const file = e.target.files?.[0];
        if (!file) return;

        debugInfo('upload', 'Knowledge file upload started.', { fileName: file.name, type });
        setIsProcessing(true);
        processFile(file, (text) => {
            bridgeMemory.ingestThesisDocument(text, file.name, type);
            onAddHistory(file.name, type === 'thesis' ? 'Thesis' : 'Context');
            onThesisUpdate();
            debugInfo('upload', 'Knowledge file processed.', { fileName: file.name, type });
            setIsProcessing(false);
            if (type === 'thesis' && thesisInputRef.current) thesisInputRef.current.value = '';
            if (type === 'context' && contextInputRef.current) contextInputRef.current.value = '';
        });
    };

    const handleManualSubmit = (text: string, type: 'thesis' | 'context') => {
        if (!text.trim()) return;
        setIsProcessing(true);
        debugInfo('upload', 'Manual knowledge entry submitted.', { type, chars: text.trim().length });

        // Simulate slight network delay
        setTimeout(() => {
            const title = type === 'thesis' ? "Manual_Rules_Entry" : "Manual_Context_Entry";
            bridgeMemory.ingestThesisDocument(text, title + "_" + new Date().toLocaleTimeString(), type);
            onAddHistory("Manual Entry", type === 'thesis' ? 'Thesis' : 'Context');

            if (type === 'thesis' && thesisInputRef.current) setManualThesis('');
            else setManualContext('');

            onThesisUpdate();
            setIsProcessing(false);
        }, 500);
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-12">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">Bridge Data Ingestion</h2>
                <p className="text-slate-400">Manage the Contact Universe and the Intelligence Knowledge Base.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* 1. CONTACT UNIVERSE */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-blue-900/30 rounded-lg text-blue-400">
                            <UploadCloud size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-white">Contact Universe</h3>
                            <p className="text-xs text-slate-500">Target List (CSV)</p>
                        </div>
                    </div>

                    <div
                        onClick={() => contactInputRef.current?.click()}
                        className="flex-1 border-2 border-slate-700 border-dashed rounded-lg flex flex-col items-center justify-center p-8 cursor-pointer hover:border-blue-500 hover:bg-slate-800/50 transition-all group"
                    >
                        <input
                            type="file"
                            ref={contactInputRef}
                            className="hidden"
                            accept=".csv,.txt"
                            onChange={handleContactFile}
                        />
                        <Database className="text-slate-600 group-hover:text-blue-500 mb-3 transition-colors" size={32} />
                        <span className="text-sm text-slate-400 group-hover:text-slate-200 font-medium">Click to Upload CSV</span>
                        <span className="text-xs text-slate-600 mt-2">Supports: First Name, Last Name, Role</span>
                    </div>
                </div>

                {/* 2. THESIS (RULES) */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-red-900/30 rounded-lg text-red-400">
                            <Shield size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-white">Thesis & Rules</h3>
                            <p className="text-xs text-slate-500">Immutable Constraints</p>
                        </div>
                    </div>

                    <div className="space-y-4 flex-1 flex flex-col">
                        <div
                            onClick={() => thesisInputRef.current?.click()}
                            className="border border-slate-700 bg-slate-800 rounded-lg p-3 flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-700 transition-colors"
                        >
                            <input
                                type="file"
                                ref={thesisInputRef}
                                className="hidden"
                                accept=".txt,.md,.pdf"
                                onChange={(e) => handleKnowledgeFile(e, 'thesis')}
                            />
                            <FileText size={16} className="text-slate-400" />
                            <span className="text-sm text-slate-300">Upload Constitution (TXT)</span>
                        </div>

                        <div className="flex-1 relative">
                            <textarea
                                value={manualThesis}
                                onChange={(e) => setManualThesis(e.target.value)}
                                placeholder="Define core non-negotiables..."
                                className="w-full h-full min-h-[200px] bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-red-500 resize-none"
                            />
                        </div>
                        <button
                            onClick={() => handleManualSubmit(manualThesis, 'thesis')}
                            disabled={!manualThesis.trim() || isProcessing}
                            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs uppercase font-bold rounded border border-slate-700 transition-colors flex items-center justify-center gap-2"
                        >
                            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Add Rule
                        </button>
                    </div>
                </div>

                {/* 3. CONTEXT (STRATEGY) */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-emerald-900/30 rounded-lg text-emerald-400">
                            <Terminal size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-white">Strategic Context</h3>
                            <p className="text-xs text-slate-500">Current Priorities</p>
                        </div>
                    </div>

                    <div className="space-y-4 flex-1 flex flex-col">
                        <div
                            onClick={() => contextInputRef.current?.click()}
                            className="border border-slate-700 bg-slate-800 rounded-lg p-3 flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-700 transition-colors"
                        >
                            <input
                                type="file"
                                ref={contextInputRef}
                                className="hidden"
                                accept=".txt,.md,.pdf"
                                onChange={(e) => handleKnowledgeFile(e, 'context')}
                            />
                            <FileText size={16} className="text-slate-400" />
                            <span className="text-sm text-slate-300">Upload Memos (TXT)</span>
                        </div>

                        <div className="flex-1 relative">
                            <textarea
                                value={manualContext}
                                onChange={(e) => setManualContext(e.target.value)}
                                placeholder="Define current strategic focus..."
                                className="w-full h-full min-h-[200px] bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-emerald-500 resize-none"
                            />
                        </div>
                        <button
                            onClick={() => handleManualSubmit(manualContext, 'context')}
                            disabled={!manualContext.trim() || isProcessing}
                            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs uppercase font-bold rounded border border-slate-700 transition-colors flex items-center justify-center gap-2"
                        >
                            {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Add Context
                        </button>
                    </div>
                </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden mt-8">
                <div className="p-4 border-b border-slate-700 bg-slate-800/50">
                    <h3 className="font-semibold text-slate-300 text-sm uppercase">Ingestion History</h3>
                </div>
                <div className="divide-y divide-slate-700 max-h-60 overflow-y-auto">
                    {history.length === 0 && (
                        <div className="p-4 text-center text-slate-500 text-sm">No recent activity.</div>
                    )}
                    {history.map((item) => (
                        <div key={item.id} className="p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded ${item.type === 'Contacts' ? 'bg-blue-900/20 text-blue-400' :
                                    item.type === 'Thesis' ? 'bg-red-900/20 text-red-400' :
                                        'bg-emerald-900/20 text-emerald-400'
                                    }`}>
                                    {item.type === 'Contacts' ? <UploadCloud size={16} /> : <FileText size={16} />}
                                </div>
                                <div>
                                    <p className="text-sm text-slate-200 font-medium">{item.name}</p>
                                    <p className="text-xs text-slate-500">
                                        Type: {item.type} • {item.timestamp}
                                        {item.type === 'Contacts' && typeof item.recordCount === 'number' ? ` • ${item.recordCount} contacts` : ''}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-emerald-500 text-xs">
                                    <CheckCircle size={14} />
                                    {item.status}
                                </div>
                                <button
                                    onClick={() => {
                                        const message = item.type === 'Contacts'
                                            ? `Delete "${item.name}" and remove all imported contacts from your universe? This cannot be undone.`
                                            : `Remove "${item.name}" from ingestion history?`;
                                        if (window.confirm(message)) {
                                            debugWarn('upload', 'Delete action confirmed from ingestion history.', {
                                                itemId: item.id,
                                                type: item.type,
                                                name: item.name
                                            });
                                            onDeleteHistoryItem(item);
                                        }
                                    }}
                                    className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                                    title={item.type === 'Contacts' ? 'Delete this CSV and all imported contacts' : 'Remove from history'}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default UploadZone;
