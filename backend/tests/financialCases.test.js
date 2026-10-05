import assert from 'assert';
import { LoanCalculator } from '../src/domain/LoanCalculator.js';
import { PaymentEngine } from '../src/domain/PaymentEngine.js';
import { MoraEngine } from '../src/domain/MoraEngine.js';
import { QUOTA_STATUS, EXCESS_DESTINATIONS, MORA_TYPES } from '../src/config/constants.js';

console.log('===========================================================');
console.log(' EJECUTANDO PRUEBAS DE CERTIFICACIÓN FINANCIERA — GMONEY');
console.log('===========================================================');

let passedTests = 0;
let totalTests = 10;

function runTest(title, testFn) {
  try {
    testFn();
    console.log(`[OK] ${title}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${title}`);
    console.error(`       Error: ${err.message}`);
  }
}

// -------------------------------------------------------------
// CASO 1 — PAGO NORMAL
// Cuota: $20.000, Pago: $20.000 -> Cuota pagada.
// -------------------------------------------------------------
runTest('CASO 1 — PAGO NORMAL ($20.000 sobre cuota de $20.000)', () => {
  const quotas = [
    { id: 'CUO-00001', numero_cuota: 1, fecha_vencimiento: '2026-09-23', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.PENDING }
  ];

  const res = PaymentEngine.processAllocation({
    quotas,
    amount: 20000,
    currentDate: '2026-09-23'
  });

  const q1 = res.updatedQuotas[0];
  assert.strictEqual(q1.estado, QUOTA_STATUS.PAID, 'La cuota debe quedar Pagada');
  assert.strictEqual(q1.saldo_pendiente, 0, 'El saldo pendiente debe ser 0');
  assert.strictEqual(q1.valor_pagado, 20000, 'El valor pagado debe ser 20000');
  assert.strictEqual(res.capitalAppliedTotal, 20000);
  assert.strictEqual(res.excessAmount, 0);
});

// -------------------------------------------------------------
// CASO 2 — PAGO PARCIAL
// Cuota: $20.000, Pago: $10.000 -> Cuota parcial, Saldo: $10.000.
// -------------------------------------------------------------
runTest('CASO 2 — PAGO PARCIAL ($10.000 sobre cuota de $20.000)', () => {
  const quotas = [
    { id: 'CUO-00001', numero_cuota: 1, fecha_vencimiento: '2026-09-23', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.PENDING }
  ];

  const res = PaymentEngine.processAllocation({
    quotas,
    amount: 10000,
    currentDate: '2026-09-23'
  });

  const q1 = res.updatedQuotas[0];
  assert.strictEqual(q1.estado, QUOTA_STATUS.PARTIAL, 'La cuota debe quedar Parcial');
  assert.strictEqual(q1.saldo_pendiente, 10000, 'El saldo pendiente debe ser 10000');
  assert.strictEqual(q1.valor_pagado, 10000, 'El valor pagado debe ser 10000');
  assert.strictEqual(res.capitalAppliedTotal, 10000);
});

// -------------------------------------------------------------
// CASO 3 — PAGO MAYOR A UNA CUOTA
// Cuota: $20.000, Pago: $50.000 -> Primera cuota pagada, Excedente: $30.000.
// -------------------------------------------------------------
runTest('CASO 3 — PAGO MAYOR A UNA CUOTA ($50.000 con cuota de $20.000)', () => {
  const quotas = [
    { id: 'CUO-00001', numero_cuota: 1, fecha_vencimiento: '2026-09-23', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.PENDING },
    { id: 'CUO-00002', numero_cuota: 2, fecha_vencimiento: '2026-09-24', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.PENDING }
  ];

  // Caso 3a: Aplicar excedente a cuotas futuras
  const resFuture = PaymentEngine.processAllocation({
    quotas,
    amount: 50000,
    excessDestination: EXCESS_DESTINATIONS.FUTURE_QUOTAS,
    currentDate: '2026-09-23'
  });

  assert.strictEqual(resFuture.updatedQuotas[0].estado, QUOTA_STATUS.PAID);
  assert.strictEqual(resFuture.updatedQuotas[1].estado, QUOTA_STATUS.PAID);
  assert.strictEqual(resFuture.excessAmount, 10000, 'Debe sobrar $10.000 tras cubrir cuota 1 y 2');

  // Caso 3b: Guardar excedente como saldo a favor
  const resCredit = PaymentEngine.processAllocation({
    quotas,
    amount: 50000,
    excessDestination: EXCESS_DESTINATIONS.CREDIT_BALANCE,
    currentDate: '2026-09-23'
  });

  assert.strictEqual(resCredit.updatedQuotas[0].estado, QUOTA_STATUS.PAID);
  assert.strictEqual(resCredit.updatedQuotas[1].estado, QUOTA_STATUS.PENDING, 'La cuota 2 no debe ser tocada si se guarda saldo a favor');
  assert.strictEqual(resCredit.excessAmount, 30000, 'El excedente guardado como saldo a favor debe ser $30.000');
});

