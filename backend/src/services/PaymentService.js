import { getStore } from '../repositories/RepositoryFactory.js';
import {
  ENTITIES,
  ROLES,
  LOAN_STATUS,
  QUOTA_STATUS,
  EXCESS_DESTINATIONS,
  PAYMENT_METHODS
} from '../config/constants.js';
import { PaymentEngine } from '../domain/PaymentEngine.js';
import { MoraEngine } from '../domain/MoraEngine.js';
import { getTodayStr } from '../domain/DateUtils.js';
import { AuditService } from './AuditService.js';
import crypto from 'crypto';

export class PaymentService {
  /**
   * Preview payment breakdown without saving to database
   */
  static async previewPayment({
    prestamo_id,
    monto,
    destino_excedente = EXCESS_DESTINATIONS.FUTURE_QUOTAS,
    payMoraFirst = true
  }) {
    const store = await getStore();
    const loan = await store.findById(ENTITIES.LOANS, prestamo_id);
    if (!loan) throw new Error('Préstamo no encontrado');

    let quotas = await store.findAll(ENTITIES.QUOTAS, (q) => q.prestamo_id === prestamo_id);
    quotas.sort((a, b) => a.numero_cuota - b.numero_cuota);

    // Apply late fee evaluation
    const configList = await store.findAll(ENTITIES.CONFIG);
    const config = Object.fromEntries(configList.map((c) => [c.clave, c.valor]));
    quotas = MoraEngine.evaluateQuotasMora(quotas, config, getTodayStr());

    return PaymentEngine.previewAllocation({
      quotas,
      amount: monto,
      excessDestination: destino_excedente,
      payMoraFirst,
      currentDate: getTodayStr()
    });
  }

  /**
   * Register immutable payment
   */
  static async registerPayment(paymentData, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const {
      prestamo_id,
      monto,
      metodo_pago = PAYMENT_METHODS.CASH,
      destino_excedente = EXCESS_DESTINATIONS.FUTURE_QUOTAS,
      payMoraFirst = true,
      observaciones = ''
    } = paymentData;

    const numericAmount = Math.round(Number(monto) || 0);
    if (numericAmount <= 0) throw new Error('El valor del pago debe ser mayor a 0');

    // 1. Validate Loan
    const loan = await store.findById(ENTITIES.LOANS, prestamo_id);
    if (!loan) throw new Error('El préstamo seleccionado no existe');
    if (loan.estado === LOAN_STATUS.PAID || loan.estado === LOAN_STATUS.CANCELLED) {
      throw new Error(`No se pueden registrar pagos en un préstamo con estado: ${loan.estado}`);
    }

    // 2. Validate Collector authorization
    if (currentUser.rol === ROLES.COLLECTOR && String(loan.cobrador_id) !== String(currentUser.id)) {
      throw new Error('No tiene autorización para registrar pagos en este préstamo');
    }

    // 3. Validate Customer
    const customer = await store.findById(ENTITIES.CUSTOMERS, loan.cliente_id);
    if (!customer) throw new Error('El cliente asociado no existe');

    // 4. Fetch quotas & evaluate mora
    let quotas = await store.findAll(ENTITIES.QUOTAS, (q) => q.prestamo_id === prestamo_id);
    quotas.sort((a, b) => a.numero_cuota - b.numero_cuota);

    const configList = await store.findAll(ENTITIES.CONFIG);
    const config = Object.fromEntries(configList.map((c) => [c.clave, c.valor]));
    quotas = MoraEngine.evaluateQuotasMora(quotas, config, getTodayStr());

    // 5. Execute Payment Engine
    const allocation = PaymentEngine.processAllocation({
      quotas,
      amount: numericAmount,
      excessDestination: destino_excedente,
      payMoraFirst,
      currentDate: getTodayStr()
    });

    const now = new Date();
    const fecha_pago = getTodayStr();
    const hora_pago = now.toTimeString().slice(0, 8);

    // 6. Generate IDs
    const paymentId = await store.getNextId(ENTITIES.PAYMENTS, 'PAG');
    const receiptId = await store.getNextId(ENTITIES.RECEIPTS, 'REC');

    // 7. Update affected quotas in database
    const quotasToUpdate = allocation.updatedQuotas.filter((uq) => {
      return allocation.affectedQuotas.some((aq) => aq.cuota_id === uq.id);
    });

    await store.batchUpdate(ENTITIES.QUOTAS, quotasToUpdate);

    // 8. Update customer credit balance if excess was chosen as credit
    if (allocation.excessAmount > 0 && allocation.excessDestination === EXCESS_DESTINATIONS.CREDIT_BALANCE) {
      const currentCredit = Number(customer.saldo_credito) || 0;
      await store.update(ENTITIES.CUSTOMERS, customer.id, {
        saldo_credito: currentCredit + allocation.excessAmount
      });
    }

    // 9. Check if loan is fully paid
    const remainingUnpaid = allocation.updatedQuotas.filter(
      (q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED
    );

    let updatedLoanStatus = loan.estado;
    if (remainingUnpaid.length === 0) {
      updatedLoanStatus = LOAN_STATUS.PAID;
      await store.update(ENTITIES.LOANS, loan.id, {
        estado: LOAN_STATUS.PAID
      });
    } else {
      const hasOverdue = remainingUnpaid.some((q) => q.estado === QUOTA_STATUS.OVERDUE);
      updatedLoanStatus = hasOverdue ? LOAN_STATUS.IN_MORA : LOAN_STATUS.ACTIVE;
      if (updatedLoanStatus !== loan.estado) {
        await store.update(ENTITIES.LOANS, loan.id, { estado: updatedLoanStatus });
      }
    }

    // 10. Create Immutable Payment Record
    const paymentRecord = {
      id: paymentId,
      cliente_id: customer.id,
      prestamo_id: loan.id,
      cobrador_id: currentUser.id,
      usuario_registro_id: currentUser.id,
      fecha_pago,
      hora_pago,
      monto_total: numericAmount,
      metodo_pago,
      capital_aplicado: allocation.capitalAppliedTotal,
      mora_aplicada: allocation.moraAppliedTotal,
      excedente_aplicado: allocation.excessAmount,
      destino_excedente: allocation.excessDestination,
      cuotas_afectadas_json: allocation.affectedQuotas,
      estado: 'VALIDO',
      reversion_id: '',
      motivo_ajuste: '',
      observaciones: observaciones.trim()
    };

    await store.create(ENTITIES.PAYMENTS, paymentRecord);

    // 11. Create Receipt Record
    const verificationCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const receiptRecord = {
      id: receiptId,
      pago_id: paymentId,
      prestamo_id: loan.id,
      cliente_id: customer.id,
      cliente_nombre: customer.nombre_completo,
      cliente_cedula: customer.cedula,
      cobrador_id: currentUser.id,
      cobrador_nombre: currentUser.nombre,
      fecha_hora: now.toISOString(),
      monto: numericAmount,
      metodo_pago,
      saldo_restante_prestamo: allocation.remainingLoanBalance,
      cuotas_restantes: allocation.remainingQuotasCount,
      codigo_verificacion: verificationCode
    };

    await store.create(ENTITIES.RECEIPTS, receiptRecord);

    // 12. Audit Log
    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'REGISTRAR_PAGO',
      entidad: ENTITIES.PAYMENTS,
      entidad_id: paymentId,
      detalles: {
        prestamo_id: loan.id,
        cliente_id: customer.id,
        monto: numericAmount,
        capital_aplicado: allocation.capitalAppliedTotal,
        mora_aplicada: allocation.moraAppliedTotal,
        excedente: allocation.excessAmount
      },
      ip
    });

