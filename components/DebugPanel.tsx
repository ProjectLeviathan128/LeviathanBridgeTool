import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bug, ChevronDown, ChevronUp, Info, Trash2, XCircle } from 'lucide-react';
import { DebugEvent, clearDebugEvents, subscribeDebugEvents, subscribeDebugPanelControls, requestDebugPanelClose } from '../services/debugService';

const DebugPanel: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const [events, setEvents] = useState<DebugEvent[]>([]);

    useEffect(() => {
        return subscribeDebugEvents(setEvents);
    }, []);

    useEffect(() => {
        return subscribeDebugPanelControls({
            onOpen: () => setIsOpen(true),
            onClose: () => setIsOpen(false),
        });
    }, []);

    const errorCount = useMemo(() => events.filter((event) => event.level === 'error').length, [events]);
    const warnCount = useMemo(() => events.filter((event) => event.level === 'warn').length, [events]);
    const latestEvents = useMemo(() => [...events].reverse(), [events]);

    const levelIcon = (level: DebugEvent['level']) => {
        if (level === 'error') return <XCircle size={12} className="text-red-400" />;
        if (level === 'warn') return <AlertTriangle size={12} className="text-amber-400" />;
        return <Info size={12} className="text-blue-400" />;
    };

    return (
        <div className="fixed bottom-4 right-4 z-[80] w-[92vw] max-w-[520px]">
            {!isOpen ? (
                <button
                    onClick={() => setIsOpen(true)}
                    className="ml-auto flex items-center gap-2 bg-slate-900/95 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg shadow-lg hover:border-blue-500 transition-colors"
                    title="Open Debug Panel"
                >
                    <Bug size={14} className="text-blue-400" />
                    <span className="text-xs font-medium">Debug</span>
                    <span className="text-[10px] text-slate-400">{events.length}</span>
                    {(errorCount > 0 || warnCount > 0) && (
                        <span className="text-[10px] text-red-300">
                            {errorCount}E/{warnCount}W
                        </span>
                    )}
                </button>
            ) : (
                <div className="bg-slate-950/95 backdrop-blur border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900">
                        <div className="flex items-center gap-2">
                            <Bug size={14} className="text-blue-400" />
                            <span className="text-xs uppercase tracking-wider font-semibold text-slate-200">Live Debug Panel</span>
                            <span className="text-[10px] text-slate-400">{events.length} events</span>
                            <span className="text-[10px] text-red-300">{errorCount} errors</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowDetails((value) => !value)}
                                className="p-1 text-slate-500 hover:text-white transition-colors"
                                title={showDetails ? 'Hide Details' : 'Show Details'}
                            >
                                {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            <button
                                onClick={clearDebugEvents}
                                className="p-1 text-slate-500 hover:text-amber-400 transition-colors"
                                title="Clear Logs"
                            >
                                <Trash2 size={14} />
                            </button>
                            <button
                                onClick={requestDebugPanelClose}
                                className="p-1 text-slate-500 hover:text-white transition-colors"
                                title="Close"
                            >
                                <XCircle size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-800">
                        {latestEvents.length === 0 ? (
                            <div className="px-3 py-8 text-center text-xs text-slate-500">No events yet.</div>
                        ) : latestEvents.map((event) => (
                            <div key={event.id} className="px-3 py-2">
                                <div className="flex items-start gap-2">
                                    <div className="mt-0.5">{levelIcon(event.level)}</div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                            <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                                            <span className="text-slate-400">{event.source}</span>
                                        </div>
                                        <p className="text-xs text-slate-200 break-words">{event.message}</p>
                                        {showDetails && event.details && (
                                            <pre className="mt-1 p-2 text-[10px] text-slate-300 bg-slate-900 rounded border border-slate-800 overflow-x-auto whitespace-pre-wrap break-words">
                                                {event.details}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default DebugPanel;
