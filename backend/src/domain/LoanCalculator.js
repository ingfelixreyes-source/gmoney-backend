import { addPaymentFrequency, getNextValidDate } from './DateUtils.js';
import { FIRST_PAYMENT_RULES } from '../config/constants.js';

export class LoanCalculator {
  /**
   * Calculate financial figures of a loan
   * @param {Object} params
   * @param {number} params.principal - Capital inicial en COP
   * @param {number} params.interestRatePct - Tasa de interés (ej. 20)
   * @param {number} [params.numQuotas] - Número de cuotas pactadas
   * @returns {Object} { principal, interestRatePct, interestAmount, totalAmount, quotaAmount, numQuotas }
   */
  static calculateFigures({ principal, interestRatePct, numQuotas }) {
    const p = Math.round(Number(principal) || 0);
    const rate = Number(interestRatePct) || 0;
    const n = Math.round(Number(numQuotas) || 1);

    if (p <= 0) throw new Error('El capital debe ser mayor a 0');
    if (rate < 0) throw new Error('La tasa de interés no puede ser negativa');
    if (n <= 0) throw new Error('El número de cuotas debe ser mayor a 0');

    // Interés simple sobre capital inicial
    const interestAmount = Math.round(p * (rate / 100));
    const totalAmount = p + interestAmount;
    const quotaAmount = Math.round(totalAmount / n);

    return {
      principal: p,
      interestRatePct: rate,
      interestAmount,
      totalAmount,
      quotaAmount,
      numQuotas: n
    };
  }

  /**
   * Generate amortization schedule (cuotas)
   */
  static generateSchedule({
    loanId,
    totalAmount,
    numQuotas,
    quotaAmount,
    startDate,
    frequency = 'Diario',
    firstPaymentRule = FIRST_PAYMENT_RULES.NEXT_DAY,
    customFirstDate = null,
    excludeSundays = true,
    excludeHolidays = false
  }) {
    const quotas = [];
    let currentDate;

    // Determine first payment date
    if (firstPaymentRule === FIRST_PAYMENT_RULES.SAME_DAY) {
      currentDate = getNextValidDate(startDate, { excludeSundays, excludeHolidays });
    } else if (firstPaymentRule === FIRST_PAYMENT_RULES.CUSTOM_DATE && customFirstDate) {
      currentDate = getNextValidDate(customFirstDate, { excludeSundays, excludeHolidays });
    } else {
      // NEXT_DAY
      currentDate = addPaymentFrequency(startDate, 'Diario', { excludeSundays, excludeHolidays });
    }

    let accumulatedValue = 0;

    for (let i = 1; i <= numQuotas; i++) {
      // Adjust last quota if there's rounding difference
      let val = quotaAmount;
      if (i === numQuotas) {
        val = totalAmount - accumulatedValue;
      } else {
        accumulatedValue += val;
      }

      quotas.push({
        id: `CUO-${String(i).padStart(5, '0')}`,
        prestamo_id: loanId || '',
        numero_cuota: i,
        fecha_vencimiento: currentDate,
        valor_original: val,
        valor_pagado: 0,
        saldo_pendiente: val,
        mora_generada: 0,
        mora_pagada: 0,
        mora_pendiente: 0,
        estado: 'Pendiente',
        actualizado_en: new Date().toISOString()
      });

      if (i < numQuotas) {
        currentDate = addPaymentFrequency(currentDate, frequency, { excludeSundays, excludeHolidays });
      }
    }

    return {
      quotas,
      endDate: currentDate
    };
  }
}
