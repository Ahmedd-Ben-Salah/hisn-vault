import { createRequire } from "node:module";
import type * as S from "@hisn/shared";

export type * from "@hisn/shared";

const m = createRequire(import.meta.url)("@hisn/shared") as typeof S;

export const {
  Action,
  CHANGE_KIND_NAMES,
  ChangeKind,
  TAG,
  PqKeyTree,
  pqSeedFromKey,
  PQ_DEFAULT_HEIGHT,
  decodePqSignature,
  encodePqSignature,
  pqVerify,
  agentPayDigest,
  alertAckDigest,
  approveDigest,
  cancelDigest,
  changeApproveDigest,
  changeDigest,
  changeVetoDigest,
  completeSignature,
  decodeChangeData,
  encodeChangeData,
  encodeDigestInput,
  ethSignedHash,
  freezeDigest,
  payDigest,
  reconfirmDigest,
  recoverSigner,
  renewFreezeDigest,
  vetoDigest,
  HBAR,
  TINYBAR_TO_WEIBAR,
  TOKENS,
  USDC_TESTNET,
  USDC_TOKEN_ID,
  DEMO_USDC,
  DEMO_USDC_TOKEN_ID,
  formatAmount,
  hbarToWei,
  parseUnits,
  shortAddress,
  tinybarToWeibar,
  tokenInfo,
  STATUS_NAMES,
  Status,
  TIER_NAMES,
  Tier,
  predictTier,
  HCS_TYPES,
  SIGNED_TYPES,
  decodeHcs,
  encodeHcs,
  isHcsMessage,
  SCHEDULE_SERVICE,
  TESTNET,
  evmAddressToEntityId,
  hashscanAccount,
  hashscanContract,
  hashscanSchedule,
  hashscanTopic,
  hashscanTx,
} = m;

export type Action = S.Action;
export type ChangeKind = S.ChangeKind;
export type Status = S.Status;
export type Tier = S.Tier;
