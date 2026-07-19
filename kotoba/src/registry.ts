/**
 * wire kotoba — kotoba-E2E registry.
 *
 * Plaintext path (corridorRate, corridorStat): sdk.write / sdk.read — corridor
 * reference catalog + aggregate stats (zero party DIDs). corridorStat FK-checks
 * corridorRate via exists() (read + check).
 * E2E path (transferLedger, secureMessage): sdk.encryptedWrite / sdk.encryptedRead
 * — PII bodies sealed in the kotoba envelope (ADR-2605181100), read-cap = owner
 * DID + explicit recipients. Balances and transfer history are derived by
 * scanning the E2E ledger (integer minor-unit math, no float). The substrate
 * never sees party identities or amounts in plaintext.
 *
 * The fiat merchant-of-record settlement rail EXECUTION stays etzhayyim
 * (consent-capability) — not modeled here as a collection.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  CORRIDOR_RATE_COLLECTION,
  CORRIDOR_STAT_COLLECTION,
  SECURE_MESSAGE_INNER_TYPE,
  TRANSFER_LEDGER_INNER_TYPE,
  corridorRateDidFor,
  corridorRateRkey,
  corridorStatDidFor,
  corridorStatRkey,
  fromMinorUnits,
  isDecimalString,
  isUint,
  messageRkey,
  toMinorUnits,
  transferRkey,
  type BalanceLine,
  type BookTransferInput,
  type BookTransferOutput,
  type CorridorRateRecord,
  type CorridorRateView,
  type ConfirmTransferInput,
  type ConfirmTransferOutput,
  type CorridorStatRecord,
  type CorridorStatView,
  type CoverageInput,
  type CoverageOutput,
  type GetBalanceInput,
  type GetBalanceOutput,
  type GetTransferHistoryInput,
  type GetTransferHistoryOutput,
  type GetTransferInput,
  type GetTransferOutput,
  type ListCorridorRatesInput,
  type ListCorridorRatesOutput,
  type ListCorridorStatsInput,
  type ListCorridorStatsOutput,
  type ListMessagesInput,
  type ListMessagesOutput,
  type ListTransfersInput,
  type ListTransfersOutput,
  type RecordCorridorStatInput,
  type RecordCorridorStatOutput,
  type SecureMessageBody,
  type SecureMessageView,
  type SendMessageInput,
  type SendMessageOutput,
  type TransferLedgerBody,
  type TransferLedgerView,
  type TransferStatus,
  type UpsertCorridorRateInput,
  type UpsertCorridorRateOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Plaintext FK helper (exists via read; mock has no exists()) ─────

async function corridorRateExists(e: Etzhayyim, corridor: string): Promise<boolean> {
  const rkey = corridorRateRkey(corridor);
  const resp = await e
    .read<CorridorRateRecord>({ collection: CORRIDOR_RATE_COLLECTION, rkey })
    .catch(() => ({ records: [] as Array<{ uri: string; value: CorridorRateRecord }> }));
  return Boolean(resp.records[0]?.value);
}

// ─── Corridor rate (PLAINTEXT, reference catalog) ───────────────────

export async function upsertCorridorRate(e: Etzhayyim, input: UpsertCorridorRateInput): Promise<UpsertCorridorRateOutput> {
  if (!input.corridor || !input.currencyPair) return { status: "rejected", error: "missingRequiredFields" };
  if (!isUint(input.ratePermille)) return { status: "rejected", error: "invalidRatePermille" };
  const rkey = corridorRateRkey(input.corridor);
  const now = new Date().toISOString();
  const did = corridorRateDidFor(input.corridor);
  const existing = await e.read<CorridorRateRecord>({ collection: CORRIDOR_RATE_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const wasPresent = Boolean(existing.records[0]?.value);
  const record: CorridorRateRecord = {
    did,
    corridor: input.corridor,
    currencyPair: input.currencyPair,
    ratePermille: input.ratePermille,
    source: input.source ?? "indicative",
    generatedAt: input.generatedAt ?? now,
    createdAt: existing.records[0]?.value?.createdAt ?? now,
  };
  const receipt = await e.write({ collection: CORRIDOR_RATE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: wasPresent ? "updated" : "recorded", corridorUri: receipt.uri, did, corridor: input.corridor };
}

export async function listCorridorRates(e: Etzhayyim, input: ListCorridorRatesInput = {}): Promise<ListCorridorRatesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<CorridorRateRecord>({ collection: CORRIDOR_RATE_COLLECTION, cursor: input.cursor, limit });
  const items: CorridorRateView[] = resp.records
    .filter((r) => !input.currencyPair || r.value.currencyPair === input.currencyPair)
    .map((r) => ({ ...r.value, corridorUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Corridor stat (PLAINTEXT, aggregate; FK → corridorRate) ────────

export async function recordCorridorStat(e: Etzhayyim, input: RecordCorridorStatInput): Promise<RecordCorridorStatOutput> {
  if (!input.corridor || !input.period || !input.currency) return { status: "rejected", error: "missingRequiredFields" };
  if (!isUint(input.transferCount) || !isUint(input.totalMinorUnits)) return { status: "rejected", error: "invalidAggregate" };
  if (!(await corridorRateExists(e, input.corridor))) return { status: "rejected", error: "corridorRateNotFound" };
  const rkey = corridorStatRkey(input.corridor, input.period);
  const existing = await e.read<CorridorStatRecord>({ collection: CORRIDOR_STAT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", statUri: existing.records[0].uri, did: existing.records[0].value.did };
  }
  const now = new Date().toISOString();
  const did = corridorStatDidFor(input.corridor, input.period);
  const record: CorridorStatRecord = {
    did,
    corridor: input.corridor,
    period: input.period,
    transferCount: input.transferCount,
    totalMinorUnits: input.totalMinorUnits,
    currency: input.currency,
    createdAt: now,
  };
  const receipt = await e.write({ collection: CORRIDOR_STAT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", statUri: receipt.uri, did };
}

export async function listCorridorStats(e: Etzhayyim, input: ListCorridorStatsInput = {}): Promise<ListCorridorStatsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<CorridorStatRecord>({ collection: CORRIDOR_STAT_COLLECTION, cursor: input.cursor, limit });
  const items: CorridorStatView[] = resp.records
    .filter((r) => !input.corridor || r.value.corridor === input.corridor)
    .map((r) => ({ ...r.value, statUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Transfer ledger (E2E-ENCRYPTED, PII) ───────────────────────────

export async function bookTransfer(e: Etzhayyim, input: BookTransferInput): Promise<BookTransferOutput> {
  if (!input.transferRef || !input.fromDid || !input.toDid || !input.currency || !input.corridor) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!isDecimalString(input.amount)) return { status: "rejected", error: "invalidAmount" };
  const body: TransferLedgerBody = {
    transferRef: input.transferRef,
    fromDid: input.fromDid,
    toDid: input.toDid,
    amount: input.amount,
    currency: input.currency,
    corridor: input.corridor,
    status: input.status ?? "pending",
    memo: input.memo,
    bookedAt: input.bookedAt ?? new Date().toISOString(),
  };
  // Read-cap = owner DID (sender, auto-wrapped) + counterparties + extras.
  const recipients = [...new Set([input.fromDid, input.toDid, ...(input.recipients ?? [])])];
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: TRANSFER_LEDGER_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients,
    rkey: transferRkey(input.transferRef),
  });
  return { status: "booked", uri: receipt.uri, keyId: receipt.keyId, transferRef: input.transferRef };
}

async function scanTransfers(e: Etzhayyim, maxScan: number): Promise<TransferLedgerView[]> {
  const out: TransferLedgerView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<TransferLedgerBody>({ innerType: TRANSFER_LEDGER_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listTransfers(e: Etzhayyim, input: ListTransfersInput = {}): Promise<ListTransfersOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanTransfers(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (t) => (!input.corridor || t.corridor === input.corridor) && (!input.status || t.status === input.status),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getTransfer(e: Etzhayyim, input: GetTransferInput): Promise<GetTransferOutput> {
  if (!input.transferRef) return { error: "invalidTransferRef" };
  const all = await scanTransfers(e, DEFAULT_MAX_SCAN);
  const found = all.find((t) => t.transferRef === input.transferRef);
  if (!found) return { error: "notFound" };
  return { transfer: found };
}

/**
 * Confirmation workflow transition. Re-seals the E2E ledger entry at the same
 * rkey with an advanced status (precedent: air-cargo trackShipment). The fiat
 * settlement rail CALL stays etzhayyim; this only advances the migrated ledger DATA.
 */
