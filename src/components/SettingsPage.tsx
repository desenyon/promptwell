"use client";

import { ArrowUpRight, History, Search, Settings, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  InstructionFileId,
  PlatformId,
  SavedPrompt,
  ToolId,
  UserProfile,
} from "@/types";

type SettingsTab = "profile" | "history";

const PLATFORM_LABELS: Record<PlatformId, string> = {
  cursor: "Cursor",
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  generic: "Chat or API",
};
const TOOL_LABELS: Record<ToolId, string> = {
  context7: "Context7",
  graphify: "Graphify",
  headroom: "Headroom",
  "web-search": "Web search",
};
const INSTRUCTION_LABELS: Record<InstructionFileId, string> = {
  "agents-md": "AGENTS.md",
  "claude-md": "CLAUDE.md",
  "cursor-rules": "Cursor rules",
};

function toggle<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function ChoiceChips<T extends string>({
  labels,
  values,
  onChange,
}: {
  labels: Record<T, string>;
  values: T[];
  onChange: (values: T[]) => void;
}) {
  return (
    <div className="setting-chips">
      {(Object.entries(labels) as Array<[T, string]>).map(([id, label]) => (
        <button
          className={values.includes(id) ? "is-selected" : ""}
          key={id}
          onClick={() => onChange(toggle(values, id))}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface SettingsPageProps {
  profile: UserProfile;
  sessions: SavedPrompt[];
  initialTab: SettingsTab;
  onSave: (profile: UserProfile) => Promise<void>;
  onOpenPrompt: (session: SavedPrompt) => void;
  onDeletePrompt: (sessionId: string) => Promise<void>;
}

export default function SettingsPage({
  profile,
  sessions,
  initialTab,
  onSave,
  onOpenPrompt,
  onDeletePrompt,
}: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState(profile);
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => setDraft(profile), [profile]);
  useEffect(() => setTab(initialTab), [initialTab]);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(query) ||
        session.prompt.toLowerCase().includes(query),
    );
  }, [search, sessions]);

  async function save() {
    setIsSaving(true);
    setMessage("");
    try {
      await onSave(draft);
      setMessage("Settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deletePrompt(session: SavedPrompt) {
    if (!window.confirm(`Delete “${session.title}” from synced history?`)) return;
    await onDeletePrompt(session.id);
  }

  return (
    <div className="settings-page">
      <div className="settings-heading">
        <span className="modal-kicker">Account memory</span>
        <h1>Settings</h1>
        <p>
          Promptwell uses these defaults to avoid repetitive questions. Workspace overrides win
          without changing your account-wide setup.
        </p>
      </div>

      <div className="settings-tabs" role="tablist">
        <button
          className={tab === "profile" ? "is-active" : ""}
          onClick={() => setTab("profile")}
          role="tab"
          type="button"
        >
          <Settings size={16} /> Prompting profile
        </button>
        <button
          className={tab === "history" ? "is-active" : ""}
          onClick={() => setTab("history")}
          role="tab"
          type="button"
        >
          <History size={16} /> History <span>{sessions.length}</span>
        </button>
      </div>

      {tab === "profile" ? (
        <div className="settings-sections">
          <section className="settings-section">
            <div>
              <span>Account defaults</span>
              <h2>Usual environment</h2>
              <p>These choices apply in every workspace unless an override is selected below.</p>
            </div>
            <div className="settings-fields">
              <label>
                Platforms
                <ChoiceChips
                  labels={PLATFORM_LABELS}
                  values={draft.platforms}
                  onChange={(platforms) => setDraft((current) => ({ ...current, platforms }))}
                />
              </label>
              <label>
                Available tools
                <ChoiceChips
                  labels={TOOL_LABELS}
                  values={draft.tools}
                  onChange={(tools) => setDraft((current) => ({ ...current, tools }))}
                />
              </label>
              <label>
                Instruction files
                <ChoiceChips
                  labels={INSTRUCTION_LABELS}
                  values={draft.instructionFiles}
                  onChange={(instructionFiles) =>
                    setDraft((current) => ({ ...current, instructionFiles }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <div>
              <span>Workspace memory</span>
              <h2>{draft.workspace.name}</h2>
              <p>Leave a group empty to inherit the account defaults above.</p>
            </div>
            <div className="settings-fields">
              <label>
                Workspace name
                <input
                  value={draft.workspace.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      workspace: { ...current.workspace, name: event.target.value },
                    }))
                  }
                />
              </label>
              <label>
                Platform overrides
                <ChoiceChips
                  labels={PLATFORM_LABELS}
                  values={draft.workspace.overrides.platforms}
                  onChange={(platforms) =>
                    setDraft((current) => ({
                      ...current,
                      workspace: {
                        ...current.workspace,
                        overrides: { ...current.workspace.overrides, platforms },
                      },
                    }))
                  }
                />
              </label>
              <label>
                Tool overrides
                <ChoiceChips
                  labels={TOOL_LABELS}
                  values={draft.workspace.overrides.tools}
                  onChange={(tools) =>
                    setDraft((current) => ({
                      ...current,
                      workspace: {
                        ...current.workspace,
                        overrides: { ...current.workspace.overrides, tools },
                      },
                    }))
                  }
                />
              </label>
              <label>
                Instruction-file overrides
                <ChoiceChips
                  labels={INSTRUCTION_LABELS}
                  values={draft.workspace.overrides.instructionFiles}
                  onChange={(instructionFiles) =>
                    setDraft((current) => ({
                      ...current,
                      workspace: {
                        ...current.workspace,
                        overrides: { ...current.workspace.overrides, instructionFiles },
                      },
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <div>
              <span>Generation behavior</span>
              <h2>Prompt defaults</h2>
              <p>Control how much research and execution detail appears in compiled prompts.</p>
            </div>
            <div className="settings-fields">
              <label>
                Prompt depth
                <select
                  value={draft.preferences.detailLevel}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      preferences: {
                        ...current.preferences,
                        detailLevel: event.target.value as UserProfile["preferences"]["detailLevel"],
                      },
                    }))
                  }
                >
                  <option value="focused">Focused</option>
                  <option value="thorough">Thorough</option>
                  <option value="exhaustive">Exhaustive</option>
                </select>
              </label>
              {[
                ["researchByDefault", "Research current practices for every prompt"],
                ["includeToolPlan", "Include a conditional tool plan"],
                ["askOnlyMissing", "Ask only for decisions memory cannot answer"],
              ].map(([key, label]) => (
                <label className="settings-check" key={key}>
                  <input
                    checked={Boolean(draft.preferences[key as keyof typeof draft.preferences])}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          [key]: event.target.checked,
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <span><strong>{label}</strong></span>
                </label>
              ))}
              <label>
                Additional durable preference
                <textarea
                  maxLength={2_000}
                  placeholder="Only add a preference that should apply to nearly every prompt."
                  value={draft.preferences.customInstructions}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      preferences: {
                        ...current.preferences,
                        customInstructions: event.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <div className="settings-savebar">
            <span>{message}</span>
            <button className="primary-button" disabled={isSaving} onClick={save} type="button">
              {isSaving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      ) : (
        <section className="history-page">
          <div className="history-toolbar">
            <div>
              <h2>Prompt history</h2>
              <p>Every researched prompt in {profile.workspace.name}, synced to your account.</p>
            </div>
            <label className="history-search">
              <Search size={15} />
              <input
                aria-label="Search prompt history"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search history"
                value={search}
              />
            </label>
          </div>

          {filteredSessions.length === 0 ? (
            <div className="history-page-empty">
              <History size={22} />
              <strong>{search ? "No prompts match your search." : "No prompts yet."}</strong>
              <span>Your first researched prompt will appear here.</span>
            </div>
          ) : (
            <div className="history-table">
              {filteredSessions.map((session) => (
                <article key={session.id}>
                  <button className="history-open" onClick={() => onOpenPrompt(session)} type="button">
                    <span>
                      <strong>{session.title}</strong>
                      <small>{session.prompt}</small>
                    </span>
                    <span className="history-meta">
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }).format(new Date(session.updatedAt))}
                      <em>{session.stage === "result" ? "Complete" : "In progress"}</em>
                      <ArrowUpRight size={16} />
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${session.title}`}
                    className="history-delete"
                    onClick={() => deletePrompt(session)}
                    title="Delete prompt"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
