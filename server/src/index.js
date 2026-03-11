import crypto from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { generatePerformanceFeedback, generateQuizFromTopic } from "./quizService.js";

dotenv.config();

const app = express();
const port = Number.parseInt(process.env.PORT || "4000", 10);

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "*"
  })
);
app.use(express.json());

const quizzes = new Map();

function inferQuizGenerationHint(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("openai_api_key")) {
    return "Set OPENAI_API_KEY in server/.env and restart the backend.";
  }

  if (status === 401 || message.includes("incorrect api key") || message.includes("invalid api key")) {
    return "The API key appears invalid. Check OPENAI_API_KEY in server/.env.";
  }

  if (status === 429 || message.includes("quota") || message.includes("rate limit")) {
    return "Your OpenAI account hit a rate limit or quota. Check usage and billing.";
  }

  if (message.includes("model") && (message.includes("not found") || message.includes("access"))) {
    return "Set OPENAI_MODEL in server/.env to a model available to your account.";
  }

  return "Verify OPENAI_API_KEY, OPENAI_MODEL, and internet access from the backend environment.";
}

function parseDifficulty(difficulty) {
  const allowed = ["easy", "medium", "hard"];
  if (typeof difficulty !== "string") {
    return "medium";
  }

  const normalized = difficulty.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : "medium";
}

function parseQuestionCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return 5;
  }

  return Math.max(1, Math.min(parsed, 10));
}

function buildQuizPreview(quizRecord) {
  return {
    quizId: quizRecord.id,
    topic: quizRecord.topic,
    difficulty: quizRecord.difficulty,
    totalQuestions: quizRecord.questions.length,
    questions: quizRecord.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options
    }))
  };
}

function buildProgress(quizRecord) {
  const answeredCount = quizRecord.answers.size;
  const correctCount = Array.from(quizRecord.answers.values()).filter((entry) => entry.correct).length;
  const accuracy = answeredCount === 0 ? 0 : Math.round((correctCount / answeredCount) * 100);

  return {
    answeredCount,
    correctCount,
    remainingCount: Math.max(quizRecord.questions.length - answeredCount, 0),
    accuracy
  };
}

function mergeAnswersIntoQuiz(quizRecord, answersPayload) {
  if (!answersPayload) {
    return;
  }

  if (Array.isArray(answersPayload)) {
    for (const answer of answersPayload) {
      const question = quizRecord.questions.find((item) => item.id === answer?.questionId);
      const selectedOption = Number.parseInt(answer?.selectedOption, 10);

      if (!question || !Number.isInteger(selectedOption)) {
        continue;
      }

      quizRecord.answers.set(question.id, {
        selectedOption,
        correct: selectedOption === question.correctOption,
        answeredAt: new Date().toISOString()
      });
    }
    return;
  }

  if (typeof answersPayload === "object") {
    for (const [questionId, selectedValue] of Object.entries(answersPayload)) {
      const question = quizRecord.questions.find((item) => item.id === questionId);
      const selectedOption = Number.parseInt(selectedValue, 10);

      if (!question || !Number.isInteger(selectedOption)) {
        continue;
      }

      quizRecord.answers.set(question.id, {
        selectedOption,
        correct: selectedOption === question.correctOption,
        answeredAt: new Date().toISOString()
      });
    }
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post("/api/quiz/generate", async (req, res) => {
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";

  if (!topic) {
    return res.status(400).json({ error: "Topic is required." });
  }

  const difficulty = parseDifficulty(req.body?.difficulty);
  const numQuestions = parseQuestionCount(req.body?.numQuestions);

  try {
    const generatedQuiz = await generateQuizFromTopic({
      topic,
      difficulty,
      numQuestions
    });

    const quizId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const quizRecord = {
      id: quizId,
      title: generatedQuiz.title,
      topic,
      difficulty,
      questions: generatedQuiz.questions,
      answers: new Map(),
      createdAt
    };

    quizzes.set(quizId, quizRecord);

    return res.status(201).json(buildQuizPreview(quizRecord));
  } catch (error) {
    console.error("Quiz generation failed:", error);
    return res.status(500).json({
      error: "Failed to generate quiz. Check API configuration and try again.",
      details: error.message,
      hint: inferQuizGenerationHint(error)
    });
  }
});

app.post("/api/quiz/answer", (req, res) => {
  const { quizId, questionId } = req.body || {};
  const selectedOption = Number.parseInt(req.body?.selectedOption, 10);

  if (!quizId || !questionId || !Number.isInteger(selectedOption)) {
    return res.status(400).json({ error: "quizId, questionId, and selectedOption are required." });
  }

  const quizRecord = quizzes.get(quizId);
  if (!quizRecord) {
    return res.status(404).json({ error: "Quiz not found." });
  }

  const question = quizRecord.questions.find((entry) => entry.id === questionId);
  if (!question) {
    return res.status(404).json({ error: "Question not found." });
  }

  if (selectedOption < 0 || selectedOption >= question.options.length) {
    return res.status(400).json({ error: "selectedOption is out of range for this question." });
  }

  const correct = selectedOption === question.correctOption;

  quizRecord.answers.set(questionId, {
    selectedOption,
    correct,
    answeredAt: new Date().toISOString()
  });

  return res.json({
    quizId,
    questionId,
    selectedOption,
    correct,
    correctOption: question.correctOption,
    correctText: question.options[question.correctOption],
    explanation: question.explanation,
    progress: buildProgress(quizRecord)
  });
});

app.post("/api/quiz/submit", async (req, res) => {
  const { quizId, answers } = req.body || {};

  if (!quizId) {
    return res.status(400).json({ error: "quizId is required." });
  }

  const quizRecord = quizzes.get(quizId);
  if (!quizRecord) {
    return res.status(404).json({ error: "Quiz not found." });
  }

  mergeAnswersIntoQuiz(quizRecord, answers);

  const results = quizRecord.questions.map((question) => {
    const attempt = quizRecord.answers.get(question.id);
    const selectedOption = attempt?.selectedOption;

    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedOption: Number.isInteger(selectedOption) ? selectedOption : null,
      selectedText:
        Number.isInteger(selectedOption) && selectedOption >= 0 && selectedOption < question.options.length
          ? question.options[selectedOption]
          : "Not answered",
      correctOption: question.correctOption,
      correctText: question.options[question.correctOption],
      correct: Boolean(attempt?.correct),
      explanation: question.explanation
    };
  });

  const correctCount = results.filter((result) => result.correct).length;
  const totalQuestions = quizRecord.questions.length;
  const accuracy = totalQuestions === 0 ? 0 : Math.round((correctCount / totalQuestions) * 100);

  const feedback = await generatePerformanceFeedback({
    topic: quizRecord.topic,
    difficulty: quizRecord.difficulty,
    accuracy,
    correctCount,
    totalQuestions,
    results
  });

  return res.json({
    quizId,
    topic: quizRecord.topic,
    difficulty: quizRecord.difficulty,
    score: correctCount,
    totalQuestions,
    accuracy,
    feedback,
    results,
    submittedAt: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`AI Quiz API listening on http://localhost:${port}`);
});
