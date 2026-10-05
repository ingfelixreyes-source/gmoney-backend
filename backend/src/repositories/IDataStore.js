/**
 * Abstract Data Store Interface
 * Guarantees decoupling between Business Logic and Storage Engine (Google Sheets / PostgreSQL / SQLite)
 */
export class IDataStore {
  async init() {
    throw new Error('Method not implemented: init');
  }

  async findById(entityName, id) {
    throw new Error('Method not implemented: findById');
  }

  async findOne(entityName, predicate) {
    throw new Error('Method not implemented: findOne');
  }

  async findAll(entityName, filterFn = null) {
    throw new Error('Method not implemented: findAll');
  }

  async create(entityName, record) {
    throw new Error('Method not implemented: create');
  }

  async update(entityName, id, updates) {
    throw new Error('Method not implemented: update');
  }

  async batchUpdate(entityName, updatesArray) {
    throw new Error('Method not implemented: batchUpdate');
  }

  async batchCreate(entityName, recordsArray) {
    throw new Error('Method not implemented: batchCreate');
  }

  async getNextId(entityName, prefix) {
    throw new Error('Method not implemented: getNextId');
  }
}