    return {
      payment: paymentRecord,
      receipt: receiptRecord,
      allocation
    };
  }

  /**
   * Reverse a previously registered payment (Ajuste / Reversión)
   */
  static async reversePayment({ pago_id, motivo }, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    if (!motivo || motivo.trim().length < 5) {
      throw new Error('Debe proporcionar un motivo claro y justificado para la reversión (mínimo 5 caracteres)');
    }

    const payment = await store.findById(ENTITIES.PAYMENTS, pago_id);
    if (!payment) throw new Error('Pago no encontrado');
    if (payment.estado === 'REVERTIDO') throw new Error('Este pago ya fue revertido previamente');

    // Only Admin or the Collector who registered it can reverse
    if (currentUser.rol !== ROLES.ADMIN && String(payment.usuario_registro_id) !== String(currentUser.id)) {
      throw new Error('No tiene permisos para revertir este pago');
    }

    const loan = await store.findById(ENTITIES.LOANS, payment.prestamo_id);
    const affectedQuotas = payment.cuotas_afectadas_json || [];

    // Revert quota balances
    const quotasToRestore = [];
    for (const item of affectedQuotas) {
      const quota = await store.findById(ENTITIES.QUOTAS, item.cuota_id);
      if (quota) {
        const restoredPaid = Math.max(0, (Number(quota.valor_pagado) || 0) - item.abono_capital);
        const restoredPending = Math.min(quota.valor_original, (Number(quota.saldo_pendiente) || 0) + item.abono_capital);
        const restoredMoraPaid = Math.max(0, (Number(quota.mora_pagada) || 0) - item.abono_mora);
        const restoredMoraPending = (Number(quota.mora_pendiente) || 0) + item.abono_mora;

        let restoredStatus = QUOTA_STATUS.PENDING;
        if (restoredPaid > 0) restoredStatus = QUOTA_STATUS.PARTIAL;
        if (quota.fecha_vencimiento < getTodayStr()) restoredStatus = QUOTA_STATUS.OVERDUE;

        quotasToRestore.push({
          id: quota.id,
          valor_pagado: restoredPaid,
          saldo_pendiente: restoredPending,
          mora_pagada: restoredMoraPaid,
          mora_pendiente: restoredMoraPending,
          estado: restoredStatus
        });
      }
    }

    await store.batchUpdate(ENTITIES.QUOTAS, quotasToRestore);

    // Revert customer credit balance if excess was applied to credit
    if (payment.excedente_aplicado > 0 && payment.destino_excedente === EXCESS_DESTINATIONS.CREDIT_BALANCE) {
      const customer = await store.findById(ENTITIES.CUSTOMERS, payment.cliente_id);
      if (customer) {
        const restoredCredit = Math.max(0, (Number(customer.saldo_credito) || 0) - payment.excedente_aplicado);
        await store.update(ENTITIES.CUSTOMERS, customer.id, { saldo_credito: restoredCredit });
      }
    }

    // Revert loan status back to Active / In Mora
    if (loan && loan.estado === LOAN_STATUS.PAID) {
      await store.update(ENTITIES.LOANS, loan.id, { estado: LOAN_STATUS.ACTIVE });
    }

    // Mark payment as REVERTIDO
    const updatedPayment = await store.update(ENTITIES.PAYMENTS, payment.id, {
      estado: 'REVERTIDO',
      motivo_ajuste: motivo.trim(),
      ajustado_por: currentUser.id,
      fecha_ajuste: new Date().toISOString()
    });

    // Audit log
    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'REVERTIR_PAGO',
      entidad: ENTITIES.PAYMENTS,
      entidad_id: payment.id,
      detalles: {
        prestamo_id: payment.prestamo_id,
        monto: payment.monto_total,
        motivo: motivo.trim()
      },
      ip
    });

    return updatedPayment;
  }
}
