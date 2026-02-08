import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import { Contact, AppSettings, IngestionHistoryItem, ChatThread, SyncState, Organization, OrganizationMember, OrganizationWorkspacePackage } from './types';
import { bridgeMemory } from './services/bridgeMemory';
import {
  loadContacts, saveContactsDebounced,
  loadThreads, saveThreadsDebounced,
  loadSettings, saveSettings,
  loadKnowledge,
  loadIngestionHistory, saveIngestionHistoryDebounced,
  loadFromCloud, saveToCloudDebounced, saveToCloud,
  setCurrentUser, clearCurrentUserData, loadSyncState, saveSyncState,
  loadOrganization, saveOrganizationDebounced,
  loadOrganizationWorkspaceFromCloud,
  saveOrganizationWorkspaceToCloud,
  saveOrganizationWorkspaceToCloudDebounced
} from './services/storageService';
import { debugError, debugInfo, debugWarn } from './services/debugService';
import { createDefaultSettings } from './services/settingsService';
import {
  INTRO_REQUEST_LIST,
  createOrganization,
  createInvitePin,
  createOrganizationInviteCode,
  createOrganizationSyncPackage,
  dedupeContacts,
  mergeContactsWithDedupe,
  organizationFromInvite,
  parseOrganizationInviteCode,
  parseOrganizationSyncPackage,
  upsertOrganizationMember
} from './services/organizationService';
import { LogIn, LogOut, User, Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';

const Dashboard = React.lazy(() => import('./components/Dashboard'));
const ContactList = React.lazy(() => import('./components/ContactList'));
const ContactDetail = React.lazy(() => import('./components/ContactDetail'));
const UploadZone = React.lazy(() => import('./components/UploadZone'));
const ChatInterface = React.lazy(() => import('./components/ChatInterface'));
const Settings = React.lazy(() => import('./components/Settings'));
const DebugPanel = React.lazy(() => import('./components/DebugPanel'));
const OrganizationHub = React.lazy(() => import('./components/OrganizationHub'));

const ORG_REFRESH_INTERVAL_MS = 30000;
const ORG_REFRESH_MIN_GAP_MS = 8000;

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

type AuthUser = { username: string; email?: string; uuid?: string };

function toOrganizationMember(user: AuthUser, role: 'owner' | 'member' = 'member'): OrganizationMember {
  return {
    userId: user.uuid || user.username,
    username: user.username,
    email: user.email,
    role,
    joinedAt: new Date().toISOString(),
  };
}

function orgThesisSource(orgId: string): string {
  return `org:${orgId}:thesis`;
}

function orgContextSource(orgId: string): string {
  return `org:${orgId}:context`;
}

function appendOrganizationDocument(existing: string, fileName: string, text: string): string {
  const section = `[${fileName}]\n${text.trim()}`;
  if (!existing.trim()) return section;
  return `${existing.trim()}\n\n${section}`;
}

function normalizeListValues(lists: string[] | undefined): string[] {
  return [...new Set((lists || []).map((list) => list.trim()).filter(Boolean))];
}

function setContactIntroRequest(contact: Contact, requested: boolean, changedAt = new Date().toISOString()): Contact {
  const normalizedLists = normalizeListValues(contact.lists);
  const nextLists = requested
    ? [...new Set([...normalizedLists, INTRO_REQUEST_LIST])]
    : normalizedLists.filter((list) => list !== INTRO_REQUEST_LIST);

  return {
    ...contact,
    lists: nextLists,
    introRequested: requested,
    introRequestedAt: requested ? (contact.introRequestedAt || new Date().toISOString()) : undefined,
    collaboration: {
      ...(contact.collaboration || {}),
      introUpdatedAt: changedAt,
      listsUpdatedAt: changedAt,
    },
  };
}

function setContactTeamFlag(contact: Contact, flagged: boolean, changedAt = new Date().toISOString()): Contact {
  return {
    ...contact,
    teamFlagged: flagged,
    collaboration: {
      ...(contact.collaboration || {}),
      teamFlaggedUpdatedAt: changedAt,
    },
  };
}

function normalizeContactCollaboration(contact: Contact): Contact {
  const normalizedLists = normalizeListValues(contact.lists);
  const hasIntroList = normalizedLists.includes(INTRO_REQUEST_LIST);
  const introRequested = typeof contact.introRequested === 'boolean'
    ? contact.introRequested
    : hasIntroList;
  const lists = introRequested
    ? [...new Set([...normalizedLists.filter((list) => list !== INTRO_REQUEST_LIST), INTRO_REQUEST_LIST])]
    : normalizedLists.filter((list) => list !== INTRO_REQUEST_LIST);
  const collaboration = contact.collaboration && (
    contact.collaboration.introUpdatedAt ||
    contact.collaboration.listsUpdatedAt ||
    contact.collaboration.teamFlaggedUpdatedAt
  )
    ? contact.collaboration
    : undefined;

  return {
    ...contact,
    lists,
    introRequested,
    introRequestedAt: introRequested ? contact.introRequestedAt : undefined,
    collaboration,
  };
}

function mergeOrganizationRecords(local: Organization, remote: Organization): Organization {
  const newer = remote.updatedAt >= local.updatedAt ? remote : local;
  const older = newer === remote ? local : remote;
  const memberMap = new Map<string, OrganizationMember>();
  older.members.forEach(member => memberMap.set(member.userId, member));
  newer.members.forEach(member => memberMap.set(member.userId, member));

  return {
    ...newer,
    members: Array.from(memberMap.values()),
    invitePin: newer.invitePin || older.invitePin,
    inviteCode: newer.inviteCode || older.inviteCode,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

function organizationSnapshotKey(org: Organization): string {
  const members = [...org.members]
    .map((member) => `${member.userId}|${member.username}|${member.email || ''}|${member.role}|${member.joinedAt}`)
    .sort()
    .join('||');
  return [
    org.id,
    org.name,
    org.thesis,
    org.strategicContext,
    org.ownerId,
    org.invitePin || '',
    org.updatedAt.toString(),
    members,
  ].join('::');
}

function mergeKnowledgeChunks(
  existing: ReturnType<typeof bridgeMemory.getAllChunks>,
  incoming: ReturnType<typeof bridgeMemory.getAllChunks>
) {
  const merged = [...existing];
  const seen = new Set(existing.map(chunk => `${chunk.source}|${chunk.content}`));
  incoming.forEach(chunk => {
    const key = `${chunk.source}|${chunk.content}`;
    if (!seen.has(key)) {
      merged.push(chunk);
      seen.add(key);
    }
  });
  return merged;
}

function mergeIngestionHistoryItems(existing: IngestionHistoryItem[], incoming: IngestionHistoryItem[]) {
  const merged = [...existing];
  const seen = new Set(existing.map(item => item.id));
  incoming.forEach(item => {
    if (!seen.has(item.id)) {
      merged.push(item);
      seen.add(item.id);
    }
  });
  return merged;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [ingestionHistory, setIngestionHistory] = useState<IngestionHistoryItem[]>([]);

  // Chat State (Lifted)
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('default');
  const [chatMounted, setChatMounted] = useState(false);

  // Track thesis version to force re-render of Thesis tab when memory updates
  const [thesisVersion, setThesisVersion] = useState(0);

  // Settings
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings());

  // Auth state
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', lastSyncedAt: null });
  const [isSynced, setIsSynced] = useState(false);

  // Organization
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [orgMessage, setOrgMessage] = useState<string | null>(null);
  const orgContextIdRef = useRef<string | null>(null);
  const orgWorkspaceLoadedRef = useRef<string | null>(null);
  const orgRefreshInFlightRef = useRef(false);
  const contactsRef = useRef<Contact[]>([]);
  const ingestionHistoryRef = useRef<IngestionHistoryItem[]>([]);
  const organizationRef = useRef<Organization | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const lastOrgRefreshAtRef = useRef(0);

  // Logout confirmation modal
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    ingestionHistoryRef.current = ingestionHistory;
  }, [ingestionHistory]);

  useEffect(() => {
    organizationRef.current = organization;
  }, [organization]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (activeTab === 'chat') setChatMounted(true);
  }, [activeTab]);

  const buildWorkspacePayload = useCallback((orgValue: Organization): OrganizationWorkspacePackage => ({
    version: 1,
    orgId: orgValue.id,
    updatedAt: new Date().toISOString(),
    updatedBy: user?.username || 'unknown',
    organization: orgValue,
    contacts,
    knowledge: bridgeMemory.getAllChunks(),
    ingestionHistory
  }), [contacts, ingestionHistory, user?.username]);

  useEffect(() => {
    const originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };

    const bindings: Array<{ method: 'warn' | 'error'; logger: typeof debugWarn }> = [
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
    if (typeof puter === 'undefined') {
      debugWarn('auth', 'Puter SDK global not detected at app init. AI enrichment may fail until script loads.');
    } else {
      debugInfo('auth', 'Puter SDK detected.');
    }

    return () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    };
  }, []);

  const syncOrganizationContext = useCallback((nextOrg: Organization | null) => {
    const previousOrgId = orgContextIdRef.current;
    if (previousOrgId && (!nextOrg || nextOrg.id !== previousOrgId)) {
      bridgeMemory.replaceSourceDocument('', orgThesisSource(previousOrgId), 'thesis');
      bridgeMemory.replaceSourceDocument('', orgContextSource(previousOrgId), 'context');
    }

    if (nextOrg) {
      bridgeMemory.replaceSourceDocument(nextOrg.thesis, orgThesisSource(nextOrg.id), 'thesis');
      bridgeMemory.replaceSourceDocument(nextOrg.strategicContext, orgContextSource(nextOrg.id), 'context');
      orgContextIdRef.current = nextOrg.id;
    } else {
      orgContextIdRef.current = null;
    }

    setThesisVersion(v => v + 1);
  }, []);

  // Load user data for a specific user
  const loadUserData = useCallback(() => {
    const loadedContacts = loadContacts();
    const loadedThreads = loadThreads();
    const loadedSettings = loadSettings();
    const loadedSyncState = loadSyncState();
    const loadedKnowledge = loadKnowledge();
    const loadedIngestionHistory = loadIngestionHistory();
    const loadedOrganization = loadOrganization();

    setContacts(loadedContacts);
    setThreads(loadedThreads);
    setActiveThreadId(loadedThreads.length > 0 ? loadedThreads[0].id : 'default');
    setSettings(loadedSettings);
    setSyncState(loadedSyncState);
    setIngestionHistory(loadedIngestionHistory);
    setOrganization(loadedOrganization);

    bridgeMemory.initialize(loadedKnowledge);
    syncOrganizationContext(loadedOrganization);

    debugInfo('storage', 'Loaded local user data.', {
      contacts: loadedContacts.length,
      threads: loadedThreads.length,
      knowledgeChunks: loadedKnowledge.length,
      ingestionHistory: loadedIngestionHistory.length,
      organization: loadedOrganization?.id || null
    });
  }, [syncOrganizationContext]);

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
    setSettings(createDefaultSettings());
    setSyncState({ status: 'idle', lastSyncedAt: null });
    setIngestionHistory([]);
    setOrganization(null);
    setOrgMessage(null);
    bridgeMemory.clear();
    orgContextIdRef.current = null;
    orgWorkspaceLoadedRef.current = null;
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
            if (cloudData.knowledge) {
              bridgeMemory.initialize(cloudData.knowledge);
              setThesisVersion(v => v + 1);
            }
            if (cloudData.ingestionHistory) setIngestionHistory(cloudData.ingestionHistory);
            if (cloudData.organization) {
              setOrganization(cloudData.organization);
              syncOrganizationContext(cloudData.organization);
            }
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
  }, [loadUserData, syncOrganizationContext]);

  // Persist contacts when they change (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveContactsDebounced(contacts);
    if (user && settings.automation.autoSyncToCloud) saveToCloudDebounced();
  }, [contacts, isSynced, settings.automation.autoSyncToCloud, user]);

  // Persist threads when they change (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveThreadsDebounced(threads);
    if (user && settings.automation.autoSyncToCloud) saveToCloudDebounced();
  }, [threads, isSynced, settings.automation.autoSyncToCloud, user]);

  // Persist settings when they change (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveSettings(settings);
    if (user && settings.automation.autoSyncToCloud) saveToCloudDebounced();
  }, [settings, isSynced, settings.automation.autoSyncToCloud, user]);

  // Persist organization when it changes (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveOrganizationDebounced(organization);
    if (user && settings.automation.autoSyncToCloud) saveToCloudDebounced();
  }, [organization, isSynced, settings.automation.autoSyncToCloud, user]);

  // Persist ingestion history when it changes (Local + Cloud)
  useEffect(() => {
    if (!isSynced) return;
    saveIngestionHistoryDebounced(ingestionHistory);
    if (user && settings.automation.autoSyncToCloud) saveToCloudDebounced();
  }, [ingestionHistory, isSynced, settings.automation.autoSyncToCloud, user]);

  // Trigger cloud sync after thesis/context changes
  useEffect(() => {
    if (!isSynced || !user || !settings.automation.autoSyncToCloud) return;
    saveToCloudDebounced();
  }, [thesisVersion, isSynced, settings.automation.autoSyncToCloud, user]);

  useEffect(() => {
    if (!user || !organization) return;

    const userId = user.uuid || user.username;
    if (organization.members.some(member => member.userId === userId)) return;

    const role: 'owner' | 'member' = organization.ownerId === userId ? 'owner' : 'member';
    setOrganization(prev => (prev ? upsertOrganizationMember(prev, toOrganizationMember(user, role)) : prev));
  }, [user, organization]);

  useEffect(() => {
    if (!user || !organization || organization.invitePin) return;
    const role: 'owner' | 'member' = organization.ownerId === (user.uuid || user.username) ? 'owner' : 'member';
    const inviter = toOrganizationMember(user, role);
    const orgWithPin: Organization = {
      ...organization,
      invitePin: createInvitePin(),
      updatedAt: Date.now()
    };
    orgWithPin.inviteCode = createOrganizationInviteCode(orgWithPin, inviter);
    setOrganization(orgWithPin);
  }, [user, organization]);

  useEffect(() => {
    if (!isSynced || !user || !organization) return;
    if (orgWorkspaceLoadedRef.current === organization.id) return;

    let cancelled = false;
    const loadWorkspace = async () => {
      const role: 'owner' | 'member' = organization.ownerId === (user.uuid || user.username) ? 'owner' : 'member';
      const currentUserMember = toOrganizationMember(user, role);
      const localKnowledge = bridgeMemory.getAllChunks();
      const localHistory = ingestionHistory;
      const localContacts = contacts;

      const remote = await loadOrganizationWorkspaceFromCloud(organization.id);
      if (cancelled) return;

      if (remote) {
        const mergedOrganization = mergeOrganizationRecords(organization, remote.organization);
        const syncedOrganization = upsertOrganizationMember(mergedOrganization, currentUserMember);
        const mergedContacts = mergeContactsWithDedupe(localContacts, remote.contacts).contacts;
        const mergedKnowledge = mergeKnowledgeChunks(localKnowledge, remote.knowledge);
        const mergedHistory = mergeIngestionHistoryItems(localHistory, remote.ingestionHistory);

        setContacts(mergedContacts);
        setSelectedContact(prev => (prev ? mergedContacts.find(contact => contact.id === prev.id) || null : null));
        setIngestionHistory(mergedHistory);
        bridgeMemory.initialize(mergedKnowledge);
        setThesisVersion(v => v + 1);
        setOrganization(syncedOrganization);
        syncOrganizationContext(syncedOrganization);

        orgWorkspaceLoadedRef.current = organization.id;
        await saveOrganizationWorkspaceToCloud({
          version: 1,
          orgId: syncedOrganization.id,
          updatedAt: new Date().toISOString(),
          updatedBy: user.username,
          organization: syncedOrganization,
          contacts: mergedContacts,
          knowledge: mergedKnowledge,
          ingestionHistory: mergedHistory
        });
        setOrgMessage(`Organization workspace synced for "${syncedOrganization.name}".`);
        return;
      }

      const seededOrganization = upsertOrganizationMember(organization, currentUserMember);
      setOrganization(seededOrganization);
      syncOrganizationContext(seededOrganization);
      orgWorkspaceLoadedRef.current = organization.id;
      await saveOrganizationWorkspaceToCloud({
        version: 1,
        orgId: seededOrganization.id,
        updatedAt: new Date().toISOString(),
        updatedBy: user.username,
        organization: seededOrganization,
        contacts: localContacts,
        knowledge: localKnowledge,
        ingestionHistory: localHistory
      });
      setOrgMessage(`Organization workspace initialized for "${seededOrganization.name}".`);
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [isSynced, user, organization?.id]);

  const refreshOrganizationWorkspaceFromCloud = useCallback(async (force = false) => {
    const currentUser = userRef.current;
    const currentOrganization = organizationRef.current;
    if (!isSynced || !currentUser || !currentOrganization) return;
    if (orgWorkspaceLoadedRef.current !== currentOrganization.id) return;
    if (orgRefreshInFlightRef.current) return;

    const now = Date.now();
    if (!force && now - lastOrgRefreshAtRef.current < ORG_REFRESH_MIN_GAP_MS) return;
    lastOrgRefreshAtRef.current = now;

    orgRefreshInFlightRef.current = true;
    try {
      const role: 'owner' | 'member' =
        currentOrganization.ownerId === (currentUser.uuid || currentUser.username) ? 'owner' : 'member';
      const currentUserMember = toOrganizationMember(currentUser, role);
      const remote = await loadOrganizationWorkspaceFromCloud(currentOrganization.id);
      if (!remote) return;

      const localContacts = contactsRef.current;
      const localHistory = ingestionHistoryRef.current;
      const localKnowledge = bridgeMemory.getAllChunks();
      const mergedOrganization = upsertOrganizationMember(
        mergeOrganizationRecords(currentOrganization, remote.organization),
        currentUserMember
      );
      const contactMerge = mergeContactsWithDedupe(localContacts, remote.contacts);
      const mergedKnowledge = mergeKnowledgeChunks(localKnowledge, remote.knowledge);
      const mergedHistory = mergeIngestionHistoryItems(localHistory, remote.ingestionHistory);

      const organizationChanged =
        organizationSnapshotKey(mergedOrganization) !== organizationSnapshotKey(currentOrganization);
      const contactsChanged = contactMerge.added > 0 || contactMerge.merged > 0;
      const knowledgeChanged = mergedKnowledge.length !== localKnowledge.length;
      const historyChanged = mergedHistory.length !== localHistory.length;

      if (!organizationChanged && !contactsChanged && !knowledgeChanged && !historyChanged) return;

      if (contactsChanged) {
        setContacts(contactMerge.contacts);
        setSelectedContact(prev => (prev ? contactMerge.contacts.find(contact => contact.id === prev.id) || null : null));
      }
      if (historyChanged) setIngestionHistory(mergedHistory);
      if (knowledgeChanged) {
        bridgeMemory.initialize(mergedKnowledge);
        setThesisVersion(v => v + 1);
      }
      if (organizationChanged) {
        setOrganization(mergedOrganization);
        syncOrganizationContext(mergedOrganization);
      }

      if (mergedOrganization.members.length > currentOrganization.members.length) {
        setOrgMessage(`A teammate joined "${mergedOrganization.name}". Members now: ${mergedOrganization.members.length}.`);
      } else if (contactMerge.added > 0) {
        setOrgMessage(`Synced ${contactMerge.added} new shared contact${contactMerge.added === 1 ? '' : 's'} from "${mergedOrganization.name}".`);
      }
    } catch (e) {
      debugError('organization', 'Organization workspace refresh failed.', e);
    } finally {
      orgRefreshInFlightRef.current = false;
    }
  }, [isSynced, syncOrganizationContext]);

  useEffect(() => {
    if (!isSynced || !user || !organization) return;
    if (orgWorkspaceLoadedRef.current !== organization.id) return;

    void refreshOrganizationWorkspaceFromCloud(true);
    const handleForegroundRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshOrganizationWorkspaceFromCloud(true);
    };
    window.addEventListener('focus', handleForegroundRefresh);
    document.addEventListener('visibilitychange', handleForegroundRefresh);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refreshOrganizationWorkspaceFromCloud();
    }, ORG_REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', handleForegroundRefresh);
      document.removeEventListener('visibilitychange', handleForegroundRefresh);
      window.clearInterval(intervalId);
    };
  }, [isSynced, user, organization?.id, refreshOrganizationWorkspaceFromCloud]);

  useEffect(() => {
    if (!isSynced || !user || !organization) return;
    if (orgWorkspaceLoadedRef.current !== organization.id) return;
    saveOrganizationWorkspaceToCloudDebounced(buildWorkspacePayload(organization));
  }, [isSynced, user, organization, contacts, ingestionHistory, thesisVersion, buildWorkspacePayload]);

  useEffect(() => {
    if (!organization) {
      orgWorkspaceLoadedRef.current = null;
      lastOrgRefreshAtRef.current = 0;
    }
  }, [organization]);

  // Force sync to cloud
  const handleForceSync = async () => {
    if (!user) return;
    setSyncState({ status: 'syncing', lastSyncedAt: syncState.lastSyncedAt });
    debugInfo('sync', 'Manual force sync started.');
    const newState = await saveToCloud();

    if (organization) {
      const role: 'owner' | 'member' = organization.ownerId === (user.uuid || user.username) ? 'owner' : 'member';
      const currentUserMember = toOrganizationMember(user, role);
      const remote = await loadOrganizationWorkspaceFromCloud(organization.id);

      if (remote) {
        const syncedOrganization = upsertOrganizationMember(
          mergeOrganizationRecords(organization, remote.organization),
          currentUserMember
        );
        const mergedContacts = mergeContactsWithDedupe(contacts, remote.contacts).contacts;
        const mergedKnowledge = mergeKnowledgeChunks(bridgeMemory.getAllChunks(), remote.knowledge);
        const mergedHistory = mergeIngestionHistoryItems(ingestionHistory, remote.ingestionHistory);

        setContacts(mergedContacts);
        setSelectedContact(prev => (prev ? mergedContacts.find(contact => contact.id === prev.id) || null : null));
        setIngestionHistory(mergedHistory);
        bridgeMemory.initialize(mergedKnowledge);
        setThesisVersion(v => v + 1);
        setOrganization(syncedOrganization);
        syncOrganizationContext(syncedOrganization);
        orgWorkspaceLoadedRef.current = syncedOrganization.id;

        await saveOrganizationWorkspaceToCloud({
          version: 1,
          orgId: syncedOrganization.id,
          updatedAt: new Date().toISOString(),
          updatedBy: user.username,
          organization: syncedOrganization,
          contacts: mergedContacts,
          knowledge: mergedKnowledge,
          ingestionHistory: mergedHistory
        });
      } else {
        const seededOrganization = upsertOrganizationMember(organization, currentUserMember);
        setOrganization(seededOrganization);
        syncOrganizationContext(seededOrganization);
        orgWorkspaceLoadedRef.current = seededOrganization.id;
        await saveOrganizationWorkspaceToCloud(buildWorkspacePayload(seededOrganization));
      }
    }

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
        loadUserData();

        // Load data from cloud on fresh sign-in
        setSyncState({ status: 'syncing', lastSyncedAt: null });
        const cloudData = await loadFromCloud();
        if (cloudData.contacts) setContacts(cloudData.contacts);
        if (cloudData.threads) {
          setThreads(cloudData.threads);
          setActiveThreadId(cloudData.threads[0]?.id || 'default');
        }
        if (cloudData.settings) setSettings(cloudData.settings);
        if (cloudData.knowledge) {
          bridgeMemory.initialize(cloudData.knowledge);
          setThesisVersion(v => v + 1);
        }
        if (cloudData.ingestionHistory) setIngestionHistory(cloudData.ingestionHistory);
        if (cloudData.organization) {
          setOrganization(cloudData.organization);
          syncOrganizationContext(cloudData.organization);
        }
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
      setOrgMessage(null);
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
    const normalized = normalizeContactCollaboration(updated);
    setContacts(prev => prev.map(c => c.id === normalized.id ? normalized : c));
    setSelectedContact(normalized);
  };

  const handleDeleteContacts = (contactIds: string[]) => {
    if (contactIds.length === 0) return;
    const targets = new Set(contactIds);
    setContacts(prev => prev.filter(contact => !targets.has(contact.id)));
    setSelectedContact(prev => (prev && targets.has(prev.id) ? null : prev));
    debugWarn('contacts', 'Contacts deleted.', { count: contactIds.length });
  };

  const handleDeleteContact = (contactId: string) => {
    handleDeleteContacts([contactId]);
  };

  const handleToggleTeamFlag = (contactId: string) => {
    const changedAt = new Date().toISOString();
    setContacts(prev => prev.map(contact => (
      contact.id === contactId
        ? setContactTeamFlag(contact, !contact.teamFlagged, changedAt)
        : contact
    )));

    setSelectedContact(prev => (
      prev && prev.id === contactId
        ? setContactTeamFlag(prev, !prev.teamFlagged, changedAt)
        : prev
    ));
  };

  const handleToggleIntroRequest = (contactId: string) => {
    const changedAt = new Date().toISOString();
    setContacts(prev => prev.map(contact => (
      contact.id === contactId
        ? setContactIntroRequest(contact, !contact.introRequested, changedAt)
        : contact
    )));

    setSelectedContact(prev => (
      prev && prev.id === contactId
        ? setContactIntroRequest(prev, !prev.introRequested, changedAt)
        : prev
    ));
  };

  const handleOpenContactFromDashboard = (contactId: string) => {
    const match = contacts.find(contact => contact.id === contactId);
    if (!match) return;
    setActiveTab('contacts');
    setSelectedContact(match);
  };

  const handleBatchUpdateContacts = (updates: Contact[]) => {
    const normalizedUpdates = updates.map(normalizeContactCollaboration);
    setContacts(prev => {
      const newContacts = [...prev];
      normalizedUpdates.forEach(u => {
        const idx = newContacts.findIndex(c => c.id === u.id);
        if (idx > -1) newContacts[idx] = u;
      });
      return newContacts;
    });

    if (selectedContact) {
      const updatedSelected = normalizedUpdates.find(update => update.id === selectedContact.id);
      if (updatedSelected) setSelectedContact(updatedSelected);
    }
  };

  const handleIngestContacts = (newContacts: Contact[]) => {
    const normalizedContacts = newContacts.map(normalizeContactCollaboration);
    const mergeResult = mergeContactsWithDedupe(contacts, normalizedContacts);
    setContacts(mergeResult.contacts);
    if (settings.automation.autoSwitchToContactsOnIngest) {
      setActiveTab('contacts');
    }
    if (mergeResult.duplicates > 0) {
      setOrgMessage(
        `Ingestion dedupe: ${mergeResult.added} new contacts, ${mergeResult.duplicates} duplicates merged.`
      );
    }
    debugInfo('ingestion', 'Contacts ingested into universe.', {
      imported: normalizedContacts.length,
      added: mergeResult.added,
      duplicates: mergeResult.duplicates,
      merged: mergeResult.merged
    });
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
    orgContextIdRef.current = null;
    setThesisVersion(prev => prev + 1);
    debugWarn('knowledge', 'Knowledge base cleared.');
  };

  const handleCreateOrganization = (payload: { name: string; thesis: string; strategicContext: string }) => {
    if (!user) {
      setOrgMessage('Sign in first to create an organization.');
      return;
    }

    const name = payload.name.trim();
    if (!name) {
      setOrgMessage('Organization name is required.');
      return;
    }

    const ownerMember = toOrganizationMember(user, 'owner');
    const nextOrg = createOrganization({
      name,
      thesis: payload.thesis,
      strategicContext: payload.strategicContext,
      owner: ownerMember
    });

    orgWorkspaceLoadedRef.current = null;
    setOrganization(nextOrg);
    syncOrganizationContext(nextOrg);
    setOrgMessage(`Created organization "${nextOrg.name}"${nextOrg.invitePin ? ` (PIN ${nextOrg.invitePin})` : ''}.`);
    debugInfo('organization', 'Organization created.', {
      id: nextOrg.id,
      name: nextOrg.name
    });
  };

  const handleJoinOrganization = (inviteCode: string) => {
    if (!user) {
      setOrgMessage('Sign in first to join an organization.');
      return;
    }

    const parsed = parseOrganizationInviteCode(inviteCode);
    if (!parsed.ok || !parsed.payload) {
      setOrgMessage(parsed.error || 'Invite code is invalid.');
      return;
    }

    const joiningMember = toOrganizationMember(user, 'member');

    const nextOrg = organizationFromInvite(parsed.payload, joiningMember);
    orgWorkspaceLoadedRef.current = null;
    setOrganization(nextOrg);
    syncOrganizationContext(nextOrg);
    setOrgMessage(`Joined "${nextOrg.name}". Shared members, contacts, and context now sync automatically across teammates.`);
    debugInfo('organization', 'Organization joined via invite.', {
      id: nextOrg.id,
      member: joiningMember.userId
    });
  };

  const handleUpdateOrganization = (payload: { name: string; thesis: string; strategicContext: string }) => {
    if (!organization) return;

    const nextOrg: Organization = {
      ...organization,
      name: payload.name.trim() || organization.name,
      thesis: payload.thesis,
      strategicContext: payload.strategicContext,
      updatedAt: Date.now()
    };

    setOrganization(nextOrg);
    syncOrganizationContext(nextOrg);
    setOrgMessage('Organization context updated.');
    debugInfo('organization', 'Organization context updated.', { id: nextOrg.id });
  };

  const handleGenerateOrganizationInvite = () => {
    if (!organization || !user) return;

    const role: 'owner' | 'member' = organization.ownerId === (user.uuid || user.username) ? 'owner' : 'member';
    const inviter = toOrganizationMember(user, role);
    const invitePin = organization.invitePin || createInvitePin();
    const orgWithPin: Organization = {
      ...organization,
      invitePin
    };
    const nextOrg: Organization = {
      ...orgWithPin,
      inviteCode: createOrganizationInviteCode(orgWithPin, inviter),
      updatedAt: Date.now()
    };

    setOrganization(nextOrg);
    setOrgMessage(`Generated a fresh invite code${nextOrg.invitePin ? ` (PIN ${nextOrg.invitePin})` : ''}.`);
    debugInfo('organization', 'Invite regenerated.', {
      id: nextOrg.id,
      inviter: inviter.userId
    });
  };

  const handleDedupeContacts = () => {
    const result = dedupeContacts(contacts);
    setContacts(result.contacts);
    setSelectedContact(prev => (prev ? result.contacts.find(c => c.id === prev.id) || null : null));
    setOrgMessage(`Dedup complete: ${result.duplicates} duplicates merged, ${result.contacts.length} canonical contacts.`);
    debugInfo('organization', 'Deduplication completed.', result);
  };

  const handleIngestOrganizationContacts = async (file: File) => {
    try {
      const { parseAndMapCSV } = await import('./services/csvService');
      const parsedContacts = await parseAndMapCSV(file);
      if (parsedContacts.length === 0) {
        throw new Error(`No valid contacts found in "${file.name}".`);
      }

      const batchId = `org-ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sourceLabel = organization ? `${organization.name} (${file.name})` : file.name;
      const preparedContacts = parsedContacts.map((contact) => ({
        ...normalizeContactCollaboration(contact),
        ingestionMeta: {
          ...contact.ingestionMeta,
          sourceLabel,
          batchId
        }
      }));

      const mergeResult = mergeContactsWithDedupe(contacts, preparedContacts);
      setContacts(mergeResult.contacts);
      setSelectedContact(prev => (prev ? mergeResult.contacts.find(c => c.id === prev.id) || null : null));
      handleAddHistory(file.name, 'Contacts', {
        batchId,
        recordCount: preparedContacts.length
      });
      setOrgMessage(
        `Imported ${preparedContacts.length} contacts from ${file.name}. Added ${mergeResult.added}, merged ${mergeResult.duplicates} duplicates.`
      );
      debugInfo('organization', 'Organization contacts imported.', {
        fileName: file.name,
        total: preparedContacts.length,
        added: mergeResult.added,
        duplicates: mergeResult.duplicates
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOrgMessage(`Contact import failed: ${message}`);
      debugError('organization', 'Organization contact import failed.', e);
      throw e instanceof Error ? e : new Error(message);
    }
  };

  const handleIngestOrganizationDocument = async (file: File, target: 'thesis' | 'context') => {
    if (!organization) {
      const error = new Error('Create or join an organization before adding shared documents.');
      setOrgMessage(error.message);
      throw error;
    }

    try {
      const { extractTextFromKnowledgeFile } = await import('./services/documentService');
      const extracted = await extractTextFromKnowledgeFile(file);
      const nextOrganization: Organization = {
        ...organization,
        thesis: target === 'thesis'
          ? appendOrganizationDocument(organization.thesis, file.name, extracted.text)
          : organization.thesis,
        strategicContext: target === 'context'
          ? appendOrganizationDocument(organization.strategicContext, file.name, extracted.text)
          : organization.strategicContext,
        updatedAt: Date.now()
      };

      setOrganization(nextOrganization);
      syncOrganizationContext(nextOrganization);
      handleAddHistory(file.name, target === 'thesis' ? 'Thesis' : 'Context');
      setOrgMessage(`Added ${file.name} to shared ${target === 'thesis' ? 'thesis' : 'strategic context'}.`);
      debugInfo('organization', 'Organization document imported.', {
        fileName: file.name,
        target,
        fileType: extracted.fileType,
        pageCount: extracted.pageCount,
        rowCount: extracted.rowCount
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOrgMessage(`Document import failed: ${message}`);
      debugError('organization', 'Organization document import failed.', e);
      throw e instanceof Error ? e : new Error(message);
    }
  };

  const handleExportOrganizationPackage = () => {
    if (!organization || !user) {
      setOrgMessage('Create or join an organization before exporting.');
      return;
    }

    const pkg = createOrganizationSyncPackage({
      organization,
      contacts,
      exportedBy: user.username
    });

    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${organization.name.replace(/\s+/g, '-').toLowerCase()}-org-package.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setOrgMessage(`Exported organization package with ${contacts.length} contacts.`);
    debugInfo('organization', 'Organization package exported.', {
      id: organization.id,
      contacts: contacts.length
    });
  };

  const handleImportOrganizationPackage = async (file: File) => {
    try {
      const raw = await file.text();
      const parsed = parseOrganizationSyncPackage(raw);
      if (!parsed.ok || !parsed.payload) {
        setOrgMessage(parsed.error || 'Invalid organization package.');
        return;
      }

      const incoming = parsed.payload;
      let nextOrganization = incoming.organization;

      if (user) {
        const role: 'owner' | 'member' =
          incoming.organization.ownerId === (user.uuid || user.username) ? 'owner' : 'member';
        nextOrganization = upsertOrganizationMember(incoming.organization, toOrganizationMember(user, role));
      }

      const mergeResult = mergeContactsWithDedupe(contacts, incoming.contacts);
      setContacts(mergeResult.contacts);
      setSelectedContact(prev => (prev ? mergeResult.contacts.find(c => c.id === prev.id) || null : null));
      orgWorkspaceLoadedRef.current = null;
      setOrganization(nextOrganization);
      syncOrganizationContext(nextOrganization);

      setOrgMessage(
        `Imported package from ${incoming.exportedBy}. Added ${mergeResult.added}, merged ${mergeResult.duplicates} duplicates.`
      );
      debugInfo('organization', 'Organization package imported.', {
        id: nextOrganization.id,
        added: mergeResult.added,
        duplicates: mergeResult.duplicates
      });
    } catch (e) {
      setOrgMessage('Failed to import organization package.');
      debugError('organization', 'Organization package import failed.', e);
    }
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
        return (
          <Dashboard
            contacts={contacts}
            settings={settings}
            organization={organization}
            onSelectContact={handleOpenContactFromDashboard}
            onDeleteContact={handleDeleteContact}
            onToggleFlag={handleToggleTeamFlag}
          />
        );
      case 'contacts':
        return (
          <ContactList
            contacts={contacts}
            onSelectContact={setSelectedContact}
            onBatchUpdateContacts={handleBatchUpdateContacts}
            onDeleteContacts={handleDeleteContacts}
            onToggleIntroRequest={handleToggleIntroRequest}
          />
        );
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
      case 'organization':
        return (
          <OrganizationHub
            user={user}
            organization={organization}
            contactsCount={contacts.length}
            orgMessage={orgMessage}
            onCreateOrganization={handleCreateOrganization}
            onJoinOrganization={handleJoinOrganization}
            onUpdateOrganization={handleUpdateOrganization}
            onGenerateInvite={handleGenerateOrganizationInvite}
            onDedupeContacts={handleDedupeContacts}
            onExportPackage={handleExportOrganizationPackage}
            onImportPackage={handleImportOrganizationPackage}
            onIngestOrganizationContacts={handleIngestOrganizationContacts}
            onIngestOrganizationDocument={handleIngestOrganizationDocument}
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
                  {organization && (
                    <span className="text-[10px] text-blue-300 border-l border-slate-600 pl-2">
                      {organization.name}
                    </span>
                  )}
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
          {chatMounted && (
            <Suspense fallback={activeTab === 'chat'
              ? <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading chat...</div>
              : null}
            >
              <ChatInterface
                isVisible={activeTab === 'chat'}
                contacts={contacts}
                onBatchUpdateContacts={handleBatchUpdateContacts}
                settings={settings}
                threads={threads}
                activeThreadId={activeThreadId}
                onUpdateThreads={handleUpdateThreads}
                onSetActiveThread={setActiveThreadId}
              />
            </Suspense>
          )}

          {/* Render other tabs normally */}
          {activeTab !== 'chat' && (
            <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading section...</div>}>
              {renderContent()}
            </Suspense>
          )}
        </div>

        {selectedContact && (
          <Suspense fallback={null}>
            <ContactDetail
              contact={selectedContact}
              onClose={() => setSelectedContact(null)}
              onUpdate={handleUpdateContact}
              onDelete={handleDeleteContact}
              onToggleFlag={handleToggleTeamFlag}
              onToggleIntroRequest={handleToggleIntroRequest}
              settings={settings}
            />
          </Suspense>
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
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      </main>
    </div>
  );
};

export default App;
