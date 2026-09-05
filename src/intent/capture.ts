import { randomUUID } from "node:crypto";
import { chatJson, openaiConfigured, parseIntentJson } from "./openai.js";

export type Requirements = {
  query: string;
  maxPriceCents: number | null;
  options: string[];
};

type Session = {
  id: string;
  history: Array<{ role: string; content: string }>;
  requirements: Requirements;
  lastChipOptions: string[];
  browseAsks: number;
  turn: number;
};

type ParsedTurn = {
  query: string;
  maxPriceCents: number | null;
  options: string[];
  response_message: string;
};

const sessions = new Map<string, Session>();

export const DATE_OPTIONS = ["flowers", "chocolates", "a nice bottle of wine"];
export const RAIN_OPTIONS = ["umbrella", "rain boots", "raincoat"];

const SYSTEM = `You are the buyer-side shopping agent for worldCommerce — a concise commerce assistant.

This is a back-and-forth conversation. One turn = one user message + one question (or a search confirmation).
Do not search Shopify yourself. The server searches UCP only after you have BOTH a product and a budget.

Sound like a shopper helping a human, not a form. One short sentence.

Turn protocol:
0. Greeting with no shopping context → greet, ask what they want. query empty, options = [].
1. Vague situation (rain / date) → query empty, 2–3 product choices in options. Do not invent a budget.
2. They pick a product → set query. Ask budget with 2–3 realistic "$N" chips for THAT product.
3. They give a budget → set max_price. Keep query from earlier turns.
4. Only when product AND budget are known: confirm you will search. options = [].
5. If one message already has product AND budget ("chocolates under $10"), set both and confirm search.

Return JSON only:
{
 "query": "short searchable product phrase, or empty string",
 "max_price": null or number in USD,
 "options": ["choice A", "choice B"],
 "response_message": "one short sentence to the human"
}`;

const PRODUCT_HINTS = [
  "umbrella", "raincoat", "poncho", "boot", "shoe", "sneaker",
  "flower", "chocolate", "candy", "wine", "jacket", "hat",
];

function emptyRequirements(): Requirements {
  return { query: "", maxPriceCents: null, options: [] };
}

function productHintRe(word: string) {
  return new RegExp(`\\b${word}s?\\b`, "i");
}

function findProductHint(text: string) {
  const lower = String(text || "").toLowerCase();
  return PRODUCT_HINTS.find((word) => productHintRe(word).test(lower));
}

function queryFromHint(hit: string) {
  if (hit === "boot") return "rain boots";
  if (hit === "flower") return "flowers";
  if (hit === "chocolate") return "chocolates";
  if (hit === "candy") return "candy";
  return hit;
}

export function isSearchableQuery(query: string) {
  const q = String(query || "").trim();
  if (q.length < 3) return false;
  if (/^(go(ing)? out|rainy day|it'?s raining|weather|help|something|stuff|idk|date( night)?|outing|gift)$/i.test(q)) {
    return false;
  }
  return true;
}

export function missingFields(req: Requirements) {
  const missing: string[] = [];
  if (!isSearchableQuery(req.query)) missing.push("query");
  if (!req.maxPriceCents || req.maxPriceCents <= 0) missing.push("budget");
  return missing;
}

export function looksLikeBudgetChip(opt: string) {
  const s = String(opt || "").trim();
  if (!s) return false;
  return (
    /^\$?\s*\d+(?:\.\d{1,2})?\s*(?:usd|dollars?)?$/i.test(s) ||
    /\b(?:under|below|max(?:imum)?)\s+\$?\s*\d+/i.test(s)
  );
}

export function suggestBudgetChips(query: string) {
  const q = String(query || "").toLowerCase();
  if (/\b(candy|candies|chocolate|snack|gum|sweets?)\b/.test(q)) return ["$5", "$8", "$12"];
  if (/\b(flower|bouquet|rose)\b/.test(q)) return ["$20", "$35", "$50"];
  if (/\b(wine|champagne)\b/.test(q)) return ["$15", "$30", "$45"];
  if (/\b(umbrella|poncho)\b/.test(q)) return ["$12", "$20", "$35"];
  if (/\b(boot|shoe|sneaker|jacket|raincoat)\b/.test(q)) return ["$40", "$70", "$100"];
  return ["$15", "$30", "$50"];
}

export function chipsForTurn(missingField: string | undefined, rawOptions: string[], query = "") {
  const raw = (Array.isArray(rawOptions) ? rawOptions : [])
    .map((o) => String(o).trim())
    .filter(Boolean)
    .slice(0, 4);
  if (missingField === "query") return raw.filter((o) => !looksLikeBudgetChip(o));
  if (missingField === "budget") {
    const budgetish = raw.filter(looksLikeBudgetChip);
    return budgetish.length ? budgetish : suggestBudgetChips(query);
  }
  return [];
}

function extractBudgetCents(text: string) {
  const under = text.match(/\b(?:under|below|less\s+than|max(?:imum)?|budget)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i);
  if (under) return Math.round(Number(under[1]) * 100);
  const dollar = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollar) return Math.round(Number(dollar[1]) * 100);
  const bare = text.match(/^\s*(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?)?\s*$/i);
  if (bare) return Math.round(Number(bare[1]) * 100);
  return null;
}

