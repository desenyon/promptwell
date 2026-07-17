"use client";

import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  InstructionFileId,
  PlatformId,
  ToolId,
  UserProfile,
} from "@/types";

interface SelectOption<T extends string> {
  id: T;
  label: string;
  description: string;
}

const PLATFORM_OPTIONS: SelectOption<PlatformId>[] = [
  { id: "cursor", label: "Cursor", description: "Rules, skills, MCP, and agent workflows" },
  { id: "claude-code", label: "Claude Code", description: "CLAUDE.md, skills, hooks, and subagents" },
  { id: "codex", label: "Codex CLI", description: "AGENTS.md, skills, MCP, and automations" },
  { id: "generic", label: "Chat or API", description: "Portable prompts without coding-agent assumptions" },
];

const TOOL_OPTIONS: SelectOption<ToolId>[] = [
  { id: "graphify", label: "Graphify", description: "Queryable codebase knowledge graphs" },
  { id: "context7", label: "Context7", description: "Current, version-specific library documentation" },
  { id: "headroom", label: "Headroom", description: "Context compression with source retrieval" },
  { id: "web-search", label: "Web search", description: "Current external research and primary sources" },
];

const INSTRUCTION_OPTIONS: SelectOption<InstructionFileId>[] = [
  { id: "agents-md", label: "AGENTS.md", description: "Cross-tool repository instructions" },
  { id: "claude-md", label: "CLAUDE.md", description: "Claude-specific project memory" },
  { id: "cursor-rules", label: "Cursor rules", description: "Scoped .cursor/rules/*.mdc guidance" },
];

interface OnboardingProps {
  profile: UserProfile;
  firstName?: string | null;
  onComplete: (profile: UserProfile) => Promise<void>;
}

function toggle<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function SelectionGrid<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: SelectOption<T>[];
  selected: T[];
  onChange: (values: T[]) => void;
}) {
  return (
    <div className="onboarding-options">
      {options.map((option) => {
        const active = selected.includes(option.id);
        return (
          <button
            className={`onboarding-option ${active ? "onboarding-option--active" : ""}`}
            key={option.id}
            onClick={() => onChange(toggle(selected, option.id))}
            type="button"
          >
            <span className="option-check">{active && <Check size={14} />}</span>
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function Onboarding({ profile, firstName, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<UserProfile>({
    ...profile,
    tools: profile.tools.length > 0 ? profile.tools : TOOL_OPTIONS.map((option) => option.id),
    instructionFiles:
      profile.instructionFiles.length > 0
        ? profile.instructionFiles
        : INSTRUCTION_OPTIONS.map((option) => option.id),
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const canContinue = useMemo(() => {
    if (step === 0) return draft.platforms.length > 0;
    if (step === 3) return draft.workspace.name.trim().length > 0;
    return true;
  }, [draft.platforms.length, draft.workspace.name, step]);

  async function continueOnboarding() {
    if (!canContinue) return;
    if (step < 3) {
      setStep((current) => current + 1);
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onComplete({ ...draft, onboardingCompleted: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Onboarding could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-brand">
        <span className="brand-mark">P/</span>
        <span>Promptwell</span>
      </header>

      <section className="onboarding-card">
        <div className="onboarding-progress" aria-label={`Onboarding step ${step + 1} of 4`}>
          {[0, 1, 2, 3].map((item) => (
            <span className={item <= step ? "is-active" : ""} key={item} />
          ))}
        </div>

        {step === 0 && (
          <>
            <span className="modal-kicker">Your working environment</span>
            <h1>{firstName ? `Set up your profile, ${firstName}.` : "Set up your prompting profile."}</h1>
            <p>
              Choose every environment you use. Promptwell will adapt its questions, instruction
              files, and execution protocol without asking again on every prompt.
            </p>
            <SelectionGrid
              options={PLATFORM_OPTIONS}
              selected={draft.platforms}
              onChange={(platforms) => setDraft((current) => ({ ...current, platforms }))}
            />
          </>
        )}

        {step === 1 && (
          <>
            <span className="modal-kicker">Available extensions</span>
            <h1>Which tools can your agents actually call?</h1>
            <p>
              Tool instructions are conditional. Promptwell will never tell an agent to use an
              extension you have not marked as available.
            </p>
            <SelectionGrid
              options={TOOL_OPTIONS}
              selected={draft.tools}
              onChange={(tools) => setDraft((current) => ({ ...current, tools }))}
            />
          </>
        )}

        {step === 2 && (
          <>
            <span className="modal-kicker">Persistent instructions</span>
            <h1>Where do your projects keep agent guidance?</h1>
            <p>
              We will tell the agent which instruction chain to inspect and avoid duplicating
              rules across incompatible formats.
            </p>
            <SelectionGrid
              options={INSTRUCTION_OPTIONS}
              selected={draft.instructionFiles}
              onChange={(instructionFiles) =>
                setDraft((current) => ({ ...current, instructionFiles }))
              }
            />
          </>
        )}

        {step === 3 && (
          <>
            <span className="modal-kicker">Default behavior</span>
            <h1>Make the useful defaults automatic.</h1>
            <p>
              These settings sync to your account. Each workspace can override them later without
              changing the account-wide profile.
            </p>
            <div className="onboarding-form">
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
              <label className="settings-check">
                <input
                  checked={draft.preferences.askOnlyMissing}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      preferences: {
                        ...current.preferences,
                        askOnlyMissing: event.target.checked,
                      },
                    }))
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Ask only what memory does not know</strong>
                  <small>Reuse platform, tool, and instruction-file preferences automatically.</small>
                </span>
              </label>
            </div>
          </>
        )}

        {error && <p className="error-message">{error}</p>}
        <footer className="onboarding-actions">
          <button
            className="secondary-button"
            disabled={step === 0 || isSaving}
            onClick={() => setStep((current) => current - 1)}
            type="button"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <button
            className="primary-button"
            disabled={!canContinue || isSaving}
            onClick={continueOnboarding}
            type="button"
          >
            {step === 3 ? (
              <>
                <Sparkles size={16} /> {isSaving ? "Saving…" : "Finish setup"}
              </>
            ) : (
              <>
                Continue <ArrowRight size={16} />
              </>
            )}
          </button>
        </footer>
      </section>
    </main>
  );
}
