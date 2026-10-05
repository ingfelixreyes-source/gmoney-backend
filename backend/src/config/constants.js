export const ROLES = {
  ADMIN: 'ADMINISTRADOR',
  COLLECTOR: 'COBRADOR'
};

export const LOAN_STATUS = {
  PENDING: 'Pendiente',
  ACTIVE: 'Activo',
  IN_MORA: 'En mora',
  PAID: 'Pagado',
  CANCELLED: 'Cancelado'
};

export const QUOTA_STATUS = {
  PENDING: 'Pendiente',
  PAID: 'Pagada',
  PARTIAL: 'Parcial',
  OVERDUE: 'Vencida',
  CANCELLED: 'Cancelada'
};

export const PAYMENT_METHODS = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia bancaria',
  NEQUI: 'Nequi',
  DAVIPLATA: 'Daviplata',
  BANCOLOMBIA: 'Bancolombia'
};

export const FREQUENCIES = {
  DAILY: 'Diario',
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quincenal',
  MONTHLY: 'Mensual'
};

export const MORA_TYPES = {
  NONE: 'SIN_MORA',
  FIXED_DAILY: 'FIJO_DIARIO',
  PERCENT_DAILY: 'PORCENTAJE_DIARIO'
};

export const FIRST_PAYMENT_RULES = {
  SAME_DAY: 'MISMO_DIA',
  NEXT_DAY: 'SIGUIENTE_DIA',
  CUSTOM_DATE: 'FECHA_SELECCIONADA'
};

export const EXCESS_DESTINATIONS = {
  FUTURE_QUOTAS: 'CUOTAS_FUTURAS',
  CREDIT_BALANCE: 'SALDO_A_FAVOR'
};

export const ENTITIES = {
  USERS: 'USUARIOS',
  CUSTOMERS: 'CLIENTES',
  ZONES: 'ZONAS',
  LOANS: 'PRESTAMOS',
  QUOTAS: 'CUOTAS',
  PAYMENTS: 'PAGOS',
  MORA: 'MORA',
  CONFIG: 'CONFIGURACION',
  AUDIT: 'AUDITORIA',
  RECEIPTS: 'RECIBOS'
};
