import { EXCESS_DESTINATIONS, QUOTA_STATUS } from '../config/constants.js';
import { getTodayStr } from './DateUtils.js';

export class PaymentEngine {
  /**
   * Calculate payment distribution preview or final allocation
   * @param {Object} params
   * @param {Array} params.quotas - List of all loan quotas ordered by numero_cuota ASC
   * @param {number} params.amount - Total amount received in COP
   * @param {string} [params.excessDestination] - 'CUOTAS_FUTURAS' or 'SALDO_A_FAVOR'
   * @param {boolean} [params.payMoraFirst=true] - Whether to liquidate late fees before principal
   * @param {string} [params.currentDate] - Reference date (YYYY-MM-DD)
   * @returns {Object} Allocation result
   */
  static processAllocation({
    quotas,
    amount,
    excessDestination = EXCESS_DESTINATIONS.FUTURE_QUOTAS,
    payMoraFirst = true,
    currentDate = getTodayStr()
  }) {
    const totalReceived = Math.round(Number(amount) || 0);
    if (totalReceived <= 0) {
      throw new Error('El valor del pago debe ser mayor a 0');
    }

    let remainingMoney = totalReceived;
    let capitalAppliedTotal = 0;
    let moraAppliedTotal = 0;

    // Filter unpaid quotas (Pendiente, Parcial, Vencida)
    const activeQuotas = quotas
      .filter((q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED)
      .map((q) => ({ ...q }));

    if (activeQuotas.length === 0) {
      return {
        totalReceived,
        capitalAppliedTotal: 0,
        moraAppliedTotal: 0,
        excessAmount: totalReceived,
        excessDestination: EXCESS_DESTINATIONS.CREDIT_BALANCE,
        affectedQuotas: [],
        remainingLoanBalance: 0,
        updatedQuotas: quotas.map((q) => ({ ...q }))
      };
    }

    // Classify quotas by priority:
    // 1. Overdue quotas (fecha_vencimiento < currentDate), sorted by oldest first
    // 2. Current quota (fecha_vencimiento == currentDate or the earliest non-overdue quota)
    // 3. Future quotas (fecha_vencimiento > currentDate)
    const overdueQuotas = [];
    const currentOrFutureQuotas = [];

    activeQuotas.forEach((q) => {
      if (q.fecha_vencimiento < currentDate || q.estado === QUOTA_STATUS.OVERDUE) {
        overdueQuotas.push(q);
      } else {
        currentOrFutureQuotas.push(q);
      }
    });

    // Primary queue: Overdue first, then current quota
    let primaryQueue = [...overdueQuotas];
    let futureQueue = [];

    if (currentOrFutureQuotas.length > 0) {
      // First one is current
      primaryQueue.push(currentOrFutureQuotas[0]);
      // Remaining are future
      futureQueue = currentOrFutureQuotas.slice(1);
    }

    const affectedQuotas = [];

    // Helper to apply money to a quota
    const applyToQuota = (q) => {
      if (remainingMoney <= 0) return;

      let quotaMoraPaid = 0;
      let quotaCapitalPaid = 0;
      const initialPaid = Number(q.valor_pagado) || 0;
      const initialPending = Number(q.saldo_pendiente) || q.valor_original - initialPaid;
      const initialMoraPending = Number(q.mora_pendiente) || 0;

      // 1. Pay Mora if applicable and pending
      if (payMoraFirst && initialMoraPending > 0) {
        quotaMoraPaid = Math.min(remainingMoney, initialMoraPending);
        remainingMoney -= quotaMoraPaid;
        moraAppliedTotal += quotaMoraPaid;
      }

      // 2. Pay Quota Principal Balance
      if (remainingMoney > 0 && initialPending > 0) {
        quotaCapitalPaid = Math.min(remainingMoney, initialPending);
        remainingMoney -= quotaCapitalPaid;
        capitalAppliedTotal += quotaCapitalPaid;
      }

      // Calculate new status
      const newPaid = initialPaid + quotaCapitalPaid;
      const newPending = initialPending - quotaCapitalPaid;
      const newMoraPending = initialMoraPending - quotaMoraPaid;

      let newStatus = q.estado;
      if (newPending <= 0 && newMoraPending <= 0) {
        newStatus = QUOTA_STATUS.PAID;
      } else if (newPaid > 0 || (Number(q.mora_pagada) || 0) + quotaMoraPaid > 0) {
        newStatus = QUOTA_STATUS.PARTIAL;
      }

      const updated = {
        ...q,
        valor_pagado: newPaid,
        saldo_pendiente: Math.max(0, newPending),
        mora_pagada: (Number(q.mora_pagada) || 0) + quotaMoraPaid,
        mora_pendiente: Math.max(0, newMoraPending),
        estado: newStatus,
        actualizado_en: new Date().toISOString()
      };

      affectedQuotas.push({
        cuota_id: q.id,
        numero_cuota: q.numero_cuota,
        fecha_vencimiento: q.fecha_vencimiento,
        abono_capital: quotaCapitalPaid,
        abono_mora: quotaMoraPaid,
        saldo_restante: updated.saldo_pendiente,
        mora_restante: updated.mora_pendiente,
        estado_resultante: newStatus
      });

      return updated;
    };

    // Step 1 & 2 & 3: Process primary queue (Overdue and Current)
    const updatedMap = new Map();
    for (const q of primaryQueue) {
      if (remainingMoney <= 0) break;
      const updated = applyToQuota(q);
      if (updated) updatedMap.set(updated.id, updated);
    }

    // Step 4: Handle Excess Money if remainingMoney > 0
    let excessAmount = 0;
    let finalExcessDestination = excessDestination;

    if (remainingMoney > 0) {
      if (excessDestination === EXCESS_DESTINATIONS.FUTURE_QUOTAS && futureQueue.length > 0) {
        // Cascade into future quotas
        for (const q of futureQueue) {
          if (remainingMoney <= 0) break;
          const updated = applyToQuota(q);
          if (updated) updatedMap.set(updated.id, updated);
        }
      }

      // If still money remaining after all quotas or user chose credit balance
      if (remainingMoney > 0) {
        excessAmount = remainingMoney;
        finalExcessDestination = EXCESS_DESTINATIONS.CREDIT_BALANCE;
        remainingMoney = 0;
      }
    }

    // Build the final complete updated quotas list
    const updatedQuotas = quotas.map((orig) => updatedMap.get(orig.id) || { ...orig });

    // Calculate remaining loan balance
    const remainingLoanBalance = updatedQuotas
      .filter((q) => q.estado !== QUOTA_STATUS.CANCELLED)
      .reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0), 0);

    const remainingQuotasCount = updatedQuotas.filter(
      (q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED
    ).length;

    return {
      totalReceived,
      capitalAppliedTotal,
      moraAppliedTotal,
      excessAmount,
      excessDestination: finalExcessDestination,
      affectedQuotas,
      remainingLoanBalance,
      remainingQuotasCount,
      updatedQuotas
    };
  }

  /**
   * Preview allocation without persisting (used in UI before user confirms)
   */
  static previewAllocation(params) {
    return this.processAllocation(params);
  }
}
