import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Copy,
  Download,
  FileUp,
  GitMerge,
  Loader2,
  Network,
  RefreshCw,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { Organization } from '../types';
import { extractTextFromKnowledgeFile } from '../services/documentService';

interface OrganizationHubProps {
  user: { username: string; email?: string; uuid?: string } | null;
  organization: Organization | null;
  contactsCount: number;
  orgMessage: string | null;
  onCreateOrganization: (payload: { name: string; thesis: string; strategicContext: string }) => void;
  onJoinOrganization: (inviteCode: string) => void;
  onUpdateOrganization: (payload: { name: string; thesis: string; strategicContext: string }) => void;
  onGenerateInvite: () => void;
  onDedupeContacts: () => void;
  onExportPackage: () => void;
  onImportPackage: (file: File) => void;
  onIngestOrganizationContacts: (file: File) => Promise<void> | void;
  onIngestOrganizationDocument: (file: File, target: 'thesis' | 'context') => Promise<void> | void;
}

function appendDocumentText(existing: string, fileName: string, text: string): string {
  const section = `[${fileName}]\n${text.trim()}`;
  if (!existing.trim()) return section;
  return `${existing.trim()}\n\n${section}`;
}

const OrganizationHub: React.FC<OrganizationHubProps> = ({
  user,
  organization,
  contactsCount,
  orgMessage,
  onCreateOrganization,
  onJoinOrganization,
  onUpdateOrganization,
  onGenerateInvite,
  onDedupeContacts,
  onExportPackage,
  onImportPackage,
  onIngestOrganizationContacts,
  onIngestOrganizationDocument,
}) => {
  const [createName, setCreateName] = useState('');
  const [createThesis, setCreateThesis] = useState('');
  const [createStrategicContext, setCreateStrategicContext] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editingThesis, setEditingThesis] = useState('');
  const [editingContext, setEditingContext] = useState('');
  const [copied, setCopied] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement>(null);
  const createContactsInputRef = useRef<HTMLInputElement>(null);
  const createThesisInputRef = useRef<HTMLInputElement>(null);
  const createContextInputRef = useRef<HTMLInputElement>(null);
  const orgContactsInputRef = useRef<HTMLInputElement>(null);
  const orgThesisInputRef = useRef<HTMLInputElement>(null);
  const orgContextInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!organization) return;
    setEditingName(organization.name);
    setEditingThesis(organization.thesis);
    setEditingContext(organization.strategicContext);
  }, [organization]);

  const handleCopyInvite = async () => {
    if (!organization?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(organization.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onImportPackage(file);
    event.target.value = '';
  };

  const withUploadState = async (operation: () => Promise<void>) => {
    setIsUploading(true);
    setLocalMessage(null);
    try {
      await operation();
    } catch (error) {
      setLocalMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateKnowledgeUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'thesis' | 'context'
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    await withUploadState(async () => {
      const extracted = await extractTextFromKnowledgeFile(file);
      if (target === 'thesis') {
        setCreateThesis((current) => appendDocumentText(current, file.name, extracted.text));
      } else {
        setCreateStrategicContext((current) => appendDocumentText(current, file.name, extracted.text));
      }
      setLocalMessage(
        `Loaded ${file.name} into ${target === 'thesis' ? 'thesis' : 'strategic context'} draft.`
      );
    });
  };

  const handleContactsUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    await withUploadState(async () => {
      await Promise.resolve(onIngestOrganizationContacts(file));
      setLocalMessage(`Imported ${file.name} into the shared contact universe.`);
    });
  };

  const handleOrganizationKnowledgeUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'thesis' | 'context'
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    await withUploadState(async () => {
      await Promise.resolve(onIngestOrganizationDocument(file, target));
      setLocalMessage(
        `Added ${file.name} to organization ${target === 'thesis' ? 'thesis' : 'strategic context'}.`
      );
    });
  };

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <Building2 size={32} className="text-blue-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Organization Workspace</h3>
          <p className="text-slate-400">
            Sign in with Puter first to create or join a shared organization workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-10">
      <div>
        <h3 className="text-2xl font-bold text-white mb-2">Organization</h3>
        <p className="text-slate-400">
          Create a shared mission workspace, invite collaborators, and merge duplicate contacts deterministically.
        </p>
      </div>

      {orgMessage && (
        <div className="px-4 py-3 bg-blue-900/20 border border-blue-800/50 rounded text-sm text-blue-200">
          {orgMessage}
        </div>
      )}

      {localMessage && (
        <div className="px-4 py-3 bg-slate-900 border border-slate-700 rounded text-sm text-slate-200">
          {localMessage}
        </div>
      )}

      {!organization ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-emerald-400" />
              <h4 className="text-white font-semibold">Create Organization</h4>
            </div>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Organization name"
              className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            />
            <textarea
              value={createThesis}
              onChange={(e) => setCreateThesis(e.target.value)}
              placeholder="Thesis (why this org exists)"
              className="w-full min-h-[120px] bg-slate-950 border border-slate-700 rounded p-2.5 text-sm text-slate-200 focus:outline-none focus:border-red-500 resize-y"
            />
            <textarea
              value={createStrategicContext}
              onChange={(e) => setCreateStrategicContext(e.target.value)}
              placeholder="Strategic context (current priorities)"
              className="w-full min-h-[120px] bg-slate-950 border border-slate-700 rounded p-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 resize-y"
            />

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Bootstrap From Files</p>
              <p className="text-xs text-slate-400">
                Upload existing docs to prefill thesis/context and import your current contact CSV.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <button
                  onClick={() => createThesisInputRef.current?.click()}
                  disabled={isUploading}
                  className="py-2 text-xs bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/60 text-slate-200 rounded border border-slate-700 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  {isUploading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
                  Thesis Doc
                </button>
                <button
                  onClick={() => createContextInputRef.current?.click()}
                  disabled={isUploading}
                  className="py-2 text-xs bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/60 text-slate-200 rounded border border-slate-700 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  {isUploading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
                  Context Doc
                </button>
                <button
                  onClick={() => createContactsInputRef.current?.click()}
                  disabled={isUploading}
                  className="py-2 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/60 text-white rounded border border-blue-500/40 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Contacts CSV
                </button>
              </div>
              <input
                ref={createThesisInputRef}
                type="file"
                accept=".txt,.md,.pdf,.csv"
                onChange={(event) => {
                  void handleCreateKnowledgeUpload(event, 'thesis');
                }}
                className="hidden"
              />
              <input
                ref={createContextInputRef}
                type="file"
                accept=".txt,.md,.pdf,.csv"
                onChange={(event) => {
                  void handleCreateKnowledgeUpload(event, 'context');
                }}
                className="hidden"
              />
              <input
                ref={createContactsInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={(event) => {
                  void handleContactsUpload(event);
                }}
                className="hidden"
              />
            </div>

            <button
              onClick={() => onCreateOrganization({
                name: createName,
                thesis: createThesis,
                strategicContext: createStrategicContext,
              })}
              disabled={!createName.trim() || isUploading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 text-white rounded text-sm font-medium transition-colors"
            >
              Create Workspace
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <UserPlus size={18} className="text-blue-400" />
              <h4 className="text-white font-semibold">Join by Invite</h4>
            </div>
            <p className="text-sm text-slate-400">
              Paste an invite code from your teammate to join the same organization context.
            </p>
            <textarea
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="LBRG1...."
              className="w-full min-h-[180px] bg-slate-950 border border-slate-700 rounded p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500 resize-y"
            />
            <button
              onClick={() => onJoinOrganization(joinCode)}
              disabled={!joinCode.trim()}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/40 text-white rounded text-sm font-medium transition-colors"
            >
              Join Organization
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <p className="text-xs uppercase text-slate-500">Members</p>
              <p className="text-2xl font-bold text-white">{organization.members.length}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <p className="text-xs uppercase text-slate-500">Contacts</p>
              <p className="text-2xl font-bold text-white">{contactsCount}</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <p className="text-xs uppercase text-slate-500">Created</p>
              <p className="text-sm font-semibold text-slate-200 mt-1">
                {new Date(organization.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Network size={18} className="text-emerald-400" />
                <h4 className="text-white font-semibold">Organization Context</h4>
              </div>
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              />
              <textarea
                value={editingThesis}
                onChange={(e) => setEditingThesis(e.target.value)}
                placeholder="Thesis"
                className="w-full min-h-[120px] bg-slate-950 border border-slate-700 rounded p-2.5 text-sm text-slate-200 focus:outline-none focus:border-red-500 resize-y"
              />
              <textarea
                value={editingContext}
                onChange={(e) => setEditingContext(e.target.value)}
                placeholder="Strategic context"
                className="w-full min-h-[120px] bg-slate-950 border border-slate-700 rounded p-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 resize-y"
              />
              <button
                onClick={() => onUpdateOrganization({
                  name: editingName,
                  thesis: editingThesis,
                  strategicContext: editingContext,
                })}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors"
              >
                Save Organization Context
              </button>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-blue-400" />
                  <h4 className="text-white font-semibold">Invites</h4>
                </div>
                <textarea
                  readOnly
                  value={organization.inviteCode}
                  className="w-full min-h-[140px] bg-slate-950 border border-slate-700 rounded p-2.5 text-xs font-mono text-slate-300"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    onClick={onGenerateInvite}
                    className="py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={14} />
                    Regenerate Invite
                  </button>
                  <button
                    onClick={handleCopyInvite}
                    className="py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Copy size={14} />
                    {copied ? 'Copied' : 'Copy Invite'}
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                <h4 className="text-white font-semibold">Organization Documents</h4>
                <p className="text-sm text-slate-400">
                  Upload files directly into shared thesis/context, or push your contact CSV into the org universe.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <button
                    onClick={() => orgThesisInputRef.current?.click()}
                    disabled={isUploading}
                    className="py-2.5 text-xs bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/60 text-slate-200 rounded border border-slate-700 transition-colors inline-flex items-center justify-center gap-1.5"
                  >
                    {isUploading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
                    Thesis Doc
                  </button>
                  <button
                    onClick={() => orgContextInputRef.current?.click()}
                    disabled={isUploading}
                    className="py-2.5 text-xs bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/60 text-slate-200 rounded border border-slate-700 transition-colors inline-flex items-center justify-center gap-1.5"
                  >
                    {isUploading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
                    Context Doc
                  </button>
                  <button
                    onClick={() => orgContactsInputRef.current?.click()}
                    disabled={isUploading}
                    className="py-2.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/60 text-white rounded border border-blue-500/40 transition-colors inline-flex items-center justify-center gap-1.5"
                  >
                    {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Contacts CSV
                  </button>
                </div>
                <input
                  ref={orgThesisInputRef}
                  type="file"
                  accept=".txt,.md,.pdf,.csv"
                  onChange={(event) => {
                    void handleOrganizationKnowledgeUpload(event, 'thesis');
                  }}
                  className="hidden"
                />
                <input
                  ref={orgContextInputRef}
                  type="file"
                  accept=".txt,.md,.pdf,.csv"
                  onChange={(event) => {
                    void handleOrganizationKnowledgeUpload(event, 'context');
                  }}
                  className="hidden"
                />
                <input
                  ref={orgContactsInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={(event) => {
                    void handleContactsUpload(event);
                  }}
                  className="hidden"
                />
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                <h4 className="text-white font-semibold">Duplicate Management</h4>
                <p className="text-sm text-slate-400">
                  Merge duplicate contacts by LinkedIn URL first, then normalized identity fields.
                </p>
                <button
                  onClick={onDedupeContacts}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <GitMerge size={14} />
                  Merge Duplicate Contacts
                </button>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <h4 className="text-white font-semibold">Cross-Account Sync Package</h4>
            <p className="text-sm text-slate-400">
              Export your organization + contacts as JSON and import your teammate&apos;s package to merge and dedupe.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={onExportPackage}
                className="py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Download size={14} />
                Export Org Package
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                className="py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Upload size={14} />
                Import Org Package
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h4 className="text-white font-semibold mb-4">Members</h4>
            <div className="space-y-2">
              {organization.members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between px-3 py-2 bg-slate-950 border border-slate-800 rounded"
                >
                  <div>
                    <p className="text-sm text-slate-200">{member.username}</p>
                    <p className="text-xs text-slate-500">{member.email || member.userId}</p>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-slate-400">{member.role}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default OrganizationHub;
