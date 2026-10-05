import { ENV } from '../config/env.js';
import { InMemoryDataStore } from './InMemoryDataStore.js';
import { GoogleSheetsDataStore } from './GoogleSheetsDataStore.js';

let instance = null;

export async function getStore() {
  if (instance) return instance;

  if (ENV.DB_DRIVER === 'sheets' && ENV.GOOGLE_SHEET_ID && ENV.GOOGLE_PRIVATE_KEY) {
    console.log('Initializing GoogleSheetsDataStore provider...');
    instance = new GoogleSheetsDataStore();
    await instance.init();
  } else {
    console.log('Initializing InMemoryDataStore provider (persisting to data/database.json)...');
    instance = new InMemoryDataStore();
    await instance.init();
  }

  return instance;
}
