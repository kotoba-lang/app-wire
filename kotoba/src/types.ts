/**
 * wire kotoba — kotoba-E2E split for the wire transfer & messaging platform.
 *
 * Per ADR-2606011400 (Consensys product-front / infra-back) + ADR-2605172400
 * (3-axis OR-test) + ADR-2605172100 (operating-entity boundary) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: maximal
 * migration — front everything that can move; only the irreducible regulated
 * EXECUTION stays etzhayyim.
 *
 * SPLIT:
 *   PUBLIC (plaintext AT records) — corridor reference catalog + aggregate
 *   corridor statistics that carry ZERO party DIDs and ZERO per-transfer amounts.
 *   corridorStat FK-checks corridorRate via exists() (read + check). Frontable
 *   open metadata + read-views.
 *
 *   SENSITIVE / PII (kotoba E2E, com.etzhayyim.encrypted.record) — the transfer
 *   LEDGER (sender/recipient DID, amount, currency, status) and secure MESSAGES
 *   (from/to DID + body) sealed via sdk.encryptedWrite (read-cap = owner DID +
 *   explicit recipients). Balances and transfer history are derived by scanning
 *   the E2E ledger, never persisted in plaintext. The substrate never sees party
 *   identities or amounts in the clear.
 *
 *   STAYS etzhayyim (consumed via consent-capability) — the fiat merchant-of-record
 *   settlement rail EXECUTION (interbank wire / correspondent clearing call). Per the
 *   operating-entity boundary, etzhayyim never becomes the fiat MoR/counterparty
 *   (on-chain USDC only), so the ledger DATA migrates as E2E records while the
 *   fiat settlement CALL remains a etzhayyim function. Not modeled here as a
 *   collection.
 *
 * AT-Lexicon: no float. Counts/periods are integers; money is decimal STRINGS
 * (minor-unit integer math internally); indicative rates are integer rate-permille
 * (rate × 1000) to stay integer.
 */

// ─── Plaintext public collections ───────────────────────────────────
export const CORRIDOR_RATE_COLLECTION = "com.etzhayyim.apps.wire.corridorRate";
export const CORRIDOR_STAT_COLLECTION = "com.etzhayyim.apps.wire.corridorStat";

// ─── E2E inner-type NSIDs (== the collection NSID per task rule) ─────
export const TRANSFER_LEDGER_INNER_TYPE = "com.etzhayyim.apps.wire.transferLedger";
export const SECURE_MESSAGE_INNER_TYPE = "com.etzhayyim.apps.wire.secureMessage";

export const WIRE_DID_PREFIX = "did:web:wire.etzhayyim.com:" as const;

// ─── Corridor rate (PLAINTEXT, reference catalog) ───────────────────

export interface CorridorRateRecord {
  did: string;
  corridor: string;          // e.g. "JP-US"
  currencyPair: string;      // e.g. "JPY/USD"
  /** indicative mid-rate × 1000, integer (no float). */
  ratePermille: number;
  source: string;
  generatedAt: string;
  createdAt: string;
}
export interface CorridorRateView extends CorridorRateRecord {
  corridorUri: string;
}
export interface UpsertCorridorRateInput {
  corridor: string;
  currencyPair: string;
  ratePermille: number;
  source?: string;
  generatedAt?: string;
}
export interface UpsertCorridorRateOutput {
  status: "recorded" | "updated" | "rejected";
  corridorUri?: string;
  did?: string;
  corridor?: string;
  error?: string;
}
export interface ListCorridorRatesInput {
  currencyPair?: string;
  limit?: number;
  cursor?: string;
}
export interface ListCorridorRatesOutput {
  items: CorridorRateView[];
  cursor?: string;
  total: number;
}

// ─── Corridor stat (PLAINTEXT, aggregate — no party DIDs) ────────────

export interface CorridorStatRecord {
  did: string;
  corridor: string;          // FK → CorridorRateRecord.corridor
  period: string;            // e.g. "2026-06"
  transferCount: number;     // integer
  /** sum of settled amounts in minor units, integer. */
  totalMinorUnits: number;
  currency: string;
  createdAt: string;
}
export interface CorridorStatView extends CorridorStatRecord {
  statUri: string;
}
export interface RecordCorridorStatInput {
  corridor: string;
  period: string;
  transferCount: number;
  totalMinorUnits: number;
  currency: string;
}
export interface RecordCorridorStatOutput {
  status: "recorded" | "alreadyExists" | "rejected";
  statUri?: string;
  did?: string;
  error?: string;
}
export interface ListCorridorStatsInput {
  corridor?: string;
  limit?: number;
  cursor?: string;
}
export interface ListCorridorStatsOutput {
  items: CorridorStatView[];
  cursor?: string;
  total: number;
}

// ─── Transfer ledger (E2E-ENCRYPTED, PII) ───────────────────────────

