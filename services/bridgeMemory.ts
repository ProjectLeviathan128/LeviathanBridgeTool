import { ThesisChunk } from '../types';
import { saveKnowledgeDebounced, loadKnowledge } from './storageService';

/**
 * Bridge Memory Service
 * Handles the storage and retrieval of Thesis chunks (RAG).
 * Now with localStorage persistence.
 */

class BridgeMemory {
  private thesisStore: ThesisChunk[] = [];

  constructor() {
    // Load from localStorage on initialization
    this.thesisStore = loadKnowledge();
  }

  public initialize(chunks: ThesisChunk[]) {
    this.thesisStore = chunks;
    this.saveToStorage();
  }

  private saveToStorage() {
    saveKnowledgeDebounced(this.thesisStore);
  }

  private chunkText(text: string, sourceName: string, type: 'thesis' | 'context'): ThesisChunk[] {
    // Semantic Chunking Simulation: Split by double newlines to keep paragraphs intact
    const rawChunks = text.split(/\n\s*\n/);

    return rawChunks
      .filter(c => c.trim().length > 10)
      .map((content, idx) => ({
        id: `chunk-${Date.now()}-${idx}`,
        content: content.trim(),
        source: sourceName,
        version: new Date().toISOString(),
        tags: [type] // Tag explicitly
      }));
  }

  public ingestThesisDocument(text: string, sourceName: string, type: 'thesis' | 'context'): ThesisChunk[] {
    const newChunks = this.chunkText(text, sourceName, type);

    this.thesisStore.push(...newChunks);
    this.saveToStorage();
    return newChunks;
  }

  public replaceSourceDocument(text: string, sourceName: string, type: 'thesis' | 'context'): ThesisChunk[] {
    this.thesisStore = this.thesisStore.filter(
      chunk => !(chunk.source === sourceName && chunk.tags.includes(type))
    );

    if (!text.trim()) {
      this.saveToStorage();
      return [];
    }

    const newChunks = this.chunkText(text, sourceName, type);
    this.thesisStore.push(...newChunks);
    this.saveToStorage();
    return newChunks;
  }

  public getThesisContext(): string {
    // structured output for better LLM comprehension
    const thesisChunks = this.getByTag('thesis');
    const contextChunks = this.getByTag('context');

    let output = "";

    if (thesisChunks.length > 0) {
      output += "=== SECTION 1: LEVIATHAN CONSTITUTION (HARD RULES) ===\n";
      output += "These are immutable constraints. Any contact violating these must be flagged.\n\n";
      output += thesisChunks.map((c, i) => `RULE #${i + 1} (${c.source}):\n${c.content}`).join('\n\n');
      output += "\n\n";
    }

    if (contextChunks.length > 0) {
      output += "=== SECTION 2: STRATEGIC CONTEXT (CURRENT PRIORITIES) ===\n";
      output += "These are current focus areas and strategic desires. Use these for scoring Investor Fit and Alignment.\n\n";
      output += contextChunks.map((c, i) => `CONTEXT #${i + 1} (${c.source}):\n${c.content}`).join('\n\n');
    }

    if (thesisChunks.length === 0 && contextChunks.length === 0) {
      return "No specific thesis documents loaded. Proceed with general best practices for Values-Aligned Capital (Patient, Strategic, Non-Predatory).";
    }

    return output;
  }

  public getByTag(tag: 'thesis' | 'context'): ThesisChunk[] {
    return this.thesisStore.filter(c => c.tags.includes(tag));
  }

  public getStats() {
    return {
      totalChunks: this.thesisStore.length,
      thesisChunks: this.getByTag('thesis').length,
      contextChunks: this.getByTag('context').length,
      sources: Array.from(new Set(this.thesisStore.map(c => c.source))).length
    };
  }

  public clear() {
    this.thesisStore = [];
    this.saveToStorage();
  }

  // Serialization for export/import
  public toJSON(): ThesisChunk[] {
    return this.thesisStore;
  }

  public fromJSON(chunks: ThesisChunk[]) {
    this.thesisStore = chunks;
    this.saveToStorage();
  }

  public getAllChunks(): ThesisChunk[] {
    return this.thesisStore;
  }
}

export const bridgeMemory = new BridgeMemory();
