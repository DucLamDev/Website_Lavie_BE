import express from 'express';
import {
  getSalesReport,
  getInventoryReport,
  getDebtReport,
  getCustomerDebtReport,
  getSupplierDebtReport,
  getDashboardStats,
} from '../controllers/reportController.js';
import {
  getDailyRevenue,
  getMonthlyRevenue,
  getBestSellingProducts,
} from '../controllers/invoiceController.js';
import {
  generateInvoicePdf,
  exportInventoryReport,
  exportRevenueReport,
  exportCustomerDebtReport,
  exportSupplierDebtReport,
} from '../controllers/reportPdfController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

router.route('/sales')
  .get(protect, admin, getSalesReport);

router.route('/inventory')
  .get(protect, admin, getInventoryReport);

router.route('/debt')
  .get(protect, admin, getDebtReport);

router.route('/customer-debt')
  .get(protect, admin, getCustomerDebtReport);

router.route('/supplier-debt')
  .get(protect, admin, getSupplierDebtReport);

router.route('/dashboard')
  .get(protect, getDashboardStats);

// New routes for revenue statistics
router.route('/revenue/daily')
  .get(protect, admin, getDailyRevenue);

router.route('/revenue/monthly')
  .get(protect, admin, getMonthlyRevenue);

// Best selling products report
router.route('/products/best-selling')
  .get(protect, admin, getBestSellingProducts);

// PDF generation routes
router.route('/invoice/:orderId')
  .get(protect, admin, generateInvoicePdf);

router.route('/inventory/export')
  .get(protect, admin, exportInventoryReport);

router.route('/revenue/export')
  .get(protect, admin, exportRevenueReport);

router.route('/customer-debt/export')
  .get(protect, admin, exportCustomerDebtReport);

router.route('/supplier-debt/export')
  .get(protect, admin, exportSupplierDebtReport);

export default router;