export interface TransferLedgerBody {
  transferRef: string;
  fromDid: string;
  toDid: string;
  /** decimal string (e.g. "1250.00"), never float. */
  amount: string;
  currency: string;
  corridor: string;
  status: TransferStatus;
  memo?: string;
  bookedAt: string;
}
export type TransferStatus = "pending" | "confirmed" | "settled" | "failed";
export interface TransferLedgerView extends TransferLedgerBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface BookTransferInput {
  transferRef: string;
  fromDid: string;
  toDid: string;
  amount: string;
  currency: string;
  corridor: string;
  status?: TransferStatus;
  memo?: string;
  bookedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface BookTransferOutput {
  status: "booked" | "rejected";
  uri?: string;
  keyId?: string;
  transferRef?: string;
  error?: string;
}
export interface ListTransfersInput {
  corridor?: string;
  status?: TransferStatus;
  limit?: number;
}
export interface ListTransfersOutput {
  items: TransferLedgerView[];
  total: number;
}
export interface GetTransferInput {
  transferRef: string;
}
export interface GetTransferOutput {
  transfer?: TransferLedgerView;
  error?: string;
}
export interface ConfirmTransferInput {
  transferRef: string;
  status?: Extract<TransferStatus, "confirmed" | "settled" | "failed">;
}
export interface ConfirmTransferOutput {
  status: "updated" | "rejected";
  uri?: string;
  keyId?: string;
  transferRef?: string;
  transferStatus?: TransferStatus;
  error?: string;
}

// ─── Secure message (E2E-ENCRYPTED, message-metadata + body) ─────────

export interface SecureMessageBody {
  messageId: string;
  fromDid: string;
  toDid: string;
  subject?: string;
  body: string;
  relatedTransferRef?: string;
  sentAt: string;
}
export interface SecureMessageView extends SecureMessageBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface SendMessageInput {
  messageId: string;
  fromDid: string;
  toDid: string;
  subject?: string;
  body: string;
  relatedTransferRef?: string;
  sentAt?: string;
  recipients?: string[];
}
export interface SendMessageOutput {
  status: "sent" | "rejected";
  uri?: string;
  keyId?: string;
  messageId?: string;
  error?: string;
}
export interface ListMessagesInput {
  toDid?: string;
  limit?: number;
}
export interface ListMessagesOutput {
  items: SecureMessageView[];
  total: number;
}

// ─── Derived views (from E2E ledger scan) ───────────────────────────

export interface GetBalanceInput {
  did: string;          // subject DID to compute net position for
  currency?: string;    // optional filter
}
export interface BalanceLine {
  currency: string;
  /** net position as decimal string (credits − debits), integer minor-unit math. */
  netAmount: string;
  creditCount: number;
  debitCount: number;
}
export interface GetBalanceOutput {
  did: string;
  balances: BalanceLine[];
  error?: string;
}
export interface GetTransferHistoryInput {
  did: string;          // sender OR recipient
  limit?: number;
}
export interface GetTransferHistoryOutput {
  did: string;
  items: TransferLedgerView[];
  total: number;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  corridorRateCount?: number;
  corridorStatCount?: number;
  transferLedgerCount?: number;
  secureMessageCount?: number;
  ratesByCurrencyPair?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Accepts "123" or "123.45" (1-? integer digits, optional fractional part). */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}

/**
 * Parse a decimal money string into integer minor units (× 10^scale).
 * No float: split on the dot and combine integer parts. Returns null on
 * malformed input.
 */
export function toMinorUnits(amount: string, scale = 2): number | null {
  if (!isDecimalString(amount)) return null;
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "0".repeat(scale)).slice(0, scale);
  const minor = Number(whole) * 10 ** scale + Number(fracPadded || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Format integer minor units back into a decimal string with `scale` places. */
export function fromMinorUnits(minor: number, scale = 2): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** scale);
  const frac = abs % 10 ** scale;
  const fracStr = String(frac).padStart(scale, "0");
  return `${neg ? "-" : ""}${whole}.${fracStr}`;
}

export function corridorRateDidFor(corridor: string): string {
  return `${WIRE_DID_PREFIX}corr:${corridor.toLowerCase()}`;
}
export function corridorStatDidFor(corridor: string, period: string): string {
  return `${WIRE_DID_PREFIX}stat:${corridor.toLowerCase()}:${period.toLowerCase()}`;
}
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
export function corridorRateRkey(corridor: string): string {
  return `corr-${slug(corridor)}`;
}
export function corridorStatRkey(corridor: string, period: string): string {
  return `stat-${slug(corridor)}-${slug(period)}`;
}
export function transferRkey(transferRef: string): string {
  return `xfer-${slug(transferRef)}`;
}
export function messageRkey(messageId: string): string {
  return `msg-${slug(messageId)}`;
}
