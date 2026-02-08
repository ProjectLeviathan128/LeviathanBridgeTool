import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Copy,
  Download,
  GitMerge,
  Network,
  RefreshCw,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { Organization } from '../types';

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
}) => {
  const [createName, setCreateName] = useState('');
  const [createThesis, setCreateThesis] = useState('');
  const [createStrategicContext, setCreateStrategicContext] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [editingName, setEditingName] = useState('');
  const [editingThesis, setEditingThesis] = useState('');
  const [editingContext, setEditingContext] = useState('');
  const [copied, setCopied] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

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
            <button
              onClick={() => onCreateOrganization({
                name: createName,
                thesis: createThesis,
                strategicContext: createStrategicContext,
              })}
              disabled={!createName.trim()}
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
