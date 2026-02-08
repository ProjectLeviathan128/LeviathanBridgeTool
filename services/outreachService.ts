import { Contact, OutreachChannel, OutreachDraft, OutreachSenderId } from '../types';
import { bridgeMemory } from './bridgeMemory';
import { debugError, debugInfo, debugWarn } from './debugService';

declare const puter: {
  ai?: {
    chat: (prompt: string, options?: { model?: string; temperature?: number }) => Promise<unknown>;
  };
};

interface SenderProfile {
  id: OutreachSenderId;
  name: string;
  title: string;
}

const SENDER_PROFILES: Record<OutreachSenderId, SenderProfile> = {
  matthew: {
    id: 'matthew',
    name: 'Matthew Fortes',
    title: 'CoFounder, Leviathan',
  },
  nathan: {
    id: 'nathan',
    name: 'Nathan Krajewski',
    title: 'Founder, Leviathan',
  },
};

const MODEL_CANDIDATES = ['gemini-2.5-pro', 'gemini-2.5-flash', 'openai/gpt-5.2-chat'];

interface OutreachGenerationOptions {
  linkedInMaxLength?: number;
  emailSubjectMaxLength?: number;
  modelCandidates?: string[];
  temperature?: number;
}

function cleanWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clampLinkedIn(text: string, maxLength = 300): string {
  const normalized = cleanWhitespace(text);
  if (normalized.length <= maxLength) return normalized;
  const cutoff = normalized.slice(0, maxLength - 1);
  const lastSpace = cutoff.lastIndexOf(' ');
  return `${cutoff.slice(0, lastSpace > 80 ? lastSpace : cutoff.length)}…`;
}

function readModelText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const maybeMessage = (response as { message?: { content?: unknown } }).message;
    if (maybeMessage && typeof maybeMessage.content === 'string') return maybeMessage.content;
    const maybeText = (response as { text?: unknown }).text;
    if (typeof maybeText === 'string') return maybeText;
  }
  return JSON.stringify(response ?? '');
}

function extractJsonObject(text: string): Record<string, string> | null {
  const stripped = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')])
    );
  } catch {
    return null;
  }
}

function buildContactContext(contact: Contact): string {
  const tracks = contact.enrichment?.tracks?.join(', ') || 'none';
  const risks = contact.enrichment?.alignmentRisks?.join('; ') || 'none';
  const summary = contact.enrichment?.summary || 'No enrichment summary yet.';
  const angle = contact.enrichment?.recommendedAngle || 'No recommended angle available.';
  const action = contact.enrichment?.recommendedAction || 'No recommended action available.';
  const raw = (contact.rawText || '').slice(0, 1200);

  return [
    `Contact Name: ${contact.name}`,
    `Headline: ${contact.headline || 'n/a'}`,
    `Location: ${contact.location || 'n/a'}`,
    `Source: ${contact.source || 'n/a'}`,
    `Strategic Tracks: ${tracks}`,
    `Summary: ${summary}`,
    `Recommended Angle: ${angle}`,
    `Recommended Action: ${action}`,
    `Risks: ${risks}`,
    `Raw Notes: ${raw || 'n/a'}`,
  ].join('\n');
}