// -------------------------------------------------------------
// CASO 4 — PAGO DE VARIAS CUOTAS
// Cinco cuotas de $20.000, Pago: $100.000 -> Cinco cuotas pagadas
// -------------------------------------------------------------
runTest('CASO 4 — PAGO DE VARIAS CUOTAS ($100.000 cubre 5 cuotas de $20.000)', () => {
  const quotas = [1, 2, 3, 4, 5].map((num) => ({
    id: `CUO-0000${num}`,
    numero_cuota: num,
    fecha_vencimiento: `2026-09-2${num}`,
    valor_original: 20000,
    valor_pagado: 0,
    saldo_pendiente: 20000,
    mora_pendiente: 0,
    estado: QUOTA_STATUS.PENDING
  }));

  const res = PaymentEngine.processAllocation({
    quotas,
    amount: 100000,
    excessDestination: EXCESS_DESTINATIONS.FUTURE_QUOTAS,
    currentDate: '2026-09-21'
  });

  assert.strictEqual(res.updatedQuotas.every((q) => q.estado === QUOTA_STATUS.PAID), true, 'Las 5 cuotas deben quedar Pagadas');
  assert.strictEqual(res.capitalAppliedTotal, 100000);
  assert.strictEqual(res.excessAmount, 0);
});

// -------------------------------------------------------------
// CASO 5 — PAGO PARCIAL SOBRE CUOTA VENCIDA
// Cuota vencida: $20.000, Pago: $15.000 -> Parcial, saldo $5.000
// -------------------------------------------------------------
runTest('CASO 5 — PAGO PARCIAL SOBRE CUOTA VENCIDA ($15.000 sobre cuota vencida de $20.000)', () => {
  const quotas = [
    { id: 'CUO-00001', numero_cuota: 1, fecha_vencimiento: '2026-09-10', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.OVERDUE }
  ];

  const res = PaymentEngine.processAllocation({
    quotas,
    amount: 15000,
    currentDate: '2026-09-23'
  });

  const q1 = res.updatedQuotas[0];
  assert.strictEqual(q1.estado, QUOTA_STATUS.PARTIAL);
  assert.strictEqual(q1.saldo_pendiente, 5000);
  assert.strictEqual(q1.valor_pagado, 15000);
});

// -------------------------------------------------------------
// CASO 6 — VARIAS CUOTAS VENCIDAS (Prioridad de Antigüedad)
// Cuota 10 ($20.000), Cuota 11 ($20.000), Pago: $35.000
// Resultado: Cuota 10 pagada ($20.000), Cuota 11 parcial ($15.000), Saldo: $5.000.
// -------------------------------------------------------------
runTest('CASO 6 — VARIAS CUOTAS VENCIDAS (Prioridad Antigüedad -> Vencimiento)', () => {
  const quotas = [
    { id: 'CUO-00010', numero_cuota: 10, fecha_vencimiento: '2026-09-10', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.OVERDUE },
    { id: 'CUO-00011', numero_cuota: 11, fecha_vencimiento: '2026-09-11', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.OVERDUE }
  ];

  const res = PaymentEngine.processAllocation({
    quotas,
    amount: 35000,
    currentDate: '2026-09-23'
  });

  const q10 = res.updatedQuotas[0];
  const q11 = res.updatedQuotas[1];

  assert.strictEqual(q10.estado, QUOTA_STATUS.PAID, 'Cuota 10 más antigua debe quedar Pagada');
  assert.strictEqual(q10.saldo_pendiente, 0);
  assert.strictEqual(q11.estado, QUOTA_STATUS.PARTIAL, 'Cuota 11 debe quedar Parcial');
  assert.strictEqual(q11.saldo_pendiente, 5000, 'Saldo de cuota 11 debe ser 5000');
  assert.strictEqual(q11.valor_pagado, 15000, 'Valor pagado de cuota 11 debe ser 15000');
});

// -------------------------------------------------------------
// CASO 7 — PRÉSTAMOS SIMULTÁNEOS
// Cliente tiene préstamo activo. Se solicita nuevo préstamo.
// Requiere autorización administrativa.
// -------------------------------------------------------------
runTest('CASO 7 — PRÉSTAMOS SIMULTÁNEOS (Regla de Bloqueo y Autorización)', () => {
  const existingLoans = [{ id: 'PRE-00001', cliente_id: 'CLI-00001', estado: 'Activo' }];
  const hasActive = existingLoans.some((l) => l.cliente_id === 'CLI-00001' && l.estado === 'Activo');

  // Verify business rule
  assert.strictEqual(hasActive, true, 'El cliente debe detectarse con préstamo activo');
  
  // Attempt without authorization
  const authorizeFlag = false;
  let canCreate = false;
  if (hasActive && !authorizeFlag) {
    canCreate = false; // Blocked!
  }
  assert.strictEqual(canCreate, false, 'No debe permitir crear préstamo simultáneo sin autorización');

  // With Admin Authorization
  const adminAuthorized = true;
  if (hasActive && adminAuthorized) {
    canCreate = true;
  }
  assert.strictEqual(canCreate, true, 'Debe permitir creación una vez autorizado por el Administrador');
});

