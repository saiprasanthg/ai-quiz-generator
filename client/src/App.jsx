import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE || "";

async function parseJsonSafe(response) {
  try { return await response.json(); }
  catch { return {}; }
}

function getApiErrorMessage(payload, fallback) {
  const parts = [];
  if (typeof payload?.error === "string" && payload.error.trim()) parts.push(payload.error.trim());
  if (typeof payload?.details === "string" && payload.details.trim()) parts.push(payload.details.trim());
  if (typeof payload?.hint === "string" && payload.hint.trim()) parts.push(`Hint: ${payload.hint.trim()}`);
  return parts.length > 0 ? parts.join(" ") : fallback;
}

function getRequestErrorMessage(err, fallback) {
  if (err?.name === "AbortError")
    return "Quiz generation timed out after 45 seconds. Try a shorter topic or retry.";
  const msg = typeof err?.message === "string" ? err.message.trim() : "";
  if ((err?.name === "TypeError" || err instanceof TypeError) &&
    (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror")))
    return "Cannot reach the quiz API. Start the backend (`cd server && npm run dev`) and verify VITE_API_BASE.";
  return msg || fallback;
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E"];

// ── HOME PAGE ──────────────────────────────────────────────────────────────
function HomePage({
  isGenerating, cancelGeneration, generateQuiz,
  topic, setTopic, difficulty, setDifficulty,
  numQuestions, setNumQuestions, resetAll,
  error, quiz, navigate, startNewQuiz
}) {
  if (isGenerating) {
    return (
      <div className="page-shell">
        <div className="app-card" style={{ width: "min(860px,100%)" }}>
          <div className="loading-state">
            <div className="loading-ring" />
            <div className="loading-dots">
              <span /><span /><span />
            </div>
            <h1>Generating your quiz</h1>
            <p>Crafting intelligent questions tailored to your topic. This may take a moment.</p>
            <button className="secondary" type="button" onClick={cancelGeneration}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="app-card" style={{ width: "min(860px,100%)" }}>
        <header className="header">
          <p className="eyebrow">React · Node.js · Express · OpenAI API</p>
          <h1>AI Quiz <em>Generator</em></h1>
          <p className="subtext">
            Enter any topic to generate a dynamic, adaptive quiz. Answer questions on a dedicated
            page and receive real-time performance feedback.
          </p>
        </header>

        <form className="controls" onSubmit={generateQuiz}>
          <label>
            Topic
            <input
              type="text"
              placeholder="e.g. JavaScript closures, World War II, SQL joins…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isGenerating}
            />
          </label>

          <div className="control-row">
            <label>
              Difficulty
              <div className="select-wrap">
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  disabled={isGenerating}
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </label>

            <label>
              Questions
              <input
                type="number"
                min={1} max={10}
                value={numQuestions}
                onChange={(e) => setNumQuestions(Number(e.target.value || 1))}
                disabled={isGenerating}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="primary" type="submit" disabled={isGenerating}>
              Generate Quiz →
            </button>
            <button className="secondary" type="button" onClick={resetAll}>
              Reset
            </button>
          </div>
        </form>

        {error && <p className="error-message">{error}</p>}

        {quiz && (
          <section className="result-card compact">
            <h2>Active Session</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.35rem" }}>
              A quiz is already loaded. Continue where you left off or start fresh.
            </p>
            <div className="button-row" style={{ marginTop: "1rem" }}>
              <button className="primary" type="button" onClick={() => navigate(`/quiz/${quiz.quizId}`)}>
                Continue Quiz →
              </button>
              <button className="secondary" type="button" onClick={startNewQuiz}>
                Clear Session
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── QUIZ PAGE ──────────────────────────────────────────────────────────────
function QuizPage({
  quiz, error, answeredCount, answers,
  finalResultsByQuestion, selectAnswer,
  submitQuiz, isSubmitting, finalResult,
  navigate, startNewQuiz
}) {
  const { quizId } = useParams();

  if (!quiz) return <Navigate to="/" replace />;
  if (quizId !== quiz.quizId) return <Navigate to={`/quiz/${quiz.quizId}`} replace />;

  const pct = quiz.totalQuestions > 0
    ? Math.round((answeredCount / quiz.totalQuestions) * 100)
    : 0;

  return (
    <div className="page-shell">
      <div className="app-card" style={{ width: "min(860px,100%)" }}>
        <header className="header">
          <p className="eyebrow">Quiz Session</p>
          <h1><em>{quiz.topic}</em></h1>
          <p className="subtext">
            Answer all questions, then submit to reveal your score and detailed feedback.
          </p>
          <div className="button-row">
            <button className="secondary" type="button" onClick={() => navigate("/")}>
              ← Generator
            </button>
            <button className="secondary" type="button" onClick={startNewQuiz}>
              New Quiz
            </button>
          </div>
        </header>

        {error && <p className="error-message">{error}</p>}

        <section className="quiz-panel">
          {/* Progress */}
          <div className="progress-panel">
            <h2>Progress</h2>
            <p>{answeredCount} / {quiz.totalQuestions} answered</p>
            <div className="meter-track">
              <span className="meter-fill" style={{ width: `${pct}%` }} />
            </div>
            <p style={{ color: "var(--gold-dim)", fontWeight: 600 }}>{pct}%</p>
          </div>

          {/* Questions */}
          <div className="questions-list">
            {quiz.questions.map((question, index) => {
              const currentAnswer = answers[question.id];
              const feedback = finalResultsByQuestion[question.id];

              return (
                <article className="question-card" key={question.id}>
                  <span className="q-number">Question {index + 1} of {quiz.questions.length}</span>
                  <h3>{question.prompt}</h3>

                  <div className="options-grid">
                    {question.options.map((option, optIdx) => (
                      <button
                        key={`${question.id}-${optIdx}`}
                        type="button"
                        className={`option-btn${currentAnswer === optIdx ? " selected" : ""}`}
                        onClick={() => selectAnswer(question.id, optIdx)}
                        disabled={!!feedback}
                      >
                        <span className="opt-letter">{OPTION_LETTERS[optIdx]}</span>
                        {option}
                      </button>
                    ))}
                  </div>

                  {feedback && (
                    <p className={`feedback ${feedback.correct ? "correct" : "incorrect"}`}>
                      {feedback.correct
                        ? `✓ Correct — ${feedback.selectedText}.`
                        : `✗ Incorrect. You chose: ${feedback.selectedText}. Correct: ${feedback.correctText}.`
                      }{" "}{feedback.explanation}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          {/* Submit */}
          <div className="submit-row">
            <button
              className="primary submit"
              type="button"
              onClick={submitQuiz}
              disabled={isSubmitting || answeredCount === 0}
            >
              {isSubmitting ? "Evaluating…" : "Submit for Evaluation →"}
            </button>
          </div>
        </section>

        {/* Results */}
        {finalResult && (
          <section className="result-card">
            <h2>Performance Report</h2>
            <div className="result-score">
              {finalResult.accuracy}%
            </div>
            <p style={{ fontFamily: "var(--mono)", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              {finalResult.score} / {finalResult.totalQuestions} correct
            </p>
            <p className="result-meta">{finalResult.feedback.summary}</p>

            <div className="result-divider" />

            <div className="result-columns">
              <div>
                <h3>Strengths</h3>
                <ul>
                  {finalResult.feedback.strengths.map((s, i) => (
                    <li key={`s-${i}`}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Areas to Improve</h3>
                <ul>
                  {finalResult.feedback.improvements.map((s, i) => (
                    <li key={`i-${i}`}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="button-row" style={{ marginTop: "1.5rem" }}>
              <button className="primary" type="button" onClick={startNewQuiz}>
                Start New Quiz →
              </button>
              <button className="secondary" type="button" onClick={() => navigate("/")}>
                Back to Generator
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── APP ROOT ───────────────────────────────────────────────────────────────
export default function App() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [numQuestions, setNumQuestions] = useState(5);
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [finalResult, setFinalResult] = useState(null);
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  const finalResultsByQuestion = useMemo(() => {
    const map = {};
    if (!Array.isArray(finalResult?.results)) return map;
    for (const r of finalResult.results) map[r.questionId] = r;
    return map;
  }, [finalResult]);

  async function generateQuiz(e) {
    e.preventDefault();
    const cleanTopic = topic.trim();
    if (!cleanTopic) { setError("Enter a topic to generate a quiz."); return; }

    setError(""); setIsGenerating(true); setFinalResult(null);
    let timerId;

    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      timerId = setTimeout(() => controller.abort(), 45000);

      const res = await fetch(`${API_BASE}/api/quiz/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ topic: cleanTopic, difficulty, numQuestions }),
      });

      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to generate quiz."));

      setQuiz(data); setAnswers({}); setFinalResult(null);
      navigate(`/quiz/${data.quizId}`);
    } catch (err) {
      setError(getRequestErrorMessage(err, "Unexpected error while generating quiz."));
    } finally {
      clearTimeout(timerId);
      setIsGenerating(false);
      abortRef.current = null;
    }
  }

  function cancelGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
  }

  function selectAnswer(questionId, selectedOption) {
    if (!quiz) return;
    setError("");
    setAnswers((prev) => ({ ...prev, [questionId]: selectedOption }));
    setFinalResult(null);
  }

  async function submitQuiz() {
    if (!quiz) return;
    setError(""); setIsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/quiz/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizId: quiz.quizId, answers }),
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data, "Failed to submit quiz."));
      setFinalResult(data);
    } catch (err) {
      setError(getRequestErrorMessage(err, "Unexpected error while submitting quiz."));
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetAll() {
    cancelGeneration();
    setQuiz(null); setAnswers({}); setFinalResult(null);
    setError(""); setIsSubmitting(false);
  }

  function startNewQuiz() { resetAll(); navigate("/"); }

  const shared = { quiz, error, navigate, startNewQuiz };

  return (
    <Routes>
      <Route path="/" element={
        <HomePage
          {...shared}
          isGenerating={isGenerating} cancelGeneration={cancelGeneration}
          generateQuiz={generateQuiz} topic={topic} setTopic={setTopic}
          difficulty={difficulty} setDifficulty={setDifficulty}
          numQuestions={numQuestions} setNumQuestions={setNumQuestions}
          resetAll={resetAll}
        />
      } />
      <Route path="/quiz/:quizId" element={
        <QuizPage
          {...shared}
          answeredCount={answeredCount} answers={answers}
          finalResultsByQuestion={finalResultsByQuestion}
          selectAnswer={selectAnswer} submitQuiz={submitQuiz}
          isSubmitting={isSubmitting} finalResult={finalResult}
        />
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}