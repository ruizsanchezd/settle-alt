import { describe, it, expect } from "vitest";
import { calculateOptimizedTransfers } from "../utils/transfers";

describe("calculateOptimizedTransfers", () => {
  it("dos personas: una paga todo", () => {
    const balances = { a: 50, b: -50 };
    const transfers = calculateOptimizedTransfers(balances);
    expect(transfers).toEqual([{ from: "b", to: "a", amount: 50 }]);
  });

  it("balances cuadrados: sin transferencias", () => {
    const balances = { a: 0, b: 0, c: 0 };
    const transfers = calculateOptimizedTransfers(balances);
    expect(transfers).toEqual([]);
  });

  it("tres personas con deudas cruzadas", () => {
    const balances = { a: 100, b: -60, c: -40 };
    const transfers = calculateOptimizedTransfers(balances);
    const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);
    expect(totalTransferred).toBe(100);
    // Verify all from/to are correct direction
    transfers.forEach((t) => {
      expect(balances[t.from]).toBeLessThan(0);
      expect(balances[t.to]).toBeGreaterThan(0);
    });
  });

  it("maneja sub-céntimos por redondeo", () => {
    // Balances que suman ~0 pero no exactamente 0 por floating point
    const balances = { a: 33.33, b: 33.33, c: -66.66 };
    const transfers = calculateOptimizedTransfers(balances);
    // No debe producir transferencias de sub-céntimo
    transfers.forEach((t) => expect(t.amount).toBeGreaterThanOrEqual(0.01));
  });

  it("grupo de 5 personas", () => {
    const balances = { a: 200, b: -50, c: -50, d: -50, e: -50 };
    const transfers = calculateOptimizedTransfers(balances);
    expect(transfers.length).toBeLessThanOrEqual(4); // Máximo M-1 transferencias
    // Verify total transferred equals total owed
    const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);
    expect(totalTransferred).toBe(200);
  });

  it("maneja balances muy pequeños ignorándolos", () => {
    // Balances menores a 0.005 deben ser ignorados
    const balances = { a: 0.004, b: -0.003, c: 0 };
    const transfers = calculateOptimizedTransfers(balances);
    expect(transfers).toEqual([]);
  });

  it("optimiza el número de transferencias", () => {
    // Caso donde la optimización es evidente
    const balances = { a: 100, b: -30, c: -30, d: -40 };
    const transfers = calculateOptimizedTransfers(balances);
    // Debe requerir solo 3 transferencias, no más
    expect(transfers.length).toBe(3);
  });

  it("maneja importe grande", () => {
    const balances = { a: 999999.99, b: -500000, c: -499999.99 };
    const transfers = calculateOptimizedTransfers(balances);
    const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);
    expect(totalTransferred).toBeCloseTo(999999.99, 2);
  });
});
