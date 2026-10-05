import express from 'express';
import { authenticate, requireRole } from '../middlewares/authMiddleware.js';
import { ROLES } from '../config/constants.js';

import { AuthService } from '../services/AuthService.js';
import { UserService } from '../services/UserService.js';
import { ZoneService } from '../services/ZoneService.js';
import { CustomerService } from '../services/CustomerService.js';
import { LoanService } from '../services/LoanService.js';
import { PaymentService } from '../services/PaymentService.js';
import { ReceiptService } from '../services/ReceiptService.js';
import { ReportService } from '../services/ReportService.js';
import { ConfigService } from '../services/ConfigService.js';
import { AuditService } from '../services/AuditService.js';

const router = express.Router();

// Helper to catch async controller errors
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ==================== AUTH ====================
router.post('/auth/login', asyncHandler(async (req, res) => {
  const { telefono, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const result = await AuthService.login({ telefono, password, ip });
  res.json(result);
}));

router.post('/auth/logout', authenticate, asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const result = await AuthService.logout({ user: req.user, ip });
  res.json(result);
}));

router.get('/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ==================== USERS ====================
router.get('/users', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const users = await UserService.getAll();
  res.json(users);
}));

router.get('/users/collectors', authenticate, asyncHandler(async (req, res) => {
  const collectors = await UserService.getCollectors();
  res.json(collectors);
}));

router.post('/users', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const user = await UserService.create(req.body, req.user, ip);
  res.status(201).json(user);
}));

router.put('/users/:id', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const user = await UserService.update(req.params.id, req.body, req.user, ip);
  res.json(user);
}));

// ==================== ZONES ====================
router.get('/zones', authenticate, asyncHandler(async (req, res) => {
  const zones = await ZoneService.getAll();
  res.json(zones);
}));

router.post('/zones', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const zone = await ZoneService.create(req.body, req.user, ip);
  res.status(201).json(zone);
}));

router.put('/zones/:id', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const zone = await ZoneService.update(req.params.id, req.body, req.user, ip);
  res.json(zone);
}));

// ==================== CUSTOMERS ====================
router.get('/customers', authenticate, asyncHandler(async (req, res) => {
  const result = await CustomerService.getAll(req.query, req.user);
  res.json(result);
}));

router.get('/customers/:id', authenticate, asyncHandler(async (req, res) => {
  const customer = await CustomerService.getById(req.params.id, req.user);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(customer);
}));

router.get('/customers/:id/profile', authenticate, asyncHandler(async (req, res) => {
  const profile = await CustomerService.getProfile(req.params.id, req.user);
  res.json(profile);
}));

router.post('/customers', authenticate, asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const customer = await CustomerService.create(req.body, req.user, ip);
  res.status(201).json(customer);
}));

router.put('/customers/:id', authenticate, asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const customer = await CustomerService.update(req.params.id, req.body, req.user, ip);
  res.json(customer);
}));

// ==================== LOANS ====================
router.get('/loans', authenticate, asyncHandler(async (req, res) => {
  const loans = await LoanService.getAll(req.query, req.user);
  res.json(loans);
}));

router.get('/loans/:id', authenticate, asyncHandler(async (req, res) => {
  const loanData = await LoanService.getById(req.params.id, req.user);
  if (!loanData) return res.status(404).json({ error: 'Préstamo no encontrado' });
  res.json(loanData);
}));

router.post('/loans/simulate', authenticate, asyncHandler(async (req, res) => {
  const simulation = await LoanService.simulate(req.body);
  res.json(simulation);
}));

router.post('/loans', authenticate, asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const result = await LoanService.create(req.body, req.user, ip);
  if (result.requiresSimultaneousAuthorization) {
    return res.status(409).json(result);
  }
  res.status(201).json(result);
}));

// ==================== PAYMENTS ====================
router.post('/payments/preview', authenticate, asyncHandler(async (req, res) => {
  const preview = await PaymentService.previewPayment(req.body);
  res.json(preview);
}));

router.post('/payments', authenticate, asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const result = await PaymentService.registerPayment(req.body, req.user, ip);
  res.status(201).json(result);
}));

router.post('/payments/:id/reverse', authenticate, asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const result = await PaymentService.reversePayment(
    { pago_id: req.params.id, motivo: req.body.motivo },
    req.user,
    ip
  );
  res.json(result);
}));

// ==================== RECEIPTS & WHATSAPP ====================
router.get('/receipts/:id', authenticate, asyncHandler(async (req, res) => {
  const receiptData = await ReceiptService.getReceipt(req.params.id);
  res.json(receiptData);
}));

router.post('/receipts/whatsapp-link', authenticate, (req, res) => {
  const link = ReceiptService.generateWhatsAppLink(req.body);
  res.json({ url: link });
});

router.post('/receipts/reminder-link', authenticate, (req, res) => {
  const link = ReceiptService.generateReminderLink(req.body);
  res.json({ url: link });
});

// ==================== REPORTS & DASHBOARDS ====================
router.get('/reports/admin-dashboard', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const dashboard = await ReportService.getAdminDashboard();
  res.json(dashboard);
}));

router.get('/reports/collector-dashboard', authenticate, asyncHandler(async (req, res) => {
  const collectorId = req.user.rol === ROLES.COLLECTOR ? req.user.id : (req.query.cobrador_id || req.user.id);
  const dashboard = await ReportService.getCollectorDashboard(collectorId);
  res.json(dashboard);
}));

router.get('/reports/export-excel', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const type = req.query.tipo || 'prestamos';
  const buffer = await ReportService.exportToExcel(type, req.query);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="gmoney_${type}_${Date.now()}.xlsx"`);
  res.send(buffer);
}));

// ==================== CONFIGURATION ====================
router.get('/config', authenticate, asyncHandler(async (req, res) => {
  const config = await ConfigService.getAll();
  res.json(config);
}));

router.put('/config', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const config = await ConfigService.updateBatch(req.body, req.user, ip);
  res.json(config);
}));

// ==================== AUDIT ====================
router.get('/audit', authenticate, requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const logs = await AuditService.getLogs(req.query);
  res.json(logs.reverse());
}));

export default router;
