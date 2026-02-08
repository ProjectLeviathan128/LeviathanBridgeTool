/**
 * Storage Service - Handles localStorage persistence for Bridge
 * All data survives page refresh
 * Now with user isolation via prefixed keys
 */

// Current user ID for key prefixing (set on login, cleared on logout)
let currentUserId: string | null = null;

// Base keys (will be prefixed with userId when user is logged in)
const BASE_KEYS = {
    CONTACTS: 'contacts',
    KNOWLEDGE: 'knowledge',
    THREADS: 'threads',
    SETTINGS: 'settings',
    ORGANIZATION: 'organization',
    INGESTION_HISTORY: 'ingestion_history',
} as const;

// Get the actual storage key (prefixed if user is logged in)
function getStorageKey(baseKey: string): string {
    if (currentUserId) {
        return `bridge_${currentUserId}_${baseKey}`;
    }
    // Fallback to legacy keys for anonymous usage
    return `bridge_${baseKey}`;
}

// Set current user for key prefixing
export function setCurrentUser(userId: string | null): void {
    currentUserId = userId;
}

// Get current user ID
export function getCurrentUser(): string | null {
    return currentUserId;
}

// Debounce helper to avoid excessive writes
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let timeoutId: ReturnType<typeof setTimeout>;
    return ((...args: any[]) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), ms);
    }) as T;
}

/**
 * Safe JSON parse with fallback
 */
function safeJsonParse<T>(json: string | null, fallback: T): T {
    if (!json) return fallback;
    try {
        return JSON.parse(json) as T;
    } catch {
        return fallback;
    }
}

// =====================
// CONTACTS
// =====================
import {
    Contact,
    AppSettings,
    ChatThread,
    ThesisChunk,
    SyncState,
    Organization,
    IngestionHistoryItem,
    OrganizationWorkspacePackage
} from '../types';
import { mergeContactsWithDedupe } from './organizationService';
import { createDefaultSettings, normalizeSettings } from './settingsService';

export function saveContacts(contacts: Contact[]): void {
    try {
        localStorage.setItem(getStorageKey(BASE_KEYS.CONTACTS), JSON.stringify(contacts));
    } catch (e) {
        console.error('Failed to save contacts:', e);
    }
}

export const saveContactsDebounced = debounce(saveContacts, 500);

export function loadContacts(): Contact[] {
    return safeJsonParse(localStorage.getItem(getStorageKey(BASE_KEYS.CONTACTS)), []);
}

// =====================
// KNOWLEDGE (Thesis Chunks)
// =====================
export function saveKnowledge(chunks: ThesisChunk[]): void {
    try {
        localStorage.setItem(getStorageKey(BASE_KEYS.KNOWLEDGE), JSON.stringify(chunks));
    } catch (e) {
        console.error('Failed to save knowledge:', e);
    }
}

export const saveKnowledgeDebounced = debounce(saveKnowledge, 500);

export function loadKnowledge(): ThesisChunk[] {
    return safeJsonParse(localStorage.getItem(getStorageKey(BASE_KEYS.KNOWLEDGE)), []);
}

// =====================
// INGESTION HISTORY
// =====================
export function saveIngestionHistory(history: IngestionHistoryItem[]): void {
    try {
        localStorage.setItem(getStorageKey(BASE_KEYS.INGESTION_HISTORY), JSON.stringify(history));
    } catch (e) {
        console.error('Failed to save ingestion history:', e);
    }
}

export const saveIngestionHistoryDebounced = debounce(saveIngestionHistory, 500);

export function loadIngestionHistory(): IngestionHistoryItem[] {
    return safeJsonParse(localStorage.getItem(getStorageKey(BASE_KEYS.INGESTION_HISTORY)), []);
}

// =====================
// CHAT THREADS
// =====================
export function saveThreads(threads: ChatThread[]): void {
    try {
        localStorage.setItem(getStorageKey(BASE_KEYS.THREADS), JSON.stringify(threads));
    } catch (e) {
        console.error('Failed to save threads:', e);
    }
}

export const saveThreadsDebounced = debounce(saveThreads, 500);

