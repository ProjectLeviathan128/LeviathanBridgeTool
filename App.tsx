import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ContactList from './components/ContactList';
import ContactDetail from './components/ContactDetail';
import UploadZone from './components/UploadZone';
import ChatInterface from './components/ChatInterface';
import Settings from './components/Settings';
import DebugPanel from './components/DebugPanel';
import { Contact, AppSettings, IngestionHistoryItem, ChatThread, SyncState } from './types';
import { bridgeMemory } from './services/bridgeMemory';
import {
  loadContacts, saveContactsDebounced,
  loadThreads, saveThreadsDebounced,
  loadSettings, saveSettings,
  loadFromCloud, saveToCloudDebounced, saveToCloud,
  setCurrentUser, clearCurrentUserData, loadSyncState, saveSyncState
} from './services/storageService';
import { debugError, debugInfo, debugWarn } from './services/debugService';
import { LogIn, LogOut, User, Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';

// Puter.js global declaration
declare const puter: {
  auth: {
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
    isSignedIn: () => boolean;
    getUser: () => Promise<{ username: string; email?: string; uuid?: string } | null>;
  };
};

function stringifyConsoleArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [ingestionHistory, setIngestionHistory] = useState<IngestionHistoryItem[]>([]);

  // Chat State (Lifted)
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('default');

  // Track thesis version to force re-render of Thesis tab when memory updates
  const [thesisVersion, setThesisVersion] = useState(0);

  // Settings
  const [settings, setSettings] = useState<AppSettings>({
    focusMode: 'BALANCED',
    analysisModel: 'quality',
  });

  // Auth state
  const [user, setUser] = useState<{ username: string; email?: string; uuid?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', lastSyncedAt: null });
  const [isSynced, setIsSynced] = useState(false);

  // Logout confirmation modal
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    const originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };

    const bindings: Array<{ method: 'log' | 'info' | 'warn' | 'error'; logger: typeof debugInfo }> = [
      { method: 'log', logger: debugInfo },
      { method: 'info', logger: debugInfo },
      { method: 'warn', logger: debugWarn },
      { method: 'error', logger: debugError },
    ];

    bindings.forEach(({ method, logger }) => {
      (console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args: unknown[]) => {
        originalConsole[method](...args);
        const message = args.map(stringifyConsoleArg).join(' ').trim();
        if (!message) return;
        logger('console', message, args);
      };
    });

    debugInfo('app', 'Debug panel initialized.');

    return () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    };
  }, []);

  // Load user data for a specific user
  const loadUserData = useCallback(() => {
    const loadedContacts = loadContacts();
    const loadedThreads = loadThreads();
    const loadedSettings = loadSettings();
    const loadedSyncState = loadSyncState();

    setContacts(loadedContacts);
    setThreads(loadedThreads);
    setActiveThreadId(loadedThreads.length > 0 ? loadedThreads[0].id : 'default');
    setSettings(loadedSettings);
    setSyncState(loadedSyncState);
    debugInfo('storage', 'Loaded local user data.', {
      contacts: loadedContacts.length,
      threads: loadedThreads.length
    });
  }, []);

  // Clear UI state (for logout with clear)
  const clearUIState = useCallback(() => {
    setContacts([]);
    setThreads([{
      id: 'default',
      title: 'New Chat',
      messages: [{
        id: 'welcome',
        role: 'model',
        text: "Bridge OS Online. I'm scanning your universe for opportunities. I can help identify high-value targets from your pending list and enrich them automatically. How can I assist?"
      }],
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }]);
    setActiveThreadId('default');
    setSettings({ focusMode: 'BALANCED', analysisModel: 'quality' });
    setSyncState({ status: 'idle', lastSyncedAt: null });
    bridgeMemory.clear();
    setThesisVersion(v => v + 1);
    debugWarn('app', 'Cleared UI state.');
  }, []);

  // Load auth state on mount AND sync from cloud if signed in
  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (typeof puter !== 'undefined' && puter.auth.isSignedIn()) {
          const userData = await puter.auth.getUser();
          if (userData) {
            // Set user ID for storage key prefixing
            setCurrentUser(userData.uuid || userData.username);
            setUser(userData);

            // Load local data first
            loadUserData();

            // Then sync from cloud
            setSyncState({ status: 'syncing', lastSyncedAt: null });
            const cloudData = await loadFromCloud();
            if (cloudData.contacts) setContacts(cloudData.contacts);
            if (cloudData.threads) {
              setThreads(cloudData.threads);
              setActiveThreadId(cloudData.threads[0]?.id || 'default');
            }
            if (cloudData.settings) setSettings(cloudData.settings);
            if (cloudData.knowledge) setThesisVersion(v => v + 1);
            setSyncState({ status: 'synced', lastSyncedAt: Date.now() });
            debugInfo('auth', 'Signed-in session restored from Puter.', {
              username: userData.username
            });
          }
        } else {
          // Anonymous user - load from legacy keys
          setCurrentUser(null);
          loadUserData();
        }
      } catch (e) {
        console.log('Puter auth not available or user not signed in');
        setCurrentUser(null);
        loadUserData();
        debugWarn('auth', 'Puter auth unavailable. Running anonymous mode.');
      } finally {
        setIsSynced(true);
      }
    };
    checkAuth();
  }, [loadUserData]);

  // Persist contacts when they change (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveContactsDebounced(contacts);
    if (user) saveToCloudDebounced();
  }, [contacts, isSynced, user]);

  // Persist threads when they change (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveThreadsDebounced(threads);
    if (user) saveToCloudDebounced();
  }, [threads, isSynced, user]);

  // Persist settings when they change (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveSettings(settings);
    if (user) saveToCloudDebounced();
  }, [settings, isSynced, user]);

  // Force sync to cloud
  const handleForceSync = async () => {
    if (!user) return;
    setSyncState({ status: 'syncing', lastSyncedAt: syncState.lastSyncedAt });
    debugInfo('sync', 'Manual force sync started.');
    const newState = await saveToCloud();
    setSyncState(newState);
    if (newState.status === 'error') {
      debugError('sync', 'Force sync failed.', newState.error);
    } else {
      debugInfo('sync', 'Force sync completed.', newState);
    }
  };

  // Auth handlers
  const handleSignIn = async () => {
    setAuthLoading(true);
    debugInfo('auth', 'Sign-in started.');
    try {
      await puter.auth.signIn();
      const userData = await puter.auth.getUser();
      if (userData) {
        setCurrentUser(userData.uuid || userData.username);
        setUser(userData);

        // Load data from cloud on fresh sign-in
        setSyncState({ status: 'syncing', lastSyncedAt: null });
        const cloudData = await loadFromCloud();
        if (cloudData.contacts) setContacts(cloudData.contacts);
        if (cloudData.threads) {
          setThreads(cloudData.threads);
          setActiveThreadId(cloudData.threads[0]?.id || 'default');
        }
        if (cloudData.settings) setSettings(cloudData.settings);
        if (cloudData.knowledge) setThesisVersion(v => v + 1);
        setSyncState({ status: 'synced', lastSyncedAt: Date.now() });
        debugInfo('auth', 'Sign-in completed.', { username: userData.username });
      }
    } catch (e) {
      console.error('Sign in failed:', e);
      debugError('auth', 'Sign-in failed.', e);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async (clearData: boolean) => {
    setAuthLoading(true);
    setShowLogoutModal(false);
    debugWarn('auth', 'Sign-out started.', { clearData });
    try {
      await puter.auth.signOut();

      if (clearData) {
        // Clear this user's local data
        clearCurrentUserData();
        clearUIState();
      }

      // Reset to anonymous state
      setCurrentUser(null);
      setUser(null);
      setSyncState({ status: 'idle', lastSyncedAt: null });
      saveSyncState({ status: 'idle', lastSyncedAt: null });

      // If not clearing data, reload anonymous data
      if (!clearData) {
        loadUserData();
      }
      debugInfo('auth', 'Sign-out completed.', { clearData });
    } catch (e) {
      console.error('Sign out failed:', e);
      debugError('auth', 'Sign-out failed.', e);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleUpdateContact = (updated: Contact) => {
    setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    setSelectedContact(updated);
  };

  const handleBatchUpdateContacts = (updates: Contact[]) => {
    setContacts(prev => {
      const newContacts = [...prev];
      updates.forEach(u => {
        const idx = newContacts.findIndex(c => c.id === u.id);
        if (idx > -1) newContacts[idx] = u;
      });
      return newContacts;
    });
  };

  const handleIngestContacts = (newContacts: Contact[]) => {
    setContacts(prev => [...prev, ...newContacts]);
    setActiveTab('contacts'); // Auto-switch to list view
    debugInfo('ingestion', 'Contacts ingested into universe.', { count: newContacts.length });
  };

  const handleThesisUpdate = () => {
    setThesisVersion(prev => prev + 1);
    debugInfo('knowledge', 'Thesis/context memory updated.');
  };

  const handleAddHistory = (name: string, type: string, metadata?: { batchId?: string; recordCount?: number }) => {
    const newItem: IngestionHistoryItem = {
      id: `ing-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      type,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'Processed',
      batchId: metadata?.batchId,
      recordCount: metadata?.recordCount
    };
    setIngestionHistory(prev => [newItem, ...prev]);
    debugInfo('ingestion', 'History item added.', newItem);
  };

  const handleDeleteHistoryItem = (item: IngestionHistoryItem) => {
    setIngestionHistory(prev => prev.filter(entry => entry.id !== item.id));
    debugWarn('ingestion', 'History item removed.', item);

    if (item.type !== 'Contacts') return;

    const shouldRemoveContact = (contact: Contact) => {
      if (item.batchId) {
        return contact.ingestionMeta.batchId === item.batchId;
      }
      return contact.ingestionMeta.sourceLabel === item.name;
    };

    setContacts(prev => {
      const nextContacts = prev.filter(contact => !shouldRemoveContact(contact));
      debugWarn('ingestion', 'Cascade deleted contacts from universe.', {
        removedCount: prev.length - nextContacts.length,
        batchId: item.batchId,
        source: item.name
      });
      return nextContacts;
    });
    setSelectedContact(prev => (prev && shouldRemoveContact(prev) ? null : prev));
  };

  const handleClearContacts = () => {
    setContacts([]);
    setActiveTab('dashboard');
    debugWarn('ingestion', 'All contacts cleared from universe.');
  };

  const handleClearKnowledge = () => {
    bridgeMemory.clear();
    setThesisVersion(prev => prev + 1);
    debugWarn('knowledge', 'Knowledge base cleared.');
  };

  // Chat Management Methods
  const handleUpdateThreads = (updatedThreads: ChatThread[]) => {
    setThreads(updatedThreads);
    debugInfo('chat', 'Chat threads updated.', { count: updatedThreads.length });
  };

  // Sync status indicator component
  const SyncIndicator = () => {
    if (!user) return null;

    const getIcon = () => {
      switch (syncState.status) {
        case 'syncing':
          return <RefreshCw size={14} className="text-amber-400 animate-spin" />;
        case 'synced':
          return <Cloud size={14} className="text-emerald-400" />;
        case 'error':
          return <AlertCircle size={14} className="text-red-400" />;
        default:
          return <CloudOff size={14} className="text-slate-500" />;
      }
    };

    const getLabel = () => {
      switch (syncState.status) {
        case 'syncing':
          return 'Syncing...';
        case 'synced':
          return syncState.lastSyncedAt
            ? `Synced ${new Date(syncState.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Synced';
        case 'error':
          return 'Sync Error';
        default:
          return 'Not Synced';
      }
    };

    return (
      <button
        onClick={handleForceSync}
        disabled={syncState.status === 'syncing'}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
        title="Click to force sync"
      >
        {getIcon()}
        <span>{getLabel()}</span>
      </button>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard contacts={contacts} />;
      case 'contacts':
        return <ContactList contacts={contacts} onSelectContact={setSelectedContact} />;
      case 'upload':
        return (
          <UploadZone
            onIngestContacts={handleIngestContacts}
            onThesisUpdate={handleThesisUpdate}
            history={ingestionHistory}
            onAddHistory={handleAddHistory}
            onDeleteHistoryItem={handleDeleteHistoryItem}
          />
        );
      case 'settings':
        return (
          <Settings
            settings={settings}
            onUpdateSettings={setSettings}
            onClearContacts={handleClearContacts}
            onClearKnowledge={handleClearKnowledge}
          />
        );
      case 'thesis':
        const thesisChunks = bridgeMemory.getByTag('thesis');
        const contextChunks = bridgeMemory.getByTag('context');

        return (
          <div className="flex flex-col h-full max-w-7xl mx-auto">
            <div className="mb-6">
              <h3 className="text-xl font-bold text-white">Bridge Knowledge Base</h3>
              <p className="text-slate-400 text-sm">Active governance rules and strategic context used for RAG.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="bg-slate-800 p-4 rounded border border-slate-700">
                <p className="text-xs text-slate-500 uppercase">Memory Chunks</p>
                <p className="text-2xl font-bold text-white">{bridgeMemory.getStats().totalChunks}</p>
              </div>
              <div className="bg-slate-800 p-4 rounded border border-slate-700">
                <p className="text-xs text-slate-500 uppercase">Context Sources</p>
                <p className="text-2xl font-bold text-blue-400">{bridgeMemory.getStats().sources}</p>
              </div>
              <div className="bg-slate-800 p-4 rounded border border-slate-700">
                <p className="text-xs text-slate-500 uppercase">Version</p>
                <p className="text-2xl font-bold text-emerald-400">v{thesisVersion + 1}.0</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden min-h-0">
              {/* Column 1: Thesis */}
              <div className="flex flex-col h-full overflow-hidden bg-slate-900 border border-slate-800 rounded-xl">
                <div className="p-4 border-b border-slate-800 bg-red-900/10 flex items-center justify-between">
                  <h4 className="font-bold text-red-200 uppercase text-sm tracking-wider">Constitution & Rules</h4>
                  <span className="text-xs bg-red-900/30 text-red-300 px-2 py-1 rounded">{thesisChunks.length} chunks</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {thesisChunks.length === 0 ? (
                    <p className="text-slate-600 text-sm italic text-center mt-10">No hard rules defined.</p>
                  ) : thesisChunks.map(chunk => (
                    <div key={chunk.id} className="bg-slate-950 p-3 rounded border border-slate-800">
                      <p className="text-slate-300 text-sm font-mono leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
                      <div className="mt-2 flex justify-between items-center">
                        <span className="text-[10px] text-slate-600 uppercase">{chunk.source}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Column 2: Context */}
              <div className="flex flex-col h-full overflow-hidden bg-slate-900 border border-slate-800 rounded-xl">
                <div className="p-4 border-b border-slate-800 bg-emerald-900/10 flex items-center justify-between">
                  <h4 className="font-bold text-emerald-200 uppercase text-sm tracking-wider">Strategic Context</h4>
                  <span className="text-xs bg-emerald-900/30 text-emerald-300 px-2 py-1 rounded">{contextChunks.length} chunks</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {contextChunks.length === 0 ? (
                    <p className="text-slate-600 text-sm italic text-center mt-10">No context documents loaded.</p>
                  ) : contextChunks.map(chunk => (
                    <div key={chunk.id} className="bg-slate-950 p-3 rounded border border-slate-800">
                      <p className="text-slate-300 text-sm font-mono leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
                      <div className="mt-2 flex justify-between items-center">
                        <span className="text-[10px] text-slate-600 uppercase">{chunk.source}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return <div className="text-slate-500 p-8">Section under construction</div>;
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <header className="h-16 border-b border-slate-800 flex items-center px-8 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
          <h2 className="text-xl font-semibold text-white capitalize">
            {activeTab === 'upload' ? 'Ingestion' : activeTab}
          </h2>
          <div className="ml-auto flex items-center gap-4">
            <span className="text-xs text-slate-500">v1.2.0-LEVIATHAN</span>

            {/* Sync Indicator */}
            <SyncIndicator />

            {/* Auth Section */}
            {user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-full border border-slate-700">
                  <User size={14} className="text-emerald-400" />
                  <span className="text-xs text-slate-300">{user.username}</span>
                </div>
                <button
                  onClick={() => setShowLogoutModal(true)}
                  disabled={authLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                >
                  <LogOut size={14} />
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={handleSignIn}
                disabled={authLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors"
              >
                <LogIn size={14} />
                {authLoading ? 'Loading...' : 'Sign In'}
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8 relative">
          {/* ChatInterface is ALWAYS rendered but hidden via CSS - preserves state */}
          <div style={{ display: activeTab === 'chat' ? 'block' : 'none' }} className="h-full">
            <ChatInterface
              contacts={contacts}
              onBatchUpdateContacts={handleBatchUpdateContacts}
              settings={settings}
              threads={threads}
              activeThreadId={activeThreadId}
              onUpdateThreads={handleUpdateThreads}
              onSetActiveThread={setActiveThreadId}
            />
          </div>

          {/* Render other tabs normally */}
          {activeTab !== 'chat' && renderContent()}
        </div>

        {selectedContact && (
          <ContactDetail
            contact={selectedContact}
            onClose={() => setSelectedContact(null)}
            onUpdate={handleUpdateContact}
            settings={settings}
          />
        )}

        {/* Logout Confirmation Modal */}
        {showLogoutModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-2">Sign Out</h3>
              <p className="text-slate-400 text-sm mb-6">
                Do you want to clear your local data? If you keep it, your data will remain on this device but won't sync until you sign in again.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => handleSignOut(true)}
                  className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Sign Out & Clear Data
                </button>
                <button
                  onClick={() => handleSignOut(false)}
                  className="w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Sign Out & Keep Data
                </button>
                <button
                  onClick={() => setShowLogoutModal(false)}
                  className="w-full px-4 py-2.5 text-slate-400 hover:text-white text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <DebugPanel />
      </main>
    </div>
  );
};

export default App;
