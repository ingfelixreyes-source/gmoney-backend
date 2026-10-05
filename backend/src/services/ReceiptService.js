import { getStore } from '../repositories/RepositoryFactory.js';
import { ENTITIES } from '../config/constants.js';

export class ReceiptService {
  static formatCurrency(amount) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(amount || 0);
  }

  static async getReceipt(id) {
    const store = await getStore();
    const receipt = await store.findById(ENTITIES.RECEIPTS, id);
    if (!receipt) throw new Error('Recibo no encontrado');

    const payment = await store.findById(ENTITIES.PAYMENTS, receipt.pago_id);
    const loan = await store.findById(ENTITIES.LOANS, receipt.prestamo_id);
    const customer = await store.findById(ENTITIES.CUSTOMERS, receipt.cliente_id);

    return {
      receipt,
      payment,
      loan,
      customer
    };
  }

  /**
   * Build WhatsApp share URL with prefilled text
   */
  static generateWhatsAppLink({
    phone,
    customerName,
    receiptNumber,
    amount,
    dateStr,
    method,
    remainingBalance,
    remainingQuotas
  }) {
    // Sanitize Colombian phone number (prepend 57 if not present)
    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length === 10 && cleanPhone.startsWith('3')) {
      cleanPhone = `57${cleanPhone}`;
    }

    const message =
      `*GMONEY — COMPROBANTE DE PAGO*\n\n` +
      `Hola *${customerName}*, confirmamos el registro de tu pago exitoso:\n\n` +
      `📄 *Recibo:* ${receiptNumber}\n` +
      `📅 *Fecha:* ${dateStr}\n` +
      `💵 *Valor Recibido:* ${this.formatCurrency(amount)}\n` +
      `💳 *Método de Pago:* ${method}\n` +
      `📉 *Saldo Restante:* ${this.formatCurrency(remainingBalance)}\n` +
      `🔢 *Cuotas Restantes:* ${remainingQuotas}\n\n` +
      `_¡Gracias por tu confianza y cumplimiento en GMONEY!_`;

    const encoded = encodeURIComponent(message);
    return `https://wa.me/${cleanPhone}?text=${encoded}`;
  }

  /**
   * Build payment reminder WhatsApp URL
   */
  static generateReminderLink({ phone, customerName, quotaAmount, dueDate, moraAmount = 0 }) {
    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length === 10 && cleanPhone.startsWith('3')) {
      cleanPhone = `57${cleanPhone}`;
    }

    let message =
      `*GMONEY — RECORDATORIO DE PAGO*\n\n` +
      `Hola *${customerName}*, te recordamos cordialmente que tienes una cuota programada:\n\n` +
      `📅 *Fecha de Vencimiento:* ${dueDate}\n` +
      `💵 *Valor de la Cuota:* ${this.formatCurrency(quotaAmount)}\n`;

    if (moraAmount > 0) {
      message += `⚠️ *Mora Acumulada:* ${this.formatCurrency(moraAmount)}\n`;
      message += `💰 *Total a Cancelar:* ${this.formatCurrency(quotaAmount + moraAmount)}\n`;
    }

    message += `\n_Agradecemos tener listo el valor para la visita de nuestro cobrador._`;

    const encoded = encodeURIComponent(message);
    return `https://wa.me/${cleanPhone}?text=${encoded}`;
  }
}