function dollarsToCents(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function sameChip(a: string, b: string) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function isDateNight(text: string) {
  return (
    /\b(date night|on a date|romantic|anniversary|valentine)\b/i.test(text) ||
    (/\bdate\b/i.test(text) && /\b(get|gift|bring|buy|order|pick)\b/i.test(text))
  );
}

function isRainyOuting(text: string) {
  return /\b(rain|rainy|weather|cold|snow)\b/i.test(text);
}

export function isGreeting(text: string) {
  return /^(hola|hi+|hey+|hello|yo+|sup|what'?s up|howdy|gm|good (morning|afternoon|evening))[\s!?.]*$/i.test(
    String(text || "").trim(),
  );
}

function budgetAsk(query: string) {
  const q = String(query || "").trim();
  if (!q) return "What's your budget?";
  if (/^(a|an|the)\s/i.test(q)) return `What's your budget for ${q}?`;
  return `What's your budget for the ${q}?`;
}

function mergeRequirements(prior: Requirements, next: ParsedTurn): Requirements {
  const query = isSearchableQuery(next.query) ? next.query.trim() : prior.query;
  const maxPriceCents =
    next.maxPriceCents && next.maxPriceCents > 0 ? next.maxPriceCents : prior.maxPriceCents;
  return { query: query || "", maxPriceCents: maxPriceCents || null, options: [] };
}

function applyChipReply(parsed: ParsedTurn, prompt: string, lastChipOptions: string[]): ParsedTurn {
  const chip = (lastChipOptions || []).find((o) => sameChip(o, prompt));
  if (!chip) return parsed;
  if (looksLikeBudgetChip(chip)) {
    return {
      ...parsed,
      maxPriceCents: parsed.maxPriceCents || extractBudgetCents(chip) || extractBudgetCents(prompt),
    };
  }
  if (!isSearchableQuery(parsed.query)) return { ...parsed, query: chip };
  return parsed;
}

function applyStatedConstraints(parsed: ParsedTurn, prompt: string): ParsedTurn {
  const statedBudget = extractBudgetCents(prompt);
  const hit = findProductHint(prompt);
  const next = { ...parsed };
  if (statedBudget) next.maxPriceCents = statedBudget;
  if (!isSearchableQuery(next.query) && hit) next.query = queryFromHint(hit);
  return next;
}

function preferSituationalChips(prompt: string, rawOptions: string[]) {
  const raw = Array.isArray(rawOptions) ? rawOptions : [];
  if (isDateNight(prompt) && !findProductHint(prompt)) {
    return raw.some((o) => /flower|chocolate|wine/i.test(o)) ? raw : [...DATE_OPTIONS];
  }
  if (isRainyOuting(prompt) && !findProductHint(prompt)) {
    return raw.some((o) => /umbrella|boot|raincoat/i.test(o)) ? raw : [...RAIN_OPTIONS];
  }
  return raw;
}

function parseWithRegex(text: string, prior: Requirements): ParsedTurn {
  const budget = extractBudgetCents(text);
  const hit = findProductHint(text);
  let query = hit ? queryFromHint(hit) : "";
  const dateNight = isDateNight(text) && !hit;
  const rainy = isRainyOuting(text) && !hit && !dateNight;
  let options: string[] = [];
  if (dateNight && !prior.query) options = [...DATE_OPTIONS];
  else if (rainy && !prior.query) options = [...RAIN_OPTIONS];

  let response_message = "";
  if (isGreeting(text) && !query && !prior.query) {
    response_message = "Hey — what should I pick up?";
    options = [];
  } else if (dateNight && !prior.query) {
    response_message = "Date night — flowers, chocolates, or a bottle of wine?";
  } else if (rainy && !prior.query) {
    response_message = "It's raining — umbrella, rain boots, or a raincoat?";
  } else if (!query && !prior.query) {
    response_message = "What should I order for you?";
  } else if (!(budget || prior.maxPriceCents)) {
    response_message = budgetAsk(query || prior.query);
    options = suggestBudgetChips(query || prior.query);
  } else {
    response_message = "Got it — I'll search Shopify next.";
  }
  return { query, maxPriceCents: budget, options, response_message };
}

function gapHint(session: Session) {
  const missing = missingFields(session.requirements);
  if (missing[0] === "budget") {
    return `Product is already "${session.requirements.query}". Ask budget only. options = realistic "$N" chips for that product.`;
  }
  if (missing[0] === "query") {
    return "Ask what to pick up. options = product names only. Do not invent a budget.";
  }
  return "Clarify product and budget before searching.";
}

async function parseWithOpenAI(text: string, session: Session): Promise<ParsedTurn> {
  const history = session.history.slice(-8).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  const prior = `Known so far: query=${session.requirements.query || "(none)"}; budget=${
    session.requirements.maxPriceCents
      ? "$" + (session.requirements.maxPriceCents / 100).toFixed(0)
      : "(none)"
  }. ${gapHint(session)}`;
  const json = await chatJson({
    system: `${SYSTEM}\n${prior}`,
    messages: [...history, { role: "user", content: text }],
  });
  const intent = parseIntentJson(json);
  return {
    query: intent.query,
    maxPriceCents: dollarsToCents(intent.max_price),
    options: intent.options,
    response_message: intent.response_message,
  };
}

function getOrCreateSession(sessionId?: string | null): Session {
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId)!;
  const session: Session = {
    id: randomUUID(),
    history: [],
    requirements: emptyRequirements(),
    lastChipOptions: [],
    browseAsks: 0,
    turn: 0,
  };
  sessions.set(session.id, session);
  return session;
}

