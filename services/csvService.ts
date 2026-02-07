import Papa from 'papaparse';
import { Contact } from '../types';

// Declare Puter global (loaded via script tag)
declare const puter: {
    ai: {
        chat: (prompt: string, options?: { model?: string }) => Promise<any>;
    };
};

interface ColumnMapping {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    headline?: string | null;
    location?: string | null;
    source?: string | null;
    tagColumns?: string[] | null;
    notes?: string | null;
}

/**
 * Intelligent CSV Parser that uses Gemini to map columns
 */
export async function parseAndMapCSV(file: File): Promise<Contact[]> {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const headers = results.meta.fields || [];
                    const data = results.data as any[];

                    if (headers.length === 0) {
                        throw new Error("No headers found in CSV");
                    }

                    if (data.length === 0) {
                        throw new Error("CSV file is empty");
                    }

                    // Get intelligent mapping from Gemini
                    // We send headers and a sample row to understand context
                    const sample = data.slice(0, 3);
                    const mapping = await getMappingFromGemini(headers, sample);

                    console.log("Gemini CSV Mapping:", mapping);

                    // Apply mapping to create contacts
                    const contacts: Contact[] = data.map((row: any, index: number) => {
                        // Resolve Name
                        let name = "Unknown";
                        if (mapping.name && row[mapping.name]) {
                            name = row[mapping.name];
                        } else if (mapping.firstName && mapping.lastName) {
                            const first = row[mapping.firstName] || '';
                            const last = row[mapping.lastName] || '';
                            if (first || last) name = `${first} ${last}`.trim();
                        } else if (mapping.firstName) {
                            name = row[mapping.firstName];
                        }

                        // Skip if name is completely missing
                        if (!name || name === 'Unknown') {
                            // Last ditch: check for any column with "name" in it that we might have missed
                            const nameCol = headers.find(h => h.toLowerCase().includes('name'));
                            if (nameCol && row[nameCol]) name = row[nameCol];
                        }

                        // Parse Tags from multiple columns
                        let tags: string[] = [];
                        if (mapping.tagColumns && Array.isArray(mapping.tagColumns)) {
                            const rawValues = mapping.tagColumns
                                .map(col => row[col])
                                .filter(val => val && typeof val === 'string' && val.trim().length > 0);

                            // Join all values and split by common separators
                            const combinedString = rawValues.join(',');
                            tags = combinedString.split(/[,\/&|]/).map(t => t.trim()).filter(t => t.length > 0 && t.length < 30); // simplistic length check to avoid full sentences
                        }

                        return {
                            id: `c-csv-${Date.now()}-${index}`,
                            name: name || "Unknown Contact",
                            headline: mapping.headline && row[mapping.headline] ? row[mapping.headline] : "",
                            location: mapping.location && row[mapping.location] ? row[mapping.location] : "",
                            source: mapping.source && row[mapping.source] ? row[mapping.source] : file.name,
                            tags: [...new Set(tags)], // Remove duplicates
                            rawText: mapping.notes && row[mapping.notes] ? row[mapping.notes] : JSON.stringify(row),
                            status: 'New',
                            ingestionMeta: {
                                uploader: "User Upload",
                                uploadDate: new Date().toISOString(),
                                sourceLabel: file.name,
                                trustLevel: "Manual"
                            }
                        } as Contact;
                    });

                    // Filter out rows that are clearly invalid (no name)
                    const validContacts = contacts.filter(c => c.name !== "Unknown Contact" && c.name.trim() !== "");

                    resolve(validContacts);

                } catch (error) {
                    console.error("CSV Processing Error:", error);
                    reject(error);
                }
            },
            error: (error: Error) => {
                reject(error);
            }
        });
    });
}

async function getMappingFromGemini(headers: string[], sample: any[]): Promise<ColumnMapping> {
    const prompt = `
    I represent a Contact Management System. I need to map a user's CSV import to my internal schema.
    
    Here are the CSV Headers: ${JSON.stringify(headers)}
    Here is a sample of the data (first 3 rows): ${JSON.stringify(sample)}

    Target Fields I need:
    - name: Full Name of the person.
    - firstName: First Name (if split).
    - lastName: Last Name (if split).
    - headline: Job title, role, description, or bio.
    - location: City, Country, Region, or Address.
    - source: Organization, Company, or Referrer.
    - tagColumns: An ARRAY of columns that likely contain keywords, sectors, types, categories, or descriptive titles (e.g. "Industry", "Focus", "Type", "Title").
    - notes: Any detailed notes, raw text, or descriptions.

    Analyz the headers and sample data to determine the best mapping.
    If 'name' is split into First/Last, map those fields and leave 'name' null.
    If 'name' is in one column, map 'name' and leave First/Last null.
    For 'tagColumns', include ALL columns that might contain useful filtering tags. For example, if there is a "Title" column and an "Industry" column, include BOTH.
    
    Return purely a JSON object with this structure (no markdown):
    {
        "name": "Exact CSV Header Name" | null,
        "firstName": "Exact CSV Header Name" | null,
        "lastName": "Exact CSV Header Name" | null,
        "headline": "Exact CSV Header Name" | null,
        "location": "Exact CSV Header Name" | null,
        "source": "Exact CSV Header Name" | null,
        "tagColumns": ["Exact CSV Header Name", "Another Header"] | [],
        "notes": "Exact CSV Header Name" | null
    }
    `;

    try {
        const response = await puter.ai.chat(prompt, { model: 'gemini-2.5-flash' });

        // Handle varying response formats from Puter
        let text = "";
        if (typeof response === 'string') text = response;
        else if (response?.message?.content) text = response.message.content;
        else if (response?.text) text = response.text;
        else text = JSON.stringify(response);

        // Clean potentially markdown-wrapped JSON
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        return JSON.parse(text) as ColumnMapping;

    } catch (e) {
        console.error("AI Mapping failed, using fallback heuristics.", e);
        return fallbackMapping(headers);
    }
}

function fallbackMapping(headers: string[]): ColumnMapping {
    const lowerHeaders = headers.map(h => h.toLowerCase());

    const findHeader = (keywords: string[]) => {
        const idx = lowerHeaders.findIndex(h => keywords.some(k => h.includes(k)));
        return idx >= 0 ? headers[idx] : null;
    };

    const tagCol = findHeader(['tags', 'keywords', 'industry', 'sector', 'focus', 'type', 'category']);

    return {
        firstName: findHeader(['first name', 'given name', 'first']),
        lastName: findHeader(['last name', 'family name', 'surname', 'last']),
        name: findHeader(['full name', 'name', 'contact']),
        headline: findHeader(['headline', 'title', 'role', 'position', 'job']),
        location: findHeader(['location', 'city', 'region', 'country', 'address']),
        source: findHeader(['source', 'company', 'organization']),
        tagColumns: tagCol ? [tagCol] : [],
        notes: findHeader(['notes', 'description', 'bio', 'text'])
    };
}
