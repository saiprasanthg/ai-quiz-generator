import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-4.1-mini";
let openaiClient;

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to server/.env before generating quizzes.");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}

function ensureString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOptionIndex(value, options) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < options.length) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
      const asIndex = Number.parseInt(trimmed, 10);

      if (asIndex >= 0 && asIndex < options.length) {
        return asIndex;
      }

      if (asIndex >= 1 && asIndex <= options.length) {
        return asIndex - 1;
      }
    }

    const letterIndex = "ABCD".indexOf(trimmed.toUpperCase());
    if (letterIndex >= 0 && letterIndex < options.length) {
      return letterIndex;
    }

    const optionMatch = options.findIndex((option) => option.toLowerCase() === trimmed.toLowerCase());
    if (optionMatch >= 0) {
      return optionMatch;
    }
  }

  return 0;
}

function normalizeQuestion(question, index) {
  const prompt = ensureString(
    question?.prompt ?? question?.question,
    `Question ${index + 1}`
  );

  let options = Array.isArray(question?.options)
    ? question.options
    : Array.isArray(question?.choices)
      ? question.choices
      : [];

  options = options
    .map((option) => ensureString(option))
    .filter(Boolean)
    .filter((option, idx, arr) => arr.indexOf(option) === idx);

  while (options.length < 4) {
    options.push(`Option ${options.length + 1}`);
  }

  options = options.slice(0, 4);

  const correctOption = normalizeOptionIndex(
    question?.correctOption ?? question?.correctAnswer ?? question?.answer,
    options
  );

  const explanation = ensureString(question?.explanation, "No explanation provided.");

  return {
    id: `q-${index + 1}`,
    prompt,
    options,
    correctOption,
    explanation
  };
}

function fallbackQuiz({ topic, difficulty, numQuestions }) {
  const safeTopic = ensureString(topic, "general knowledge");

  return {
    title: `${safeTopic} quiz`,
    questions: Array.from({ length: numQuestions }, (_, index) => ({
      id: `q-${index + 1}`,
      prompt: `Placeholder question ${index + 1} about ${safeTopic} (${difficulty}).`,
      options: ["Option 1", "Option 2", "Option 3", "Option 4"],
      correctOption: 0,
      explanation: "This is placeholder content because the model response was malformed."
    }))
  };
}

function normalizeQuizResponse(rawQuiz, { topic, difficulty, numQuestions }) {
  if (!rawQuiz || !Array.isArray(rawQuiz.questions) || rawQuiz.questions.length === 0) {
    return fallbackQuiz({ topic, difficulty, numQuestions });
  }

  const normalizedQuestions = rawQuiz.questions.slice(0, numQuestions).map(normalizeQuestion);

  while (normalizedQuestions.length < numQuestions) {
    const index = normalizedQuestions.length;
    normalizedQuestions.push({
      id: `q-${index + 1}`,
      prompt: `Extra question ${index + 1} about ${topic}`,
      options: ["Option 1", "Option 2", "Option 3", "Option 4"],
      correctOption: 0,
      explanation: "Generated as a fallback question to complete quiz length."
    });
  }

  return {
    title: ensureString(rawQuiz.title, `${topic} quiz`),
    questions: normalizedQuestions
  };
}

export async function generateQuizFromTopic({ topic, difficulty, numQuestions }) {
  const client = getClient();
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You create high-quality multiple-choice quizzes. Return valid JSON only with fields: title (string), questions (array). Each question must include prompt (string), options (exactly 4 strings), correctOption (0-based index), explanation (string)."
      },
      {
        role: "user",
        content: [
          `Topic: ${topic}`,
          `Difficulty: ${difficulty}`,
          `Number of questions: ${numQuestions}`,
          "Requirements:",
          "- Keep each question concise and unambiguous.",
          "- Include a short explanation for why the correct answer is right.",
          "- Ensure only one correct option per question.",
          "- Do not include markdown or additional text outside JSON."
        ].join("\n")
      }
    ]
  });

  const raw = completion?.choices?.[0]?.message?.content;

  if (!raw) {
    throw new Error("OpenAI returned an empty response while generating quiz content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse model JSON response: ${error.message}`);
  }

  return normalizeQuizResponse(parsed, { topic, difficulty, numQuestions });
}

function heuristicFeedback({ accuracy, correctCount, totalQuestions, results }) {
  const missed = results.filter((result) => !result.correct).slice(0, 2);

  return {
    summary:
      accuracy >= 80
        ? "Strong performance overall with consistent understanding across most questions."
        : "Good attempt. Focused review on weak spots will improve your next score.",
    strengths: [
      `You answered ${correctCount} out of ${totalQuestions} questions correctly.`,
      accuracy >= 80
        ? "Your answer choices were consistently accurate on most items."
        : "You still got several questions right, showing a solid base understanding."
    ],
    improvements:
      missed.length > 0
        ? missed.map(
            (item) =>
              `Revisit: ${item.prompt}. Correct answer: ${item.correctText}. ${item.explanation}`
          )
        : ["You answered everything correctly. Try a harder difficulty for a stronger challenge."]
  };
}

export async function generatePerformanceFeedback({
  topic,
  difficulty,
  accuracy,
  correctCount,
  totalQuestions,
  results
}) {
  try {
    const client = getClient();
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a learning coach. Return valid JSON with fields: summary (string), strengths (array of 2 strings), improvements (array of 2 strings)."
        },
        {
          role: "user",
          content: JSON.stringify({
            topic,
            difficulty,
            accuracy,
            correctCount,
            totalQuestions,
            results: results.map((result) => ({
              prompt: result.prompt,
              selectedText: result.selectedText,
              correctText: result.correctText,
              correct: result.correct
            }))
          })
        }
      ]
    });

    const raw = completion?.choices?.[0]?.message?.content;
    if (!raw) {
      return heuristicFeedback({ accuracy, correctCount, totalQuestions, results });
    }

    const parsed = JSON.parse(raw);

    return {
      summary: ensureString(parsed.summary, "No summary available."),
      strengths: Array.isArray(parsed.strengths)
        ? parsed.strengths.map((item) => ensureString(item)).filter(Boolean).slice(0, 2)
        : [],
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements.map((item) => ensureString(item)).filter(Boolean).slice(0, 2)
        : []
    };
  } catch {
    return heuristicFeedback({ accuracy, correctCount, totalQuestions, results });
  }
}
