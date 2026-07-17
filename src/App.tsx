"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  History,
  LogOut,
  Menu,
  PanelRightClose,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";

import { loadProfile, loadSessions, removeSession, saveSession, updateProfile } from "./account";
import { logout } from "./app/auth/actions";
import Onboarding from "./components/Onboarding";
import ResearchingScene from "./components/ResearchingScene";
import SettingsPage from "./components/SettingsPage";
import { PLATFORM_LABELS, TOOL_LABELS } from "./lib/catalog";
import { compilePrompt, overallScore, scorePrompt } from "./promptEngine";
import { generateQuestions } from "./provider";
import type {
  Answer,
  AppStage,
  Question,
  ResearchBrief,
  ResearchSource,
  SavedPrompt,
  UserProfile,
} from "./types";

const EXAMPLE_PROMPT =
  "Build an account settings page for our Next.js app. It should let users manage their profile and notification preferences.";

const EMPTY_RESEARCH_BRIEF: ResearchBrief = {
  domain: "",
  taskType: "",
  practices: [],
  toolPlan: [],
  verificationPlan: [],
};

type AppView = "workspace" | "settings" | "history";
type SyncState = "idle" | "saving" | "saved" | "error";

function titleFromPrompt(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const title = normalized.split(" ").slice(0, 7).join(" ");
  if (!title) return "Untitled prompt";
  return title.length < normalized.length ? `${title}…` : title;
}

interface AppProps {
  user: {
    id: string;
    email: string;
    firstName?: string | null;
  };
}

