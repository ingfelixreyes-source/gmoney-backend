import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES } from '../config/constants.js';

export class AuditService {
  static async log({
    usuario_id = 'SISTEMA',
    rol = 'SISTEMA',
    accion,
    entidad,
    entidad_id = '',
    detalles = {},
    ip = '127.0.0.1'
  }) {
    try {
      const store = await getStore();
      const id = await store.getNextId(ENTITIES.AUDIT, 'AUD');
      const now = new Date();

      const record = {
        id,
        fecha_hora: now.toISOString(),
        usuario_id,
        rol,
        accion,
        entidad,
        entidad_id: String(entidad_id || ''),
        detalles: typeof detalles === 'object' ? JSON.stringify(detalles) : String(detalles),
        ip
      };

      await store.create(ENTITIES.AUDIT, record);
      return record;
    } catch (err) {
      console.error('Failed to write audit log:', err.message);
    }
  }

  static async getLogs(filters = {}) {
    const store = await getStore();
    return store.findAll(ENTITIES.AUDIT, (log) => {
      if (filters.usuario_id && log.usuario_id !== filters.usuario_id) return false;
      if (filters.entidad && log.entidad !== filters.entidad) return false;
      if (filters.accion && log.accion !== filters.accion) return false;
      return true;
    });
  }
}
