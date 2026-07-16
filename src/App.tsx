"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  LogOut,
  Menu,
  MessageSquareText,
  PanelRightClose,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { compilePrompt, overallScore, scorePrompt } from "./promptEngine";
import { generateQuestions } from "./provider";
import type { Answer, AppStage, Question, ResearchSource, SavedPrompt } from "./types";
import { logout } from "./app/auth/actions";

const EXAMPLE_PROMPT =
  "Write a launch memo for our new team analytics dashboard. It needs to convince operations leaders to start a 30-day pilot.";
const SAVED_PROMPTS_KEY = "promptwell:sessions";

function titleFromPrompt(value: string): string {
  const words = value.trim().replace(/\s+/g, " ").split(" ").slice(0, 6);
  if (words.length === 0 || !words[0]) return "Untitled prompt";
  const title = words.join(" ");
  return title.length < value.trim().length ? `${title}…` : title;
}

function readSavedPrompts(): SavedPrompt[] {
  try {
    const value = window.localStorage.getItem(SAVED_PROMPTS_KEY);
    const parsed = value ? (JSON.parse(value) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as SavedPrompt[]) : [];
  } catch {
    return [];
  }
}

interface AppProps {
  user: {
    email: string;
    firstName?: string | null;
  };
}

function App({ user }: AppProps) {
  const [stage, setStage] = useState<AppStage>("draft");
  const [prompt, setPrompt] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const score = useMemo(() => scorePrompt(prompt, answers.length), [prompt, answers.length]);
  const totalScore = overallScore(score);
  const compiledPrompt = useMemo(
    () => compilePrompt(prompt, questions, answers),
    [prompt, questions, answers],
  );
  const activeQuestion = questions[questionIndex];
  const documentTitle = titleFromPrompt(prompt);

  useEffect(() => {
    setSavedPrompts(readSavedPrompts());
  }, []);

  function persistSession(session: SavedPrompt) {
    setSavedPrompts((current) => {
      const next = [session, ...current.filter((item) => item.id !== session.id)].slice(0, 30);
      window.localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function analyzePrompt() {
    if (prompt.trim().length < 12) {
      setError("Give us at least one complete sentence to work with.");
      return;
    }

    setError("");
    setIsAnalyzing(true);

    try {
      const result = await generateQuestions(prompt);
      const sessionId = activePromptId ?? window.crypto.randomUUID();
      setQuestions(result.questions);
      setResearchSources(result.sources);
      setAnswers([]);
      setQuestionIndex(0);
      setActivePromptId(sessionId);
      setStage("questions");
      persistSession({
        id: sessionId,
        title: titleFromPrompt(prompt),
        prompt: prompt.trim(),
        questions: result.questions,
        answers: [],
        sources: result.sources,
        stage: "questions",
        updatedAt: new Date().toISOString(),
      });
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
    setAnswers(nextAnswers);
    setDraftAnswer("");

    const nextStage = questionIndex === questions.length - 1 ? "result" : "questions";
    if (activePromptId) {
      persistSession({
        id: activePromptId,
        title: titleFromPrompt(prompt),
        prompt,
        questions,
        answers: nextAnswers,
        sources: researchSources,
        stage: nextStage,
        updatedAt: new Date().toISOString(),
      });
    }

    if (nextStage === "result") {
      setStage(nextStage);
      return;
    }
    setQuestionIndex((current) => current + 1);
  }

  function resetWorkspace() {
    setPrompt("");
    setQuestions([]);
    setResearchSources([]);
    setAnswers([]);
    setQuestionIndex(0);
    setDraftAnswer("");
    setError("");
    setStage("draft");
    setSidebarOpen(false);
    setActivePromptId(null);
  }

  function openSavedPrompt(session: SavedPrompt) {
    setPrompt(session.prompt);
    setQuestions(session.questions);
    setAnswers(session.answers);
    setResearchSources(session.sources);
    setQuestionIndex(Math.min(session.answers.length, Math.max(session.questions.length - 1, 0)));
    setActivePromptId(session.id);
    setStage(session.stage);
    setSidebarOpen(false);
  }

  function skipQuestion() {
    const nextStage = questionIndex === questions.length - 1 ? "result" : "questions";
    if (activePromptId) {
      persistSession({
        id: activePromptId,
        title: titleFromPrompt(prompt),
        prompt,
        questions,
        answers,
        sources: researchSources,
        stage: nextStage,
        updatedAt: new Date().toISOString(),
      });
    }

    if (nextStage === "result") setStage(nextStage);
    else setQuestionIndex((current) => current + 1);
  }

  async function copyResult() {
    await navigator.clipboard.writeText(compiledPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="app-shell">
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

        <nav className="prompt-history" aria-label="Prompt history">
          <p className="nav-label">Recent prompts</p>
          {savedPrompts.length === 0 ? (
            <p className="history-empty">Your researched prompts will appear here.</p>
          ) : (
            savedPrompts.map((session) => (
              <button
                className={`history-item ${activePromptId === session.id ? "history-item--active" : ""}`}
                key={session.id}
                onClick={() => openSavedPrompt(session)}
              >
                <span className="history-icon"><MessageSquareText size={15} /></span>
                <span>
                  <strong>{session.title}</strong>
                  <small>
                    {session.stage === "result"
                      ? `${session.answers.length} decisions resolved`
                      : `${session.answers.length} of ${session.questions.length} answered`}
                  </small>
                </span>
              </button>
            ))
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="account-row">
            <span className="account-avatar">{(user.firstName || user.email).charAt(0).toUpperCase()}</span>
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

      {sidebarOpen && <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="document-name">
            <span className="status-dot" />
            <span>{stage === "draft" ? "Untitled prompt" : documentTitle}</span>
          </div>
          <div className="topbar-actions">
            <span className="autosave">Saved locally</span>
            <button className="quality-toggle" onClick={() => setQualityOpen((open) => !open)}>
              Score {totalScore}
              <PanelRightClose size={16} />
            </button>
          </div>
        </header>

        <section className="conversation">
          {stage === "draft" && (
            <div className="draft-view">
              <div className="eyebrow"><span>01</span> Rough material</div>
              <h1>What are you trying<br />to make?</h1>
              <p className="lead">
                Paste the prompt you have. We’ll research the domain and find the missing decisions.
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
                      {isAnalyzing ? "Reading closely…" : "Interrogate prompt"}
                      {!isAnalyzing && <ArrowRight size={17} />}
                    </button>
                  </div>
                </div>
              </div>
              {error && <p className="error-message">{error}</p>}

              <div className="process-note">
                <span className="process-rule" />
                <p>
                  <strong>Not a rewrite button.</strong> Promptwell asks what the original prompt
                  leaves undecided, then compiles your answers into a testable instruction.
                </p>
              </div>
            </div>
          )}

          {stage === "questions" && activeQuestion && (
            <div className="question-view">
              <div className="progress-header">
                <div>
                  <span className="progress-kicker">Refining your brief</span>
                  <strong>{questionIndex + 1} of {questions.length}</strong>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} />
                </div>
              </div>

              <div className="research-status">
                <Sparkles size={14} />
                <span>
                  Guide applied · {researchSources.length} web {researchSources.length === 1 ? "source" : "sources"} checked
                </span>
              </div>

              <div className="source-card">
                <span>Your prompt</span>
                <p>{prompt}</p>
              </div>

              <article className="question-card">
                <div className="question-number">{String(questionIndex + 1).padStart(2, "0")}</div>
                <div className="question-content">
                  <span className="principle">{activeQuestion.principle}</span>
                  <h2>{activeQuestion.prompt}</h2>
                  <p className="question-why">{activeQuestion.why}</p>

                  {activeQuestion.kind === "choice" ? (
                    <div className="choice-list">
                      {activeQuestion.options?.map((option) => (
                        <button key={option} onClick={() => submitAnswer(option)}>
                          <span>{option}</span>
                          <ChevronRight size={18} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="answer-field">
                      <textarea
                        value={draftAnswer}
                        onChange={(event) => setDraftAnswer(event.target.value)}
                        placeholder={activeQuestion.placeholder ?? "Be concrete…"}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitAnswer();
                        }}
                        autoFocus
                      />
                      <button
                        className="primary-button"
                        disabled={!draftAnswer.trim()}
                        onClick={() => submitAnswer()}
                      >
                        Continue <ArrowRight size={17} />
                      </button>
                    </div>
                  )}
                </div>
              </article>
              <button
                className="skip-button"
                onClick={skipQuestion}
              >
                Skip this question
              </button>
            </div>
          )}

          {stage === "result" && (
            <div className="result-view">
              <div className="result-heading">
                <div>
                  <div className="eyebrow"><span>03</span> Compiled instruction</div>
                  <h1>Your prompt<br />now holds water.</h1>
                </div>
                <div className="score-stamp">
                  <span>{totalScore}</span>
                  <small>quality<br />score</small>
                </div>
              </div>

              <div className="result-toolbar">
                <span>{answers.length} decisions resolved</span>
                <button onClick={copyResult}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy prompt"}
                </button>
              </div>
              <pre className="compiled-prompt">{compiledPrompt}</pre>
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
        </section>
      </main>

      <aside className={`quality-panel ${qualityOpen ? "quality-panel--open" : ""}`}>
        <div className="quality-header">
          <div>
            <span>Prompt health</span>
            <strong>{totalScore}<small>/100</small></strong>
          </div>
          <Sparkles size={18} />
        </div>
        <div className="quality-spine" aria-label={`Prompt quality ${totalScore} out of 100`}>
          <span style={{ height: `${totalScore}%` }} />
        </div>
        <div className="metric-list">
          {Object.entries(score).map(([label, value]) => (
            <div className="metric" key={label}>
              <div><span>{label}</span><strong>{value}</strong></div>
              <div className="metric-track"><span style={{ width: `${value}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="quality-insight">
          <span>Next leverage point</span>
          <p>
            {score.verification < 50
              ? "Define what would make the output fail. An invisible rubric cannot guide the result."
              : "The brief is constrained enough to produce a specific, auditable result."}
          </p>
        </div>
      </aside>

    </div>
  );
}

export default App;
