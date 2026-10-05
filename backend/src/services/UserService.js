import bcrypt from 'bcryptjs';
import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES, ROLES } from '../config/constants.js';
import { AuditService } from './AuditService.js';

export class UserService {
  static async getAll() {
    const store = await getStore();
    const users = await store.findAll(ENTITIES.USERS);
    return users.map(({ password_hash, ...u }) => u);
  }

  static async getById(id) {
    const store = await getStore();
    const user = await store.findById(ENTITIES.USERS, id);
    if (!user) return null;
    const { password_hash, ...safeUser } = user;
    return safeUser;
  }

  static async getCollectors() {
    const store = await getStore();
    const collectors = await store.findAll(ENTITIES.USERS, (u) => u.rol === ROLES.COLLECTOR && u.activo);
    return collectors.map(({ password_hash, ...u }) => u);
  }

  static async create(userData, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const { telefono, nombre_completo, rol, password } = userData;

    if (!telefono || !nombre_completo || !rol || !password) {
      throw new Error('Todos los campos son obligatorios (teléfono, nombre, rol, contraseña)');
    }

    // Check duplicate phone
    const existing = await store.findOne(ENTITIES.USERS, (u) => String(u.telefono).trim() === String(telefono).trim());
    if (existing) {
      throw new Error('Ya existe un usuario registrado con este número de teléfono');
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const id = await store.getNextId(ENTITIES.USERS, 'USR');

    const newUser = {
      id,
      telefono: String(telefono).trim(),
      nombre_completo: nombre_completo.trim(),
      rol,
      password_hash,
      activo: true,
      creado_en: new Date().toISOString(),
      ultimo_login: null
    };

    await store.create(ENTITIES.USERS, newUser);

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'CREAR_USUARIO',
      entidad: ENTITIES.USERS,
      entidad_id: id,
      detalles: { nombre_completo, telefono, rol },
      ip
    });

    const { password_hash: _, ...safeUser } = newUser;
    return safeUser;
  }

  static async update(id, updates, currentUser, ip = '127.0.0.1') {
    const store = await getStore();
    const user = await store.findById(ENTITIES.USERS, id);
    if (!user) throw new Error('Usuario no encontrado');

    const cleanUpdates = {};
    if (updates.nombre_completo) cleanUpdates.nombre_completo = updates.nombre_completo.trim();
    if (updates.telefono) {
      const existing = await store.findOne(
        ENTITIES.USERS,
        (u) => String(u.telefono).trim() === String(updates.telefono).trim() && u.id !== id
      );
      if (existing) throw new Error('El número de teléfono ya está en uso por otro usuario');
      cleanUpdates.telefono = String(updates.telefono).trim();
    }
    if (updates.rol) cleanUpdates.rol = updates.rol;
    if (updates.activo !== undefined) cleanUpdates.activo = Boolean(updates.activo);

    if (updates.password && updates.password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      cleanUpdates.password_hash = await bcrypt.hash(updates.password, salt);
    }

    const updated = await store.update(ENTITIES.USERS, id, cleanUpdates);

    await AuditService.log({
      usuario_id: currentUser.id,
      rol: currentUser.rol,
      accion: 'EDITAR_USUARIO',
      entidad: ENTITIES.USERS,
      entidad_id: id,
      detalles: { campos_modificados: Object.keys(cleanUpdates) },
      ip
    });

    const { password_hash, ...safeUser } = updated;
    return safeUser;
  }
}
