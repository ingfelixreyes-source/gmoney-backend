import { MORA_TYPES } from '../config/constants.js';
import { getDaysDifference, getTodayStr } from './DateUtils.js';

export class MoraEngine {
  /**
   * Calculate late fee for a given quota
   * @param {Object} quota - Quota object
   * @param {Object} config - System late fee config
   * @param {string} [currentDate] - Reference date (YYYY-MM-DD)
   * @returns {Object} { daysLate, isOverdue, moraAmount }
   */
  static calculateQuotaMora(quota, config = {}, currentDate = getTodayStr()) {
    // If quota is already paid, no new mora
    if (quota.estado === 'Pagada' || quota.saldo_pendiente <= 0) {
      return {
        daysLate: 0,
        isOverdue: false,
        moraAmount: Number(quota.mora_pendiente) || 0
      };
    }

    const daysLateRaw = getDaysDifference(quota.fecha_vencimiento, currentDate);
    if (daysLateRaw <= 0) {
      return {
        daysLate: 0,
        isOverdue: false,
        moraAmount: 0
      };
    }

    const graceDays = Number(config.mora_dias_gracia) || 0;
    const effectiveDaysLate = Math.max(0, daysLateRaw - graceDays);

    if (effectiveDaysLate <= 0) {
      return {
        daysLate: daysLateRaw,
        isOverdue: true,
        moraAmount: 0
      };
    }

    const moraType = config.mora_tipo || MORA_TYPES.NONE;
    const moraValue = Number(config.mora_valor_defecto) || 0;
    let computedMora = 0;

    switch (moraType) {
      case MORA_TYPES.FIXED_DAILY:
        computedMora = Math.round(moraValue * effectiveDaysLate);
        break;
      case MORA_TYPES.PERCENT_DAILY:
        // Percentage of remaining quota balance per day
        computedMora = Math.round(quota.saldo_pendiente * (moraValue / 100) * effectiveDaysLate);
        break;
      case MORA_TYPES.NONE:
      default:
        computedMora = 0;
        break;
    }

    return {
      daysLate: daysLateRaw,
      effectiveDaysLate,
      isOverdue: true,
      moraAmount: computedMora
    };
  }

  /**
   * Recalculate status and late fee for all quotas of a loan
   */
  static evaluateQuotasMora(quotas, config = {}, currentDate = getTodayStr()) {
    return quotas.map((q) => {
      const { isOverdue, moraAmount } = this.calculateQuotaMora(q, config, currentDate);
      let updatedStatus = q.estado;

      if (q.estado !== 'Pagada' && q.estado !== 'Cancelada') {
        if (isOverdue) {
          updatedStatus = 'Vencida';
        } else if (q.valor_pagado > 0) {
          updatedStatus = 'Parcial';
        } else {
          updatedStatus = 'Pendiente';
        }
      }

      return {
        ...q,
        estado: updatedStatus,
        mora_generada: moraAmount,
        mora_pendiente: Math.max(0, moraAmount - (Number(q.mora_pagada) || 0))
      };
    });
  }
}
