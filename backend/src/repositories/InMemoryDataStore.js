import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { IDataStore } from './IDataStore.js';
import { ENTITIES, ROLES, MORA_TYPES, FIRST_PAYMENT_RULES } from '../config/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'database.json');

export class InMemoryDataStore extends IDataStore {
  constructor(filePath = null) {
    super();
    this.filePath = filePath || DEFAULT_DB_PATH;
    this.data = {
      [ENTITIES.USERS]: [],
      [ENTITIES.CUSTOMERS]: [],
      [ENTITIES.ZONES]: [],
      [ENTITIES.LOANS]: [],
      [ENTITIES.QUOTAS]: [],
      [ENTITIES.PAYMENTS]: [],
      [ENTITIES.MORA]: [],
      [ENTITIES.CONFIG]: [],
      [ENTITIES.AUDIT]: [],
      [ENTITIES.RECEIPTS]: []
    };
    this.counters = {};
  }

  async init() {
    // If file exists, load it
    if (fs.existsSync(this.filePath)) {
      try {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(content);
        this.data = { ...this.data, ...parsed.data };
        this.counters = parsed.counters || {};
        return;
      } catch (err) {
        console.warn('Could not read existing database.json, seeding new database:', err.message);
      }
    }

    // Seed initial data
    await this.seed();
    this.persist();
  }

  async seed() {
    const salt = await bcrypt.genSalt(10);
    const adminPasswordHash = await bcrypt.hash('admin123', salt);
    const collectorPasswordHash = await bcrypt.hash('cobrador123', salt);

    // Initial Users
    this.data[ENTITIES.USERS] = [
      {
        id: 'USR-00001',
        telefono: '3001234567',
        nombre_completo: 'Administrador General GMONEY',
        rol: ROLES.ADMIN,
        password_hash: adminPasswordHash,
        activo: true,
        creado_en: new Date().toISOString(),
        ultimo_login: null
      },
      {
        id: 'USR-00002',
        telefono: '3109876543',
        nombre_completo: 'Carlos Rutero Cobrador',
        rol: ROLES.COLLECTOR,
        password_hash: collectorPasswordHash,
        activo: true,
        creado_en: new Date().toISOString(),
        ultimo_login: null
      }
    ];

    // Initial Zones
    this.data[ENTITIES.ZONES] = [
      {
        id: 'ZON-00001',
        nombre: 'Zona 1 - Centro',
        descripcion: 'Sector comercial del centro',
        cobrador_id: 'USR-00002',
        estado: 'Activo',
        creado_en: new Date().toISOString()
      },
      {
        id: 'ZON-00002',
        nombre: 'Zona 2 - Norte',
        descripcion: 'Sector residencial y talleres',
        cobrador_id: 'USR-00002',
        estado: 'Activo',
        creado_en: new Date().toISOString()
      }
    ];

    // Initial Config
    this.data[ENTITIES.CONFIG] = [
      { clave: 'nombre_comercial', valor: 'GMONEY', descripcion: 'Nombre del sistema de préstamos' },
      { clave: 'pais', valor: 'Colombia', descripcion: 'País de operación' },
      { clave: 'moneda', valor: 'COP', descripcion: 'Moneda local' },
      { clave: 'telefono_contacto', valor: '3001234567', descripcion: 'Teléfono corporativo WhatsApp' },
      { clave: 'mora_tipo', valor: MORA_TYPES.FIXED_DAILY, descripcion: 'Tipo de cálculo de mora' },
      { clave: 'mora_valor_defecto', valor: '2000', descripcion: 'Valor por defecto de mora (COP o %)' },
      { clave: 'mora_dias_gracia', valor: '1', descripcion: 'Días de tolerancia antes de liquidar mora' },
      { clave: 'excluir_domingos', valor: 'true', descripcion: 'No programar cobros en domingos' },
      { clave: 'excluir_festivos_colombia', valor: 'true', descripcion: 'No programar cobros en festivos nacionales' },
      { clave: 'regla_primera_cuota', valor: FIRST_PAYMENT_RULES.NEXT_DAY, descripcion: 'Fecha de la primera cuota' }
    ];

    this.counters = {
      USR: 2,
      ZON: 2,
      CLI: 0,
      PRE: 0,
      CUO: 0,
      PAG: 0,
      REC: 0,
      AUD: 0
    };
  }

  persist() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ data: this.data, counters: this.counters }, null, 2),
        'utf-8'
      );
    } catch (err) {
      console.error('Error persisting database.json:', err);
    }
  }

  async getNextId(entityName, prefix) {
    if (!this.counters[prefix]) {
      this.counters[prefix] = 0;
    }
    this.counters[prefix]++;
    const id = `${prefix}-${String(this.counters[prefix]).padStart(5, '0')}`;
    this.persist();
    return id;
  }

  async findById(entityName, id) {
    const list = this.data[entityName] || [];
    const item = list.find((item) => String(item.id) === String(id));
    return item ? { ...item } : null;
  }

  async findOne(entityName, predicate) {
    const list = this.data[entityName] || [];
    const item = list.find(predicate);
    return item ? { ...item } : null;
  }

  async findAll(entityName, filterFn = null) {
    const list = this.data[entityName] || [];
    if (filterFn && typeof filterFn === 'function') {
      return list.filter(filterFn).map((x) => ({ ...x }));
    }
    return list.map((x) => ({ ...x }));
  }

  async create(entityName, record) {
    if (!this.data[entityName]) {
      this.data[entityName] = [];
    }
    const cloned = { ...record };
    this.data[entityName].push(cloned);
    this.persist();
    return { ...cloned };
  }

  async update(entityName, id, updates) {
    const list = this.data[entityName] || [];
    const index = list.findIndex((item) => String(item.id) === String(id));
    if (index === -1) return null;

    list[index] = { ...list[index], ...updates, actualizado_en: new Date().toISOString() };
    this.persist();
    return { ...list[index] };
  }

  async batchUpdate(entityName, updatesArray) {
    const list = this.data[entityName] || [];
    const results = [];

    for (const updateObj of updatesArray) {
      const index = list.findIndex((item) => String(item.id) === String(updateObj.id));
      if (index !== -1) {
        list[index] = { ...list[index], ...updateObj, actualizado_en: new Date().toISOString() };
        results.push({ ...list[index] });
      }
    }

    this.persist();
    return results;
  }

  async batchCreate(entityName, recordsArray) {
    if (!this.data[entityName]) {
      this.data[entityName] = [];
    }
    const created = recordsArray.map((r) => ({ ...r }));
    this.data[entityName].push(...created);
    this.persist();
    return created;
  }
}