export function loadThreads(): ChatThread[] {
    const threads = safeJsonParse<ChatThread[]>(localStorage.getItem(getStorageKey(BASE_KEYS.THREADS)), []);

    // Ensure at least one default thread exists
    if (threads.length === 0) {
        return [{
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
        }];
    }

    return threads;
}

// =====================
// SETTINGS
// =====================
export function saveSettings(settings: AppSettings): void {
    try {
        localStorage.setItem(getStorageKey(BASE_KEYS.SETTINGS), JSON.stringify(normalizeSettings(settings)));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

export function loadSettings(): AppSettings {
    const raw = safeJsonParse<unknown>(localStorage.getItem(getStorageKey(BASE_KEYS.SETTINGS)), createDefaultSettings());
    return normalizeSettings(raw);
}

// =====================
// ORGANIZATION
// =====================
export function saveOrganization(organization: Organization | null): void {
    try {
        if (!organization) {
            localStorage.removeItem(getStorageKey(BASE_KEYS.ORGANIZATION));
            return;
        }
        localStorage.setItem(getStorageKey(BASE_KEYS.ORGANIZATION), JSON.stringify(organization));
    } catch (e) {
        console.error('Failed to save organization:', e);
    }
}

export const saveOrganizationDebounced = debounce(saveOrganization, 500);

export function loadOrganization(): Organization | null {
    return safeJsonParse(localStorage.getItem(getStorageKey(BASE_KEYS.ORGANIZATION)), null);
}

// =====================
// SYNC STATE
// =====================
const SYNC_STATE_KEY = 'bridge_sync_state';

export function saveSyncState(state: SyncState): void {
    try {
        localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save sync state:', e);
    }
}

export function loadSyncState(): SyncState {
    return safeJsonParse(localStorage.getItem(SYNC_STATE_KEY), {
        status: 'idle' as const,
        lastSyncedAt: null,
    });
}

// =====================
// CLEAR USER DATA
// =====================
export function clearCurrentUserData(): void {
    if (!currentUserId) return;

    Object.values(BASE_KEYS).forEach(baseKey => {
        const key = `bridge_${currentUserId}_${baseKey}`;
        localStorage.removeItem(key);
    });

    console.log(`Cleared data for user: ${currentUserId}`);
}

// Clear ALL data (legacy + current user)
export function clearAllData(): void {
    // Clear current user data
    clearCurrentUserData();

    // Clear legacy keys
    Object.values(BASE_KEYS).forEach(baseKey => {
        localStorage.removeItem(`bridge_${baseKey}`);
    });

    // Clear sync state
    localStorage.removeItem(SYNC_STATE_KEY);
}

// =====================
// EXPORT / IMPORT
// =====================
export function exportAllData(): string {
    const data = {
        contacts: loadContacts(),
        knowledge: loadKnowledge(),
        ingestionHistory: loadIngestionHistory(),
        threads: loadThreads(),
        settings: loadSettings(),
        organization: loadOrganization(),
        exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
}

export function importAllData(jsonString: string): boolean {
    try {
        const data = JSON.parse(jsonString);
        if (data.contacts) saveContacts(data.contacts);
        if (data.knowledge) saveKnowledge(data.knowledge);
        if (data.ingestionHistory) saveIngestionHistory(data.ingestionHistory);
        if (data.threads) saveThreads(data.threads);
        if (data.settings) saveSettings(normalizeSettings(data.settings));
        if ('organization' in data) saveOrganization(data.organization || null);
        return true;
    } catch (e) {
        console.error('Failed to import data:', e);
        return false;
    }
}

// =====================
// CLOUD SYNC (Puter FS - File System)
// =====================

// Declare Puter Global
declare const puter: {
    auth: { isSignedIn: () => boolean; getUser: () => Promise<any> };
    fs: {
        write: (path: string, content: any) => Promise<void>;
        read: (path: string) => Promise<any>;
        exists: (path: string) => Promise<boolean>;
    };
};

// User-specific cloud file path
function getCloudFilePath(): string {
    if (currentUserId) {
        return `leviathan_bridge_${currentUserId}_data.json`;
    }
    return 'leviathan_bridge_data.json';
}

function getOrganizationCloudFilePath(orgId: string): string {
    const normalizedOrgId = orgId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `leviathan_org_${normalizedOrgId}_workspace.json`;
}

function mergeKnowledgeChunks(existing: ThesisChunk[], incoming: ThesisChunk[]): ThesisChunk[] {
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

function mergeIngestionHistoryEntries(
    existing: IngestionHistoryItem[],
    incoming: IngestionHistoryItem[]
): IngestionHistoryItem[] {
    const merged = [...existing];
    const seen = new Set(existing.map(item => item.id));
    incoming.forEach(item => {
        if (!seen.has(item.id)) {
            merged.push(item);
            seen.add(item.id);
        }
    });
    return merged.sort((a, b) => {
        const aTime = Date.parse(a.timestamp) || 0;
        const bTime = Date.parse(b.timestamp) || 0;
        return bTime - aTime;
    });
}

function mergeOrganizationRecords(existing: Organization, incoming: Organization): Organization {
    const newer = incoming.updatedAt >= existing.updatedAt ? incoming : existing;
    const older = newer === incoming ? existing : incoming;
    const memberMap = new Map<string, typeof newer.members[number]>();

    older.members.forEach(member => memberMap.set(member.userId, member));
    newer.members.forEach(member => memberMap.set(member.userId, member));

    return {
        ...newer,
        members: Array.from(memberMap.values()),
        invitePin: newer.invitePin || older.invitePin,
    };
}

function mergeOrganizationWorkspacePackages(
    existing: OrganizationWorkspacePackage,
    incoming: OrganizationWorkspacePackage
): OrganizationWorkspacePackage {
    const mergedContacts = mergeContactsWithDedupe(existing.contacts, incoming.contacts).contacts;
    const mergedKnowledge = mergeKnowledgeChunks(existing.knowledge, incoming.knowledge);
    const mergedHistory = mergeIngestionHistoryEntries(existing.ingestionHistory, incoming.ingestionHistory);
    const mergedOrganization = mergeOrganizationRecords(existing.organization, incoming.organization);

    const updatedAt = new Date().toISOString();
    return {
        version: 1,
        orgId: incoming.orgId || existing.orgId,
        updatedAt,
        updatedBy: incoming.updatedBy || existing.updatedBy,
        organization: {
            ...mergedOrganization,
            updatedAt: Math.max(existing.organization.updatedAt, incoming.organization.updatedAt, Date.now()),
        },
        contacts: mergedContacts,
        knowledge: mergedKnowledge,
        ingestionHistory: mergedHistory,
    };
}

async function readCloudTextFile(path: string): Promise<string | null> {
    try {
        const file = await puter.fs.read(path);
        if (!file) return null;
        return await file.text();
    } catch {
        return null;
    }
}

export async function saveToCloud(): Promise<SyncState> {
    if (typeof puter === 'undefined' || !puter.auth.isSignedIn()) {
        return { status: 'idle', lastSyncedAt: null };
    }

    const syncState: SyncState = { status: 'syncing', lastSyncedAt: null };
    saveSyncState(syncState);

    try {
        console.log('Syncing to cloud file system...');

        // Prepare data package
        const dataPackage = {
            contacts: loadContacts(),
            knowledge: loadKnowledge(),
            ingestionHistory: loadIngestionHistory(),
            threads: loadThreads(),
            settings: loadSettings(),
            organization: loadOrganization(),
            lastUpdated: new Date().toISOString()
        };

        // Write to user's root directory in Puter
        await puter.fs.write(getCloudFilePath(), JSON.stringify(dataPackage));

        const successState: SyncState = { status: 'synced', lastSyncedAt: Date.now() };
        saveSyncState(successState);
        console.log('Cloud sync complete (FS).');
        return successState;
    } catch (e) {
        console.error('Cloud save failed:', e);
        const errorState: SyncState = { status: 'error', lastSyncedAt: null, error: String(e) };
        saveSyncState(errorState);
        return errorState;
    }
}

export const saveToCloudDebounced = debounce(saveToCloud, 2000);

export async function loadFromCloud(): Promise<{
    contacts: Contact[] | null;
    knowledge: ThesisChunk[] | null;
    ingestionHistory: IngestionHistoryItem[] | null;
    threads: ChatThread[] | null;
    settings: AppSettings | null;
    organization: Organization | null;
}> {
    if (typeof puter === 'undefined' || !puter.auth.isSignedIn()) {
        return {
            contacts: null,
            knowledge: null,
            ingestionHistory: null,
            threads: null,
            settings: null,
            organization: null
        };
    }

    try {
        console.log('Loading from cloud file system...');

        let content;
        try {
            const file = await puter.fs.read(getCloudFilePath());
            content = await file.text();
        } catch (err) {
            console.warn('No cloud backup found or read error:', err);
            return {
                contacts: null,
                knowledge: null,
                ingestionHistory: null,
                threads: null,
                settings: null,
                organization: null
            };
        }

        if (!content) {
            return {
                contacts: null,
                knowledge: null,
                ingestionHistory: null,
                threads: null,
                settings: null,
                organization: null
            };
        }

        const data = JSON.parse(content);

        // Update local state
        if (data.contacts) saveContacts(data.contacts);
        if (data.knowledge) saveKnowledge(data.knowledge);
        if (data.ingestionHistory) saveIngestionHistory(data.ingestionHistory);
        if (data.threads) saveThreads(data.threads);
        if (data.settings) saveSettings(normalizeSettings(data.settings));
        if ('organization' in data) saveOrganization(data.organization || null);

        // Update sync state
        saveSyncState({ status: 'synced', lastSyncedAt: Date.now() });

        console.log('Cloud load complete (FS).');

        return {
            contacts: data.contacts,
            knowledge: data.knowledge,
            ingestionHistory: data.ingestionHistory,
            threads: data.threads,
            settings: data.settings ? normalizeSettings(data.settings) : null,
            organization: data.organization || null
        };

    } catch (e) {
        console.error('Cloud load failed:', e);
        return {
            contacts: null,
            knowledge: null,
            ingestionHistory: null,
            threads: null,
            settings: null,
            organization: null
        };
    }
}

export async function loadOrganizationWorkspaceFromCloud(orgId: string): Promise<OrganizationWorkspacePackage | null> {
    if (typeof puter === 'undefined' || !puter.auth.isSignedIn()) return null;
    if (!orgId.trim()) return null;

    try {
        const raw = await readCloudTextFile(getOrganizationCloudFilePath(orgId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as OrganizationWorkspacePackage;

        if (parsed.version !== 1 || parsed.orgId !== orgId) return null;
        if (!parsed.organization || !Array.isArray(parsed.contacts) || !Array.isArray(parsed.knowledge)) return null;

        return parsed;
    } catch (e) {
        console.error('Organization workspace load failed:', e);
        return null;
    }
}

export async function saveOrganizationWorkspaceToCloud(
    payload: OrganizationWorkspacePackage
): Promise<SyncState> {
    if (typeof puter === 'undefined' || !puter.auth.isSignedIn()) {
        return { status: 'idle', lastSyncedAt: null };
    }

    try {
        const path = getOrganizationCloudFilePath(payload.orgId);
        const existingRaw = await readCloudTextFile(path);
        let nextPayload = payload;

        if (existingRaw) {
            try {
                const existing = JSON.parse(existingRaw) as OrganizationWorkspacePackage;
                if (existing.version === 1 && existing.orgId === payload.orgId) {
                    nextPayload = mergeOrganizationWorkspacePackages(existing, payload);
                }
            } catch {
                // Keep incoming payload if existing blob is malformed.
            }
        }

        nextPayload.updatedAt = new Date().toISOString();
        await puter.fs.write(path, JSON.stringify(nextPayload));
        return { status: 'synced', lastSyncedAt: Date.now() };
    } catch (e) {
        console.error('Organization workspace save failed:', e);
        return { status: 'error', lastSyncedAt: null, error: String(e) };
    }
}

export const saveOrganizationWorkspaceToCloudDebounced = debounce(saveOrganizationWorkspaceToCloud, 2000);
