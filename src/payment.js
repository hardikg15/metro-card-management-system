import { randomUUID } from 'node:crypto';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MOCK provider for the academic prototype. No real money, bank, UPI or gateway is involved.
// `simulate` ('SUCCESS' | 'FAILED') forces an outcome for demos/tests; otherwise ~90% succeed.
export function createMockPayment({ delayMs = 150, successRate = 0.9 } = {}) {
  return {
    async charge({ amountPaise, simulate }) {
      await sleep(delayMs);
      const ok = simulate ? simulate === 'SUCCESS' : Math.random() < successRate;
      return { status: ok ? 'SUCCESS' : 'FAILED', reference: `MOCK-${randomUUID()}`, amountPaise };
    },
  };
}
