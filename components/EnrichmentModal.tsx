import React from 'react';
import { X, Loader2, CheckCircle, XCircle, Zap, Search, Brain, Database } from 'lucide-react';

interface EnrichmentStep {
    id: string;
    label: string;
    status: 'pending' | 'running' | 'done' | 'error';
    icon: 'search' | 'brain' | 'database';
}

interface EnrichmentProgress {
    isOpen: boolean;
    currentContact: string;
    currentContactIndex: number;
    totalContacts: number;
    currentStep: string;
    steps: EnrichmentStep[];
    cancelled: boolean;
}

interface EnrichmentModalProps {
    progress: EnrichmentProgress;
    onCancel: () => void;
}

const stepIcons = {
    search: Search,
    brain: Brain,
    database: Database,
};

const EnrichmentModal: React.FC<EnrichmentModalProps> = ({ progress, onCancel }) => {
    if (!progress.isOpen) return null;

    const overallPercentage = progress.totalContacts > 0
        ? Math.round((progress.currentContactIndex / progress.totalContacts) * 100)
        : 0;

    // Calculate per-contact progress based on steps
    const completedSteps = progress.steps.filter(s => s.status === 'done').length;
    const contactPercentage = progress.steps.length > 0
        ? Math.round((completedSteps / progress.steps.length) * 100)
        : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-amber-900/50 to-orange-900/50 px-6 py-4 border-b border-slate-700">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <Zap className="text-amber-400" size={20} />
                            </div>
                            <div>
                                <h3 className="text-white font-semibold">Bridge Enrichment</h3>
                                <p className="text-amber-200/70 text-sm">Analyzing contacts with AI</p>
                            </div>
                        </div>
                        <button
                            onClick={onCancel}
                            className="p-2 hover:bg-red-900/50 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                            title="Cancel enrichment"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Overall Progress */}
                <div className="px-6 py-4 border-b border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-300">Overall Progress</span>
                        <span className="text-sm font-bold text-amber-400">
                            {progress.currentContactIndex} / {progress.totalContacts} contacts
                        </span>
                    </div>
                    <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500 ease-out"
                            style={{ width: `${overallPercentage}%` }}
                        />
                    </div>
                    <div className="text-right mt-1">
                        <span className="text-xs text-slate-500">{overallPercentage}% complete</span>
                    </div>
                </div>

                {/* Current Contact */}
                <div className="px-6 py-4 bg-slate-950/50">
                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                        Currently Processing
                    </div>
                    <div className="flex items-center gap-3">
                        <Loader2 className="animate-spin text-blue-400" size={18} />
                        <span className="text-white font-medium text-lg">{progress.currentContact}</span>
                        <span className="ml-auto text-sm text-blue-400 font-medium">{contactPercentage}%</span>
                    </div>

                    {/* Contact Progress Bar */}
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-3">
                        <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${contactPercentage}%` }}
                        />
                    </div>
                </div>

                {/* Step Details */}
                <div className="px-6 py-4 border-t border-slate-800 max-h-48 overflow-y-auto">
                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">
                        Enrichment Steps
                    </div>
                    <div className="space-y-2">
                        {progress.steps.map((step) => {
                            const IconComponent = stepIcons[step.icon];
                            return (
                                <div
                                    key={step.id}
                                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${step.status === 'running' ? 'bg-blue-900/20 border border-blue-800' :
                                            step.status === 'done' ? 'bg-emerald-900/10' :
                                                step.status === 'error' ? 'bg-red-900/10' :
                                                    'bg-slate-800/30'
                                        }`}
                                >
                                    <div className={`w-6 h-6 rounded flex items-center justify-center ${step.status === 'running' ? 'bg-blue-900/50' :
                                            step.status === 'done' ? 'bg-emerald-900/50' :
                                                step.status === 'error' ? 'bg-red-900/50' :
                                                    'bg-slate-800'
                                        }`}>
                                        {step.status === 'running' ? (
                                            <Loader2 className="animate-spin text-blue-400" size={14} />
                                        ) : step.status === 'done' ? (
                                            <CheckCircle className="text-emerald-400" size={14} />
                                        ) : step.status === 'error' ? (
                                            <XCircle className="text-red-400" size={14} />
                                        ) : (
                                            <IconComponent className="text-slate-500" size={14} />
                                        )}
                                    </div>
                                    <span className={`text-sm ${step.status === 'running' ? 'text-blue-300' :
                                            step.status === 'done' ? 'text-emerald-300' :
                                                step.status === 'error' ? 'text-red-300' :
                                                    'text-slate-500'
                                        }`}>
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
                    <div className="text-xs text-slate-600">
                        Press Cancel to stop at any time
                    </div>
                    <button
                        onClick={onCancel}
                        className="px-4 py-1.5 bg-red-900/50 hover:bg-red-800 text-red-300 hover:text-white text-sm font-medium rounded-lg transition-colors border border-red-800"
                    >
                        Cancel Enrichment
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EnrichmentModal;
export type { EnrichmentProgress, EnrichmentStep };
