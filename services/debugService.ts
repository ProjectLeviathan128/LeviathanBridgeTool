export type DebugLevel = 'info' | 'warn' | 'error';

export interface DebugEvent {
    id: string;
    timestamp: string;
    level: DebugLevel;
    source: string;
    message: string;
    details?: string;
}

type DebugListener = (events: DebugEvent[]) => void;

const MAX_DEBUG_EVENTS = 500;
const DEBUG_PANEL_OPEN_EVENT = 'bridge:debug-panel-open';
const DEBUG_PANEL_CLOSE_EVENT = 'bridge:debug-panel-close';
const listeners = new Set<DebugListener>();
let events: DebugEvent[] = [];

function notifyListeners() {
    listeners.forEach((listener) => listener(events));
}

function safeStringify(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function appendEvent(level: DebugLevel, source: string, message: string, details?: unknown) {
    const event: DebugEvent = {
        id: `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        details: details === undefined ? undefined : safeStringify(details),
    };

    events = [...events, event].slice(-MAX_DEBUG_EVENTS);
    notifyListeners();
}

export function debugInfo(source: string, message: string, details?: unknown) {
    appendEvent('info', source, message, details);
}

export function debugWarn(source: string, message: string, details?: unknown) {
    appendEvent('warn', source, message, details);
}

export function debugError(source: string, message: string, details?: unknown) {
    appendEvent('error', source, message, details);
}

export function subscribeDebugEvents(listener: DebugListener): () => void {
    listeners.add(listener);
    listener(events);
    return () => {
        listeners.delete(listener);
    };
}

export function clearDebugEvents() {
    events = [];
    notifyListeners();
}

export function requestDebugPanelOpen() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(DEBUG_PANEL_OPEN_EVENT));
}

export function requestDebugPanelClose() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(DEBUG_PANEL_CLOSE_EVENT));
}

export function subscribeDebugPanelControls(handlers: { onOpen: () => void; onClose: () => void }): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const openHandler = () => handlers.onOpen();
    const closeHandler = () => handlers.onClose();
    window.addEventListener(DEBUG_PANEL_OPEN_EVENT, openHandler);
    window.addEventListener(DEBUG_PANEL_CLOSE_EVENT, closeHandler);

    return () => {
        window.removeEventListener(DEBUG_PANEL_OPEN_EVENT, openHandler);
        window.removeEventListener(DEBUG_PANEL_CLOSE_EVENT, closeHandler);
    };
}
