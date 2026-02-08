import Papa from 'papaparse';

export type SupportedKnowledgeFileType = 'text' | 'csv' | 'pdf';

export interface ExtractedDocumentText {
  text: string;
  fileType: SupportedKnowledgeFileType;
  pageCount?: number;
  rowCount?: number;
}

const TEXT_FILE_EXTENSIONS = new Set(['txt', 'md', 'markdown']);
const CSV_FILE_EXTENSIONS = new Set(['csv']);
const PDF_FILE_EXTENSIONS = new Set(['pdf']);

let pdfWorkerConfigured = false;

function getFileExtension(fileName: string): string {
  const segments = fileName.toLowerCase().split('.');
  return segments.length > 1 ? segments[segments.length - 1] : '';
}

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureTextContent(value: string, fileName: string): string {
  const normalized = normalizeExtractedText(value);
  if (!normalized) {
    throw new Error(`"${fileName}" did not contain readable text.`);
  }
  return normalized;
}

async function extractTextFromPlainFile(file: File): Promise<ExtractedDocumentText> {
  const text = await file.text();
  return {
    text: ensureTextContent(text, file.name),
    fileType: 'text',
  };
}

async function extractTextFromCsvFile(file: File): Promise<ExtractedDocumentText> {
  const rawCsv = await file.text();
  const parsed = Papa.parse<string[]>(rawCsv, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(`CSV parsing failed: ${parsed.errors[0].message}`);
  }

  const rows = parsed.data
    .map((row) => (Array.isArray(row) ? row : []))
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  const text = ensureTextContent(
    rows.map((row) => row.join(' | ')).join('\n'),
    file.name
  );

  return {
    text,
    fileType: 'csv',
    rowCount: rows.length,
  };
}

async function extractTextFromPdfFile(file: File): Promise<ExtractedDocumentText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfWorkerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    pdfWorkerConfigured = true;
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const document = await loadingTask.promise;
  const pageTextBlocks: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const line = textContent.items
      .map((item) => (typeof item === 'object' && item && 'str' in item ? String(item.str) : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (line) {
      pageTextBlocks.push(line);
    }
  }

  const text = ensureTextContent(pageTextBlocks.join('\n\n'), file.name);

  return {
    text,
    fileType: 'pdf',
    pageCount: document.numPages,
  };
}

export function isSupportedKnowledgeFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  return (
    TEXT_FILE_EXTENSIONS.has(extension) ||
    CSV_FILE_EXTENSIONS.has(extension) ||
    PDF_FILE_EXTENSIONS.has(extension)
  );
}

export async function extractTextFromKnowledgeFile(file: File): Promise<ExtractedDocumentText> {
  const extension = getFileExtension(file.name);

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return extractTextFromPlainFile(file);
  }

  if (CSV_FILE_EXTENSIONS.has(extension)) {
    return extractTextFromCsvFile(file);
  }

  if (PDF_FILE_EXTENSIONS.has(extension)) {
    return extractTextFromPdfFile(file);
  }

  throw new Error(
    `Unsupported file type "${extension || 'unknown'}". Use .txt, .md, .csv, or .pdf files.`
  );
}
