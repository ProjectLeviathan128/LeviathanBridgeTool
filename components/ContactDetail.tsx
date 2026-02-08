import React, { useEffect, useState } from 'react';
import { Contact, ScoreProvenance, AppSettings } from '../types';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { analyzeContactWithGemini } from '../services/geminiService';
import { assessEnrichmentQuality } from '../services/enrichmentGuards';
import { debugError, debugWarn, requestDebugPanelOpen } from '../services/debugService';
import { AlertOctagon, Brain, X, Loader2, ShieldAlert, Fingerprint, History, Info, ExternalLink, RefreshCw, Flag, Trash2, Save } from 'lucide-react';

interface ContactDetailProps {
  contact: Contact;
  onClose: () => void;
  onUpdate: (updatedContact: Contact) => void;
  onDelete: (contactId: string) => void;
  onToggleFlag: (contactId: string) => void;
  onSetLists: (contactId: string, lists: string[]) => void;
  settings: AppSettings;
}

const ContactDetail: React.FC<ContactDetailProps> = ({
  contact,
  onClose,
  onUpdate,
  onDelete,
  onToggleFlag,
  onSetLists,
  settings
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listDraft, setListDraft] = useState('');

  useEffect(() => {
    setListDraft((contact.lists || []).join(', '));
  }, [contact.id, contact.lists]);

  const handleEnrich = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeContactWithGemini(contact, settings);
      const quality = assessEnrichmentQuality(result.enrichment);
      const isPipelineError = result.enrichment.flaggedAttributes.includes('analysis_error');
      if (isPipelineError) {
        setError(result.enrichment.summary);
        debugWarn('contact.detail', 'Manual enrichment returned pipeline error.', {
          contactId: contact.id,
          name: contact.name,
          summary: result.enrichment.summary,
          flags: result.enrichment.flaggedAttributes,
        });
        requestDebugPanelOpen();
      } else {
        setError(null);
      }
      onUpdate({
        ...contact,
        status: quality.requiresReview ? 'Review Needed' : 'Enriched',
        scores: result.scores,
        enrichment: result.enrichment
      });
    } catch (err) {
      debugError('contact.detail', 'Manual enrichment request threw an exception.', {
        contactId: contact.id,
        name: contact.name,
        error: err instanceof Error ? err.message : String(err),
      });
      setError('Enrichment request crashed before completion. Check Debug panel and retry.');
      requestDebugPanelOpen();
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveLists = () => {
    const lists = listDraft
      .split(',')
      .map(list => list.trim())
      .filter(Boolean);
    onSetLists(contact.id, lists);
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete ${contact.name}? This cannot be undone.`)) return;
    onDelete(contact.id);
    onClose();
  };

  const radarData = contact.scores ? [
    { subject: 'Investor', A: contact.scores.investorFit.score, fullMark: 100 },
    { subject: 'Values', A: contact.scores.valuesAlignment.score, fullMark: 100 },
    { subject: 'Govt', A: contact.scores.govtAccess.score, fullMark: 100 },
    { subject: 'Maritime', A: contact.scores.maritimeRelevance.score, fullMark: 100 },
    { subject: 'Connector', A: contact.scores.connectorScore.score, fullMark: 100 },
  ] : [];

  const renderProvenance = (label: string, data: ScoreProvenance) => (
    <div className="bg-slate-800/50 p-3 rounded border border-slate-700 mb-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-slate-400 text-xs font-semibold uppercase">{label}</span>
        <div className="flex items-center gap-2">
          {data.missingDataPenalty && <span className="text-[10px] text-amber-500 flex items-center gap-1"><AlertOctagon size={10} /> Data Penalty</span>}
          <span className={`text-sm font-bold ${data.score > 75 ? 'text-emerald-400' : 'text-slate-300'}`}>{data.score}/100</span>
        </div>
      </div>
      <p className="text-xs text-slate-300 mb-2">{data.reasoning}</p>
      {data.contributingFactors.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.contributingFactors.map((factor, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-900 rounded text-slate-500 border border-slate-800">{factor}</span>
          ))}
        </div>
      )}
    </div>
  );

  const getHostname = (url: string) => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return 'External Link';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex justify-end">
      <div className="w-full max-w-5xl bg-slate-900 h-full border-l border-slate-700 overflow-y-auto shadow-2xl flex flex-col">

        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900 sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white font-mono">{contact.name}</h2>
              {contact.enrichment?.collisionRisk && (
                <div className="px-2 py-1 bg-red-900/30 border border-red-800 text-red-400 text-xs rounded flex items-center gap-1">
                  <Fingerprint size={12} /> Identity Collision Risk
                </div>
              )}
            </div>
            <p className="text-slate-400 mt-1">{contact.headline}</p>
            <div className="flex gap-2 mt-3 flex-wrap">
              <span className="text-xs px-2 py-1 bg-slate-800 text-slate-300 rounded border border-slate-700">
                {contact.location}
              </span>
              <span className="text-xs px-2 py-1 bg-slate-800 text-slate-300 rounded border border-slate-700 flex items-center gap-1">
                Source: {contact.source} <span className="text-slate-500">({contact.ingestionMeta.trustLevel})</span>
              </span>
              {contact.tags && contact.tags.map((tag, i) => (
                <span key={i} className="text-xs px-2 py-1 bg-indigo-900/30 text-indigo-300 rounded border border-indigo-800/50">
                  {tag}
                </span>
              ))}
              <span className={`text-xs px-2 py-1 rounded border ${contact.status === 'Enriched' ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800' :
                contact.status === 'Review Needed' ? 'bg-amber-900/30 text-amber-400 border-amber-800' :
                  'bg-slate-700 text-slate-300 border-slate-600'
                }`}>
                {contact.status}
              </span>
              {contact.teamFlagged && (
                <span className="text-xs px-2 py-1 rounded border bg-amber-900/30 text-amber-300 border-amber-700/50 uppercase tracking-wider">
                  Team Flagged
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(contact.lists || []).map(list => (
                <span
                  key={list}
                  className="text-[10px] px-2 py-1 rounded border bg-cyan-900/20 text-cyan-300 border-cyan-700/50 uppercase tracking-wider"
                >
                  {list}
                </span>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => onToggleFlag(contact.id)}
                className={`px-3 py-1.5 text-xs rounded border transition-colors inline-flex items-center gap-1.5 ${
                  contact.teamFlagged
                    ? 'text-amber-300 border-amber-700/60 bg-amber-900/20 hover:bg-amber-900/30'
                    : 'text-slate-300 border-slate-700 hover:border-amber-700/60 hover:text-amber-300'
                }`}
              >
                <Flag size={12} />
                {contact.teamFlagged ? 'Unflag' : 'Flag for Team'}
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs rounded border border-red-800/60 text-red-300 hover:bg-red-900/20 transition-colors inline-flex items-center gap-1.5"
              >
                <Trash2 size={12} />
                Delete Contact
              </button>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-8 flex-1">
          {error && (
            <div className="mb-6 p-4 bg-red-900/20 border border-red-800 text-red-200 rounded flex items-center gap-2">
              <AlertOctagon size={18} />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* Left Column: Intelligence & Scores */}
            <div className="space-y-6">
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold">Bridge Intelligence</h3>
                  <div className="flex items-center gap-4">
                    {contact.scores && (
                      <button
                        onClick={handleEnrich}
                        disabled={isAnalyzing}
                        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                        title="Force Re-Analysis"
                      >
                        {isAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        {isAnalyzing ? 'Analyzing...' : 'Re-Analyze'}
                      </button>
                    )}
                    {contact.enrichment && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Fingerprint size={14} />
                        Identity Confidence: <span className={contact.enrichment.identityConfidence < 80 ? 'text-amber-400' : 'text-emerald-400'}>{contact.enrichment.identityConfidence}%</span>
                      </div>
                    )}
                  </div>
                </div>

                {contact.scores ? (
                  <>
                    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 mb-6">
                      <div className="h-64 relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                            <PolarGrid stroke="#334155" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            <Radar name={contact.name} dataKey="A" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                          </RadarChart>
                        </ResponsiveContainer>
                        <div className="absolute top-0 right-0 p-2 bg-slate-900/80 rounded text-xs text-slate-400 border border-slate-700">
                          Overall Confidence: <span className="text-white font-bold">{contact.scores.overallConfidence}%</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {renderProvenance('Investor Fit', contact.scores.investorFit)}
                      {renderProvenance('Values Alignment', contact.scores.valuesAlignment)}
                      {renderProvenance('Government Access', contact.scores.govtAccess)}
                      {renderProvenance('Maritime Relevance', contact.scores.maritimeRelevance)}
                      {renderProvenance('Connector Potential', contact.scores.connectorScore)}
                    </div>
                  </>
                ) : (
                  <div className="bg-slate-800/50 rounded-lg p-8 border border-slate-700 border-dashed text-center">
                    <Brain className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 mb-4">No intelligence generated yet.</p>
                    <button
                      onClick={handleEnrich}
                      disabled={isAnalyzing}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 mx-auto disabled:opacity-50"
                    >
                      {isAnalyzing ? <Loader2 className="animate-spin" /> : 'Run Bridge Analysis'}
                    </button>
                    <p className="text-[10px] text-slate-600 mt-4">
                      Running on {settings.analysisModel === 'fast' ? 'Flash (Fast)' : 'Pro (Deep)'} Mode
                    </p>
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-2">
                    <History size={14} /> Contact Card & Notes
                  </h3>
                </div>

                <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                  {(() => {
                    let parsedData: Record<string, any> = {};
                    let isJson = false;

                    try {
                      if (contact.rawText && (contact.rawText.startsWith('{') || contact.rawText.startsWith('['))) {
                        parsedData = JSON.parse(contact.rawText);
                        isJson = true;
                      }
                    } catch (e) {
                      isJson = false;
                    }

                    if (isJson && Object.keys(parsedData).length > 0) {
                      // Filter out keys we already show in the header or are internal
                      const explicitlyExcluded = ['id', 'status', 'scores', 'enrichment', 'ingestionMeta', 'name', 'headline', 'location', 'source', 'firstName', 'lastName'];

                      const entries = Object.entries(parsedData)
                        .filter(([key, value]) =>
                          !explicitlyExcluded.includes(key) &&
                          value !== null &&
                          value !== undefined &&
                          value !== '' &&
                          typeof value !== 'object' // Skip nested objects for now to keep it clean
                        );

                      if (entries.length === 0) {
                        return (
                          <div className="p-4 text-slate-500 text-sm italic text-center">
                            No additional details found.
                          </div>
                        );
                      }

                      return (
                        <div className="divide-y divide-slate-700/50">
                          {entries.map(([key, value]) => (
                            <div key={key} className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-3 hover:bg-slate-700/30 transition-colors gap-1">
                              <span className="text-xs text-slate-400 uppercase font-medium tracking-wide">
                                {key.replace(/([A-Z])/g, ' $1').trim()}
                              </span>
                              <span className="text-sm text-slate-200 font-mono text-right break-all">
                                {String(value).startsWith('http') ? (
                                  <a href={String(value)} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline flex items-center gap-1 justify-end">
                                    {getHostname(String(value))} <ExternalLink size={10} />
                                  </a>
                                ) : (
                                  String(value)
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    } else {
                      // Fallback for plain text notes
                      return (
                        <div className="p-4 text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-mono">
                          {contact.rawText || "No context available."}
                        </div>
                      );
                    }
                  })()}
                </div>
              </section>
            </div>

            {/* Right Column: Strategic Outcomes */}
            <div className="space-y-6">
              <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
                <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <Flag className="text-amber-400" size={16} />
                  Team Collaboration
                </h4>
                <p className="text-xs text-slate-400 mb-3">
                  Use shared flags and lists so your cofounder sees priority changes immediately.
                </p>
                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-wider text-slate-500">Lists (comma separated)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={listDraft}
                      onChange={(e) => setListDraft(e.target.value)}
                      placeholder="e.g. q1-targets, warm-intros"
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveLists}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium inline-flex items-center gap-1"
                    >
                      <Save size={12} />
                      Save
                    </button>
                  </div>
                </div>
              </div>

              {contact.enrichment ? (
                <>
                  <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
                    <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                      <ShieldAlert className="text-blue-400" size={18} />
                      Bridge Summary
                    </h4>
                    <p className="text-slate-300 text-sm leading-relaxed">{contact.enrichment.summary}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                      <h5 className="text-slate-400 text-xs uppercase mb-2">Recommended Track</h5>
                      <div className="flex flex-wrap gap-2">
                        {contact.enrichment.tracks.length > 0 ? (
                          contact.enrichment.tracks.map(t => (
                            <span key={t} className="px-2 py-1 bg-indigo-900/40 text-indigo-300 border border-indigo-700/50 rounded text-xs">
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500 text-xs">No fit found</span>
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                      <h5 className="text-slate-400 text-xs uppercase mb-2">Next Action</h5>
                      <p className="text-white font-medium text-sm">{contact.enrichment.recommendedAction}</p>
                    </div>
                  </div>

                  {contact.enrichment.alignmentRisks.length > 0 && (
                    <div className="bg-red-900/10 border border-red-900/50 p-4 rounded-lg">
                      <h5 className="text-red-400 text-xs uppercase mb-2 font-bold flex items-center gap-2">
                        <AlertOctagon size={14} /> Alignment Risks
                      </h5>
                      <ul className="list-disc list-inside text-red-200/80 text-sm space-y-1">
                        {contact.enrichment.alignmentRisks.map((risk, i) => (
                          <li key={i}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <h5 className="text-slate-500 text-xs uppercase mb-2">Strategic Angle</h5>
                    <p className="text-slate-300 text-sm italic border-l-2 border-blue-500 pl-3">
                      "{contact.enrichment.recommendedAngle}"
                    </p>
                  </div>

                  <div>
                    <h5 className="text-slate-500 text-xs uppercase mb-3 flex items-center justify-between">
                      Evidence & Sources
                      <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded border border-slate-700 text-slate-400">
                        {contact.enrichment.evidenceLinks.length} found
                      </span>
                    </h5>
                    <div className="space-y-3">
                      {contact.enrichment.evidenceLinks.length > 0 ? contact.enrichment.evidenceLinks.map((ev, i) => (
                        <div key={i} className="bg-slate-900/80 p-3 rounded border border-slate-800 text-sm hover:border-blue-900/50 transition-colors group">
                          <p className="text-slate-300 mb-2 leading-snug">"{ev.claim}"</p>
                          <div className="flex items-center justify-between">
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-2 px-3 py-1.5 bg-blue-900/20 text-blue-400 hover:bg-blue-900/40 hover:text-blue-300 rounded text-xs font-medium transition-all"
                            >
                              <ExternalLink size={12} />
                              {getHostname(ev.url)}
                            </a>
                            <span className={`text-[10px] px-2 py-0.5 rounded ${ev.confidence > 80 ? 'bg-emerald-900/20 text-emerald-500' : 'bg-slate-800 text-slate-500'}`}>
                              {ev.confidence}% Conf
                            </span>
                          </div>
                        </div>
                      )) : <div className="text-slate-600 text-xs italic text-center py-4 border border-slate-800 rounded border-dashed">No external evidence found.</div>}
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4">
                  <Info size={48} className="opacity-20" />
                  <p className="text-sm italic">Run analysis to generate strategic routing and risk assessment.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactDetail;
