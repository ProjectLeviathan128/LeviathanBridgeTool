import React, { useState } from 'react';
import { AppSettings, OutreachChannel, OutreachSenderId, StrategicFocus } from '../types';
import {
    BarChart3,
    Bot,
    BrainCircuit,
    Briefcase,
    Cloud,
    Clock3,
    Download,
    Landmark,
    MessageSquareText,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldAlert,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    Target,
    Trash2,
    Upload,
    type LucideIcon,
} from 'lucide-react';
import { exportAllData, importAllData, saveToCloud, loadFromCloud, loadSyncState } from '../services/storageService';
import { createDefaultSettings } from '../services/settingsService';

interface SettingsProps {
    settings: AppSettings;
    onUpdateSettings: (newSettings: AppSettings) => void;
    onClearContacts: () => void;
    onClearKnowledge: () => void;
}

type SettingsSectionKey = 'analysis' | 'chat' | 'outreach' | 'dashboard' | 'automation' | 'sync';

const focusModes: {
    id: StrategicFocus;
    label: string;
    desc: string;
    icon: LucideIcon;
    selectedClass: string;
    iconClass: string;
    dotClass: string;
}[] = [
    {
        id: 'BALANCED',
        label: 'Balanced Strategy',
        desc: 'Standard evaluation. Weigh commercial potential and values alignment equally.',
        icon: Target,
        selectedClass: 'border-blue-500 bg-blue-900/20',
        iconClass: 'text-blue-400',
        dotClass: 'bg-blue-500',
    },
    {
        id: 'GATEKEEPER',
        label: 'The Gatekeeper',
        desc: 'Strict values enforcement. Prioritize reputational safety over deal velocity.',
        icon: ShieldCheck,
        selectedClass: 'border-emerald-500 bg-emerald-900/20',
        iconClass: 'text-emerald-400',
        dotClass: 'bg-emerald-500',
    },
    {
        id: 'DEAL_HUNTER',
        label: 'The Deal Hunter',
        desc: 'Commercial aggression. Prioritize investor fit and connector potential.',
        icon: Briefcase,
        selectedClass: 'border-amber-500 bg-amber-900/20',
        iconClass: 'text-amber-400',
        dotClass: 'bg-amber-500',
    },
    {
        id: 'GOVT_INTEL',
        label: 'Government Intel',
        desc: 'Bias toward public-sector access, policy influence, and maritime regulation.',
        icon: Landmark,
        selectedClass: 'border-purple-500 bg-purple-900/20',
        iconClass: 'text-purple-400',
        dotClass: 'bg-purple-500',
    },
];

function SettingsCard(props: {
    title: string;
    description?: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700 bg-slate-900/50 flex items-center gap-2">
                {props.icon}
                <h3 className="font-semibold text-white">{props.title}</h3>
            </div>
            <div className="p-6 space-y-4">
                {props.description && <p className="text-sm text-slate-400">{props.description}</p>}
                {props.children}
            </div>
        </div>
    );
}

