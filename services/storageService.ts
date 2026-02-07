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
import { Contact, AppSettings, ChatThread, ThesisChunk, SyncState } from '../types';

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
        localStorage.setItem(getStorageKey(BASE_KEYS.SETTINGS), JSON.stringify(settings));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

export function loadSettings(): AppSettings {
    return safeJsonParse(localStorage.getItem(getStorageKey(BASE_KEYS.SETTINGS)), {
        focusMode: 'BALANCED' as const,
        analysisModel: 'quality' as const,
    });
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
        threads: loadThreads(),
        settings: loadSettings(),
        exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
}

export function importAllData(jsonString: string): boolean {
    try {
        const data = JSON.parse(jsonString);
        if (data.contacts) saveContacts(data.contacts);
        if (data.knowledge) saveKnowledge(data.knowledge);
        if (data.threads) saveThreads(data.threads);
        if (data.settings) saveSettings(data.settings);
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
            threads: loadThreads(),
            settings: loadSettings(),
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
    threads: ChatThread[] | null;
    settings: AppSettings | null;
}> {
    if (typeof puter === 'undefined' || !puter.auth.isSignedIn()) {
        return { contacts: null, knowledge: null, threads: null, settings: null };
    }

    try {
        console.log('Loading from cloud file system...');

        let content;
        try {
            const file = await puter.fs.read(getCloudFilePath());
            content = await file.text();
        } catch (err) {
            console.warn('No cloud backup found or read error:', err);
            return { contacts: null, knowledge: null, threads: null, settings: null };
        }

        if (!content) return { contacts: null, knowledge: null, threads: null, settings: null };

        const data = JSON.parse(content);

        // Update local state
        if (data.contacts) saveContacts(data.contacts);
        if (data.knowledge) saveKnowledge(data.knowledge);
        if (data.threads) saveThreads(data.threads);
        if (data.settings) saveSettings(data.settings);

        // Update sync state
        saveSyncState({ status: 'synced', lastSyncedAt: Date.now() });

        console.log('Cloud load complete (FS).');

        return {
            contacts: data.contacts,
            knowledge: data.knowledge,
            threads: data.threads,
            settings: data.settings
        };

    } catch (e) {
        console.error('Cloud load failed:', e);
        return { contacts: null, knowledge: null, threads: null, settings: null };
    }
}
