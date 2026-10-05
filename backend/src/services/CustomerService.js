import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES, ROLES, LOAN_STATUS, QUOTA_STATUS } from '../config/constants.js';
import { AuditService } from './AuditService.js';
import { getTodayStr } from '../domain/DateUtils.js';

export class CustomerService {
  static async getAll({ search = '', zona_id = '', cobrador_id = '', estado = '', page = 1, limit = 50 }, currentUser) {
    const store = await getStore();
    let customers = await store.findAll(ENTITIES.CUSTOMERS);

    // If current user is a collector, enforce route restriction
    if (currentUser && currentUser.rol === ROLES.COLLECTOR) {
      customers = customers.filter((c) => String(c.cobrador_id) === String(currentUser.id));
    } else if (cobrador_id) {
      customers = customers.filter((c) => String(c.cobrador_id) === String(cobrador_id));
    }

    if (zona_id) {
      customers = customers.filter((c) => String(c.zona_id) === String(zona_id));
    }

    if (estado) {
      customers = customers.filter((c) => c.estado === estado);
    }

    if (search) {
      const q = search.toLowerCase().trim();
      customers = customers.filter(
        (c) =>
          (c.nombre_completo && c.nombre_completo.toLowerCase().includes(q)) ||
          (c.cedula && c.cedula.includes(q)) ||
          (c.telefono && c.telefono.includes(q))
      );
    }

    const total = customers.length;
    const startIndex = (page - 1) * limit;
    const paginated = customers.slice(startIndex, startIndex + limit);

    return {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
      data: paginated
    };
  }

  static async getById(id, currentUser) {
    const store = await getStore();
    const customer = await store.findById(ENTITIES.CUSTOMERS, id);
    if (!customer) return null;

    if (currentUser && currentUser.rol === ROLES.COLLECTOR && String(customer.cobrador_id) !== String(currentUser.id)) {
      throw new Error('No tiene autorización para acceder a este cliente');
    }

    return customer;
  }

  static async getProfile(id, currentUser) {
    const customer = await this.getById(id, currentUser);
    if (!customer) throw new Error('Cliente no encontrado');

    const store = await getStore();
    // Fetch all loans for this customer
    const loans = await store.findAll(ENTITIES.LOANS, (l) => String(l.cliente_id) === String(id));
    const loanIds = new Set(loans.map((l) => l.id));

    // Fetch quotas for these loans
    const quotas = await store.findAll(ENTITIES.QUOTAS, (q) => loanIds.has(q.prestamo_id));
    
    // Fetch payments for these loans
    const payments = await store.findAll(ENTITIES.PAYMENTS, (p) => loanIds.has(p.prestamo_id));

    const activeLoans = loans.filter((l) => l.estado === LOAN_STATUS.ACTIVE || l.estado === LOAN_STATUS.IN_MORA);
    const completedLoans = loans.filter((l) => l.estado === LOAN_STATUS.PAID || l.estado === LOAN_STATUS.CANCELLED);

    // Calculate total pending balance across active loans
    const totalPendingBalance = quotas
      .filter((q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED)
      .reduce((sum, q) => sum + (Number(q.saldo_pendiente) || 0), 0);

    const totalMoraPending = quotas.reduce((sum, q) => sum + (Number(q.mora_pendiente) || 0), 0);

    // Find next upcoming quota
    const today = getTodayStr();
    const pendingQuotas = quotas
      .filter((q) => q.estado !== QUOTA_STATUS.PAID && q.estado !== QUOTA_STATUS.CANCELLED)
      .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));

    const nextQuota = pendingQuotas[0] || null;
    const hasOverdue = pendingQuotas.some((q) => q.fecha_vencimiento < today || q.estado === QUOTA_STATUS.OVERDUE);

    return {
      customer,
      summary: {
        activeLoansCount: activeLoans.length,
        completedLoansCount: completedLoans.length,
        totalPendingBalance,
        totalMoraPending,
        creditBalance: customer.saldo_credito || 0,
        nextQuota,
        hasOverdue,
        portfolioStatus: hasOverdue ? 'En mora' : activeLoans.length > 0 ? 'Al día' : 'Sin deuda'
      },
      activeLoans,
      completedLoans,
      pendingQuotas,
      recentPayments: payments.slice(-10).reverse()
    };
  }

  static async create(customerData, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const { cedula, nombre_completo, telefono, direccion, barrio, zona_id, cobrador_id, foto_url, observaciones } = customerData;

    if (!cedula || !nombre_completo || !telefono) {
      throw new Error('Cédula, nombre completo y teléfono son campos obligatorios');
    }

    // Check duplicate cédula
    const existing = await store.findOne(ENTITIES.CUSTOMERS, (c) => String(c.cedula).trim() === String(cedula).trim());
    if (existing) {
      throw new Error(`Ya existe un cliente registrado con la cédula ${cedula} (${existing.nombre_completo})`);
    }

    const id = await store.getNextId(ENTITIES.CUSTOMERS, 'CLI');
    const newCustomer = {
      id,
      cedula: String(cedula).trim(),
      nombre_completo: nombre_completo.trim(),
      telefono: String(telefono).trim(),
      foto_url: foto_url || '',
      direccion: (direccion || '').trim(),
      barrio: (barrio || '').trim(),
      zona_id: zona_id || '',
      cobrador_id: cobrador_id || (currentUser.rol === ROLES.COLLECTOR ? currentUser.id : ''),
      saldo_credito: 0,
      estado: 'Activo',
      fecha_registro: getTodayStr(),
      observaciones: (observaciones || '').trim()
    };

    await store.create(ENTITIES.CUSTOMERS, newCustomer);

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'CREAR_CLIENTE',
      entidad: ENTITIES.CUSTOMERS,
      entidad_id: id,
      detalles: { cedula, nombre_completo, telefono },
      ip
    });

    return newCustomer;
  }

  static async update(id, updates, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const customer = await store.findById(ENTITIES.CUSTOMERS, id);
    if (!customer) throw new Error('Cliente no encontrado');

    if (currentUser.rol === ROLES.COLLECTOR && String(customer.cobrador_id) !== String(currentUser.id)) {
      throw new Error('No tiene permisos para modificar clientes fuera de su cartera');
    }

    const cleanUpdates = {};
    if (updates.nombre_completo) cleanUpdates.nombre_completo = updates.nombre_completo.trim();
    if (updates.telefono) cleanUpdates.telefono = String(updates.telefono).trim();
    if (updates.direccion !== undefined) cleanUpdates.direccion = updates.direccion.trim();
    if (updates.barrio !== undefined) cleanUpdates.barrio = updates.barrio.trim();
    if (updates.foto_url !== undefined) cleanUpdates.foto_url = updates.foto_url;
    if (updates.zona_id !== undefined) cleanUpdates.zona_id = updates.zona_id;
    if (updates.cobrador_id !== undefined && currentUser.rol === ROLES.ADMIN) {
      cleanUpdates.cobrador_id = updates.cobrador_id;
    }
    if (updates.estado !== undefined && currentUser.rol === ROLES.ADMIN) {
      cleanUpdates.estado = updates.estado;
    }
    if (updates.observaciones !== undefined) cleanUpdates.observaciones = updates.observaciones.trim();

    const updated = await store.update(ENTITIES.CUSTOMERS, id, cleanUpdates);

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'EDITAR_CLIENTE',
      entidad: ENTITIES.CUSTOMERS,
      entidad_id: id,
      detalles: cleanUpdates,
      ip
    });

    return updated;
  }
}
