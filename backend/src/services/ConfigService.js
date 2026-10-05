import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES } from '../config/constants.js';
import { AuditService } from './AuditService.js';

export class ConfigService {
  static async getAll() {
    const store = await getStore();
    const list = await store.findAll(ENTITIES.CONFIG);
    return Object.fromEntries(list.map((c) => [c.clave, c.valor]));
  }

  static async updateBatch(configsObj, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const existing = await store.findAll(ENTITIES.CONFIG);
    const existingKeys = new Set(existing.map((c) => c.clave));

    for (const [clave, valor] of Object.entries(configsObj)) {
      if (existingKeys.has(clave)) {
        await store.update(ENTITIES.CONFIG, clave, { valor: String(valor) });
      } else {
        await store.create(ENTITIES.CONFIG, { clave, valor: String(valor), descripcion: '' });
      }
    }

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'CONFIG_CAMBIO',
      entidad: ENTITIES.CONFIG,
      entidad_id: 'GENERAL',
      detalles: configsObj,
      ip
    });

    return this.getAll();
  }
}
