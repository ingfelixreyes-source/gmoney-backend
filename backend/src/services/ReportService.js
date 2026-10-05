import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES, LOAN_STATUS, QUOTA_STATUS, ROLES } from '../config/constants.js';
import { getTodayStr } from '../domain/DateUtils.js';
import ExcelJS from 'exceljs';

export class ReportService {
  /**
   * Comprehensive metrics for the Administrator Dashboard
   */
  static async getAdminDashboard() {
    const store = await getStore();
    const today = getTodayStr();

    const [loans, customers, quotas, payments, users, zones] = await Promise.all([
      store.findAll(ENTITIES.LOANS),
      store.findAll(ENTITIES.CUSTOMERS),
      store.findAll(ENTITIES.QUOTAS),
      store.findAll(ENTITIES.PAYMENTS, (p) => p.estado === 'VALIDO'),
      store.findAll(ENTITIES.USERS),
      store.findAll(ENTITIES.ZONAS)
    ]);

    // Active counts
    const activeCustomers = customers.filter((c) => c.estado === 'Activo').length;
    const activeLoans = loans.filter((l) => l.estado === LOAN_STATUS.ACTIVE || l.estado === LOAN_STATUS.IN_MORA);
    const paidLoans = loans.filter((l) => l.estado === LOAN_STATUS.PAID);

    // Global Financials
    const totalPrestadoCapital = loans.reduce((sum, l) => sum + (Number(l.capital_inicial) || 0), 0);
    const totalInteresEstimadoGenerado = loans.reduce((sum, l) => sum + (Number(l.valor_interes) || 0), 0);
    const totalColocado = totalPrestadoCapital + totalInteresEstimadoGenerado;

    const totalRecaudado = payments.reduce((sum, p) => sum + (Number(p.monto_total) || 0), 0);
    const capitalRecuperado = payments.reduce((sum, p) => sum + (Number(p.capital_aplicado) || 0), 0);
    const moraRecuperada = payments.reduce((sum, p) => sum + (Number(p.mora_aplicada) || 0), 0);

    // Cartera Pendiente (uncollected quotas)
    const activeQuotas = quotas.filter((q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED);
    const carteraPendiente = activeQuotas.reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0), 0);
    const moraPendiente = quotas.reduce((sum, q) => sum + (Number(q.mora_pendiente) || 0), 0);
    const moraGeneradaTotal = quotas.reduce((sum, q) => sum + (Number(q.mora_generada) || 0), 0);

    // Today's numbers
    const todaysPayments = payments.filter((p) => p.fecha_pago === today);
    const recaudoDelDia = todaysPayments.reduce((sum, p) => sum + (Number(p.monto_total) || 0), 0);

    const todaysQuotas = quotas.filter((q) => q.fecha_vencimiento === today);
    const valorCobroDelDiaEsperado = todaysQuotas.reduce((sum, q) => sum + (Number(q.valor_original) || 0), 0);