export async function confirmTransfer(e: Etzhayyim, input: ConfirmTransferInput): Promise<ConfirmTransferOutput> {
  if (!input.transferRef) return { status: "rejected", error: "invalidTransferRef" };
  const all = await scanTransfers(e, DEFAULT_MAX_SCAN);
  const prior = all.find((t) => t.transferRef === input.transferRef);
  if (!prior) return { status: "rejected", error: "notFound" };
  const nextStatus: TransferStatus = input.status ?? "confirmed";
  const body: TransferLedgerBody = {
    transferRef: prior.transferRef,
    fromDid: prior.fromDid,
    toDid: prior.toDid,
    amount: prior.amount,
    currency: prior.currency,
    corridor: prior.corridor,
    status: nextStatus,
    memo: prior.memo,
    bookedAt: prior.bookedAt,
  };
  // Preserve read-cap = original counterparties (owner auto-wrapped).
  const recipients = [...new Set([prior.fromDid, prior.toDid])];
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: TRANSFER_LEDGER_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients,
    rkey: transferRkey(input.transferRef),
  });
  return { status: "updated", uri: receipt.uri, keyId: receipt.keyId, transferRef: input.transferRef, transferStatus: nextStatus };
}

// ─── Secure message (E2E-ENCRYPTED) ─────────────────────────────────

