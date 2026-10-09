"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Download,
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
import {
  MAX_QUALITY_ROUNDS,
  QUALITY_GATE,
  compilePrompt,
  overallScore,
  scoreSpecification,
  weakDimensions,
} from "./promptEngine";
import { getSessionProgress, SessionWriter, mergeResearch } from "./sessionState";
import { MAX_ANSWER_CHARACTERS, MAX_PROMPT_CHARACTERS } from "./lib/validation";
import { generateFollowUpQuestions, generateQuestions } from "./provider";
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
  const title = normalized.split(" ").slice(0, 7).join(" ").slice(0, 159);
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
  const [qualityRound, setQualityRound] = useState(1);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [writer] = useState(() => new SessionWriter(saveSession));
  const unsynced = useRef(new Map<string, SavedPrompt>());
  const pendingWrites = useRef(0);
  const researchRequest = useRef<AbortController | null>(null);
  const activePromptRef = useRef<string | null>(null);

  useEffect(() => () => researchRequest.current?.abort(), []);
  useEffect(() => {
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      if (unsynced.current.size) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => window.removeEventListener("beforeunload", warnBeforeExit);
  }, []);


  const score = useMemo(
    () => scoreSpecification(prompt, answers, questions, researchBrief),
    [answers, prompt, questions, researchBrief],
  );
  const totalScore = overallScore(score);
  const scoreGaps = useMemo(() => weakDimensions(score), [score]);
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
  useEffect(() => {
    setDraftAnswer(answers.find((answer) => answer.questionId === activeQuestion?.id)?.value ?? "");
  }, [activePromptId, activeQuestion?.id, answers]);

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

  function updateSyncState() {
    setSyncState(pendingWrites.current > 0 ? "saving" : unsynced.current.size > 0 ? "error" : "saved");
  }

  function persistSession(session: SavedPrompt) {
    optimisticSession(session);
    unsynced.current.set(session.id, session);
    pendingWrites.current += 1;
    setSyncState("saving");
    void writer.save(session).then((saved) => {
      // A previous response must never replace newer optimistic progress.
      if (unsynced.current.get(session.id) === session) {
        unsynced.current.delete(session.id);
        optimisticSession(saved);
      }
    }).catch(() => {
      // Keep the latest snapshot for the explicit retry action.
    }).finally(() => {
      pendingWrites.current -= 1;
      updateSyncState();
    });
  }

  function retrySync() {
    for (const session of unsynced.current.values()) persistSession(session);
  }

  function createSession(
    nextAnswers: Answer[],
    nextStage: Exclude<AppStage, "draft">,
    nextIndex = questionIndex,
  ): SavedPrompt | null {
    return createSessionWith(nextAnswers, questions, researchBrief, researchSources, nextStage, qualityRound, nextIndex);
  }

  function stopResearch() {
    researchRequest.current?.abort();
    researchRequest.current = null;
    setIsAnalyzing(false);
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
    await writer.drain(sessionId);
    await removeSession(sessionId);
    unsynced.current.delete(sessionId);
    updateSyncState();
    setSavedPrompts((current) => current.filter((session) => session.id !== sessionId));
    if (activePromptRef.current === sessionId) resetWorkspace();
  }

  async function analyzePrompt() {
    if (isAnalyzing) return;
    if (prompt.trim().length < 12 || prompt.length > MAX_PROMPT_CHARACTERS) {
      setError("Use a complete sentence between 12 and 12,000 characters.");
      return;
    }
    if (!profile) return;

    setError("");
    setIsAnalyzing(true);
    const controller = new AbortController();
    researchRequest.current = controller;
    try {
      const result = await generateQuestions(prompt, controller.signal);
      if (researchRequest.current !== controller) return;
      const sessionId = activePromptId ?? window.crypto.randomUUID();
      const createdAt = activeCreatedAt ?? new Date().toISOString();
      setQuestions(result.questions);
      setResearchSources(result.sources);
      setResearchBrief(result.researchBrief);
      setAnswers([]);
      setQuestionIndex(0);
      setQualityRound(1);
      activePromptRef.current = sessionId;
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
        qualityRound: 1,
        questionIndex: 0,
        createdAt,
        updatedAt: createdAt,
      };
      persistSession(session);
    } catch (requestError) {
      if (researchRequest.current !== controller) return;
      setError(requestError instanceof Error ? requestError.message : "Question generation failed.");
    } finally {
      if (researchRequest.current === controller) { researchRequest.current = null; setIsAnalyzing(false); }
    }
  }

  async function continueUntilQualityGate(
    nextAnswers: Answer[],
    currentQuestions: Question[],
    currentBrief: ResearchBrief,
    currentSources: ResearchSource[],
  ) {
    if (isAnalyzing) return;
    const nextScore = scoreSpecification(prompt, nextAnswers, currentQuestions, currentBrief);
    const nextTotal = overallScore(nextScore);
    const lastIndex = Math.max(currentQuestions.length - 1, 0);
    if (nextTotal >= QUALITY_GATE || qualityRound >= MAX_QUALITY_ROUNDS) {
      setAnswers(nextAnswers);
      setStage("result");
      setError(nextTotal < QUALITY_GATE ? `Quality is ${nextTotal}/100 after ${qualityRound} rounds. Review the best available prompt before using it.` : "");
      const session = createSessionWith(nextAnswers, currentQuestions, currentBrief, currentSources, "result", qualityRound, lastIndex);
      if (session) persistSession(session);
      return;
    }

    // Save answers before any network request, including a failed/cancelled follow-up.
    const progress = createSessionWith(nextAnswers, currentQuestions, currentBrief, currentSources, "questions", qualityRound, lastIndex);
    if (progress) persistSession(progress);
    setAnswers(nextAnswers);
    setQuestionIndex(lastIndex);
    setIsAnalyzing(true);
    setError("");
    const controller = new AbortController();
    researchRequest.current = controller;
    try {
      const followUp = await generateFollowUpQuestions(prompt, {
        answers: nextAnswers, questions: currentQuestions, score: nextScore, overall: nextTotal,
        weakDimensions: weakDimensions(nextScore), researchBrief: currentBrief, round: qualityRound + 1,
      }, controller.signal);
      if (researchRequest.current !== controller) return;
      const merged = mergeResearch({ questions: currentQuestions, researchBrief: currentBrief, sources: currentSources }, followUp);
      setQuestions(merged.questions);
      setResearchBrief(merged.researchBrief);
      setResearchSources(merged.sources);
      setQualityRound(qualityRound + 1);
      setQuestionIndex(currentQuestions.length);
      setStage("questions");
      const session = createSessionWith(nextAnswers, merged.questions, merged.researchBrief, merged.sources, "questions", qualityRound + 1, currentQuestions.length);
      if (session) persistSession(session);
    } catch (requestError) {
      if (researchRequest.current !== controller) return;
      setError(requestError instanceof Error ? requestError.message : "Quality iteration failed. Try again or use the current prompt.");
    } finally {
      if (researchRequest.current === controller) { researchRequest.current = null; setIsAnalyzing(false); }
    }
  }

  function createSessionWith(
    nextAnswers: Answer[],
    nextQuestions: Question[],
    nextBrief: ResearchBrief,
    nextSources: ResearchSource[],
    nextStage: Exclude<AppStage, "draft">,
    nextRound: number,
    nextIndex: number,
  ): SavedPrompt | null {
    if (!profile || !activePromptId) return null;
    const now = new Date().toISOString();
    return {
      id: activePromptId,
      workspaceId: profile.workspace.id,
      title: titleFromPrompt(prompt),
      prompt: prompt.trim(),
      questions: nextQuestions,
      answers: nextAnswers,
      sources: nextSources,
      researchBrief: nextBrief,
      compiledPrompt: compilePrompt(
        prompt,
        nextQuestions,
        nextAnswers,
        profile,
        nextBrief,
        nextSources,
      ),
      stage: nextStage,
      qualityRound: nextRound,
      questionIndex: nextIndex,
      createdAt: activeCreatedAt ?? now,
      updatedAt: now,
    };
  }

  function submitAnswer(value = draftAnswer) {
    if (isAnalyzing || !activeQuestion || !value.trim() || value.length > MAX_ANSWER_CHARACTERS) return;
    const nextAnswers = [
      ...answers.filter((answer) => answer.questionId !== activeQuestion.id),
      { questionId: activeQuestion.id, value: value.trim() },
    ];
    setAnswers(nextAnswers);
    setDraftAnswer("");

    if (questionIndex < questions.length - 1) {
      const session = createSession(nextAnswers, "questions", questionIndex + 1);
      if (session) persistSession(session);
      setQuestionIndex((current) => current + 1);
      return;
    }

    void continueUntilQualityGate(nextAnswers, questions, researchBrief, researchSources);
  }

  function skipQuestion() {
    if (isAnalyzing) return;
    if (questionIndex < questions.length - 1) {
      const session = createSession(answers, "questions", questionIndex + 1);
      if (session) persistSession(session);
      setQuestionIndex((current) => current + 1);
      return;
    }

    void continueUntilQualityGate(answers, questions, researchBrief, researchSources);
  }

  function resetWorkspace() {
    stopResearch();
    setCopied(false);
    setView("workspace");
    setPrompt("");
    setQuestions([]);
    setResearchSources([]);
    setResearchBrief(EMPTY_RESEARCH_BRIEF);
    setAnswers([]);
    setQuestionIndex(0);
    setQualityRound(1);
    setDraftAnswer("");
    setError("");
    setStage("draft");
    setSidebarOpen(false);
    activePromptRef.current = null;
    setActivePromptId(null);
    setActiveCreatedAt(null);
  }

  function openSavedPrompt(session: SavedPrompt) {
    stopResearch();
    setCopied(false);
    const progress = getSessionProgress(session);
    setQualityRound(progress.qualityRound);
    setView("workspace");
    setPrompt(session.prompt);
    setQuestions(session.questions);
    setAnswers(session.answers);
    setResearchSources(session.sources);
    setResearchBrief(session.researchBrief ?? EMPTY_RESEARCH_BRIEF);
    setQuestionIndex(progress.questionIndex);
    activePromptRef.current = session.id;
    setActivePromptId(session.id);
    setActiveCreatedAt(session.createdAt);
    setStage(session.stage);
    setError("");
    setSidebarOpen(false);
  }

  function openSettings(target: "settings" | "history") {
    stopResearch();
    setView(target);
    setSidebarOpen(false);
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(compiledPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch { setError("Clipboard access failed. Select the prompt or download the Markdown file."); }
  }

  function downloadResult() {
    const url = URL.createObjectURL(new Blob([compiledPrompt], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "promptwell-prompt.md";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function finishNow() {
    const nextAnswers = activeQuestion && draftAnswer.trim()
      ? [...answers.filter((a) => a.questionId !== activeQuestion.id), { questionId: activeQuestion.id, value: draftAnswer.trim() }]
      : answers;
    setAnswers(nextAnswers);
    setStage("result");
    const session = createSession(nextAnswers, "result");
    if (session) persistSession(session);
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
            {syncState === "error" && <button className="text-button" onClick={retrySync}>Retry sync</button>}
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
              {isAnalyzing && (stage === "draft" || stage === "questions") && (
                <div>
                  <button className="secondary-button" onClick={() => { stopResearch(); setError("Research cancelled. Saved answers are preserved."); }}>Cancel research</button>
                  <ResearchingScene researchEnabled={profile.preferences.researchByDefault} />
                </div>
              )}

              {stage === "draft" && !isAnalyzing && (
                  <div className="draft-view">
                    <div className="eyebrow"><span>01</span> Rough material</div>
                    <h1>What are you trying<br />to make?</h1>
                    <p className="lead">
                      Paste the prompt you have. We’ll research the domain, apply your saved tool
                      profile, and find only the decisions memory cannot answer.
                    </p>

                    <div className="prompt-composer">
                      <textarea
                        maxLength={MAX_PROMPT_CHARACTERS}
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
              )}

              {stage === "questions" && !isAnalyzing && activeQuestion && (
                <div className="question-view">
                  <div className="progress-header">
                    <div>
                      <span className="progress-kicker">
                        Adaptive interview · gate {QUALITY_GATE}+ · round {qualityRound}
                      </span>
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
                      Score {totalScore}/{QUALITY_GATE} required ·{" "}
                      {scoreGaps.length > 0
                        ? `closing ${scoreGaps.join(", ")}`
                        : "quality gate clear"}{" "}
                      · {researchSources.length} sources
                    </span>
                  </div>
                  {error && <p className="error-message">{error}</p>}

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
                            aria-label={activeQuestion.prompt}
                            maxLength={MAX_ANSWER_CHARACTERS}
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
                  <button className="skip-button" onClick={finishNow} type="button">Use current prompt</button>
                </div>
              )}

              {stage === "result" && (
                <div className="result-view">
                  <div className="result-heading">
                    <div>
                      <div className="eyebrow"><span>03</span> Execution-ready specification</div>
                      <h1>
                        {totalScore >= QUALITY_GATE ? (
                          <>
                            Your prompt
                            <br />
                            now holds water.
                          </>
                        ) : (
                          <>
                            Best available
                            <br />
                            prompt is ready.
                          </>
                        )}
                      </h1>
                    </div>
                    <div className={`score-stamp ${totalScore >= QUALITY_GATE ? "score-stamp--pass" : ""}`}>
                      <span>{totalScore}</span>
                      <small>
                        gate {QUALITY_GATE}+
                        <br />
                        {totalScore >= QUALITY_GATE ? "cleared" : "not met"}
                      </small>
                    </div>
                  </div>

                  {error && <p className="error-message">{error}</p>}

                  <div className="result-toolbar">
                    <span>
                      {answers.length} decisions · {researchBrief.practices.length} practices
                    </span>
                    <button onClick={copyResult}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                      {copied ? "Copied" : "Copy prompt"}
                    </button>
                  </div>
                  {totalScore < QUALITY_GATE && <p className="error-message">Quality gate not met ({totalScore}/{QUALITY_GATE}). Review unresolved decisions before using this prompt.</p>}
                  <button className="text-button" onClick={downloadResult}><Download size={16} /> Download Markdown</button>
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
            <span>
              {!prompt.trim()
                ? "Waiting for a prompt"
                : totalScore >= QUALITY_GATE
                  ? "Quality gate cleared"
                  : `Gate ${QUALITY_GATE} · ${QUALITY_GATE - totalScore} points short`}
            </span>
            <p>
              {!prompt.trim()
                ? "Prompt health starts at zero. Paste a rough request to reveal what is already specified and what is missing."
                : totalScore >= QUALITY_GATE
                  ? "This specification meets the Promptwell bar and is ready to copy."
                  : scoreGaps.length > 0
                    ? `Keep iterating on ${scoreGaps.join(", ")}. Below ${QUALITY_GATE} is not acceptable.`
                    : `Keep answering until the score reaches ${QUALITY_GATE}.`}
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

export default App;