const Settings: React.FC<SettingsProps> = ({ settings, onUpdateSettings, onClearContacts, onClearKnowledge }) => {
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const syncState = loadSyncState();

    const updateRoot = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        onUpdateSettings({
            ...settings,
            [key]: value
        });
    };

    const updateSection = <S extends SettingsSectionKey, K extends keyof AppSettings[S]>(
        section: S,
        key: K,
        value: AppSettings[S][K]
    ) => {
        onUpdateSettings({
            ...settings,
            [section]: {
                ...settings[section],
                [key]: value
            }
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
                setImportStatus('Import successful. Refreshing now...');
                setTimeout(() => window.location.reload(), 1200);
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
            setTimeout(() => setSyncStatus('idle'), 2500);
        } catch {
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 2500);
        }
    };

    const handlePullFromCloud = async () => {
        if (settings.sync.confirmBeforePull) {
            const confirmed = window.confirm('Pulling from cloud may overwrite your local state. Continue?');
            if (!confirmed) return;
        }

        setSyncStatus('syncing');
        try {
            await loadFromCloud();
            setSyncStatus('success');
            setImportStatus('Cloud data loaded. Refreshing now...');
            setTimeout(() => window.location.reload(), 1200);
        } catch {
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 2500);
        }
    };

    const handleResetSettings = () => {
        if (!window.confirm('Reset all settings to defaults?')) return;
        onUpdateSettings(createDefaultSettings());
        setImportStatus('Settings reset to defaults.');
    };

    const modelLabel = settings.analysisModel === 'fast' ? 'Gemini Flash' : 'Gemini Pro';

    return (
        <div className="max-w-6xl mx-auto pb-12">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-white mb-2">System Configuration</h2>
                    <p className="text-slate-400">Expanded controls for intelligence, outreach, automation, and data workflows.</p>
                </div>
                <button
                    onClick={handleResetSettings}
                    className="px-3 py-2 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5"
                >
                    <RotateCcw size={14} />
                    Reset Defaults
                </button>
            </div>

            {importStatus && (
                <div className={`mb-6 p-3 rounded-lg text-sm ${importStatus.includes('failed') ? 'bg-red-900/30 text-red-300' : 'bg-emerald-900/30 text-emerald-300'}`}>
                    {importStatus}
                </div>
            )}

            <div className="space-y-8">
                <SettingsCard
                    title="Intelligence Engine"
                    description="Control strategy posture and model depth."
                    icon={<BrainCircuit className="text-emerald-400" size={20} />}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {focusModes.map((mode) => {
                            const Icon = mode.icon;
                            const isSelected = settings.focusMode === mode.id;
                            return (
                                <button
                                    key={mode.id}
                                    onClick={() => updateRoot('focusMode', mode.id)}
                                    className={`text-left p-4 rounded-lg border-2 transition-all ${isSelected
                                        ? mode.selectedClass
                                        : 'border-slate-700 bg-slate-900 hover:border-slate-600'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2 font-bold text-white">
                                            <Icon size={18} className={mode.iconClass} />
                                            <span>{mode.label}</span>
                                        </div>
                                        {isSelected && <span className={`w-3 h-3 rounded-full ${mode.dotClass}`} />}
                                    </div>
                                    <p className="text-xs text-slate-400">{mode.desc}</p>
                                </button>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        <button
                            onClick={() => updateRoot('analysisModel', 'fast')}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${settings.analysisModel === 'fast'
                                ? 'border-blue-500 bg-blue-900/20'
                                : 'border-slate-700 bg-slate-900 hover:border-slate-600'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-white">Fast Scan (Flash)</span>
                                {settings.analysisModel === 'fast' && <span className="w-3 h-3 bg-blue-500 rounded-full" />}
                            </div>
                            <p className="text-xs text-slate-400">Lower latency, useful for high-volume triage.</p>
                        </button>
                        <button
                            onClick={() => updateRoot('analysisModel', 'quality')}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${settings.analysisModel === 'quality'
                                ? 'border-emerald-500 bg-emerald-900/20'
                                : 'border-slate-700 bg-slate-900 hover:border-slate-600'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-white">Deep Dive (Pro)</span>
                                {settings.analysisModel === 'quality' && <span className="w-3 h-3 bg-emerald-500 rounded-full" />}
                            </div>
                            <p className="text-xs text-slate-400">Higher-confidence reasoning and evidence handling.</p>
                        </button>
                    </div>
                    <p className="text-xs text-slate-500">Current analysis runtime: {modelLabel}</p>
                </SettingsCard>

                <SettingsCard
                    title="Evidence Guardrails"
                    description="Tune how strict Bridge is before accepting enrichment."
                    icon={<ShieldCheck className="text-blue-400" size={20} />}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Min Evidence Links</span>
                                <span className="text-blue-300 font-mono">{settings.analysis.minEvidenceLinks}</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="6"
                                step="1"
                                value={settings.analysis.minEvidenceLinks}
                                onChange={(event) => updateSection('analysis', 'minEvidenceLinks', parseInt(event.target.value, 10))}
                                className="w-full accent-blue-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Max Evidence Links</span>
                                <span className="text-blue-300 font-mono">{settings.analysis.maxEvidenceLinks}</span>
                            </div>
                            <input
                                type="range"
                                min={settings.analysis.minEvidenceLinks}
                                max="12"
                                step="1"
                                value={settings.analysis.maxEvidenceLinks}
                                onChange={(event) => updateSection('analysis', 'maxEvidenceLinks', parseInt(event.target.value, 10))}
                                className="w-full accent-blue-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Min Distinct Domains</span>
                                <span className="text-blue-300 font-mono">{settings.analysis.minDistinctDomains}</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="4"
                                step="1"
                                value={settings.analysis.minDistinctDomains}
                                onChange={(event) => updateSection('analysis', 'minDistinctDomains', parseInt(event.target.value, 10))}
                                className="w-full accent-blue-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Min Identity Confidence</span>
                                <span className="text-blue-300 font-mono">{settings.analysis.minIdentityConfidence}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={settings.analysis.minIdentityConfidence}
                                onChange={(event) => updateSection('analysis', 'minIdentityConfidence', parseInt(event.target.value, 10))}
                                className="w-full accent-blue-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>High Priority Score Threshold</span>
                                <span className="text-blue-300 font-mono">{settings.analysis.highPriorityScoreThreshold}</span>
                            </div>
                            <input
                                type="range"
                                min="40"
                                max="100"
                                step="5"
                                value={settings.analysis.highPriorityScoreThreshold}
                                onChange={(event) => updateSection('analysis', 'highPriorityScoreThreshold', parseInt(event.target.value, 10))}
                                className="w-full accent-blue-500"
                            />
                        </label>
                    </div>

                    <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2">
                        <span className="text-sm text-slate-300">Require at least one non-LinkedIn source</span>
                        <input
                            type="checkbox"
                            checked={settings.analysis.requireNonLinkedInSource}
                            onChange={(event) => updateSection('analysis', 'requireNonLinkedInSource', event.target.checked)}
                            className="accent-blue-500"
                        />
                    </label>
                </SettingsCard>

                <SettingsCard
                    title="Chat & Enrichment Ops"
                    description="Adjust search depth and enrichment throughput."
                    icon={<Bot className="text-emerald-400" size={20} />}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-slate-300">
                                <span className="inline-flex items-center gap-1"><Search size={12} /> Search Result Limit</span>
                                <span className="text-emerald-300 font-mono">{settings.chat.searchResultLimit}</span>
                            </div>
                            <input
                                type="range"
                                min="5"
                                max="100"
                                step="5"
                                value={settings.chat.searchResultLimit}
                                onChange={(event) => updateSection('chat', 'searchResultLimit', parseInt(event.target.value, 10))}
                                className="w-full accent-emerald-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-slate-300">
                                <span>Search Notes Snippet Length</span>
                                <span className="text-emerald-300 font-mono">{settings.chat.searchSnippetLength}</span>
                            </div>
                            <input
                                type="range"
                                min="80"
                                max="1200"
                                step="20"
                                value={settings.chat.searchSnippetLength}
                                onChange={(event) => updateSection('chat', 'searchSnippetLength', parseInt(event.target.value, 10))}
                                className="w-full accent-emerald-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-slate-300">
                                <span>Enrichment Batch Size</span>
                                <span className="text-emerald-300 font-mono">{settings.chat.enrichmentBatchSize}</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="10"
                                step="1"
                                value={settings.chat.enrichmentBatchSize}
                                onChange={(event) => updateSection('chat', 'enrichmentBatchSize', parseInt(event.target.value, 10))}
                                className="w-full accent-emerald-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-slate-300">
                                <span className="inline-flex items-center gap-1"><Clock3 size={12} /> Delay Between Enrich Calls (ms)</span>
                                <span className="text-emerald-300 font-mono">{settings.chat.enrichmentDelayMs}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="5000"
                                step="100"
                                value={settings.chat.enrichmentDelayMs}
                                onChange={(event) => updateSection('chat', 'enrichmentDelayMs', parseInt(event.target.value, 10))}
                                className="w-full accent-emerald-500"
                            />
                        </label>
                    </div>

                    <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2">
                        <span className="text-sm text-slate-300">Show grounding source links in chat replies</span>
                        <input
                            type="checkbox"
                            checked={settings.chat.showGroundingSources}
                            onChange={(event) => updateSection('chat', 'showGroundingSources', event.target.checked)}
                            className="accent-emerald-500"
                        />
                    </label>
                </SettingsCard>

                <SettingsCard
                    title="Outreach Defaults"
                    description="Set generation defaults for contact follow-up drafts."
                    icon={<Sparkles className="text-cyan-400" size={20} />}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-[11px] uppercase tracking-wider text-slate-500">Default Sender</label>
                            <select
                                value={settings.outreach.defaultSender}
                                onChange={(event) => updateSection('outreach', 'defaultSender', event.target.value as OutreachSenderId)}
                                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                            >
                                <option value="nathan">Nathan Krajewski (Founder)</option>
                                <option value="matthew">Matthew Fortes (CoFounder)</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[11px] uppercase tracking-wider text-slate-500">Default Channel</label>
                            <div className="mt-1 grid grid-cols-2 gap-2">
                                {(['linkedin', 'email'] as OutreachChannel[]).map((channel) => (
                                    <button
                                        key={channel}
                                        type="button"
                                        onClick={() => updateSection('outreach', 'defaultChannel', channel)}
                                        className={`px-3 py-2 rounded border text-xs inline-flex items-center justify-center gap-1 ${
                                            settings.outreach.defaultChannel === channel
                                                ? 'bg-blue-600 border-blue-500 text-white'
                                                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                                        }`}
                                    >
                                        <MessageSquareText size={12} />
                                        {channel === 'linkedin' ? 'LinkedIn' : 'Email'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Max Drafts Per Contact</span>
                                <span className="text-cyan-300 font-mono">{settings.outreach.maxDraftsPerContact}</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="20"
                                step="1"
                                value={settings.outreach.maxDraftsPerContact}
                                onChange={(event) => updateSection('outreach', 'maxDraftsPerContact', parseInt(event.target.value, 10))}
                                className="w-full accent-cyan-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>LinkedIn Character Limit</span>
                                <span className="text-cyan-300 font-mono">{settings.outreach.linkedInCharacterLimit}</span>
                            </div>
                            <input
                                type="range"
                                min="120"
                                max="1200"
                                step="10"
                                value={settings.outreach.linkedInCharacterLimit}
                                onChange={(event) => updateSection('outreach', 'linkedInCharacterLimit', parseInt(event.target.value, 10))}
                                className="w-full accent-cyan-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Email Subject Max Length</span>
                                <span className="text-cyan-300 font-mono">{settings.outreach.emailSubjectMaxLength}</span>
                            </div>
                            <input
                                type="range"
                                min="30"
                                max="140"
                                step="5"
                                value={settings.outreach.emailSubjectMaxLength}
                                onChange={(event) => updateSection('outreach', 'emailSubjectMaxLength', parseInt(event.target.value, 10))}
                                className="w-full accent-cyan-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Generation Temperature</span>
                                <span className="text-cyan-300 font-mono">{settings.outreach.modelTemperature.toFixed(2)}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={settings.outreach.modelTemperature}
                                onChange={(event) => updateSection('outreach', 'modelTemperature', parseFloat(event.target.value))}
                                className="w-full accent-cyan-500"
                            />
                        </label>
                    </div>
                </SettingsCard>

                <SettingsCard
                    title="Dashboard Thresholds"
                    description="Tune queue sizes and scoring cutoffs used in dashboard views."
                    icon={<BarChart3 className="text-amber-400" size={20} />}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Priority Queue Size</span>
                                <span className="text-amber-300 font-mono">{settings.dashboard.priorityQueueSize}</span>
                            </div>
                            <input
                                type="range"
                                min="3"
                                max="20"
                                step="1"
                                value={settings.dashboard.priorityQueueSize}
                                onChange={(event) => updateSection('dashboard', 'priorityQueueSize', parseInt(event.target.value, 10))}
                                className="w-full accent-amber-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Risk Queue Size</span>
                                <span className="text-amber-300 font-mono">{settings.dashboard.riskQueueSize}</span>
                            </div>
                            <input
                                type="range"
                                min="3"
                                max="20"
                                step="1"
                                value={settings.dashboard.riskQueueSize}
                                onChange={(event) => updateSection('dashboard', 'riskQueueSize', parseInt(event.target.value, 10))}
                                className="w-full accent-amber-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Investor Fit Min</span>
                                <span className="text-amber-300 font-mono">{settings.dashboard.highValueInvestorMin}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={settings.dashboard.highValueInvestorMin}
                                onChange={(event) => updateSection('dashboard', 'highValueInvestorMin', parseInt(event.target.value, 10))}
                                className="w-full accent-amber-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Values Alignment Min</span>
                                <span className="text-amber-300 font-mono">{settings.dashboard.highValueValuesMin}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={settings.dashboard.highValueValuesMin}
                                onChange={(event) => updateSection('dashboard', 'highValueValuesMin', parseInt(event.target.value, 10))}
                                className="w-full accent-amber-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Connector Score Min</span>
                                <span className="text-amber-300 font-mono">{settings.dashboard.highValueConnectorMin}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={settings.dashboard.highValueConnectorMin}
                                onChange={(event) => updateSection('dashboard', 'highValueConnectorMin', parseInt(event.target.value, 10))}
                                className="w-full accent-amber-500"
                            />
                        </label>

                        <label className="space-y-2">
                            <div className="flex justify-between text-xs text-slate-300">
                                <span>Low Confidence Threshold</span>
                                <span className="text-amber-300 font-mono">{settings.dashboard.riskLowConfidenceThreshold}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={settings.dashboard.riskLowConfidenceThreshold}
                                onChange={(event) => updateSection('dashboard', 'riskLowConfidenceThreshold', parseInt(event.target.value, 10))}
                                className="w-full accent-amber-500"
                            />
                        </label>
                    </div>
                </SettingsCard>

                <SettingsCard
                    title="Automation & Sync Behavior"
                    description="Control operational defaults for ingestion, debugging, and sync safety."
                    icon={<SlidersHorizontal className="text-purple-400" size={20} />}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2">
                            <span className="text-sm text-slate-300">Auto-switch to Contacts after ingestion</span>
                            <input
                                type="checkbox"
                                checked={settings.automation.autoSwitchToContactsOnIngest}
                                onChange={(event) => updateSection('automation', 'autoSwitchToContactsOnIngest', event.target.checked)}
                                className="accent-purple-500"
                            />
                        </label>

                        <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2">
                            <span className="text-sm text-slate-300">Auto-sync local changes to cloud</span>
                            <input
                                type="checkbox"
                                checked={settings.automation.autoSyncToCloud}
                                onChange={(event) => updateSection('automation', 'autoSyncToCloud', event.target.checked)}
                                className="accent-purple-500"
                            />
                        </label>

                        <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2">
                            <span className="text-sm text-slate-300">Auto-open debug panel on failures</span>
                            <input
                                type="checkbox"
                                checked={settings.automation.autoOpenDebugOnFailure}
                                onChange={(event) => updateSection('automation', 'autoOpenDebugOnFailure', event.target.checked)}
                                className="accent-purple-500"
                            />
                        </label>

                        <label className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 px-3 py-2">
                            <span className="text-sm text-slate-300">Confirm before pull from cloud</span>
                            <input
                                type="checkbox"
                                checked={settings.sync.confirmBeforePull}
                                onChange={(event) => updateSection('sync', 'confirmBeforePull', event.target.checked)}
                                className="accent-purple-500"
                            />
                        </label>
                    </div>
                </SettingsCard>

                <SettingsCard
                    title="Data & Sync"
                    description="Manual data controls and backup workflows."
                    icon={<Cloud className="text-blue-400" size={20} />}
                >
                    {syncState.lastSyncedAt && (
                        <p className="text-sm text-slate-400">
                            Last synced: {new Date(syncState.lastSyncedAt).toLocaleString()}
                        </p>
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
                </SettingsCard>

                <SettingsCard
                    title="Danger Zone"
                    icon={<ShieldAlert className="text-red-400" size={20} />}
                >
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-slate-900 rounded border border-slate-700 gap-3">
                            <div>
                                <h4 className="text-white font-medium">Clear Contact Universe</h4>
                                <p className="text-sm text-slate-500">Delete all contacts and enrichment state.</p>
                            </div>
                            <button
                                onClick={() => {
                                    if (window.confirm('Delete all contacts permanently?')) onClearContacts();
                                }}
                                className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800 rounded text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={16} />
                                Delete Contacts
                            </button>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-slate-900 rounded border border-slate-700 gap-3">
                            <div>
                                <h4 className="text-white font-medium">Wipe Knowledge Base</h4>
                                <p className="text-sm text-slate-500">Remove thesis and strategic context memory.</p>
                            </div>
                            <button
                                onClick={() => {
                                    if (window.confirm('Wipe thesis/context memory permanently?')) onClearKnowledge();
                                }}
                                className="px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800 rounded text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <Trash2 size={16} />
                                Wipe Memory
                            </button>
                        </div>
                    </div>
                </SettingsCard>
            </div>
        </div>
    );
};

export default Settings;
