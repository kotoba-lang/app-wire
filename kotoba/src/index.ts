/**
 * wire kotoba — barrel. kotoba-E2E split: corridor reference catalog +
 * aggregate stats plaintext; transfer ledger + secure messages sealed via
 * kotoba E2E (sdk.encryptedWrite/Read, ADR-2605181100). Balances and transfer
 * history are derived from the E2E ledger. The fiat merchant-of-record
 * settlement rail EXECUTION stays etzhayyim via consent-capability.
 */
export * from "./types.js";
export {
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
} from "./registry.js";
