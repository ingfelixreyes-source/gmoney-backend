import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES, ROLES, LOAN_STATUS, QUOTA_STATUS, FREQUENCIES } from '../config/constants.js';
import { LoanCalculator } from '../domain/LoanCalculator.js';
import { MoraEngine } from '../domain/MoraEngine.js';
import { getTodayStr } from '../domain/DateUtils.js';
import { AuditService } from './AuditService.js';

export class LoanService {
  /**
   * Check if a customer already has active loans
   */
  static async checkExistingLoans(cliente_id) {
    const store = await getStore();
    const loans = await store.findAll(
      ENTITIES.LOANS,
      (l) => String(l.cliente_id) === String(cliente_id) && (l.estado === LOAN_STATUS.ACTIVE || l.estado === LOAN_STATUS.IN_MORA)
    );

    if (loans.length === 0) {
      return { hasActiveLoans: false, activeLoans: [] };
    }

    const loanDiagnostics = [];
    for (const loan of loans) {
      const quotas = await store.findAll(ENTITIES.QUOTAS, (q) => q.prestamo_id === loan.id);
      const payments = await store.findAll(ENTITIES.PAYMENTS, (p) => p.prestamo_id === loan.id);
      const pendingQuotas = quotas.filter((q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED);
      const overdueQuotas = pendingQuotas.filter((q) => q.estado === QUOTA_STATUS.OVERDUE || q.fecha_vencimiento < getTodayStr());
      
      const pendingBalance = pendingQuotas.reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0), 0);
      const pendingMora = quotas.reduce((sum, q) => sum + (Number(q.mora_pendiente) || 0), 0);
      const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;

      loanDiagnostics.push({
        loanId: loan.id,
        capitalInicial: loan.capital_inicial,
        totalPrestamo: loan.total_prestamo,
        saldoPendiente: pendingBalance,
        cuotasPendientesCount: pendingQuotas.length,
        cuotasVencidasCount: overdueQuotas.length,
        moraPendiente: pendingMora,
        estado: loan.estado,
        ultimoPagoFecha: lastPayment ? `${lastPayment.fecha_pago} ${lastPayment.hora_pago}` : 'Sin pagos registrados',
        ultimoPagoMonto: lastPayment ? lastPayment.monto_total : 0
      });
    }

