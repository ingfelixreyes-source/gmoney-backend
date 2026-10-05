import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES } from '../config/constants.js';
import { AuditService } from './AuditService.js';

export class ZoneService {
  static async getAll() {
    const store = await getStore();
    return store.findAll(ENTITIES.ZONAS);
  }

  static async getById(id) {
    const store = await getStore();
    return store.findById(ENTITIES.ZONAS, id);
  }

  static async create(zoneData, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const { nombre, descripcion, cobrador_id } = zoneData;

    if (!nombre) throw new Error('El nombre de la zona es obligatorio');

    const id = await store.getNextId(ENTITIES.ZONAS, 'ZON');
    const newZone = {
      id,
      nombre: nombre.trim(),
      descripcion: (descripcion || '').trim(),
      cobrador_id: cobrador_id || '',
      estado: 'Activo',
      creado_en: new Date().toISOString()
    };

    await store.create(ENTITIES.ZONAS, newZone);

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'CREAR_ZONA',
      entidad: ENTITIES.ZONAS,
      entidad_id: id,
      detalles: { nombre, cobrador_id },
      ip
    });

    return newZone;
  }

  static async update(id, updates, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const zone = await store.findById(ENTITIES.ZONAS, id);
    if (!zone) throw new Error('Zona no encontrada');

    const cleanUpdates = {};
    if (updates.nombre) cleanUpdates.nombre = updates.nombre.trim();
    if (updates.descripcion !== undefined) cleanUpdates.descripcion = updates.descripcion.trim();
    if (updates.cobrador_id !== undefined) cleanUpdates.cobrador_id = updates.cobrador_id;
    if (updates.estado) cleanUpdates.estado = updates.estado;

    const updated = await store.update(ENTITIES.ZONAS, id, cleanUpdates);

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'EDITAR_ZONA',
      entidad: ENTITIES.ZONAS,
      entidad_id: id,
      detalles: cleanUpdates,
      ip
    });

    return updated;
  }
}
