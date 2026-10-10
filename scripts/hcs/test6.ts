import { decodeHcs, encodeHcs, hashscanTopic, type HcsMessage } from "@hisn/shared";
import { createTopic, submit } from "../../contracts/scripts/lib/hcs";
import { mirrorRetry, opt, results, sleep } from "../../contracts/scripts/lib/env";

interface MirrorMessage {
  consensus_timestamp: string;
  sequence_number: number;
  message: string;
}

const GAP_MS = Number(opt("TEST6_GAP_MS", "10000"));

function message(type: HcsMessage["type"], ref: number): HcsMessage {
  return {
    v: 1,
    type,
    vault: opt("VAULT_ADDRESS", "0x0000000000000000000000000000000000000000"),
    ref,
    at: Math.floor(Date.now() / 1000),
    body: { test: "day1-6", note: "Day-1 test 6: ordered public log" },
  };
}

async function main(): Promise<void> {
  const lines: string[] = [];

  const topicId = opt("TEST6_TOPIC_ID") || (await createTopic("hisn day1 test 6"));
  lines.push(`Topic ${topicId} with no submit key: ${hashscanTopic(topicId)}`);

  const first = message("REQUEST", 1);
  const sentAt1 = Date.now();
  const tx1 = await submit(topicId, encodeHcs(first));
  lines.push(`Message 1 submitted, tx ${tx1}`);

  await sleep(GAP_MS);

  const second = message("PROPOSED", 1);
  const sentAt2 = Date.now();
  const tx2 = await submit(topicId, encodeHcs(second));
  lines.push(`Message 2 submitted ${Math.round((sentAt2 - sentAt1) / 1000)} s later, tx ${tx2}`);

  const started = Date.now();
  let msgs: MirrorMessage[] = [];
  for (let i = 0; i < 30 && msgs.length < 2; i++) {
    const r = await mirrorRetry<{ messages: MirrorMessage[] }>(`/api/v1/topics/${topicId}/messages?order=asc&limit=10`);
    msgs = r.messages;
    if (msgs.length < 2) await sleep(2000);
  }
  const mirrorDelay = Math.round((Date.now() - started) / 1000);

  if (msgs.length < 2) {
    lines.push(`Mirror node returned ${msgs.length} message(s) after ${mirrorDelay} s of polling`);
    results("Test 6 (HCS public log)", false, lines);
    process.exitCode = 1;
    return;
  }

  const [a, b] = msgs;
  const decodedA = decodeHcs(Buffer.from(a.message, "base64").toString("utf8"));
  const decodedB = decodeHcs(Buffer.from(b.message, "base64").toString("utf8"));
  const gap = Number(b.consensus_timestamp) - Number(a.consensus_timestamp);
  const inOrder = a.sequence_number < b.sequence_number && Number(a.consensus_timestamp) < Number(b.consensus_timestamp);
  const typesOk = decodedA?.type === "REQUEST" && decodedB?.type === "PROPOSED";
  const gapOk = Math.abs(gap - GAP_MS / 1000) <= 5;

  lines.push(`Message 1: sequence ${a.sequence_number}, consensus ${a.consensus_timestamp}, decoded type ${decodedA?.type ?? "INVALID"}`);
  lines.push(`Message 2: sequence ${b.sequence_number}, consensus ${b.consensus_timestamp}, decoded type ${decodedB?.type ?? "INVALID"}`);
  lines.push(`Consensus gap ${gap.toFixed(3)} s (expected about ${GAP_MS / 1000} s)`);
  lines.push(`Both visible on the mirror node after ${mirrorDelay} s of polling from the second submit`);
  lines.push(`Sender clock to consensus: message 1 ${(Number(a.consensus_timestamp) - sentAt1 / 1000).toFixed(2)} s`);

  const pass = inOrder && typesOk && gapOk;
  if (!pass) {
    if (!inOrder) lines.push("FAILED: messages not in order");
    if (!typesOk) lines.push("FAILED: messages did not decode with the shared HCS validator");
    if (!gapOk) lines.push("FAILED: consensus gap differs from the send gap by more than 5 s");
  }
  results("Test 6 (HCS public log)", pass, lines);
  if (!pass) process.exitCode = 1;
}

const missing = ["RELAYER_ACCOUNT_ID", "RELAYER_PRIVATE_KEY"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Not run: set ${missing.join(" and ")} in .env first. Nothing was written to DAY1_RESULTS.md.`);
  process.exit(2);
}

main().catch((e: unknown) => {
  results("Test 6 (HCS public log)", null, [`Script error: ${(e as Error).message}`]);
  process.exitCode = 1;
});