function App({ user }: AppProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState("");
  const [view, setView] = useState<AppView>("workspace");
  const [stage, setStage] = useState<AppStage>("draft");
  const [prompt, setPrompt] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);
  const [researchBrief, setResearchBrief] = useState<ResearchBrief>(EMPTY_RESEARCH_BRIEF);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [activeCreatedAt, setActiveCreatedAt] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");

  const score = useMemo(() => scorePrompt(prompt, answers.length), [prompt, answers.length]);
  const totalScore = overallScore(score);
  const compiledPrompt = useMemo(
    () =>
      profile
        ? compilePrompt(
            prompt,
            questions,
            answers,
            profile,
            researchBrief,
            researchSources,
          )
        : "",
    [answers, profile, prompt, questions, researchBrief, researchSources],
  );
  const activeQuestion = questions[questionIndex];
  const documentTitle = titleFromPrompt(prompt);

  async function bootstrap() {
    setIsBootstrapping(true);
    setBootstrapError("");
    try {
      const nextProfile = await loadProfile();
      setProfile(nextProfile);
      if (nextProfile.onboardingCompleted) {
        setSavedPrompts(await loadSessions(nextProfile.workspace.id));
      }
    } catch (loadError) {
      setBootstrapError(
        loadError instanceof Error ? loadError.message : "Promptwell could not load your account.",
      );
    } finally {
      setIsBootstrapping(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  function optimisticSession(session: SavedPrompt) {
    setSavedPrompts((current) =>
      [session, ...current.filter((item) => item.id !== session.id)]
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 100),
    );
  }

  function persistSession(session: SavedPrompt) {
    optimisticSession(session);
    setSyncState("saving");
    void saveSession(session)
      .then((saved) => {
        optimisticSession(saved);
        setSyncState("saved");
      })
      .catch((saveError) => {
        console.error("[Prompt session] Save failed", saveError);
        setSyncState("error");
      });
  }

  function createSession(
    nextAnswers: Answer[],
    nextStage: Exclude<AppStage, "draft">,
  ): SavedPrompt | null {
    if (!profile || !activePromptId) return null;
    const now = new Date().toISOString();
    return {
      id: activePromptId,
      workspaceId: profile.workspace.id,
      title: titleFromPrompt(prompt),
      prompt: prompt.trim(),
      questions,
      answers: nextAnswers,
      sources: researchSources,
      researchBrief,
      compiledPrompt: compilePrompt(
        prompt,
        questions,
        nextAnswers,
        profile,
        researchBrief,
        researchSources,
      ),
      stage: nextStage,
      createdAt: activeCreatedAt ?? now,
      updatedAt: now,
    };
  }

  async function completeOnboarding(nextProfile: UserProfile) {
    const savedProfile = await updateProfile(nextProfile);
    setProfile(savedProfile);
    setSavedPrompts(await loadSessions(savedProfile.workspace.id));
  }

  async function saveProfileSettings(nextProfile: UserProfile) {
    const savedProfile = await updateProfile(nextProfile);
    setProfile(savedProfile);
  }

  async function deletePrompt(sessionId: string) {
    await removeSession(sessionId);
    setSavedPrompts((current) => current.filter((session) => session.id !== sessionId));
    if (activePromptId === sessionId) resetWorkspace();
  }

  async function analyzePrompt() {
    if (prompt.trim().length < 12) {
      setError("Give us at least one complete sentence to work with.");
      return;
    }
    if (!profile) return;

    setError("");
    setIsAnalyzing(true);
    try {
      const result = await generateQuestions(prompt);
      const sessionId = activePromptId ?? window.crypto.randomUUID();
      const createdAt = activeCreatedAt ?? new Date().toISOString();
      setQuestions(result.questions);
      setResearchSources(result.sources);
      setResearchBrief(result.researchBrief);
      setAnswers([]);
      setQuestionIndex(0);
      setActivePromptId(sessionId);
      setActiveCreatedAt(createdAt);
      setStage("questions");

      const session: SavedPrompt = {
        id: sessionId,
        workspaceId: profile.workspace.id,
        title: titleFromPrompt(prompt),
        prompt: prompt.trim(),
        questions: result.questions,
        answers: [],
        sources: result.sources,
        researchBrief: result.researchBrief,
        compiledPrompt: compilePrompt(
          prompt,
          result.questions,
          [],
          profile,
          result.researchBrief,
          result.sources,
        ),
        stage: "questions",
        createdAt,
        updatedAt: createdAt,
      };
      persistSession(session);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Question generation failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function submitAnswer(value = draftAnswer) {
    if (!activeQuestion || !value.trim()) return;
    const nextAnswers = [
      ...answers.filter((answer) => answer.questionId !== activeQuestion.id),
      { questionId: activeQuestion.id, value: value.trim() },
    ];
    const nextStage = questionIndex === questions.length - 1 ? "result" : "questions";
    setAnswers(nextAnswers);
    setDraftAnswer("");
    const session = createSession(nextAnswers, nextStage);
    if (session) persistSession(session);

    if (nextStage === "result") setStage("result");
    else setQuestionIndex((current) => current + 1);
  }

  function skipQuestion() {
    const nextStage = questionIndex === questions.length - 1 ? "result" : "questions";
    const session = createSession(answers, nextStage);
    if (session) persistSession(session);
    if (nextStage === "result") setStage("result");
    else setQuestionIndex((current) => current + 1);
  }

  function resetWorkspace() {
    setView("workspace");
    setPrompt("");
    setQuestions([]);
    setResearchSources([]);
    setResearchBrief(EMPTY_RESEARCH_BRIEF);
    setAnswers([]);
    setQuestionIndex(0);
    setDraftAnswer("");
    setError("");
    setStage("draft");
    setSidebarOpen(false);
    setActivePromptId(null);
    setActiveCreatedAt(null);
  }

  function openSavedPrompt(session: SavedPrompt) {
    setView("workspace");
    setPrompt(session.prompt);
    setQuestions(session.questions);
    setAnswers(session.answers);
    setResearchSources(session.sources);
    setResearchBrief(session.researchBrief ?? EMPTY_RESEARCH_BRIEF);
    setQuestionIndex(Math.min(session.answers.length, Math.max(session.questions.length - 1, 0)));
    setActivePromptId(session.id);
    setActiveCreatedAt(session.createdAt);
    setStage(session.stage);
    setSidebarOpen(false);
  }

  function openSettings(target: "settings" | "history") {
    setView(target);
    setSidebarOpen(false);
  }

  async function copyResult() {
    await navigator.clipboard.writeText(compiledPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  if (isBootstrapping) {
    return (
      <main className="loading-screen">
        <span className="brand-mark">P/</span>
        <strong>Loading your prompting memory…</strong>
      </main>
    );
  }

  if (bootstrapError || !profile) {
    return (
      <main className="loading-screen">
        <span className="brand-mark">P/</span>
        <strong>Your account memory is unavailable.</strong>
        <p>{bootstrapError}</p>
        <button className="primary-button" onClick={() => void bootstrap()} type="button">
          Try again
        </button>
      </main>
    );
  }

  if (!profile.onboardingCompleted) {
    return (
      <Onboarding
        firstName={user.firstName}
        onComplete={completeOnboarding}
        profile={profile}
      />
    );
  }

  const syncLabel =
    syncState === "saving"
      ? "Saving…"
      : syncState === "error"
        ? "Sync failed"
        : syncState === "saved"
          ? "Synced"
          : "Account sync";

  return (
    <div className={`app-shell ${view !== "workspace" ? "app-shell--page" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}>
        <div className="brand-row">
          <button className="brand" onClick={resetWorkspace} aria-label="Promptwell home">
            <span className="brand-mark">P/</span>
            <span>Promptwell</span>
          </button>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <button className="new-prompt-button" onClick={resetWorkspace}>
          <Plus size={17} />
          New prompt
          <span className="shortcut">⌘ N</span>
        </button>

        <nav className="main-navigation" aria-label="Primary navigation">
          <button
            className={view === "history" ? "is-active" : ""}
            onClick={() => openSettings("history")}
          >
            <History size={16} /> History
            <span>{savedPrompts.length}</span>
          </button>
          <button
            className={view === "settings" ? "is-active" : ""}
            onClick={() => openSettings("settings")}
          >
            <Settings size={16} /> Settings
          </button>
        </nav>

        <div className="sidebar-context">
          <span>Active workspace</span>
          <strong>{profile.workspace.name}</strong>
          <small>
            {profile.platforms.length} platforms · {profile.tools.length} tools remembered
          </small>
        </div>

        <div className="sidebar-footer">
          <div className="account-row">
            <span className="account-avatar">
              {(user.firstName || user.email).charAt(0).toUpperCase()}
            </span>
            <span>
              <strong>{user.firstName || "Signed in"}</strong>
              <small>{user.email}</small>
            </span>
            <form action={logout}>
              <button className="sign-out-button" aria-label="Sign out" title="Sign out">
                <LogOut size={15} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />
      )}

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="document-name">
            <span className="status-dot" />
            <span>
              {view === "workspace"
                ? stage === "draft"
                  ? "Untitled prompt"
                  : documentTitle
                : view === "history"
                  ? "Settings / History"
                  : "Settings / Prompting profile"}
            </span>
          </div>
          <div className="topbar-actions">
            <span className={`autosave ${syncState === "error" ? "autosave--error" : ""}`}>
              {syncLabel}
            </span>
            {view === "workspace" && (
              <button className="quality-toggle" onClick={() => setQualityOpen((open) => !open)}>
                Score {totalScore}
                <PanelRightClose size={16} />
              </button>
            )}
          </div>
        </header>

        <section className="conversation">
          {view !== "workspace" ? (
            <SettingsPage
              initialTab={view === "history" ? "history" : "profile"}
              onDeletePrompt={deletePrompt}
              onOpenPrompt={openSavedPrompt}
              onSave={saveProfileSettings}
              profile={profile}
              sessions={savedPrompts}
            />
          ) : (
            <>
              {stage === "draft" && (
                isAnalyzing ? (
                  <ResearchingScene />
                ) : (
                  <div className="draft-view">
                    <div className="eyebrow"><span>01</span> Rough material</div>
                    <h1>What are you trying<br />to make?</h1>
                    <p className="lead">
                      Paste the prompt you have. We’ll research the domain, apply your saved tool
                      profile, and find only the decisions memory cannot answer.
                    </p>

                    <div className="prompt-composer">
                      <textarea
                        value={prompt}
                        onChange={(event) => {
                          setPrompt(event.target.value);
                          setError("");
                        }}
                        placeholder="Paste a rough prompt, brief, or half-formed idea…"
                        aria-label="Your rough prompt"
                        autoFocus
                      />
                      <div className="composer-footer">
                        <button className="text-button" onClick={() => setPrompt(EXAMPLE_PROMPT)}>
                          Use an example
                        </button>
                        <div className="composer-submit">
                          <span>{prompt.length.toLocaleString()} / 12,000</span>
                          <button
                            className="primary-button"
                            onClick={analyzePrompt}
                            disabled={isAnalyzing}
                          >
                            Research prompt
                            <ArrowRight size={17} />
                          </button>
                        </div>
                      </div>
                    </div>
                    {error && <p className="error-message">{error}</p>}

                    <div className="memory-strip">
                      <span>Remembered</span>
                      <div>
                        {[
                          ...profile.platforms.map((id) => PLATFORM_LABELS[id]),
                          ...profile.tools.map((id) => TOOL_LABELS[id]),
                        ].map((item) => (
                          <small key={item}>{item}</small>
                        ))}
                      </div>
                      <button onClick={() => openSettings("settings")}>Edit defaults</button>
                    </div>
                  </div>
                )
              )}

              {stage === "questions" && activeQuestion && (
                <div className="question-view">
                  <div className="progress-header">
                    <div>
                      <span className="progress-kicker">Adaptive interview</span>
                      <strong>
                        {questionIndex + 1} of {questions.length}
                      </strong>
                    </div>
                    <div className="progress-track">
                      <span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} />
                    </div>
                  </div>

                  <div className="research-status">
                    <Sparkles size={14} />
                    <span>
                      {researchBrief.domain || "Domain"} strategy · {researchSources.length} primary
                      sources · memory skips known tools
                    </span>
                  </div>

                  <div className="source-card">
                    <span>Working brief</span>
                    <p>{prompt}</p>
                  </div>

                  <article className="question-card">
                    <div className="question-number">
                      {String(questionIndex + 1).padStart(2, "0")}
                    </div>
                    <div className="question-content">
                      <div className="question-meta">
                        <span className="principle">{activeQuestion.principle}</span>
                        <span>
                          {activeQuestion.kind === "choice" ? "Pick one" : "Write the detail"}
                        </span>
                      </div>
                      <h2 className="question-title">{activeQuestion.prompt}</h2>
                      <div className="question-why">
                        <strong>What this changes</strong>
                        <p>{activeQuestion.why}</p>
                      </div>

                      {activeQuestion.kind === "choice" ? (
                        <div className="choice-list">
                          {activeQuestion.options?.map((option, index) => (
                            <button key={option} onClick={() => submitAnswer(option)} type="button">
                              <span className="choice-key">
                                {String.fromCharCode(65 + index)}
                              </span>
                              <span className="choice-label">{option}</span>
                              <ChevronRight size={18} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="answer-field">
                          <textarea
                            value={draftAnswer}
                            onChange={(event) => setDraftAnswer(event.target.value)}
                            placeholder={activeQuestion.placeholder ?? "Add the concrete details…"}
                            onKeyDown={(event) => {
                              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                submitAnswer();
                              }
                            }}
                            autoFocus
                          />
                          <div className="answer-footer">
                            <span>⌘ Enter to continue</span>
                            <button
                              className="primary-button"
                              disabled={!draftAnswer.trim()}
                              onClick={() => submitAnswer()}
                              type="button"
                            >
                              Save answer <ArrowRight size={17} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                  <button className="skip-button" onClick={skipQuestion} type="button">
                    Memory already covers this
                  </button>
                </div>
              )}

              {stage === "result" && (
                <div className="result-view">
                  <div className="result-heading">
                    <div>
                      <div className="eyebrow"><span>03</span> Execution-ready specification</div>
                      <h1>Your prompt<br />now holds water.</h1>
                    </div>
                    <div className="score-stamp">
                      <span>{totalScore}</span>
                      <small>quality<br />score</small>
                    </div>
                  </div>

                  <div className="result-toolbar">
                    <span>
                      {answers.length} decisions · {researchBrief.practices.length} researched practices
                    </span>
                    <button onClick={copyResult}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? "Copied" : "Copy prompt"}
                    </button>
                  </div>
                  <pre className="compiled-prompt">{compiledPrompt}</pre>

                  <section className="strategy-summary">
                    <div>
                      <span>Adaptive strategy</span>
                      <strong>{researchBrief.taskType}</strong>
                    </div>
                    <ul>
                      {researchBrief.practices.map((practice) => (
                        <li key={practice.title}>
                          <strong>{practice.title}</strong>
                          <span>{practice.application}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="research-sources" aria-labelledby="research-sources-title">
                    <div className="research-sources-heading">
                      <span>Research trail</span>
                      <strong id="research-sources-title">{researchSources.length} sources</strong>
                    </div>
                    {researchSources.map((source) => (
                      <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
                        <span>{source.title}</span>
                        <small>{source.practice}</small>
                      </a>
                    ))}
                  </section>
                  <div className="result-actions">
                    <button className="secondary-button" onClick={() => {
                      setStage("questions");
                      setQuestionIndex(0);
                    }}>
                      Review answers
                    </button>
                    <button className="primary-button" onClick={resetWorkspace}>
                      Refine another prompt <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {view === "workspace" && (
        <aside
          className={`quality-panel ${qualityOpen ? "quality-panel--open" : ""} ${
            totalScore === 0 ? "quality-panel--zero" : ""
          }`}
        >
          <div className="quality-header">
            <div>
              <span>Prompt health</span>
              <strong>
                {totalScore}
                <small>/100</small>
              </strong>
            </div>
            <Sparkles size={18} />
          </div>
          <div className="quality-spine" aria-label={`Prompt quality ${totalScore} out of 100`}>
            <span style={{ height: totalScore === 0 ? "0%" : `${totalScore}%` }} />
          </div>
          <div className="metric-list">
            {Object.entries(score).map(([label, value]) => (
              <div className="metric" key={label}>
                <div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
                <div className={`metric-track ${value === 0 ? "metric-track--empty" : ""}`}>
                  <span style={{ width: value === 0 ? "0%" : `${value}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="quality-insight">
            <span>{prompt.trim() ? "Next leverage point" : "Waiting for a prompt"}</span>
            <p>
              {!prompt.trim()
                ? "Prompt health starts at zero. Paste a rough request to reveal what is already specified and what is missing."
                : score.verification < 50
                  ? "Define what would make the output fail. An invisible rubric cannot guide the result."
                  : "The brief is constrained enough to produce a specific, auditable result."}
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

export default App;
