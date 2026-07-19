import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  upsertCorridorRate,
  listCorridorRates,
  recordCorridorStat,
  listCorridorStats,
  bookTransfer,
  listTransfers,
  getTransfer,
  confirmTransfer,
  sendMessage,
  listMessages,
  getBalance,
  getTransferHistory,
  coverage,
  fromMinorUnits,
  toMinorUnits,
} from "../src/index.js";

const OWNER = "did:web:wire.etzhayyim.com";
const ALICE = "did:web:alice.example";
const BOB = "did:web:bob.example";

describe("wire kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("corridorRate (PLAINTEXT reference catalog)", () => {
    it("upserts, validates, lists/filters", async () => {
      expect((await upsertCorridorRate(e, { corridor: "JP-US", currencyPair: "JPY/USD", ratePermille: 7 })).status).toBe("recorded");
      // upsert again → updated
      expect((await upsertCorridorRate(e, { corridor: "JP-US", currencyPair: "JPY/USD", ratePermille: 8 })).status).toBe("updated");
      // invalid rate (must be uint)
      expect((await upsertCorridorRate(e, { corridor: "X", currencyPair: "A/B", ratePermille: -1 })).status).toBe("rejected");
      await upsertCorridorRate(e, { corridor: "EU-US", currencyPair: "EUR/USD", ratePermille: 1080 });
      expect((await listCorridorRates(e)).total).toBe(2);
      expect((await listCorridorRates(e, { currencyPair: "EUR/USD" })).total).toBe(1);
    });
  });

  describe("corridorStat (PLAINTEXT aggregate, FK → corridorRate via exists())", () => {
    it("rejects stat for unknown corridor, accepts after rate exists, dedups", async () => {
      // FK fails: no corridorRate yet
      expect((await recordCorridorStat(e, { corridor: "JP-US", period: "2026-06", transferCount: 3, totalMinorUnits: 500000, currency: "USD" })).status).toBe("rejected");
      await upsertCorridorRate(e, { corridor: "JP-US", currencyPair: "JPY/USD", ratePermille: 7 });
      expect((await recordCorridorStat(e, { corridor: "JP-US", period: "2026-06", transferCount: 3, totalMinorUnits: 500000, currency: "USD" })).status).toBe("recorded");
      // dedup
      expect((await recordCorridorStat(e, { corridor: "JP-US", period: "2026-06", transferCount: 3, totalMinorUnits: 500000, currency: "USD" })).status).toBe("alreadyExists");
      // no party DIDs leak into the plaintext stat record
      const stats = await listCorridorStats(e, { corridor: "JP-US" });
      expect(stats.total).toBe(1);
      expect(JSON.stringify(stats.items[0])).not.toContain("did:web:alice");
    });
  });

  describe("transferLedger (E2E-ENCRYPTED PII)", () => {
    it("seals via encryptedWrite, round-trips, validates, filters", async () => {
      const ok = await bookTransfer(e, { transferRef: "T1", fromDid: ALICE, toDid: BOB, amount: "1250.00", currency: "USD", corridor: "JP-US" });
      expect(ok.status).toBe("booked");
      expect(ok.keyId).toBeTruthy();
      // invalid amount (not a decimal string)
      expect((await bookTransfer(e, { transferRef: "TX", fromDid: ALICE, toDid: BOB, amount: "12.3.4", currency: "USD", corridor: "JP-US" })).status).toBe("rejected");
      const got = await getTransfer(e, { transferRef: "T1" });
      expect(got.transfer?.fromDid).toBe(ALICE);
      expect(got.transfer?.amount).toBe("1250.00");
      expect(got.transfer?.status).toBe("pending");
      await bookTransfer(e, { transferRef: "T2", fromDid: BOB, toDid: ALICE, amount: "500.00", currency: "USD", corridor: "JP-US", status: "settled" });
      expect((await listTransfers(e)).total).toBe(2);
      expect((await listTransfers(e, { status: "settled" })).total).toBe(1);
    });

    it("confirmTransfer advances ledger status at the same rkey", async () => {
      await bookTransfer(e, { transferRef: "T1", fromDid: ALICE, toDid: BOB, amount: "10.00", currency: "USD", corridor: "JP-US" });
      const c = await confirmTransfer(e, { transferRef: "T1" });
      expect(c.status).toBe("updated");
      expect(c.transferStatus).toBe("confirmed");
      // single ledger entry (overwrite, not append) and status advanced
      expect((await listTransfers(e)).total).toBe(1);
      expect((await getTransfer(e, { transferRef: "T1" })).transfer?.status).toBe("confirmed");
      // settle path
      const s = await confirmTransfer(e, { transferRef: "T1", status: "settled" });
      expect(s.transferStatus).toBe("settled");
      expect((await getTransfer(e, { transferRef: "T1" })).transfer?.status).toBe("settled");
      // unknown ref rejected
      expect((await confirmTransfer(e, { transferRef: "nope" })).status).toBe("rejected");
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the ledger", async () => {
      await bookTransfer(e, { transferRef: "T1", fromDid: ALICE, toDid: BOB, amount: "10.00", currency: "USD", corridor: "JP-US" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listTransfers(outsider)).total).toBe(0);
      expect((await getTransfer(outsider, { transferRef: "T1" })).error).toBe("notFound");
    });
  });

  describe("secureMessage (E2E-ENCRYPTED metadata + body)", () => {
    it("seals, round-trips, filters by recipient", async () => {
      expect((await sendMessage(e, { messageId: "M1", fromDid: ALICE, toDid: BOB, body: "wire confirmed" })).status).toBe("sent");
      expect((await sendMessage(e, { messageId: "MX", fromDid: ALICE, toDid: BOB, body: "" })).status).toBe("rejected");
      await sendMessage(e, { messageId: "M2", fromDid: BOB, toDid: ALICE, body: "thanks" });
      expect((await listMessages(e)).total).toBe(2);
      expect((await listMessages(e, { toDid: BOB })).total).toBe(1);
    });

    it("non-recipient sees zero messages", async () => {
      await sendMessage(e, { messageId: "M1", fromDid: ALICE, toDid: BOB, body: "secret" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listMessages(outsider)).total).toBe(0);
    });
  });

  describe("derived views (balance + history, integer minor-unit math)", () => {
    it("computes net balance from E2E ledger without float", async () => {
      await bookTransfer(e, { transferRef: "T1", fromDid: ALICE, toDid: BOB, amount: "1250.50", currency: "USD", corridor: "JP-US" });
      await bookTransfer(e, { transferRef: "T2", fromDid: BOB, toDid: ALICE, amount: "250.25", currency: "USD", corridor: "JP-US" });
      const bal = await getBalance(e, { did: BOB });
      // BOB received 1250.50, sent 250.25 → net +1000.25
      const usd = bal.balances.find((b) => b.currency === "USD");
      expect(usd?.netAmount).toBe("1000.25");
      expect(usd?.creditCount).toBe(1);
      expect(usd?.debitCount).toBe(1);
      const hist = await getTransferHistory(e, { did: BOB });
      expect(hist.total).toBe(2);
    });

    it("minor-unit helpers round-trip exactly", () => {
      expect(toMinorUnits("1250.50")).toBe(125050);
      expect(fromMinorUnits(125050)).toBe("1250.50");
      expect(fromMinorUnits(100025)).toBe("1000.25");
      expect(toMinorUnits("not-money")).toBeNull();
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext rates+stats + E2E transfers+messages", async () => {
      await upsertCorridorRate(e, { corridor: "JP-US", currencyPair: "JPY/USD", ratePermille: 7 });
      await upsertCorridorRate(e, { corridor: "EU-US", currencyPair: "EUR/USD", ratePermille: 1080 });
      await recordCorridorStat(e, { corridor: "JP-US", period: "2026-06", transferCount: 2, totalMinorUnits: 175075, currency: "USD" });
      await bookTransfer(e, { transferRef: "T1", fromDid: ALICE, toDid: BOB, amount: "10.00", currency: "USD", corridor: "JP-US" });
      await sendMessage(e, { messageId: "M1", fromDid: ALICE, toDid: BOB, body: "hi" });
      const cov = await coverage(e);
      expect(cov.corridorRateCount).toBe(2);
      expect(cov.corridorStatCount).toBe(1);
      expect(cov.transferLedgerCount).toBe(1);
      expect(cov.secureMessageCount).toBe(1);
      expect(cov.ratesByCurrencyPair?.["EUR/USD"]).toBe(1);
    });
  });
});