    // Overdue analysis
    const cuotasVencidas = activeQuotas.filter((q) => q.fecha_vencimiento < today || q.estado === QUOTA_STATUS.OVERDUE);
    const valorCarteraVencida = cuotasVencidas.reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0), 0);

    // Clients with overdue quotas
    const overdueLoanIds = new Set(cuotasVencidas.map((q) => q.prestamo_id));
    const overdueCustomerIds = new Set(
      loans.filter((l) => overdueLoanIds.has(l.id)).map((l) => l.cliente_id)
    );
    const clientesEnMoraCount = overdueCustomerIds.size;

    // Collections by collector
    const collectors = users.filter((u) => u.rol === ROLES.COLLECTOR);
    const recaudoPorCobrador = collectors.map((c) => {
      const colPayments = payments.filter((p) => String(p.cobrador_id) === String(c.id));
      const colToday = colPayments.filter((p) => p.fecha_pago === today);
      return {
        cobradorId: c.id,
        nombre: c.nombre_completo,
        telefono: c.telefono,
        totalRecaudado: colPayments.reduce((s, p) => s + (Number(p.monto_total) || 0), 0),
        recaudoHoy: colToday.reduce((s, p) => s + (Number(p.monto_total) || 0), 0)
      };
    });

    // Collections by zone
    const recaudoPorZona = zones.map((z) => {
      const zoneLoans = loans.filter((l) => String(l.zona_id) === String(z.id));
      const zoneLoanIds = new Set(zoneLoans.map((l) => l.id));
      const zonePayments = payments.filter((p) => zoneLoanIds.has(p.prestamo_id));
      const zoneQuotas = quotas.filter((q) => zoneLoanIds.has(q.prestamo_id));
      const zonePending = zoneQuotas
        .filter((q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED)
        .reduce((s, q) => s + (Number(q.saldo_pendiente) || 0), 0);

      return {
        zonaId: z.id,
        nombre: z.nombre,
        totalRecaudado: zonePayments.reduce((s, p) => s + (Number(p.monto_total) || 0), 0),
        carteraPendiente: zonePending
      };
    });

    return {
      resumenGeneral: {
        totalPrestadoCapital,
        totalInteresEstimadoGenerado,
        totalColocado,
        totalRecaudado,
        capitalRecuperado,
        carteraPendiente,
        clientesActivos: activeCustomers,
        prestamosActivos: activeLoans.length,
        prestamosPagados: paidLoans.length,
        tasaRecuperacionPct: totalColocado > 0 ? Number(((totalRecaudado / totalColocado) * 100).toFixed(1)) : 0
      },
      operacionDelDia: {
        fecha: today,
        recaudoDelDia,
        valorCobroDelDiaEsperado,
        pagosRegistradosHoy: todaysPayments.length,
        cuotasDelDiaCount: todaysQuotas.length
      },
      moraYCarteraVencida: {
        clientesEnMoraCount,
        cuotasVencidasCount: cuotasVencidas.length,
        valorCarteraVencida,
        moraGeneradaTotal,
        moraRecuperada,
        moraPendiente
      },
      recaudoPorCobrador,
      recaudoPorZona
    };
  }

  /**
   * Mobile Street POS Dashboard for Collectors
   */
  static async getCollectorDashboard(collectorId) {
    const store = await getStore();
    const today = getTodayStr();

    const [customers, loans, quotas, payments] = await Promise.all([
      store.findAll(ENTITIES.CUSTOMERS, (c) => String(c.cobrador_id) === String(collectorId)),
      store.findAll(ENTITIES.LOANS, (l) => String(l.cobrador_id) === String(collectorId)),
      store.findAll(ENTITIES.QUOTAS),
      store.findAll(ENTITIES.PAYMENTS, (p) => String(p.cobrador_id) === String(collectorId) && p.estado === 'VALIDO')
    ]);

    const loanIds = new Set(loans.map((l) => l.id));
    const collectorQuotas = quotas.filter((q) => loanIds.has(q.prestamo_id));

    // Today's collections
    const todaysPayments = payments.filter((p) => p.fecha_pago === today);
    const recaudoHoy = todaysPayments.reduce((sum, p) => sum + (Number(p.monto_total) || 0), 0);

    // Today's expected
    const todaysQuotas = collectorQuotas.filter((q) => q.fecha_vencimiento === today);
    const esperadoHoy = todaysQuotas.reduce((sum, q) => sum + (Number(q.valor_original) || 0), 0);

    // Overdue
    const activeQuotas = collectorQuotas.filter((q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED);
    const vencidas = activeQuotas.filter((q) => q.fecha_vencimiento < today || q.estado === QUOTA_STATUS.OVERDUE);

    // Route list: Assigned customers with today's status
    const rutaDelDia = customers.map((c) => {
      const cLoans = loans.filter((l) => String(l.cliente_id) === String(c.id) && (l.estado === LOAN_STATUS.ACTIVE || l.estado === LOAN_STATUS.IN_MORA));
      const cLoanIds = new Set(cLoans.map((l) => l.id));
      const cQuotas = collectorQuotas.filter((q) => cLoanIds.has(q.prestamo_id) && q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED);
      
      const cTodaysPayments = todaysPayments.filter((p) => String(p.cliente_id) === String(c.id));
      const montoAbonadoHoy = cTodaysPayments.reduce((sum, p) => sum + (Number(p.monto_total) || 0), 0);

      const cTodaysUnpaidQuotas = cQuotas.filter((q) => q.fecha_vencimiento === today);
      const saldoRestanteCuotaHoy = cTodaysUnpaidQuotas.reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0), 0);
      const cOverdueQuotas = cQuotas.filter((q) => q.fecha_vencimiento < today || q.estado === QUOTA_STATUS.OVERDUE);
      
      // Detect partial quota pending completion
      const activePartialQuota = cQuotas.find((q) => q.estado === QUOTA_STATUS.PARTIAL);

      const abonoParcialHoy = montoAbonadoHoy > 0 && (saldoRestanteCuotaHoy > 0 || (activePartialQuota && activePartialQuota.saldo_pendiente > 0));
      const cuotaCompletadaHoy = montoAbonadoHoy > 0 && !abonoParcialHoy;

      let saldoParaCompletarCuota = 0;
      let valorOriginalCuotaActual = 0;
      let abonoPrevioCuotaActual = 0;

      if (activePartialQuota) {
        saldoParaCompletarCuota = activePartialQuota.saldo_pendiente;
        valorOriginalCuotaActual = activePartialQuota.valor_original;
        abonoPrevioCuotaActual = activePartialQuota.valor_pagado;
      } else if (cTodaysUnpaidQuotas.length > 0) {
        saldoParaCompletarCuota = cTodaysUnpaidQuotas[0].saldo_pendiente;
        valorOriginalCuotaActual = cTodaysUnpaidQuotas[0].valor_original;
        abonoPrevioCuotaActual = cTodaysUnpaidQuotas[0].valor_pagado;
      } else if (cQuotas.length > 0) {
        saldoParaCompletarCuota = cQuotas[0].saldo_pendiente;
        valorOriginalCuotaActual = cQuotas[0].valor_original;
        abonoPrevioCuotaActual = cQuotas[0].valor_pagado;
      }

      const totalDebe = cQuotas.reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0) + (Number(q.mora_pendiente) || 0), 0);

      return {
        clienteId: c.id,
        nombre: c.nombre_completo,
        telefono: c.telefono,
        direccion: c.direccion,
        barrio: c.barrio,
        totalDebe,
        tienePrestamosActivos: cLoans.length > 0,
        prestamosActivosCount: cLoans.length,
        prestamoPrincipalId: cLoans.length > 0 ? cLoans[0].id : null,
        cuotaEsperadaHoy: cTodaysUnpaidQuotas.reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0), 0),
        cuotasVencidasCount: cOverdueQuotas.length,
        yaPagoHoy: montoAbonadoHoy > 0,
        montoAbonadoHoy,
        abonoParcialHoy,
        cuotaCompletadaHoy,
        saldoParaCompletarCuota,
        valorOriginalCuotaActual,
        abonoPrevioCuotaActual,
        tieneCuotaParcial: Boolean(activePartialQuota),
        enMora: cOverdueQuotas.length > 0
      };
    });

    const abonosParcialesCount = rutaDelDia.filter((r) => r.abonoParcialHoy).length;
    const completadosCount = rutaDelDia.filter((r) => r.cuotaCompletadaHoy).length;

    return {
      collectorId,
      hoy: today,
      metricas: {
        totalClientes: customers.length,
        esperadoHoy,
        recaudoHoy,
        cuotasDelDiaCount: todaysQuotas.length,
        pagosRegistradosHoy: todaysPayments.length,
        cuotasVencidasCount: vencidas.length,
        abonosParcialesCount,
        completadosCount
      },
      rutaDelDia
    };
  }

  /**
   * Export financial report to Excel
   */
  static async exportToExcel(reportType, filters = {}) {
    const store = await getStore();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GMONEY';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Reporte GMONEY');

    if (reportType === 'pagos') {
      const payments = await store.findAll(ENTITIES.PAYMENTS);
      sheet.columns = [
        { header: 'ID Pago', key: 'id', width: 14 },
        { header: 'Fecha', key: 'fecha_pago', width: 12 },
        { header: 'Hora', key: 'hora_pago', width: 10 },
        { header: 'Cliente ID', key: 'cliente_id', width: 14 },
        { header: 'Préstamo ID', key: 'prestamo_id', width: 14 },
        { header: 'Cobrador ID', key: 'cobrador_id', width: 14 },
        { header: 'Monto Total COP', key: 'monto_total', width: 16 },
        { header: 'Capital Aplicado', key: 'capital_aplicado', width: 16 },
        { header: 'Mora Aplicada', key: 'mora_aplicada', width: 16 },
        { header: 'Excedente', key: 'excedente_aplicado', width: 14 },
        { header: 'Método', key: 'metodo_pago', width: 18 },
        { header: 'Estado', key: 'estado', width: 12 }
      ];

      payments.forEach((p) => {
        sheet.addRow(p);
      });
    } else {
      // Default: Loans report
      const loans = await store.findAll(ENTITIES.LOANS);
      sheet.columns = [
        { header: 'ID Préstamo', key: 'id', width: 14 },
        { header: 'Cliente ID', key: 'cliente_id', width: 14 },
        { header: 'Cobrador ID', key: 'cobrador_id', width: 14 },
        { header: 'Capital Inicial COP', key: 'capital_inicial', width: 18 },
        { header: 'Tasa %', key: 'tasa_interes_pct', width: 10 },
        { header: 'Interés COP', key: 'valor_interes', width: 16 },
        { header: 'Total Pactado', key: 'total_prestamo', width: 18 },
        { header: 'Cuotas', key: 'num_cuotas', width: 10 },
        { header: 'Valor Cuota', key: 'valor_cuota', width: 14 },
        { header: 'Frecuencia', key: 'frecuencia', width: 14 },
        { header: 'Fecha Inicio', key: 'fecha_inicio', width: 14 },
        { header: 'Fecha Fin', key: 'fecha_fin', width: 14 },
        { header: 'Estado', key: 'estado', width: 14 }
      ];

      loans.forEach((l) => {
        sheet.addRow(l);
      });
    }

    return workbook.xlsx.writeBuffer();
  }
}
