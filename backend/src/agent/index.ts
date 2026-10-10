import type { AgentHost, AgentModule } from "../agent-host.js";
import { AgentCore, explainRefusal } from "./core.js";
import { DEFAULT_BASE_URL, llmReply, type LlmConfig } from "./llm.js";
import { enforceRouting, rulesReply } from "./rules.js";
import type { AgentAction, AgentReply, AgentTurn } from "./types.js";

const MAX_HISTORY = 200;
const MAX_MESSAGE = 2000;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function summarize(actions: AgentAction[]): string {
  if (actions.length === 0) return "I didn't do anything this time. Ask me again in a moment.";
  return actions
    .map((a) => {
      const who = a.payee ?? a.to ?? "that recipient";
      if (a.kind === "paid") return `I paid ${who}.`;
      if (a.kind === "sent_to_puck") return `I sent the payment to ${who} to your puck for you to decide.`;
      return `I didn't pay ${who}: ${a.reason}`;
    })
    .join(" ");
}

export interface HelperAgent extends AgentModule {
  chat(message: string): Promise<AgentReply>;
  history(): AgentTurn[];
}

export function createAgent(host: AgentHost): HelperAgent {
  const core = new AgentCore(host);
  const turns: AgentTurn[] = [];
  const key = host.config.llmKey.trim();
  const model = host.config.llmModel.trim();
  const llm: LlmConfig | null = key && model ? { key, model, baseUrl: process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL } : null;
  if (key && !model) console.error("agent: LLM_API_KEY is set but LLM_MODEL is empty, using the fixed rules");
  const explain = (code: string) => explainRefusal(code, host.state()?.immutables.probation ?? 0);
  let queue: Promise<unknown> = Promise.resolve();

  async function answer(message: string): Promise<AgentReply> {
    const history = turns.slice();
    core.begin(message);
    turns.push({ role: "owner", text: message, at: nowSec(), actions: [] });
    let reply: string | null = null;
    if (llm) {
      try {
        reply = await llmReply(llm, core, history, message, explain);
      } catch (e) {
        console.error("agent: model call failed, using the fixed rules:", (e as Error).message);
      }
      if (!reply && core.actions.length > 0) reply = summarize(core.actions);
      if (reply) {
        try {
          const extra = await enforceRouting(core, message, host.state()?.payees ?? []);
          if (extra) reply = `${reply} ${extra}`;
        } catch (e) {
          console.error("agent: could not route the request to the puck:", (e as Error).message);
        }
      }
    }
    if (!reply) reply = await rulesReply(core, message, host.state()?.payees ?? []);
    const actions = core.actions.slice();
    turns.push({ role: "agent", text: reply, at: nowSec(), actions });
    if (turns.length > MAX_HISTORY) turns.splice(0, turns.length - MAX_HISTORY);
    return { reply, actions };
  }

  return {
    chat(message: string): Promise<AgentReply> {
      const text = String(message ?? "").slice(0, MAX_MESSAGE).trim();
      const run = () => (text ? answer(text) : Promise.resolve({ reply: "Tell me what you'd like to pay, or ask how much I can still pay today.", actions: [] }));
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
    history(): AgentTurn[] {
      return turns.slice();
    },
  };
}