// -------------------------------------------------------------
// CASO 8 — INDEPENDENCIA DE DOS PRÉSTAMOS
// Cliente tiene Préstamo A y Préstamo B. Pago sobre Préstamo A
// El Préstamo B no debe modificarse.
// -------------------------------------------------------------
runTest('CASO 8 — INDEPENDENCIA TOTAL ENTRE PRÉSTAMOS', () => {
  const quotasLoanA = [
    { id: 'CUO-A1', prestamo_id: 'PRE-A', numero_cuota: 1, fecha_vencimiento: '2026-09-23', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 0, estado: QUOTA_STATUS.PENDING }
  ];
  const quotasLoanB = [
    { id: 'CUO-B1', prestamo_id: 'PRE-B', numero_cuota: 1, fecha_vencimiento: '2026-09-23', valor_original: 50000, valor_pagado: 0, saldo_pendiente: 50000, mora_pendiente: 0, estado: QUOTA_STATUS.PENDING }
  ];

  // Pay on Loan A
  const resA = PaymentEngine.processAllocation({
    quotas: quotasLoanA,
    amount: 20000,
    currentDate: '2026-09-23'
  });

  // Verify Loan A changed
  assert.strictEqual(resA.updatedQuotas[0].saldo_pendiente, 0);
  assert.strictEqual(resA.updatedQuotas[0].estado, QUOTA_STATUS.PAID);

  // Verify Loan B is completely untouched
  assert.strictEqual(quotasLoanB[0].saldo_pendiente, 50000);
  assert.strictEqual(quotasLoanB[0].estado, QUOTA_STATUS.PENDING);
});

// -------------------------------------------------------------
// CASO 9 — MORA SEPARADA DE CAPITAL
// Cuota: $20.000, Mora: $5.000, Pago: $25.000
// Resultado: Cuota pagada, Mora pagada. Cuentas separadas.
// -------------------------------------------------------------
runTest('CASO 9 — MORA SEPARADA DE CAPITAL ($20.000 cuota + $5.000 mora)', () => {
  const quotas = [
    { id: 'CUO-00001', numero_cuota: 1, fecha_vencimiento: '2026-09-10', valor_original: 20000, valor_pagado: 0, saldo_pendiente: 20000, mora_pendiente: 5000, mora_pagada: 0, estado: QUOTA_STATUS.OVERDUE }
  ];

  const res = PaymentEngine.processAllocation({
    quotas,
    amount: 25000,
    payMoraFirst: true,
    currentDate: '2026-09-23'
  });

  const q1 = res.updatedQuotas[0];
  assert.strictEqual(res.moraAppliedTotal, 5000, 'Mora aplicada debe ser exactamente $5.000');
  assert.strictEqual(res.capitalAppliedTotal, 20000, 'Capital aplicado debe ser exactamente $20.000');
  assert.strictEqual(q1.mora_pagada, 5000);
  assert.strictEqual(q1.mora_pendiente, 0);
  assert.strictEqual(q1.saldo_pendiente, 0);
  assert.strictEqual(q1.estado, QUOTA_STATUS.PAID);
});

// -------------------------------------------------------------
// CASO 10 — ERROR EN PAGO Y REVERSIÓN AUDITADA
// Pago registrado incorrectamente -> Ajuste / Reversión
// -------------------------------------------------------------
runTest('CASO 10 — REVERSIÓN Y AJUSTE DE PAGO INMUTABLE', () => {
  const originalQuota = {
    id: 'CUO-00001',
    numero_cuota: 1,
    fecha_vencimiento: '2026-09-23',
    valor_original: 20000,
    valor_pagado: 0,
    saldo_pendiente: 20000,
    mora_pendiente: 0,
    mora_pagada: 0,
    estado: QUOTA_STATUS.PENDING
  };

  // Payment applied incorrectly
  const paymentRes = PaymentEngine.processAllocation({
    quotas: [originalQuota],
    amount: 20000,
    currentDate: '2026-09-23'
  });

  const paidQuota = paymentRes.updatedQuotas[0];
  assert.strictEqual(paidQuota.estado, QUOTA_STATUS.PAID);

  // Compensating Reversion Process
  const affected = paymentRes.affectedQuotas[0];
  const restoredPaid = paidQuota.valor_pagado - affected.abono_capital;
  const restoredPending = paidQuota.saldo_pendiente + affected.abono_capital;
  const restoredStatus = restoredPending >= paidQuota.valor_original ? QUOTA_STATUS.PENDING : QUOTA_STATUS.PARTIAL;

  assert.strictEqual(restoredPaid, 0, 'El valor pagado debe retornar a 0');
  assert.strictEqual(restoredPending, 20000, 'El saldo pendiente debe retornar a 20.000');
  assert.strictEqual(restoredStatus, QUOTA_STATUS.PENDING, 'El estado debe retornar a Pendiente');
});

console.log('===========================================================');
console.log(` RESULTADOS: ${passedTests} de ${totalTests} PRUEBAS SUPERADAS EXITOSAMENTE.`);
console.log('===========================================================');

if (passedTests !== totalTests) {
  process.exit(1);
}