function polishMessage(
  msg: string,
  missing: string | undefined,
  req: Requirements,
  options: string[],
  ready: boolean,
) {
  const text = String(msg || "").trim();
  if (ready) {
    if (!text || /budget/i.test(text)) {
      return `Searching Shopify for "${req.query}" under $${(req.maxPriceCents! / 100).toFixed(0)}.`;
    }
    return text;
  }
  if (!text) {
    if (missing === "query") {
      if (options.length) {
        const list = options.slice(0, 3).join(", ").replace(/, ([^,]*)$/, ", or $1");
        return `What should I pick up — ${list}?`;
      }
      return "What should I order for you?";
    }
    return budgetAsk(req.query);
  }
  return text;
}

/**
 * Multi-turn buyer intent. Ready only when searchable product + budget exist.
 * Does not call Shopify UCP.
 */
export async function captureTurn({
  sessionId,
  prompt,
}: {
  sessionId?: string | null;
  prompt: string;
}) {
  const session = getOrCreateSession(sessionId);
  session.turn += 1;
  session.history.push({ role: "user", content: prompt });

  let parsed: ParsedTurn;
  let provider: "openai" | "regex" = "regex";
  if (openaiConfigured()) {
    try {
      parsed = await parseWithOpenAI(prompt, session);
      provider = "openai";
    } catch {
      parsed = parseWithRegex(prompt, session.requirements);
      provider = "regex";
    }
  } else {
    parsed = parseWithRegex(prompt, session.requirements);
  }

  parsed = applyChipReply(parsed, prompt, session.lastChipOptions);
  parsed = applyStatedConstraints(parsed, prompt);
  if (isGreeting(prompt) && !session.requirements.query && !findProductHint(prompt)) {
    parsed = {
      ...parsed,
      query: "",
      options: [],
      response_message: parsed.response_message || "Hey — what should I pick up?",
    };
  }

  session.requirements = mergeRequirements(session.requirements, parsed);
  const missing = missingFields(session.requirements);
  const ready = missing.length === 0;
  const rawOptions =
    !ready && missing[0] === "query"
      ? preferSituationalChips(prompt, parsed.options)
      : parsed.options;
  const options = ready ? [] : chipsForTurn(missing[0], rawOptions, session.requirements.query);
  session.requirements.options = options;
  session.lastChipOptions = options;

  const agentMessage = polishMessage(
    parsed.response_message,
    missing[0],
    session.requirements,
    options,
    ready,
  );
  session.history.push({ role: "assistant", content: agentMessage });

  return {
    sessionId: session.id,
    stopReason: ready ? ("ready" as const) : ("needs_clarification" as const),
    agentMessage,
    options,
    parsed: {
      raw: prompt,
      query: session.requirements.query,
      intent: prompt,
      maxPriceCents: session.requirements.maxPriceCents,
      shipTo: { country: "US", region: "CA", postalCode: "94103" },
    },
    missing,
    provider,
    ready,
  };
}

export function resetIntentSession(sessionId?: string | null) {
  if (sessionId) sessions.delete(sessionId);
}
