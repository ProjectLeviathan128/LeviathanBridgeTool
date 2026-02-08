import React, { useState, useMemo, useEffect } from 'react';
import { Contact } from '../types';
import { Search, ChevronRight, AlertTriangle, X, SlidersHorizontal, Check, Flag, Trash2, Plus, ListChecks, MessageSquareText } from 'lucide-react';
import { INTRO_REQUEST_LIST } from '../services/organizationService';

interface ContactListProps {
    contacts: Contact[];
    onSelectContact: (contact: Contact) => void;
    onBatchUpdateContacts: (updates: Contact[]) => void;
    onDeleteContacts: (contactIds: string[]) => void;
    onToggleIntroRequest: (contactId: string) => void;
}

const ContactList: React.FC<ContactListProps> = ({
    contacts,
    onSelectContact,
    onBatchUpdateContacts,
    onDeleteContacts,
    onToggleIntroRequest,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [listInput, setListInput] = useState('');
    const [listFilter, setListFilter] = useState('All');

    // Advanced Filter State
    const [filters, setFilters] = useState({
        status: 'All' as string,
        track: 'All' as string,
        location: '',
        source: '',
        minInvestorScore: 0,
        minValuesScore: 0,
        minGovtScore: 0,
        minMaritimeScore: 0,
        minConnectorScore: 0,
        hasNotes: false,
        isFlagged: false
    });

    const allLists = useMemo(() => {
        const names = new Set<string>();
        contacts.forEach(contact => {
            (contact.lists || []).forEach(list => {
                const normalized = list.trim();
                if (normalized) names.add(normalized);
            });
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }, [contacts]);

    // Intelligent Filtering Logic
    const filteredContacts = useMemo(() => {
        return contacts.filter(c => {
            // 1. Text Search (Fuzzy-ish)
            const searchLower = searchTerm.toLowerCase();
            const matchesSearch =
                searchTerm === '' ||
                c.name.toLowerCase().includes(searchLower) ||
                c.headline.toLowerCase().includes(searchLower) ||
                c.location.toLowerCase().includes(searchLower) ||
                (c.tags && c.tags.some(t => t.toLowerCase().includes(searchLower))) ||
                (c.rawText && c.rawText.toLowerCase().includes(searchLower));

            if (!matchesSearch) return false;

            // 2. Status Filter
            if (filters.status !== 'All' && c.status !== filters.status) return false;

            // 3. Track Filter
            if (filters.track !== 'All') {
                if (!c.enrichment?.tracks?.includes(filters.track as any)) return false;
            }

            // 4. Location Filter (Partial Match)
            if (filters.location && !c.location.toLowerCase().includes(filters.location.toLowerCase())) return false;

            // 5. Source Filter (Partial Match)
            if (filters.source && !c.ingestionMeta.sourceLabel.toLowerCase().includes(filters.source.toLowerCase())) return false;

            // 6. Boolean Flags
            if (filters.hasNotes && !c.rawText) return false;
            if (filters.isFlagged && !c.teamFlagged && (!c.enrichment?.flaggedAttributes || c.enrichment.flaggedAttributes.length === 0)) return false;

            // 7. List Filter
            if (listFilter !== 'All' && !(c.lists || []).includes(listFilter)) return false;

            // 8. Score Thresholds
            if (filters.minInvestorScore > 0 && (!c.scores || c.scores.investorFit.score < filters.minInvestorScore)) return false;
            if (filters.minValuesScore > 0 && (!c.scores || c.scores.valuesAlignment.score < filters.minValuesScore)) return false;
            if (filters.minGovtScore > 0 && (!c.scores || c.scores.govtAccess.score < filters.minGovtScore)) return false;
            if (filters.minMaritimeScore > 0 && (!c.scores || c.scores.maritimeRelevance.score < filters.minMaritimeScore)) return false;
            if (filters.minConnectorScore > 0 && (!c.scores || c.scores.connectorScore.score < filters.minConnectorScore)) return false;

            return true;
        });
    }, [contacts, searchTerm, filters, listFilter]);

    const activeFilterCount =
        (filters.status !== 'All' ? 1 : 0) +
        (filters.track !== 'All' ? 1 : 0) +
        (filters.location ? 1 : 0) +
        (filters.source ? 1 : 0) +
        (listFilter !== 'All' ? 1 : 0) +
        (filters.hasNotes ? 1 : 0) +
        (filters.isFlagged ? 1 : 0) +
        (filters.minInvestorScore > 0 ? 1 : 0) +
        (filters.minValuesScore > 0 ? 1 : 0) +
        (filters.minGovtScore > 0 ? 1 : 0) +
        (filters.minMaritimeScore > 0 ? 1 : 0) +
        (filters.minConnectorScore > 0 ? 1 : 0);

    const resetFilters = () => {
        setFilters({
            status: 'All',
            track: 'All',
            location: '',
            source: '',
            minInvestorScore: 0,
            minValuesScore: 0,
            minGovtScore: 0,
            minMaritimeScore: 0,
            minConnectorScore: 0,
            hasNotes: false,
            isFlagged: false
        });
        setSearchTerm('');
        setListFilter('All');
    };

    const filteredIds = useMemo(() => filteredContacts.map(contact => contact.id), [filteredContacts]);
    const selectedCount = selectedIds.size;
    const introQueueCount = useMemo(() => contacts.filter(contact => contact.introRequested).length, [contacts]);

    const toggleSelected = (contactId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(contactId)) next.delete(contactId);
            else next.add(contactId);
            return next;
        });
    };

    const toggleSelectAllFiltered = () => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            const allSelected = filteredIds.every(id => next.has(id));
            if (allSelected) {
                filteredIds.forEach(id => next.delete(id));
            } else {
                filteredIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const applyUpdatesToSelected = (updateFn: (contact: Contact) => Contact) => {
        const updates = contacts
            .filter(contact => selectedIds.has(contact.id))
            .map(updateFn);

        if (updates.length > 0) onBatchUpdateContacts(updates);
    };

    const handleBulkFlag = (flagged: boolean) => {
        applyUpdatesToSelected(contact => ({ ...contact, teamFlagged: flagged }));
    };

    const handleBulkIntroQueue = (requested: boolean) => {
        applyUpdatesToSelected(contact => {
            const lists = new Set((contact.lists || []).map(list => list.trim()).filter(Boolean));
            if (requested) {
                lists.add(INTRO_REQUEST_LIST);
            } else {
                lists.delete(INTRO_REQUEST_LIST);
            }
            return {
                ...contact,
                lists: Array.from(lists),
                introRequested: requested,
                introRequestedAt: requested ? (contact.introRequestedAt || new Date().toISOString()) : undefined
            };
        });
    };

    const handleBulkAddToList = () => {
        const normalized = listInput.trim();
        if (!normalized) return;

        applyUpdatesToSelected(contact => ({
            ...contact,
            lists: [...new Set([...(contact.lists || []), normalized])]
        }));

        setListInput('');
        setListFilter(normalized);
    };

    const handleBulkDelete = () => {
        const targetIds = Array.from(selectedIds);
        if (targetIds.length === 0) return;
        if (!window.confirm(`Delete ${targetIds.length} selected contacts? This cannot be undone.`)) return;
        onDeleteContacts(targetIds);
        setSelectedIds(new Set());
    };

    const handleToggleSingleFlag = (contact: Contact) => {
        onBatchUpdateContacts([{ ...contact, teamFlagged: !contact.teamFlagged }]);
    };

    const handleDeleteSingle = (contact: Contact) => {
        if (!window.confirm(`Delete ${contact.name}? This cannot be undone.`)) return;
        onDeleteContacts([contact.id]);
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(contact.id);
            return next;
        });
    };

    useEffect(() => {
        const validIds = new Set(contacts.map(contact => contact.id));
        setSelectedIds(prev => {
            const next = new Set<string>();
            prev.forEach(id => {
                if (validIds.has(id)) next.add(id);
            });
            return next;
        });
    }, [contacts]);

    return (
        <div className="flex h-full gap-4">
            {/* Main List Area */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden flex flex-col flex-1 h-full">
                {/* Toolbar */}
                <div className="p-4 border-b border-slate-700 flex flex-wrap gap-4 items-center justify-between bg-slate-800 z-10">
                    <div className="relative flex-1 max-w-lg">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                        <input
                            type="text"
                            placeholder="Deep Search (Name, Notes, Bio)..."
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 pl-10 pr-4 py-2.5 rounded focus:outline-none focus:border-blue-500 transition-all font-medium text-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <select
                            value={listFilter}
                            onChange={(e) => setListFilter(e.target.value)}
                            className="bg-slate-900 border border-slate-700 text-slate-300 rounded px-2 py-2 text-sm focus:outline-none focus:border-blue-500"
                            title="Filter by list"
                        >
                            <option value="All">All Lists</option>
                            {allLists.map(list => (
                                <option key={list} value={list}>{list}</option>
                            ))}
                        </select>

                        <button
                            onClick={() => setListFilter(listFilter === INTRO_REQUEST_LIST ? 'All' : INTRO_REQUEST_LIST)}
                            className={`px-3 py-2 text-xs rounded border transition-colors inline-flex items-center gap-1 ${listFilter === INTRO_REQUEST_LIST
                                ? 'bg-emerald-600 border-emerald-500 text-white'
                                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700'
                                }`}
                            title="Show intro request queue"
                        >
                            <MessageSquareText size={12} />
                            Intro Queue ({introQueueCount})
                        </button>

                        <button
                            onClick={() => setIsFilterOpen(!isFilterOpen)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded border transition-colors font-medium text-sm ${isFilterOpen || activeFilterCount > 0 ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
                        >
                            <SlidersHorizontal size={16} />
                            Filters
                            {activeFilterCount > 0 && (
                                <span className="bg-white text-blue-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                <div className="px-4 py-3 border-b border-slate-700 bg-slate-900/80 flex flex-wrap items-center gap-2">
                    <button
                        onClick={toggleSelectAllFiltered}
                        className="px-3 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                        {filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id)) ? 'Unselect Filtered' : 'Select Filtered'}
                    </button>
                    <span className="text-xs text-slate-400">{selectedCount} selected</span>
                    {selectedCount > 0 && (
                        <>
                            <button
                                onClick={() => handleBulkFlag(true)}
                                className="px-3 py-1.5 text-xs rounded border border-amber-700/50 text-amber-300 hover:bg-amber-900/20 transition-colors inline-flex items-center gap-1"
                            >
                                <Flag size={12} />
                                Flag
                            </button>
                            <button
                                onClick={() => handleBulkFlag(false)}
                                className="px-3 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
                            >
                                Unflag
                            </button>
                            <button
                                onClick={() => handleBulkIntroQueue(true)}
                                className="px-3 py-1.5 text-xs rounded border border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/20 transition-colors inline-flex items-center gap-1"
                            >
                                <MessageSquareText size={12} />
                                Queue Intro
                            </button>
                            <button
                                onClick={() => handleBulkIntroQueue(false)}
                                className="px-3 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
                            >
                                Remove Intro
                            </button>
                            <div className="flex items-center gap-1 ml-1">
                                <input
                                    type="text"
                                    value={listInput}
                                    onChange={(e) => setListInput(e.target.value)}
                                    placeholder="List name"
                                    className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={handleBulkAddToList}
                                    className="px-2.5 py-1.5 text-xs rounded border border-blue-600/60 text-blue-300 hover:bg-blue-900/20 transition-colors inline-flex items-center gap-1"
                                >
                                    <Plus size={12} />
                                    Add List
                                </button>
                            </div>
                            <button
                                onClick={handleBulkDelete}
                                className="px-3 py-1.5 text-xs rounded border border-red-700/50 text-red-300 hover:bg-red-900/20 transition-colors inline-flex items-center gap-1 ml-auto"
                            >
                                <Trash2 size={12} />
                                Delete
                            </button>
                        </>
                    )}
                </div>

                {/* Table */}
                <div className="overflow-x-auto flex-1 bg-slate-900/50">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wider sticky top-0 z-0 shadow-sm">
                            <tr>
                                <th className="p-4 font-medium border-b border-slate-800 w-12"></th>
                                <th className="p-4 font-medium border-b border-slate-800">Identity</th>
                                <th className="p-4 font-medium border-b border-slate-800">Bridge Scores</th>
                                <th className="p-4 font-medium border-b border-slate-800">Strategic Fit</th>
                                <th className="p-4 font-medium border-b border-slate-800">Status</th>
                                <th className="p-4 font-medium border-b border-slate-800">Team</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {filteredContacts.map(contact => (
                                <tr
                                    key={contact.id}
                                    className="hover:bg-slate-800 transition-colors cursor-pointer group"
                                    onClick={() => onSelectContact(contact)}
                                >
                                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(contact.id)}
                                            onChange={() => toggleSelected(contact.id)}
                                            className="accent-blue-500"
                                        />
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 text-xs font-bold shrink-0">
                                                {contact.name.charAt(0)}
                                            </div>
                                            <div>
                                                <div className="font-medium text-slate-200 text-sm">{contact.name}</div>
                                                <div className="text-xs text-slate-500 truncate max-w-[200px] mt-0.5">{contact.headline}</div>
                                                <div className="text-[10px] text-slate-600 mt-1">{contact.location}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        {contact.scores ? (
                                            <div className="flex items-center gap-3 text-sm">
                                                <ScoreBadge label="INV" score={contact.scores.investorFit.score} />
                                                <ScoreBadge label="VAL" score={contact.scores.valuesAlignment.score} />
                                                <ScoreBadge label="GOV" score={contact.scores.govtAccess.score} />
                                            </div>
                                        ) : (
                                            <span className="text-slate-600 text-xs italic bg-slate-800 px-2 py-1 rounded">Pending Analysis</span>
                                        )}
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-wrap gap-1.5">
                                            {contact.enrichment?.tracks && contact.enrichment.tracks.length > 0 ? (
                                                contact.enrichment.tracks.slice(0, 2).map(t => (
                                                    <span key={t} className={`px-2 py-0.5 rounded text-[10px] border ${t === 'Investment' ? 'bg-blue-900/20 text-blue-300 border-blue-800' :
                                                        t === 'Government' ? 'bg-amber-900/20 text-amber-300 border-amber-800' :
                                                            'bg-purple-900/20 text-purple-300 border-purple-800'
                                                        }`}>
                                                        {t === 'Strategic Partner' ? 'Strategic' : t}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-slate-700 text-xs">-</span>
                                            )}
                                            {contact.enrichment?.tracks && contact.enrichment.tracks.length > 2 && (
                                                <span className="text-[10px] text-slate-500 px-1">+More</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <StatusBadge status={contact.status} />
                                    </td>
                                    <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-end gap-1.5">
                                            {contact.teamFlagged && (
                                                <span className="text-[10px] uppercase tracking-wider text-amber-300 border border-amber-600/50 bg-amber-900/30 px-1.5 py-0.5 rounded">
                                                    Flagged
                                                </span>
                                            )}
                                            {contact.introRequested && (
                                                <span className="text-[10px] uppercase tracking-wider text-emerald-300 border border-emerald-600/50 bg-emerald-900/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                                    <MessageSquareText size={10} />
                                                    Intro
                                                </span>
                                            )}
                                            {(contact.lists || []).slice(0, 1).map(list => (
                                                <span
                                                    key={list}
                                                    className="text-[10px] uppercase tracking-wider text-cyan-300 border border-cyan-700/50 bg-cyan-900/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                                                >
                                                    <ListChecks size={10} />
                                                    {list}
                                                </span>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={() => onToggleIntroRequest(contact.id)}
                                                className={`p-1 rounded border transition-colors ${contact.introRequested
                                                        ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/20'
                                                        : 'text-slate-500 border-slate-700 hover:text-emerald-300 hover:border-emerald-700/50'
                                                    }`}
                                                title={contact.introRequested ? 'Remove from intro queue' : 'Request intro'}
                                            >
                                                <MessageSquareText size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleSingleFlag(contact)}
                                                className={`p-1 rounded border transition-colors ${contact.teamFlagged
                                                        ? 'text-amber-300 border-amber-700/50 bg-amber-900/20'
                                                        : 'text-slate-500 border-slate-700 hover:text-amber-300 hover:border-amber-700/50'
                                                    }`}
                                                title={contact.teamFlagged ? 'Unflag contact' : 'Flag contact'}
                                            >
                                                <Flag size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteSingle(contact)}
                                                className="p-1 rounded border border-slate-700 text-slate-500 hover:text-red-300 hover:border-red-700/50 transition-colors"
                                                title="Delete contact"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                            <ChevronRight className="inline-block text-slate-700 group-hover:text-blue-400 transition-colors" size={18} />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredContacts.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="p-12 text-center">
                                        <div className="flex flex-col items-center justify-center text-slate-500">
                                            <Search size={32} className="mb-3 opacity-20" />
                                            <p className="text-sm">No contacts match your filters.</p>
                                            <button onClick={resetFilters} className="mt-2 text-blue-400 text-xs hover:underline">Reset all filters</button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Intelligent Filter Panel */}
            {isFilterOpen && (
                <div className="w-80 bg-slate-900 border-l border-slate-800 p-6 flex flex-col h-full animate-in slide-in-from-right-4 duration-200 shadow-2xl z-20 absolute right-0 top-0 bottom-0 md:relative md:shadow-none">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider">Deep Filters</h3>
                        <button onClick={() => setIsFilterOpen(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
                    </div>

                    <div className="space-y-6 flex-1 overflow-y-auto pr-2 pb-6 custom-scrollbar">
                        {/* Status */}
                        <div>
                            <label className="text-xs font-semibold text-slate-400 uppercase mb-3 block">Analysis Status</label>
                            <div className="flex flex-wrap gap-2">
                                {['All', 'New', 'Enriched', 'Review Needed', 'Discarded'].map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setFilters(prev => ({ ...prev, status: s }))}
                                        className={`px-3 py-1.5 rounded text-xs transition-colors border ${filters.status === s
                                            ? 'bg-blue-600 border-blue-500 text-white font-medium'
                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                                            }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="h-px bg-slate-800" />

                        {/* Text Inputs */}
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase mb-2 block">Location</label>
                                <input
                                    type="text"
                                    placeholder="e.g. London, NYC..."
                                    className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                                    value={filters.location}
                                    onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value }))}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase mb-2 block">Source / Upload</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Feb_Import.csv..."
                                    className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                                    value={filters.source}
                                    onChange={(e) => setFilters(prev => ({ ...prev, source: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="h-px bg-slate-800" />

                        {/* Tracks */}
                        <div>
                            <label className="text-xs font-semibold text-slate-400 uppercase mb-3 block">Strategic Track</label>
                            <select
                                className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                                value={filters.track}
                                onChange={(e) => setFilters(prev => ({ ...prev, track: e.target.value }))}
                            >
                                <option value="All">Any Track</option>
                                <option value="Investment">Investment</option>
                                <option value="Government">Government</option>
                                <option value="Strategic Partner">Strategic Partner</option>
                            </select>
                        </div>

                        <div className="h-px bg-slate-800" />

                        {/* Boolean Toggles */}
                        <div className="space-y-3">
                            <label className="flex items-center justify-between cursor-pointer group">
                                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Only with Notes</span>
                                <div
                                    className={`w-10 h-5 rounded-full relative transition-colors ${filters.hasNotes ? 'bg-blue-600' : 'bg-slate-700'}`}
                                    onClick={() => setFilters(prev => ({ ...prev, hasNotes: !prev.hasNotes }))}
                                >
                                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${filters.hasNotes ? 'left-6' : 'left-1'}`} />
                                </div>
                            </label>

                            <label className="flex items-center justify-between cursor-pointer group">
                                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">Has Team/Risk Flags</span>
                                <div
                                    className={`w-10 h-5 rounded-full relative transition-colors ${filters.isFlagged ? 'bg-red-600' : 'bg-slate-700'}`}
                                    onClick={() => setFilters(prev => ({ ...prev, isFlagged: !prev.isFlagged }))}
                                >
                                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${filters.isFlagged ? 'left-6' : 'left-1'}`} />
                                </div>
                            </label>
                        </div>

                        <div className="h-px bg-slate-800" />

                        {/* Detailed Scores */}
                        <div className="space-y-4">
                            <label className="text-xs font-semibold text-slate-400 uppercase block">Score Thresholds</label>

                            {[
                                { label: 'Investor Fit', key: 'minInvestorScore', color: 'text-blue-400', accent: 'accent-blue-500' },
                                { label: 'Values Alignment', key: 'minValuesScore', color: 'text-emerald-400', accent: 'accent-emerald-500' },
                                { label: 'Govt Access', key: 'minGovtScore', color: 'text-amber-400', accent: 'accent-amber-500' },
                                { label: 'Maritime', key: 'minMaritimeScore', color: 'text-cyan-400', accent: 'accent-cyan-500' },
                                { label: 'Connector', key: 'minConnectorScore', color: 'text-purple-400', accent: 'accent-purple-500' },
                            ].map((scoreItem) => (
                                <div key={scoreItem.key}>
                                    <div className="flex justify-between text-xs mb-1.5">
                                        <span className="text-slate-300">{scoreItem.label}</span>
                                        <span className={`${scoreItem.color} font-mono`}>{(filters as any)[scoreItem.key]}+</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0" max="90" step="10"
                                        value={(filters as any)[scoreItem.key]}
                                        onChange={(e) => setFilters(prev => ({ ...prev, [scoreItem.key]: parseInt(e.target.value) }))}
                                        className={`w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer ${scoreItem.accent}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="pt-6 border-t border-slate-800 mt-auto">
                        <button
                            onClick={resetFilters}
                            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-bold uppercase tracking-wider transition-colors"
                        >
                            Reset Filters
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper Components for Cleaner Table
const ScoreBadge = ({ label, score }: { label: string, score: number }) => {
    let colorClass = 'text-slate-400';
    if (score >= 80) colorClass = 'text-emerald-400';
    else if (score >= 50) colorClass = 'text-blue-400';
    else if (score < 30) colorClass = 'text-red-400';

    return (
        <div className="flex flex-col items-center min-w-[30px]">
            <span className={`text-xs font-bold font-mono ${colorClass}`}>{score}</span>
            <span className="text-[9px] text-slate-600 uppercase">{label}</span>
        </div>
    );
};

const StatusBadge = ({ status }: { status: string }) => {
    let styles = 'bg-slate-800 text-slate-400 border-slate-700';
    let icon = null;

    if (status === 'Enriched') {
        styles = 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50';
        icon = <Check size={10} />;
    } else if (status === 'Review Needed') {
        styles = 'bg-amber-900/20 text-amber-400 border-amber-900/50';
        icon = <AlertTriangle size={10} />;
    } else if (status === 'New') {
        styles = 'bg-blue-900/20 text-blue-400 border-blue-900/50';
    } else if (status === 'Discarded') {
        styles = 'bg-slate-800 text-slate-600 border-slate-700 line-through';
    }

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${styles}`}>
            {icon}
            {status}
        </span>
    );
};

export default ContactList;