export async function sendMessage(e: Etzhayyim, input: SendMessageInput): Promise<SendMessageOutput> {
  if (!input.messageId || !input.fromDid || !input.toDid || !input.body) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const body: SecureMessageBody = {
    messageId: input.messageId,
    fromDid: input.fromDid,
    toDid: input.toDid,
    subject: input.subject,
    body: input.body,
    relatedTransferRef: input.relatedTransferRef,
    sentAt: input.sentAt ?? new Date().toISOString(),
  };
  const recipients = [...new Set([input.fromDid, input.toDid, ...(input.recipients ?? [])])];
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: SECURE_MESSAGE_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients,
    rkey: messageRkey(input.messageId),
  });
  return { status: "sent", uri: receipt.uri, keyId: receipt.keyId, messageId: input.messageId };
}

async function scanMessages(e: Etzhayyim, maxScan: number): Promise<SecureMessageView[]> {
  const out: SecureMessageView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<SecureMessageBody>({ innerType: SECURE_MESSAGE_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listMessages(e: Etzhayyim, input: ListMessagesInput = {}): Promise<ListMessagesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanMessages(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((m) => !input.toDid || m.toDid === input.toDid);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Derived views (from E2E ledger scan; integer minor-unit math) ──

export async function getBalance(e: Etzhayyim, input: GetBalanceInput): Promise<GetBalanceOutput> {
  if (!input.did) return { did: "", balances: [], error: "invalidDid" };
  const all = await scanTransfers(e, DEFAULT_MAX_SCAN);
  // currency → { net minor units, credits, debits }
  const acc = new Map<string, { net: number; credits: number; debits: number }>();
  for (const t of all) {
    if (input.currency && t.currency !== input.currency) continue;
    const isCredit = t.toDid === input.did;
    const isDebit = t.fromDid === input.did;
    if (!isCredit && !isDebit) continue;
    const minor = toMinorUnits(t.amount);
    if (minor === null) continue;
    const cur = acc.get(t.currency) ?? { net: 0, credits: 0, debits: 0 };
    if (isCredit) { cur.net += minor; cur.credits += 1; }
    if (isDebit) { cur.net -= minor; cur.debits += 1; }
    acc.set(t.currency, cur);
  }
  const balances: BalanceLine[] = [...acc.entries()].map(([currency, v]) => ({
    currency,
    netAmount: fromMinorUnits(v.net),
    creditCount: v.credits,
    debitCount: v.debits,
  }));
  return { did: input.did, balances };
}

export async function getTransferHistory(e: Etzhayyim, input: GetTransferHistoryInput): Promise<GetTransferHistoryOutput> {
  if (!input.did) return { did: "", items: [], total: 0 };
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanTransfers(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((t) => t.fromDid === input.did || t.toDid === input.did);
  return { did: input.did, items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Coverage rollup (plaintext + E2E countAll) ─────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const ratesByCurrencyPair: Record<string, number> = {};

  let corridorRateCount = 0;
  let cursor: string | undefined;
  while (corridorRateCount < maxScan) {
    const page = await e.read<CorridorRateRecord>({ collection: CORRIDOR_RATE_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      ratesByCurrencyPair[r.value.currencyPair] = (ratesByCurrencyPair[r.value.currencyPair] ?? 0) + 1;
      corridorRateCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }

  let corridorStatCount = 0;
  let statCursor: string | undefined;
  while (corridorStatCount < maxScan) {
    const page = await e.read<CorridorStatRecord>({ collection: CORRIDOR_STAT_COLLECTION, cursor: statCursor, limit: PAGE_LIMIT });
    corridorStatCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    statCursor = page.cursor;
  }

  const transferLedgerCount = (await scanTransfers(e, maxScan)).length;
  const secureMessageCount = (await scanMessages(e, maxScan)).length;

  return {
    corridorRateCount,
    corridorStatCount,
    transferLedgerCount,
    secureMessageCount,
    ratesByCurrencyPair,
    truncated:
      corridorRateCount >= maxScan ||
      corridorStatCount >= maxScan ||
      transferLedgerCount >= maxScan ||
      secureMessageCount >= maxScan,
  };
}
