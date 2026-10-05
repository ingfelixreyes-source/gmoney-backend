import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ENV } from './config/env.js';
import { getStore } from './repositories/RepositoryFactory.js';
import apiRoutes from './routes/api.js';
import { errorHandler } from './middlewares/errorHandler.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, '..', '..', 'frontend');

const app = express();

// Security Middlewares with relaxed CSP for CDN assets
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false
}));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body Parsers with 10MB limit for compressed customer photos
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve Frontend Static Files
app.use(express.static(frontendPath));

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'GMONEY Backend API',
    version: '1.0.0',
    mode: ENV.NODE_ENV,
    dbDriver: ENV.DB_DRIVER,
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/v1', apiRoutes);

// SPA Routing Fallback (for client-side routing, Express 5 compatible)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error Handler
app.use(errorHandler);

// Server startup
async function startServer() {
  try {
    const store = await getStore();
    console.log('DataStore ready. Driver:', ENV.DB_DRIVER);

    const port = ENV.PORT;
    const server = app.listen(port, () => {
      console.log(`===============================================`);
      console.log(` GMONEY API Server listening on port ${port}`);
      console.log(` Health check: http://localhost:${port}/health`);
      console.log(` Mode: ${ENV.NODE_ENV} | Driver: ${ENV.DB_DRIVER}`);
      console.log(`===============================================`);
    });

    return server;
  } catch (err) {
    console.error('Fatal error starting GMONEY server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, startServer };
