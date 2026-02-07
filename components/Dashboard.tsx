import React from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ScatterChart, Scatter, ZAxis, ReferenceLine, Legend
} from 'recharts';
import { Contact } from '../types';
import { Activity, Users, AlertTriangle, ShieldCheck, Hourglass, Target, TrendingUp } from 'lucide-react';

interface DashboardProps {
  contacts: Contact[];
}

const COLORS = ['#0ea5e9', '#6366f1', '#10b981', '#f59e0b', '#64748b'];

const Dashboard: React.FC<DashboardProps> = ({ contacts }) => {
  const data = React.useMemo(() => {
    const total = contacts.length;

    // High Value: Enriched AND (Investor Fit > 80 OR Govt Access > 80)
    const highValue = contacts.filter(c =>
      c.status === 'Enriched' &&
      c.scores &&
      (c.scores.investorFit.score >= 80 || c.scores.govtAccess.score >= 80)
    ).length;

    const needsReview = contacts.filter(c => c.status === 'Review Needed').length;

    // Pending Analysis


    // 1. Track Distribution Logic
    const trackCounts: Record<string, number> = {
      'Investment': 0,
      'Government': 0,
      'Strategic': 0,
      'Pending': 0,
      'No Fit': 0
    };

    contacts.forEach(c => {
      if (c.status === 'New') {
        trackCounts['Pending']++;
      } else if (c.status === 'Discarded') {
        trackCounts['No Fit']++;
      } else if (c.enrichment?.tracks && c.enrichment.tracks.length > 0) {
        c.enrichment.tracks.forEach(t => {
          if (t === 'Strategic Partner') trackCounts['Strategic']++;
          else if (trackCounts[t] !== undefined) trackCounts[t]++;
        });
      } else {
        trackCounts['No Fit']++;
      }
    });

    const trackDistribution = Object.keys(trackCounts)
      .filter(k => trackCounts[k] > 0)
      .map(k => ({ name: k, value: trackCounts[k] }));

    // 2. Scatter Plot Data (Matrix)
    const scatterData = contacts
      .filter(c => c.status === 'Enriched' && c.scores)
      .map(c => ({
        name: c.name,
        x: c.scores!.investorFit.score,
        y: c.scores!.valuesAlignment.score,
        z: 1,
        track: c.enrichment?.tracks[0] || 'Unknown'
      }));

    // 3. Histogram Data (Quality Distribution)
    const scoreBuckets = [
      { name: '0-20', count: 0 },
      { name: '21-40', count: 0 },
      { name: '41-60', count: 0 },
      { name: '61-80', count: 0 },
      { name: '81-100', count: 0 },
    ];

    contacts.forEach(c => {
      if (c.scores) {
        const s = c.scores.investorFit.score;
        if (s <= 20) scoreBuckets[0].count++;
        else if (s <= 40) scoreBuckets[1].count++;
        else if (s <= 60) scoreBuckets[2].count++;
        else if (s <= 80) scoreBuckets[3].count++;
        else scoreBuckets[4].count++;
      }
    });

    return {
      stats: { totalContacts: total, highValueCount: highValue, needsReviewCount: needsReview, trackDistribution },
      scatterData,
      scoreBuckets
    };
  }, [contacts]);

  // If no data, show empty state
  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-500">
        <Activity className="w-16 h-16 mb-4 opacity-20" />
        <h3 className="text-xl font-semibold text-slate-300">System Ready</h3>
        <p className="mb-6">Upload contact universe to begin.</p>
      </div>
    )
  }

  const { stats, scatterData, scoreBuckets } = data;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Level KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm">Total Universe</p>
            <h3 className="text-2xl font-bold text-white">{stats.totalContacts}</h3>
          </div>
          <Users className="text-slate-500 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm">High Value</p>
            <h3 className="text-2xl font-bold text-emerald-400">{stats.highValueCount}</h3>
          </div>
          <ShieldCheck className="text-emerald-500 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm">Needs Review</p>
            <h3 className="text-2xl font-bold text-amber-400">{stats.needsReviewCount}</h3>
          </div>
          <AlertTriangle className="text-amber-500 w-8 h-8" />
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm">Pending Analysis</p>
            <h3 className="text-2xl font-bold text-blue-400">{contacts.filter(c => c.status === 'New').length}</h3>
          </div>
          <Hourglass className="text-blue-500 w-8 h-8" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* CHART 1: THE ALIGNMENT MATRIX */}
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 flex flex-col h-[400px]">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Target className="text-blue-400" size={20} />
                The Alignment Matrix
              </h3>
              <p className="text-xs text-slate-400">Values Alignment (Y) vs Investor Fit (X)</p>
            </div>
            {scatterData.length === 0 && <span className="text-xs text-amber-500 bg-amber-900/20 px-2 py-1 rounded">No Scored Data</span>}
          </div>

          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Investor Fit"
                  unit=""
                  stroke="#94a3b8"
                  domain={[0, 100]}
                  label={{ value: 'Investor Fit', position: 'bottom', fill: '#64748b', fontSize: 12 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Values"
                  unit=""
                  stroke="#94a3b8"
                  domain={[0, 100]}
                  label={{ value: 'Values Alignment', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 12 }}
                />
                <ZAxis type="number" dataKey="z" range={[60, 400]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 p-3 rounded shadow-xl">
                          <p className="text-white font-bold text-sm mb-1">{data.name}</p>
                          <p className="text-xs text-emerald-400">Values: {data.y}</p>
                          <p className="text-xs text-blue-400">Invest Fit: {data.x}</p>
                          <p className="text-[10px] text-slate-500 mt-1 uppercase">{data.track}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />

                {/* Strategic Zones Reference Lines */}
                <ReferenceLine x={50} stroke="#475569" strokeDasharray="3 3" />
                <ReferenceLine y={50} stroke="#475569" strokeDasharray="3 3" />

                <Scatter name="Contacts" data={scatterData} fill="#8884d8">
                  {scatterData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={
                      entry.x > 70 && entry.y > 70 ? '#10b981' : // Top Right: Green (Good)
                        entry.x > 70 && entry.y < 50 ? '#ef4444' : // Bottom Right: Red (Dangerous)
                          entry.y > 70 ? '#6366f1' : // Top Left: Indigo (Strategic)
                            '#64748b' // Else: Slate
                    } />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 justify-center mt-2 text-[10px] text-slate-500 uppercase tracking-widest">
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Priority</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Risk Zone</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-500"></div> Strategic</div>
          </div>
        </div>

        {/* CHART 2: STRATEGIC DISTRIBUTION */}
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 flex flex-col h-[400px]">
          <h3 className="text-lg font-semibold text-white mb-4">Strategic Allocation</h3>
          <div className="flex-1 w-full relative min-h-0">
            {stats.trackDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.trackDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={100}
                    fill="#8884d8"
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {stats.trackDistribution.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                    itemStyle={{ color: '#f8fafc' }}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-600 italic">
                No enriched data available yet.
              </div>
            )}
            {stats.trackDistribution.length > 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
                <span className="text-4xl font-bold text-white">
                  {stats.trackDistribution.reduce((acc, curr) => acc + curr.value, 0)}
                </span>
                <span className="text-xs text-slate-500 uppercase tracking-wider">Assigned</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* CHART 3: FUNNEL QUALITY (HISTOGRAM) */}
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 flex flex-col">
          <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <TrendingUp className="text-purple-400" size={20} />
            Lead Quality Distribution
          </h3>
          <p className="text-xs text-slate-400 mb-6">Breakdown of universe by Investor Fit score.</p>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreBuckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: '#334155' }}
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                  {scoreBuckets.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={index > 3 ? '#10b981' : '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;