    return {
      hasActiveLoans: true,
      activeLoans: loanDiagnostics
    };
  }

  static async simulate({
    principal,
    interestRatePct,
    numQuotas,
    startDate = getTodayStr(),
    frequency = FREQUENCIES.DAILY,
    firstPaymentRule,
    customFirstDate,
    excludeSundays = true,
    excludeHolidays = true
  }) {
    const figures = LoanCalculator.calculateFigures({ principal, interestRatePct, numQuotas });
    const schedule = LoanCalculator.generateSchedule({
      loanId: 'PRE-SIMULADO',
      totalAmount: figures.totalAmount,
      numQuotas: figures.numQuotas,
      quotaAmount: figures.quotaAmount,
      startDate,
      frequency,
      firstPaymentRule,
      customFirstDate,
      excludeSundays,
      excludeHolidays
    });

    return {
      figures,
      schedule: schedule.quotas,
      endDate: schedule.endDate
    };
  }

  static async create(loanData, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const {
      cliente_id,
      capital_inicial,
      tasa_interes_pct,
      num_cuotas,
      frecuencia = FREQUENCIES.DAILY,
      fecha_inicio = getTodayStr(),
      firstPaymentRule,
      customFirstDate,
      excludeSundays = true,
      excludeHolidays = true,
      autorizar_simultaneo = false,
      observaciones = ''
    } = loanData;

    // Validate customer
    const customer = await store.findById(ENTITIES.CUSTOMERS, cliente_id);
    if (!customer) throw new Error('El cliente seleccionado no existe');
    if (customer.estado !== 'Activo') throw new Error('El cliente se encuentra inactivo');

    // Check simultaneous loans rule
    const existingCheck = await this.checkExistingLoans(cliente_id);
    if (existingCheck.hasActiveLoans) {
      if (!autorizar_simultaneo) {
        return {
          requiresSimultaneousAuthorization: true,
          message: 'Este cliente ya tiene un préstamo activo. Se requiere autorización del Administrador para crear un préstamo simultáneo.',
          activeLoansDiagnostics: existingCheck.activeLoans
        };
      }

      // Check admin authorization
      if (currentUser.rol !== ROLES.ADMIN) {
        throw new Error('Solo un Administrador puede autorizar la creación de préstamos simultáneos');
      }
    }

    // Calculate loan figures
    const figures = LoanCalculator.calculateFigures({
      principal: capital_inicial,
      interestRatePct: tasa_interes_pct,
      numQuotas: num_cuotas
    });

    const loanId = await store.getNextId(ENTITIES.LOANS, 'PRE');

    // Generate schedule
    const schedule = LoanCalculator.generateSchedule({
      loanId,
      totalAmount: figures.totalAmount,
      numQuotas: figures.numQuotas,
      quotaAmount: figures.quotaAmount,
      startDate: fecha_inicio,
      frequency: frecuencia,
      firstPaymentRule,
      customFirstDate,
      excludeSundays,
      excludeHolidays
    });

    // Create quotas with sequential IDs
    const quotasToInsert = [];
    for (let i = 0; i < schedule.quotas.length; i++) {
      const quotaId = await store.getNextId(ENTITIES.QUOTAS, 'CUO');
      quotasToInsert.push({
        ...schedule.quotas[i],
        id: quotaId,
        prestamo_id: loanId
      });
    }

    const newLoan = {
      id: loanId,
      cliente_id,
      cobrador_id: customer.cobrador_id || (currentUser.rol === ROLES.COLLECTOR ? currentUser.id : ''),
      zona_id: customer.zona_id || '',
      capital_inicial: figures.principal,
      tasa_interes_pct: figures.interestRatePct,
      valor_interes: figures.interestAmount,
      total_prestamo: figures.totalAmount,
      num_cuotas: figures.numQuotas,
      valor_cuota: figures.quotaAmount,
      frecuencia,
      fecha_inicio,
      fecha_fin: schedule.endDate,
      estado: LOAN_STATUS.ACTIVE,
      es_simultaneo: existingCheck.hasActiveLoans,
      autorizado_por: existingCheck.hasActiveLoans ? currentUser.id : '',
      fecha_autorizacion: existingCheck.hasActiveLoans ? new Date().toISOString() : null,
      creado_en: new Date().toISOString(),
      observaciones: (observaciones || '').trim()
    };

    // Atomic persistence
    await store.create(ENTITIES.LOANS, newLoan);
    await store.batchCreate(ENTITIES.QUOTAS, quotasToInsert);

    // Audit logs
    if (existingCheck.hasActiveLoans) {
      await AuditService.log({
        usuario_id: currentUser.id,
        rol: currentUser.rol,
        accion: 'AUTORIZAR_SIMULTANEO',
        entidad: ENTITIES.LOANS,
        entidad_id: loanId,
        detalles: { cliente_id, autorizador: currentUser.nombre },
        ip
      });
    }

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'CREAR_PRESTAMO',
      entidad: ENTITIES.LOANS,
      entidad_id: loanId,
      detalles: {
        cliente_id,
        capital_inicial: figures.principal,
        total_prestamo: figures.totalAmount,
        cuotas: figures.numQuotas
      },
      ip
    });

    return {
      loan: newLoan,
      quotas: quotasToInsert
    };
  }

  static async getById(id, currentUser) {
    const store = await getStore();
    const loan = await store.findById(ENTITIES.LOANS, id);
    if (!loan) return null;

    if (currentUser && currentUser.rol === ROLES.COLLECTOR && String(loan.cobrador_id) !== String(currentUser.id)) {
      throw new Error('No tiene autorización para ver este préstamo');
    }

    const customer = await store.findById(ENTITIES.CUSTOMERS, loan.cliente_id);
    let quotas = await store.findAll(ENTITIES.QUOTAS, (q) => q.prestamo_id === loan.id);
    quotas.sort((a, b) => a.numero_cuota - b.numero_cuota);

    // Evaluate current mora on quotas
    const configList = await store.findAll(ENTITIES.CONFIG);
    const config = Object.fromEntries(configList.map((c) => [c.clave, c.valor]));
    quotas = MoraEngine.evaluateQuotasMora(quotas, config, getTodayStr());

    const payments = await store.findAll(ENTITIES.PAYMENTS, (p) => p.prestamo_id === loan.id);

    return {
      loan,
      customer,
      quotas,
      payments: payments.reverse()
    };
  }

  static async getAll(filters = {}, currentUser) {
    const store = await getStore();
    let loans = await store.findAll(ENTITIES.LOANS);

    if (currentUser && currentUser.rol === ROLES.COLLECTOR) {
      loans = loans.filter((l) => String(l.cobrador_id) === String(currentUser.id));
    } else if (filters.cobrador_id) {
      loans = loans.filter((l) => String(l.cobrador_id) === String(filters.cobrador_id));
    }

    if (filters.cliente_id) {
      loans = loans.filter((l) => String(l.cliente_id) === String(filters.cliente_id));
    }

    if (filters.zona_id) {
      loans = loans.filter((l) => String(l.zona_id) === String(filters.zona_id));
    }

    if (filters.estado) {
      loans = loans.filter((l) => l.estado === filters.estado);
    }

    return loans.reverse();
  }
}
