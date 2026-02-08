import React, { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
} from 'recharts';
import { Contact } from '../types';
import {
  Activity,
  AlertTriangle,
  Clock3,
  Compass,
  Flag,
  Fingerprint,
  Hourglass,
  Link2,
  MousePointer2,
  ShieldCheck,
  Target,
  Trash2,
  TrendingUp,
  Users,
} from 'lucide-react';

interface DashboardProps {
  contacts: Contact[];
  onSelectContact?: (contactId: string) => void;
  onDeleteContact?: (contactId: string) => void;
  onToggleFlag?: (contactId: string) => void;
}

interface ScatterPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  confidence: number;
  track: string;
  status: Contact['status'];
  teamFlagged: boolean;
}

interface PriorityItem {
  id: string;
  name: string;
  score: number;
  confidence: number;
  track: string;
  action: string;
  teamFlagged: boolean;
}

interface RiskItem {
  id: string;
  name: string;
  severity: number;
  reason: string;
  teamFlagged: boolean;
}

interface DomainCount {
  domain: string;
  count: number;
}

const TRACK_COLORS: Record<string, string> = {
  Investment: '#10b981',
  Government: '#3b82f6',
  'Strategic Partner': '#06b6d4',
  'Multi-Track': '#8b5cf6',
  Pending: '#f59e0b',
  'No Fit': '#64748b',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPercent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function bucketTrack(contact: Contact): string {
  if (contact.status === 'New') return 'Pending';
  if (contact.status === 'Discarded') return 'No Fit';
  const tracks = contact.enrichment?.tracks || [];
  if (tracks.length === 0) return 'No Fit';
  if (tracks.length > 1) return 'Multi-Track';
  return tracks[0];
}

function formatWhen(iso?: string): string {
  if (!iso) return 'N/A';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'N/A';
  return new Date(parsed).toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

const Dashboard: React.FC<DashboardProps> = ({
  contacts,
  onSelectContact,
  onDeleteContact,
  onToggleFlag,
}) => {
  const data = useMemo(() => {
    const total = contacts.length;
    const pendingCount = contacts.filter((c) => c.status === 'New').length;
    const enrichedCount = contacts.filter((c) => c.status === 'Enriched').length;
    const reviewCount = contacts.filter((c) => c.status === 'Review Needed').length;
    const discardedCount = contacts.filter((c) => c.status === 'Discarded').length;
    const processedCount = total - pendingCount;

    const scoredContacts = contacts.filter((c) => Boolean(c.scores));
    const avgConfidence = scoredContacts.length
      ? Math.round(
        scoredContacts.reduce((sum, c) => sum + (c.scores?.overallConfidence || 0), 0) /
        scoredContacts.length
      )
      : 0;

    const evidenceRichCount = contacts.filter(
      (c) => (c.enrichment?.evidenceLinks.length || 0) >= 2
    ).length;
    const evidenceCoveragePct = toPercent(evidenceRichCount, processedCount);

    const highValueContacts = contacts.filter((c) => {
      if (!c.scores || !c.enrichment) return false;
      const investor = c.scores.investorFit.score >= 80;
      const values = c.scores.valuesAlignment.score >= 70;
      const connector = c.scores.connectorScore.score >= 75;
      return (investor && values) || connector;
    });

    const trackCounter = new Map<string, number>();
    contacts.forEach((contact) => {
      const bucket = bucketTrack(contact);
      trackCounter.set(bucket, (trackCounter.get(bucket) || 0) + 1);
    });
    const trackDistribution = Array.from(trackCounter.entries()).map(([name, value]) => ({
      name,
      value,
      color: TRACK_COLORS[name] || '#64748b',
    }));

    const scatterData: ScatterPoint[] = contacts
      .filter((c): c is Contact & { scores: NonNullable<Contact['scores']> } => Boolean(c.scores))
      .map((c) => ({
        id: c.id,
        name: c.name,
        x: c.scores.investorFit.score,
        y: c.scores.valuesAlignment.score,
        z: Math.max(60, c.scores.overallConfidence * 3),
        confidence: c.scores.overallConfidence,
        track: bucketTrack(c),
        status: c.status,
        teamFlagged: Boolean(c.teamFlagged),
      }));

    const confidenceBands = [
      { name: '0-40', count: 0 },
      { name: '41-60', count: 0 },
      { name: '61-80', count: 0 },
      { name: '81-100', count: 0 },
    ];
    scoredContacts.forEach((contact) => {
      const conf = contact.scores?.overallConfidence || 0;
      if (conf <= 40) confidenceBands[0].count += 1;
      else if (conf <= 60) confidenceBands[1].count += 1;
      else if (conf <= 80) confidenceBands[2].count += 1;
      else confidenceBands[3].count += 1;
    });

    const statusBars = [
      { name: 'New', count: pendingCount, color: '#3b82f6' },
      { name: 'Enriched', count: enrichedCount, color: '#10b981' },
      { name: 'Review', count: reviewCount, color: '#f59e0b' },
      { name: 'Discarded', count: discardedCount, color: '#64748b' },
    ];

    const sourceBars = [
      {
        name: 'Manual',
        count: contacts.filter((c) => c.ingestionMeta.trustLevel === 'Manual').length,
      },
      {
        name: 'Scraped',
        count: contacts.filter((c) => c.ingestionMeta.trustLevel === 'Scraped').length,
      },
      {
        name: 'Third-Party',
        count: contacts.filter((c) => c.ingestionMeta.trustLevel === 'Third-Party').length,
      },
    ];

    const priorityQueue: PriorityItem[] = contacts
      .filter(
        (c): c is Contact & { scores: NonNullable<Contact['scores']>; enrichment: NonNullable<Contact['enrichment']> } =>
          Boolean(c.scores) && Boolean(c.enrichment) && c.status !== 'Discarded'
      )
      .map((c) => {
        const weighted = Math.round(
          c.scores.investorFit.score * 0.3 +
          c.scores.valuesAlignment.score * 0.25 +
          c.scores.connectorScore.score * 0.15 +
          c.scores.maritimeRelevance.score * 0.15 +
          c.scores.govtAccess.score * 0.05 +
          c.scores.overallConfidence * 0.1
        );
        const penalty =
          (c.status === 'Review Needed' ? 10 : 0) +
          (c.enrichment.collisionRisk ? 12 : 0);
        const score = clamp(weighted - penalty, 0, 100);
        return {
          id: c.id,
          name: c.name,
          score,
          confidence: c.scores.overallConfidence,
          track: bucketTrack(c),
          action: c.enrichment.recommendedAction,
          teamFlagged: Boolean(c.teamFlagged),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const riskQueue: RiskItem[] = contacts
      .filter((c) => {
        const lowConfidence = (c.scores?.overallConfidence || 100) < 60;
        const collision = c.enrichment?.collisionRisk || false;
        return c.status === 'Review Needed' || lowConfidence || collision;
      })
      .map((c) => {
        const collision = c.enrichment?.collisionRisk || false;
        const confidence = c.scores?.overallConfidence || 100;
        const lowEvidence = (c.enrichment?.evidenceLinks.length || 0) < 2;

        let severity = 0;
        if (collision) severity += 4;
        if (c.status === 'Review Needed') severity += 3;
        if (confidence < 60) severity += 2;
        if (lowEvidence) severity += 1;

        const reason =
          c.enrichment?.alignmentRisks[0] ||
          (collision
            ? 'Potential identity collision risk.'
            : confidence < 60
              ? 'Low confidence analysis.'
              : 'Needs manual review.');

        return {
          id: c.id,
          name: c.name,
          severity,
          reason,
          teamFlagged: Boolean(c.teamFlagged),
        };
      })
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 8);

    const domainMap = new Map<string, number>();
    contacts.forEach((contact) => {
      contact.enrichment?.evidenceLinks.forEach((evidence) => {
        const domain = hostnameFromUrl(evidence.url);
        if (!domain) return;
        domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
      });
    });
    const topDomains: DomainCount[] = Array.from(domainMap.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const avgEvidencePerAnalyzed = processedCount
      ? Math.round(
        contacts.reduce((sum, c) => sum + (c.enrichment?.evidenceLinks.length || 0), 0) /
        processedCount
      )
      : 0;

    const latestVerified = contacts
      .filter((c) => Boolean(c.enrichment?.lastVerified))
      .sort((a, b) => {
        const aTime = Date.parse(a.enrichment?.lastVerified || '');
        const bTime = Date.parse(b.enrichment?.lastVerified || '');
        return bTime - aTime;
      })
      .slice(0, 5)
      .map((contact) => ({
        id: contact.id,
        name: contact.name,
        when: formatWhen(contact.enrichment?.lastVerified),
        teamFlagged: Boolean(contact.teamFlagged),
      }));

    const pipelineHealth = clamp(
      Math.round(
        toPercent(processedCount, total) * 0.45 +
        avgConfidence * 0.45 -
        toPercent(reviewCount, total) * 0.2
      ),
      0,
      100
    );

    return {
      total,
      pendingCount,
      enrichedCount,
      reviewCount,
      discardedCount,
      processedCount,
      avgConfidence,
      evidenceCoveragePct,
      highValueCount: highValueContacts.length,
      pipelineHealth,
      trackDistribution,
      scatterData,
      confidenceBands,
      statusBars,
      sourceBars,
      priorityQueue,
      riskQueue,
      topDomains,
      uniqueDomainCount: domainMap.size,
      avgEvidencePerAnalyzed,
      latestVerified,
    };
  }, [contacts]);

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[34rem] text-slate-500">
        <Activity className="w-16 h-16 mb-4 opacity-25" />
        <h3 className="text-2xl font-semibold text-slate-200">Mission Control Ready</h3>
        <p className="text-sm text-slate-400 mt-2">Ingest contacts to activate live pipeline intelligence.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <section className="bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950 border border-slate-700 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Operator Cockpit</p>
            <h3 className="text-2xl font-bold text-white mt-1">Leviathan Pipeline Health</h3>
            <p className="text-sm text-slate-300 mt-2">
              {data.processedCount} of {data.total} contacts processed. {data.highValueCount} high-conviction targets identified.
            </p>
          </div>
          <div className="min-w-[240px]">
            <div className="flex items-end justify-between mb-2">
              <span className="text-xs uppercase tracking-widest text-slate-400">Health Score</span>
              <span className="text-3xl font-bold text-cyan-300">{data.pipelineHealth}</span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
              <div
                className={`h-full rounded-full ${data.pipelineHealth >= 75 ? 'bg-emerald-500' : data.pipelineHealth >= 55 ? 'bg-amber-400' : 'bg-red-500'}`}
                style={{ width: `${data.pipelineHealth}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">Blend of throughput, confidence, and review backlog pressure.</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Total Universe</p>
            <h4 className="text-2xl font-bold text-white">{data.total}</h4>
          </div>
          <Users className="text-slate-400 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">High Conviction</p>
            <h4 className="text-2xl font-bold text-emerald-400">{data.highValueCount}</h4>
          </div>
          <ShieldCheck className="text-emerald-400 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Review Backlog</p>
            <h4 className="text-2xl font-bold text-amber-400">{data.reviewCount}</h4>
          </div>
          <AlertTriangle className="text-amber-400 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Pending Enrichment</p>
            <h4 className="text-2xl font-bold text-blue-400">{data.pendingCount}</h4>
          </div>
          <Hourglass className="text-blue-400 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Avg Confidence</p>
            <h4 className="text-2xl font-bold text-cyan-300">{data.avgConfidence}%</h4>
          </div>
          <TrendingUp className="text-cyan-300 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Evidence Coverage</p>
            <h4 className="text-2xl font-bold text-indigo-300">{data.evidenceCoveragePct}%</h4>
          </div>
          <Link2 className="text-indigo-300 w-8 h-8" />
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 h-[390px] flex flex-col">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Target size={18} className="text-blue-400" />
                Alignment Matrix
              </h3>
              <p className="text-xs text-slate-400">Investor Fit (X) vs Values Alignment (Y)</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block">{data.scatterData.length} scored contacts</span>
              <span className="text-[10px] text-slate-500 inline-flex items-center gap-1 mt-1">
                <MousePointer2 size={10} />
                click a dot to open
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 16, bottom: 12, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={[0, 100]}
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Investor Fit', position: 'bottom', fill: '#64748b', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[0, 100]}
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Values Alignment', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
                />
                <ZAxis type="number" dataKey="z" range={[50, 380]} />
                <ReferenceLine x={60} stroke="#475569" strokeDasharray="3 3" />
                <ReferenceLine y={60} stroke="#475569" strokeDasharray="3 3" />
                <Tooltip
                  cursor={{ strokeDasharray: '4 4' }}
                  content={(props: any) => {
                    const active = Boolean(props?.active);
                    const payload = props?.payload as Array<{ payload?: ScatterPoint }> | undefined;
                    if (!active || !payload || payload.length === 0) return null;
                    const point = payload[0]?.payload;
                    if (!point) return null;
                    return (
                      <div className="bg-slate-950 border border-slate-700 rounded p-3 text-xs shadow-xl">
                        <p className="text-white font-semibold">{point.name}</p>
                        <p className="text-blue-300 mt-1">Fit: {point.x}</p>
                        <p className="text-emerald-300">Values: {point.y}</p>
                        <p className="text-cyan-300">Confidence: {point.confidence}%</p>
                        <p className="text-slate-400 uppercase mt-1">{point.track}</p>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={data.scatterData}
                  fill="#3b82f6"
                  onClick={(point: any) => {
                    const selectedId = typeof point?.id === 'string' ? point.id : null;
                    if (selectedId && onSelectContact) onSelectContact(selectedId);
                  }}
                  cursor={onSelectContact ? 'pointer' : 'default'}
                >
                  {data.scatterData.map((point) => (
                    <Cell
                      key={point.id}
                      fill={
                        point.x >= 70 && point.y >= 70
                          ? '#10b981'
                          : point.x >= 70 && point.y < 55
                            ? '#ef4444'
                            : point.y >= 70
                              ? '#06b6d4'
                              : '#64748b'
                      }
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 h-[390px] flex flex-col">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Compass size={18} className="text-cyan-400" />
                Track Allocation
              </h3>
              <p className="text-xs text-slate-400">How the current universe is distributed</p>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.trackDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="48%"
                  innerRadius={70}
                  outerRadius={98}
                  paddingAngle={4}
                >
                  {data.trackDistribution.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={(props: any) => {
                    const active = Boolean(props?.active);
                    const payload = props?.payload as Array<{ payload?: { name?: string; value?: number } }> | undefined;
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0]?.payload;
                    if (!row?.name || typeof row.value !== 'number') return null;
                    return (
                      <div className="bg-slate-950 border border-slate-700 rounded p-2 text-xs shadow-xl">
                        <p className="text-white">{row.name}</p>
                        <p className="text-slate-300">{row.value} contacts</p>
                      </div>
                    );
                  }}
                />
                <Legend verticalAlign="bottom" height={30} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-1">Pipeline Stage Mix</h3>
          <p className="text-xs text-slate-400 mb-4">Throughput by contact status</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.statusBars}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {data.statusBars.map((row) => (
                    <Cell key={row.name} fill={row.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-1">Confidence Distribution</h3>
          <p className="text-xs text-slate-400 mb-4">Overall confidence across scored contacts</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.confidenceBands}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#06b6d4" radius={[6, 6, 0, 0]}>
                  {data.confidenceBands.map((row, idx) => (
                    <Cell key={row.name} fill={idx >= 2 ? '#10b981' : '#0ea5e9'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-1">Top Opportunity Queue</h3>
          <p className="text-xs text-slate-400 mb-4">Ranked by weighted strategic score and confidence</p>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {data.priorityQueue.length === 0 && (
              <p className="text-sm text-slate-500">No scored opportunities available yet.</p>
            )}
            {data.priorityQueue.map((item) => (
              <div
                key={item.id}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 cursor-pointer hover:border-blue-700/60 transition-colors"
                onClick={() => onSelectContact?.(item.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{item.name}</p>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mt-0.5">{item.track}</p>
                    <p className="text-xs text-slate-300 mt-2 line-clamp-2">{item.action}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-emerald-300 text-lg font-bold leading-none">{item.score}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{item.confidence}% conf</p>
                    <div className="flex items-center justify-end gap-1 mt-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleFlag?.(item.id);
                        }}
                        className={`p-1 rounded border transition-colors ${
                          item.teamFlagged
                            ? 'text-amber-300 border-amber-600/60 bg-amber-900/30'
                            : 'text-slate-400 border-slate-600 hover:text-amber-300 hover:border-amber-600/50'
                        }`}
                        title={item.teamFlagged ? 'Unflag contact' : 'Flag contact'}
                      >
                        <Flag size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
                          onDeleteContact?.(item.id);
                        }}
                        className="p-1 rounded border border-slate-600 text-slate-400 hover:text-red-300 hover:border-red-600/50 transition-colors"
                        title="Delete contact"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-1">Risk Monitor</h3>
          <p className="text-xs text-slate-400 mb-4">Contacts requiring human intervention</p>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {data.riskQueue.length === 0 && (
              <p className="text-sm text-slate-500">No active risk flags.</p>
            )}
            {data.riskQueue.map((item) => (
              <div
                key={item.id}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 cursor-pointer hover:border-blue-700/60 transition-colors"
                onClick={() => onSelectContact?.(item.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{item.name}</p>
                    <p className="text-xs text-slate-300 mt-1">{item.reason}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`text-[11px] font-bold px-2 py-1 rounded border ${
                        item.severity >= 6
                          ? 'text-red-300 border-red-500/40 bg-red-900/30'
                          : item.severity >= 4
                            ? 'text-amber-300 border-amber-500/40 bg-amber-900/20'
                            : 'text-slate-300 border-slate-600 bg-slate-800'
                      }`}
                    >
                      S{item.severity}
                    </span>
                    <div className="flex items-center justify-end gap-1 mt-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleFlag?.(item.id);
                        }}
                        className={`p-1 rounded border transition-colors ${
                          item.teamFlagged
                            ? 'text-amber-300 border-amber-600/60 bg-amber-900/30'
                            : 'text-slate-400 border-slate-600 hover:text-amber-300 hover:border-amber-600/50'
                        }`}
                        title={item.teamFlagged ? 'Unflag contact' : 'Flag contact'}
                      >
                        <Flag size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return;
                          onDeleteContact?.(item.id);
                        }}
                        className="p-1 rounded border border-slate-600 text-slate-400 hover:text-red-300 hover:border-red-600/50 transition-colors"
                        title="Delete contact"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 xl:col-span-2">
          <h3 className="text-lg font-semibold text-white mb-1">Evidence Intelligence</h3>
          <p className="text-xs text-slate-400 mb-4">Domain diversity and citation density across enriched contacts</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
              <p className="text-xs uppercase tracking-widest text-slate-500">Unique Domains</p>
              <p className="text-2xl font-bold text-cyan-300 mt-1">{data.uniqueDomainCount}</p>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
              <p className="text-xs uppercase tracking-widest text-slate-500">Avg Links / Contact</p>
              <p className="text-2xl font-bold text-indigo-300 mt-1">{data.avgEvidencePerAnalyzed}</p>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
              <p className="text-xs uppercase tracking-widest text-slate-500">Evidence Coverage</p>
              <p className="text-2xl font-bold text-emerald-300 mt-1">{data.evidenceCoveragePct}%</p>
            </div>
          </div>
          <div className="space-y-2">
            {data.topDomains.length === 0 && (
              <p className="text-sm text-slate-500">No evidence sources captured yet.</p>
            )}
            {data.topDomains.map((domain) => (
              <div key={domain.domain} className="flex items-center justify-between text-sm bg-slate-900 border border-slate-700 rounded px-3 py-2">
                <span className="text-slate-200 truncate">{domain.domain}</span>
                <span className="text-cyan-300 font-semibold">{domain.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-1">Signal Feed</h3>
          <p className="text-xs text-slate-400 mb-4">Most recently verified contacts</p>
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {data.latestVerified.length === 0 && (
              <p className="text-sm text-slate-500">No recent verification events.</p>
            )}
            {data.latestVerified.map((entry) => (
              <div
                key={entry.id}
                className="bg-slate-900 border border-slate-700 rounded-lg p-3 cursor-pointer hover:border-blue-700/60 transition-colors"
                onClick={() => onSelectContact?.(entry.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-white truncate">{entry.name}</p>
                  {entry.teamFlagged && (
                    <span className="text-[10px] uppercase tracking-wider text-amber-300 border border-amber-600/50 bg-amber-900/30 px-1.5 py-0.5 rounded">
                      Flagged
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <Clock3 size={12} />
                  {entry.when}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700">
            <h4 className="text-xs uppercase tracking-widest text-slate-500 mb-2">Ingestion Source Mix</h4>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.sourceBars} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={70} stroke="#64748b" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="#3b82f6">
                    {data.sourceBars.map((row, idx) => (
                      <Cell key={row.name} fill={idx === 0 ? '#10b981' : idx === 1 ? '#0ea5e9' : '#8b5cf6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="mt-4 text-[11px] text-slate-500 flex items-center gap-1">
            <Fingerprint size={12} />
            Identity/collision indicators are reflected in Risk Monitor severity.
          </div>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
