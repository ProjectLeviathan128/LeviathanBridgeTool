import React, { useState } from 'react';
import { AppSettings, StrategicFocus } from '../types';
import { Trash2, BrainCircuit, ShieldAlert, Target, ShieldCheck, Briefcase, Landmark, Download, Upload, RefreshCw, Cloud } from 'lucide-react';
import { exportAllData, importAllData, saveToCloud, loadFromCloud, loadSyncState } from '../services/storageService';

interface SettingsProps {
    settings: AppSettings;
    onUpdateSettings: (newSettings: AppSettings) => void;
    onClearContacts: () => void;
    onClearKnowledge: () => void;
}

const Settings: React.FC<SettingsProps> = ({ settings, onUpdateSettings, onClearContacts, onClearKnowledge }) => {
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
    const [importStatus, setImportStatus] = useState<string | null>(null);

    const handleFocusChange = (mode: StrategicFocus) => {
        onUpdateSettings({
            ...settings,
            focusMode: mode
        });
    };

    const handleModelChange = (model: 'fast' | 'quality') => {
        onUpdateSettings({
            ...settings,
            analysisModel: model
        });
    };

    const handleExport = () => {
        const data = exportAllData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bridge-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            const success = importAllData(content);
            if (success) {
                setImportStatus('Import successful! Refresh the page to see changes.');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                setImportStatus('Import failed. Invalid file format.');
            }
        };
        reader.readAsText(file);
    };

    const handleForceSync = async () => {
        setSyncStatus('syncing');
        try {
            await saveToCloud();
            setSyncStatus('success');
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch {
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    const handlePullFromCloud = async () => {
        setSyncStatus('syncing');
        try {
            await loadFromCloud();
            setSyncStatus('success');
            setImportStatus('Cloud data loaded! Refresh the page to see changes.');
            setTimeout(() => window.location.reload(), 1500);
        } catch {
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    const syncState = loadSyncState();

    const focusModes: { id: StrategicFocus; label: string; desc: string; icon: any; color: string }[] = [
        {
            id: 'BALANCED',
            label: 'Balanced Strategy',
            desc: 'Standard evaluation. Weighs commercial potential and values alignment equally.',
            icon: Target,
            color: 'blue'
        },
        {
            id: 'GATEKEEPER',
            label: 'The Gatekeeper',
            desc: 'Strict values enforcement. Prioritizes reputational safety over commercial opportunity. High rejection rate.',
            icon: ShieldCheck,
            color: 'emerald'
        },
        {
            id: 'DEAL_HUNTER',
            label: 'The Deal Hunter',
            desc: 'Commercial aggression. Prioritizes investor fit and connector potential. Tolerates minor thesis deviations.',
            icon: Briefcase,
            color: 'amber'
        },
        {
            id: 'GOVT_INTEL',
            label: 'Government Intel',
            desc: 'Focus on public sector access, lobbying potential, and regulatory influence.',
            icon: Landmark,
            color: 'purple'
        }
    ];

    return (
        <div className="max-w-4xl mx-auto pb-12">
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-white mb-2">System Configuration</h2>
                <p className="text-slate-400">Configure the Intelligence Engine's personality and directives.</p>
            </div>

            <div className="space-y-8">

                {/* 1. STRATEGIC DIRECTIVE */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex items-center gap-2">
                        <Target className="text-blue-400" size={20} />
                        <h3 className="font-semibold text-white">Strategic Directive</h3>
                    </div>
                    <div className="p-6">
                        <p className="text-sm text-slate-400 mb-4">
                            How should Bridge prioritize findings? This setting alters the "Personality" of the analysis engine.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {focusModes.map((mode) => {
                                const Icon = mode.icon;
                                const isSelected = settings.focusMode === mode.id;
                                return (
                                    <div
                                        key={mode.id}
                                        onClick={() => handleFocusChange(mode.id)}
                                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${isSelected
                                                ? `border-${mode.color}-500 bg-${mode.color}-900/20`
                                                : 'border-slate-700 bg-slate-900 hover:border-slate-600'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2 font-bold text-white">
                                                <Icon size={18} className={`text-${mode.color}-400`} />
                                                <span>{mode.label}</span>
                                            </div>
                                            {isSelected && <div className={`w-3 h-3 bg-${mode.color}-500 rounded-full`} />}
                                        </div>
                                        <p className="text-xs text-slate-400">{mode.desc}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* 2. AI MODEL CONFIGURATION */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex items-center gap-2">
                        <BrainCircuit className="text-emerald-400" size={20} />
                        <h3 className="font-semibold text-white">Intelligence Depth</h3>
                    </div>
                    <div className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div
                                onClick={() => handleModelChange('fast')}
                                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${settings.analysisModel === 'fast' ? 'border-blue-500 bg-blue-900/20' : 'border-slate-700 bg-slate-900 hover:border-slate-600'}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-bold text-white">Fast Scan (Flash)</span>
                                    {settings.analysisModel === 'fast' && <div className="w-3 h-3 bg-blue-500 rounded-full" />}
                                </div>
                                <p className="text-xs text-slate-400">Quick triage. Good for large lists. Less detailed reasoning.</p>
                            </div>

                            <div
                                onClick={() => handleModelChange('quality')}
                                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${settings.analysisModel === 'quality' ? 'border-emerald-500 bg-emerald-900/20' : 'border-slate-700 bg-slate-900 hover:border-slate-600'}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-bold text-white">Deep Dive (Pro)</span>
                                    {settings.analysisModel === 'quality' && <div className="w-3 h-3 bg-emerald-500 rounded-full" />}
                                </div>
                                <p className="text-xs text-slate-400">Full internet research, complex reasoning, and verifying evidence sources.</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. DATA & SYNC */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex items-center gap-2">
                        <Cloud className="text-blue-400" size={20} />
                        <h3 className="font-semibold text-white">Data & Sync</h3>
                    </div>
                    <div className="p-6 space-y-4">
                        {syncState.lastSyncedAt && (
                            <p className="text-sm text-slate-400">
                                Last synced: {new Date(syncState.lastSyncedAt).toLocaleString()}
                            </p>
                        )}

                        {importStatus && (
                            <div className={`p-3 rounded-lg text-sm ${importStatus.includes('failed') ? 'bg-red-900/30 text-red-300' : 'bg-emerald-900/30 text-emerald-300'}`}>
                                {importStatus}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <button
                                onClick={handleForceSync}
                                disabled={syncStatus === 'syncing'}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                <RefreshCw size={16} className={syncStatus === 'syncing' ? 'animate-spin' : ''} />
                                {syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'success' ? 'Synced!' : 'Force Sync to Cloud'}
                            </button>

                            <button
                                onClick={handlePullFromCloud}
                                disabled={syncStatus === 'syncing'}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700/50 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                <Cloud size={16} />
                                Pull from Cloud
                            </button>
                        </div>

                        <div className="border-t border-slate-700 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <button
                                onClick={handleExport}
                                className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                <Download size={16} />
                                Export Data (JSON)
                            </button>

                            <label className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer">
                                <Upload size={16} />
                                Import Data
                                <input
                                    type="file"
                                    accept=".json"
                                    onChange={handleImport}
                                    className="hidden"
                                />
                            </label>
                        </div>
                    </div>
                </div>

                {/* 4. DANGER ZONE */}
                <div className="bg-slate-800 rounded-xl border border-red-900/50 overflow-hidden">
                    <div className="p-4 border-b border-red-900/30 bg-red-900/10 flex items-center gap-2">
                        <ShieldAlert className="text-red-400" size={20} />
                        <h3 className="font-semibold text-red-200">Danger Zone</h3>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="flex items-center justify-between p-4 bg-slate-900 rounded border border-slate-700">
                            <div>
                                <h4 className="text-white font-medium">Clear Contact Universe</h4>
                                <p className="text-sm text-slate-500">Permanently delete all uploaded contacts and analysis.</p>
                            </div>
                            <button
                                onClick={() => { if (window.confirm('Are you sure you want to delete all contacts?')) onClearContacts(); }}
                                className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800 rounded text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={16} /> Delete Contacts
                            </button>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-slate-900 rounded border border-slate-700">
                            <div>
                                <h4 className="text-white font-medium">Wipe Knowledge Base</h4>
                                <p className="text-sm text-slate-500">Remove all Thesis and Context documents from memory.</p>
                            </div>
                            <button
                                onClick={() => { if (window.confirm('Are you sure you want to wipe the knowledge base?')) onClearKnowledge(); }}
                                className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800 rounded text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={16} /> Wipe Memory
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
