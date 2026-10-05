import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES } from '../config/constants.js';
import { ENV } from '../config/env.js';
import { AuditService } from './AuditService.js';

export class AuthService {
  static async login({ telefono, password, ip = '127.0.0.1' }) {
    if (!telefono || !password) {
      throw new Error('Número de teléfono y contraseña son requeridos');
    }

    const store = await getStore();
    const user = await store.findOne(ENTITIES.USERS, (u) => String(u.telefono).trim() === String(telefono).trim());

    if (!user) {
      throw new Error('Credenciales incorrectas o usuario no encontrado');
    }

    if (!user.activo) {
      throw new Error('El usuario se encuentra inactivo. Contacte al Administrador.');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      throw new Error('Credenciales incorrectas');
    }

    // Update last login
    const updatedUser = await store.update(ENTITIES.USERS, user.id, {
      ultimo_login: new Date().toISOString()
    });

    // Create JWT
    const token = jwt.sign(
      {
        id: user.id,
        nombre: user.nombre_completo,
        telefono: user.telefono,
        rol: user.rol
      },
      ENV.JWT_SECRET,
      { expiresIn: ENV.JWT_EXPIRES_IN }
    );

    // Audit log
    await AuditService.log({
      usuario_id: user.id,
      rol: user.rol,
      accion: 'LOGIN',
      entidad: ENTITIES.USERS,
      entidad_id: user.id,
      detalles: { mensaje: 'Inicio de sesión exitoso' },
      ip
    });

    const { password_hash, ...safeUser } = updatedUser;
    return { user: safeUser, token };
  }

  static async logout({ user, ip = '127.0.0.1' }) {
    if (user) {
      await AuditService.log({
        usuario_id: user.id,
        rol: user.rol,
        accion: 'LOGOUT',
        entidad: ENTITIES.USERS,
        entidad_id: user.id,
        detalles: { mensaje: 'Cierre de sesión' },
        ip
      });
    }
    return { success: true };
  }
}
