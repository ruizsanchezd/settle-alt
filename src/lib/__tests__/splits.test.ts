import { describe, it, expect } from "vitest";
import { calculateSplits } from "../utils/splits";

describe("calculateSplits", () => {
  // Split equitativo básico
  it("divide 100 entre 3 personas con redondeo correcto", () => {
    // 100 / 3 = 33.33 + 33.33 + 33.34
    const result = calculateSplits(100, "equal", ["a", "b", "c"], {});
    expect(result.reduce((sum, s) => sum + s.amount, 0)).toBe(100);
    expect(result.every((s) => s.amount >= 33.33 && s.amount <= 33.34)).toBe(
      true
    );
  });

  // Split equitativo exacto
  it("divide 100 entre 2 personas exactamente", () => {
    const result = calculateSplits(100, "equal", ["a", "b"], {});
    expect(result).toEqual([
      { memberId: "a", amount: 50 },
      { memberId: "b", amount: 50 },
    ]);
  });

  // Split equitativo con 1 persona
  it("asigna todo a una persona si solo hay una", () => {
    const result = calculateSplits(75.5, "equal", ["a"], {});
    expect(result).toEqual([{ memberId: "a", amount: 75.5 }]);
  });

  // Split por cantidades exactas
  it("respeta cantidades exactas", () => {
    const result = calculateSplits(100, "exact", ["a", "b"], { a: 60, b: 40 });
    expect(result).toEqual([
      { memberId: "a", amount: 60 },
      { memberId: "b", amount: 40 },
    ]);
  });

  // Split por porcentaje
  it("calcula porcentajes correctamente", () => {
    const result = calculateSplits(200, "percentage", ["a", "b"], {
      a: 70,
      b: 30,
    });
    expect(result).toEqual([
      { memberId: "a", amount: 140 },
      { memberId: "b", amount: 60 },
    ]);
  });

  // Split por shares
  it("calcula shares correctamente", () => {
    const result = calculateSplits(100, "shares", ["a", "b", "c"], {
      a: 2,
      b: 1,
      c: 1,
    });
    expect(result).toEqual([
      { memberId: "a", amount: 50 },
      { memberId: "b", amount: 25 },
      { memberId: "c", amount: 25 },
    ]);
  });

  // Edge cases de redondeo
  it("maneja 1 céntimo entre 3 personas", () => {
    const result = calculateSplits(0.01, "equal", ["a", "b", "c"], {});
    expect(result.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(0.01, 2);
  });

  // Importe grande
  it("maneja importes grandes sin errores de precisión", () => {
    const result = calculateSplits(999999.99, "equal", ["a", "b", "c"], {});
    expect(result.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(
      999999.99,
      2
    );
  });

  // Error cases
  it("lanza error si no hay participantes", () => {
    expect(() => calculateSplits(100, "equal", [], {})).toThrow(
      "Debe haber al menos un participante"
    );
  });

  it("lanza error si split exacto no suma correcto", () => {
    expect(() =>
      calculateSplits(100, "exact", ["a", "b"], { a: 60, b: 30 })
    ).toThrow("no coincide con el total");
  });

  it("lanza error si porcentajes no suman 100", () => {
    expect(() =>
      calculateSplits(100, "percentage", ["a", "b"], { a: 60, b: 30 })
    ).toThrow("deben sumar 100%");
  });

  it("lanza error si shares son 0 o negativos", () => {
    expect(() =>
      calculateSplits(100, "shares", ["a", "b"], { a: 0, b: 0 })
    ).toThrow("Las partes deben ser mayores a 0");
  });
});
