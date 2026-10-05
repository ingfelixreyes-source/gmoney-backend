import { google } from 'googleapis';
import { IDataStore } from './IDataStore.js';
import { ENV } from '../config/env.js';

export class GoogleSheetsDataStore extends IDataStore {
  constructor() {
    super();
    this.sheetId = ENV.GOOGLE_SHEET_ID;
    this.sheets = null;
    this.auth = null;
    this.lock = Promise.resolve(); // Simple mutex lock for sequential atomic operations
    this.headersMap = new Map();
  }

  async acquireLock() {
    let release;
    const nextLock = new Promise((resolve) => {
      release = resolve;
    });
    const currentLock = this.lock;
    this.lock = currentLock.then(() => nextLock);
    await currentLock;
    return release;
  }

  async init() {
    if (!this.sheetId || !ENV.GOOGLE_SERVICE_ACCOUNT_EMAIL || !ENV.GOOGLE_PRIVATE_KEY) {
      console.warn('Google Sheets credentials not fully provided in .env. Operating in hybrid/standby mode.');
      return;
    }

    try {
      this.auth = new google.auth.JWT({
        email: ENV.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: ENV.GOOGLE_PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      console.log('Connected successfully to Google Sheets API v4 (ID:', this.sheetId, ')');
    } catch (err) {
      console.error('Failed to authenticate with Google Sheets API:', err.message);
    }
  }

  async getHeaders(entityName) {
    if (this.headersMap.has(entityName)) {
      return this.headersMap.get(entityName);
    }
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `${entityName}!1:1`
    });
    const headers = (res.data.values && res.data.values[0]) || [];
    this.headersMap.set(entityName, headers);
    return headers;
  }

  async findAll(entityName, filterFn = null) {
    if (!this.sheets) throw new Error('Google Sheets client not initialized');
    const headers = await this.getHeaders(entityName);
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: `${entityName}!A2:ZZ`
    });

    const rows = res.data.values || [];
    const list = rows.map((row, idx) => {
      const obj = { _rowNumber: idx + 2 };
      headers.forEach((h, colIdx) => {
        let val = row[colIdx];
        // Parse JSON or booleans if applicable
        if (val === 'TRUE') val = true;
        else if (val === 'FALSE') val = false;
        else if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
          try {
            val = JSON.parse(val);
          } catch (_) {}
        }
        obj[h] = val;
      });
      return obj;
    });

    if (filterFn && typeof filterFn === 'function') {
      return list.filter(filterFn);
    }
    return list;
  }

  async findById(entityName, id) {
    const list = await this.findAll(entityName);
    return list.find((item) => String(item.id) === String(id)) || null;
  }

  async findOne(entityName, predicate) {
    const list = await this.findAll(entityName);
    return list.find(predicate) || null;
  }

  async create(entityName, record) {
    const unlock = await this.acquireLock();
    try {
      const headers = await this.getHeaders(entityName);
      const row = headers.map((h) => {
        const val = record[h];
        if (typeof val === 'object' && val !== null) {
          return JSON.stringify(val);
        }
        return val !== undefined && val !== null ? String(val) : '';
      });

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetId,
        range: `${entityName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] }
      });

      return { ...record };
    } finally {
      unlock();
    }
  }

  async update(entityName, id, updates) {
    const unlock = await this.acquireLock();
    try {
      const list = await this.findAll(entityName);
      const item = list.find((x) => String(x.id) === String(id));
      if (!item) return null;

      const headers = await this.getHeaders(entityName);
      const merged = { ...item, ...updates, actualizado_en: new Date().toISOString() };
      const row = headers.map((h) => {
        const val = merged[h];
        if (typeof val === 'object' && val !== null) {
          return JSON.stringify(val);
        }
        return val !== undefined && val !== null ? String(val) : '';
      });

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `${entityName}!A${item._rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] }
      });

      return merged;
    } finally {
      unlock();
    }
  }

  async batchCreate(entityName, recordsArray) {
    const unlock = await this.acquireLock();
    try {
      const headers = await this.getHeaders(entityName);
      const rows = recordsArray.map((rec) =>
        headers.map((h) => {
          const val = rec[h];
          if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val);
          }
          return val !== undefined && val !== null ? String(val) : '';
        })
      );

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetId,
        range: `${entityName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      });

      return recordsArray;
    } finally {
      unlock();
    }
  }

  async batchUpdate(entityName, updatesArray) {
    const unlock = await this.acquireLock();
    try {
      const list = await this.findAll(entityName);
      const headers = await this.getHeaders(entityName);
      const dataUpdates = [];

      for (const upd of updatesArray) {
        const item = list.find((x) => String(x.id) === String(upd.id));
        if (item) {
          const merged = { ...item, ...upd, actualizado_en: new Date().toISOString() };
          const row = headers.map((h) => {
            const val = merged[h];
            if (typeof val === 'object' && val !== null) {
              return JSON.stringify(val);
            }
            return val !== undefined && val !== null ? String(val) : '';
          });

          dataUpdates.push({
            range: `${entityName}!A${item._rowNumber}`,
            values: [row]
          });
        }
      }

      if (dataUpdates.length > 0) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.sheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: dataUpdates
          }
        });
      }

      return updatesArray;
    } finally {
      unlock();
    }
  }

  async getNextId(entityName, prefix) {
    const list = await this.findAll(entityName);
    let max = 0;
    list.forEach((item) => {
      if (item.id && typeof item.id === 'string' && item.id.startsWith(prefix)) {
        const numPart = parseInt(item.id.split('-')[1], 10);
        if (!isNaN(numPart) && numPart > max) max = numPart;
      }
    });
    return `${prefix}-${String(max + 1).padStart(5, '0')}`;
  }
}