function buildFallbackDraft(
  contact: Contact,
  channel: OutreachChannel,
  sender: SenderProfile,
  options: OutreachGenerationOptions
): OutreachDraft {
  const linkedInMaxLength = typeof options.linkedInMaxLength === 'number' ? options.linkedInMaxLength : 300;
  const emailSubjectMaxLength = typeof options.emailSubjectMaxLength === 'number' ? options.emailSubjectMaxLength : 70;
  const angle = contact.enrichment?.recommendedAngle || 'exploring a fit with Leviathan';
  const callToAction = 'Open to a 20-minute call next week?';
  const subject = `Leviathan x ${contact.name}`.slice(0, emailSubjectMaxLength);

  if (channel === 'linkedin') {
    const message = clampLinkedIn(
      `Hi ${contact.name.split(' ')[0]}, ${sender.name} here (${sender.title}). ` +
      `I’m reaching out because your work feels aligned with Leviathan. ${angle}. ${callToAction}`,
      linkedInMaxLength
    );
    return {
      channel,
      senderId: sender.id,
      senderName: sender.name,
      senderTitle: sender.title,
      message,
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    channel,
    senderId: sender.id,
    senderName: sender.name,
    senderTitle: sender.title,
    subject,
    message:
      `Hi ${contact.name.split(' ')[0]},\n\n` +
      `${sender.name} here (${sender.title}) at Leviathan. ` +
      `Your background stood out as a strong fit for what we're building. ${angle}.\n\n` +
      `If it makes sense, would you be open to a short 20-minute intro call next week?\n\n` +
      `Best,\n${sender.name}`,
    generatedAt: new Date().toISOString(),
  };
}

function buildPrompt(
  contact: Contact,
  channel: OutreachChannel,
  sender: SenderProfile,
  options: OutreachGenerationOptions
): string {
  const linkedInMaxLength = typeof options.linkedInMaxLength === 'number' ? options.linkedInMaxLength : 300;
  const emailSubjectMaxLength = typeof options.emailSubjectMaxLength === 'number' ? options.emailSubjectMaxLength : 70;
  const thesisContext = bridgeMemory.getThesisContext();
  const outputSpec = channel === 'linkedin'
    ? `Return JSON only: {"message":"..."} (HARD LIMIT: <= ${linkedInMaxLength} characters, no markdown).`
    : `Return JSON only: {"subject":"...","message":"..."} (subject <= ${emailSubjectMaxLength} chars, message can be longer if needed, no markdown).`;

  return [
    'You are drafting high-conversion outreach for Leviathan.',
    `Sender: ${sender.name} (${sender.title})`,
    `Channel: ${channel}`,
    'Goal: get the recipient to take a short intro call.',
    '',
    'Constraints:',
    '- Personalize tightly to this specific contact and context.',
    '- Tone: direct, warm, strategic, not fluffy.',
    '- Do not invent facts not present in the provided context.',
    '- Never mention "AI" or "generated".',
    '- Include a concrete CTA for a short call.',
    channel === 'linkedin'
      ? `- Keep the message under ${linkedInMaxLength} characters.`
      : `- For email include a strong concise subject under ${emailSubjectMaxLength} characters.`,
    '',
    'Leviathan Thesis and Context:',
    thesisContext,
    '',
    'Contact Intelligence:',
    buildContactContext(contact),
    '',
    outputSpec,
  ].join('\n');
}

export function getSenderProfile(senderId: OutreachSenderId): SenderProfile {
  return SENDER_PROFILES[senderId];
}

export async function generateOutreachDraft(
  contact: Contact,
  channel: OutreachChannel,
  senderId: OutreachSenderId,
  options: OutreachGenerationOptions = {}
): Promise<OutreachDraft> {
  const sender = getSenderProfile(senderId);
  const prompt = buildPrompt(contact, channel, sender, options);
  const linkedInMaxLength = typeof options.linkedInMaxLength === 'number' ? options.linkedInMaxLength : 300;
  const emailSubjectMaxLength = typeof options.emailSubjectMaxLength === 'number' ? options.emailSubjectMaxLength : 70;
  const modelCandidates = options.modelCandidates && options.modelCandidates.length > 0
    ? options.modelCandidates
    : MODEL_CANDIDATES;
  const temperature = typeof options.temperature === 'number' && Number.isFinite(options.temperature)
    ? Math.max(0, Math.min(1, options.temperature))
    : 0.35;

  if (typeof puter === 'undefined' || !puter.ai?.chat) {
    debugWarn('outreach', 'Puter runtime unavailable; using fallback outreach draft.', {
      contactId: contact.id,
      channel,
      senderId,
    });
    return buildFallbackDraft(contact, channel, sender, options);
  }

  let lastError: unknown = null;
  for (const model of modelCandidates) {
    try {
      const response = await puter.ai.chat(prompt, { model, temperature });
      const responseText = readModelText(response);
      const json = extractJsonObject(responseText);

      if (channel === 'linkedin') {
        const messageSource = json?.message || responseText;
        const message = clampLinkedIn(messageSource, linkedInMaxLength);
        const draft: OutreachDraft = {
          channel,
          senderId: sender.id,
          senderName: sender.name,
          senderTitle: sender.title,
          message,
          generatedAt: new Date().toISOString(),
        };
        debugInfo('outreach', 'Generated LinkedIn outreach draft.', {
          contactId: contact.id,
          model,
          length: message.length,
          senderId,
        });
        return draft;
      }

      const subject = cleanWhitespace(json?.subject || `Leviathan x ${contact.name}`);
      const message = cleanWhitespace(json?.message || responseText);
      const draft: OutreachDraft = {
        channel,
        senderId: sender.id,
        senderName: sender.name,
        senderTitle: sender.title,
        subject: subject.slice(0, emailSubjectMaxLength),
        message,
        generatedAt: new Date().toISOString(),
      };
      debugInfo('outreach', 'Generated email outreach draft.', {
        contactId: contact.id,
        model,
        senderId,
      });
      return draft;
    } catch (error) {
      lastError = error;
      debugWarn('outreach', 'Outreach model failed; trying next fallback.', {
        contactId: contact.id,
        model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  debugError('outreach', 'All outreach models failed; using fallback draft.', {
    contactId: contact.id,
    channel,
    senderId,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return buildFallbackDraft(contact, channel, sender, options);
}
