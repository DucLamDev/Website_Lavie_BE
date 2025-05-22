import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import Transaction from '../models/Transaction.js';
import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import PDFDocument from 'pdfkit';
import PDFTable from 'pdfkit-table';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to format date
export const formatDate = (date) => {
  return new Date(date).toISOString().split('T')[0];
};

// @desc    Get sales report
// @route   GET /api/reports/sales
// @access  Private/Admin
export const getSalesReport = async (req, res) => {
  try {
    // Get date parameters or default to current month
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1)); // First day of current month
    const end = endDate ? new Date(endDate) : new Date();
    
    // Set end date to end of day
    end.setHours(23, 59, 59, 999);

    // Get all orders within date range
    const orders = await Order.find({
      orderDate: { $gte: start, $lte: end },
      status: 'completed',
    });

    // Calculate total sales, total paid, total debt
    const totalSales = orders.reduce((acc, order) => acc + order.totalAmount, 0);
    const totalPaid = orders.reduce((acc, order) => acc + order.paidAmount, 0);
    const totalDebt = orders.reduce((acc, order) => acc + order.debtRemaining, 0);
    
    // Get order count
    const orderCount = orders.length;

    // Get daily sales data
    const dailySales = await Order.aggregate([
      {
        $match: {
          orderDate: { $gte: start, $lte: end },
          status: 'completed',
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderDate' } },
          sales: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          sales: 1,
          orders: 1,
        },
      },
    ]);

    // Get top products
    const topProducts = await OrderItem.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: '$productId',
          quantity: { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 0,
          productId: '$_id',
          productName: '$product.name',
          quantity: 1,
          revenue: 1,
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]);

    // Get top customers
    const topCustomers = await Order.aggregate([
      {
        $match: {
          orderDate: { $gte: start, $lte: end },
          status: 'completed',
        },
      },
      {
        $group: {
          _id: '$customerId',
          orders: { $sum: 1 },
          spend: { $sum: '$totalAmount' },
        },
      },
      {
        $lookup: {
          from: 'customers',
          localField: '_id',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: '$customer' },
      {
        $project: {
          _id: 0,
          customerId: '$_id',
          customerName: '$customer.name',
          orders: 1,
          spend: 1,
        },
      },
      { $sort: { spend: -1 } },
      { $limit: 5 },
    ]);

    res.json({
      totalSales,
      totalOrders: orderCount,
      averageOrderValue: orderCount > 0 ? totalSales / orderCount : 0,
      dailySales,
      topProducts,
      topCustomers,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get inventory report
// @route   GET /api/reports/inventory
// @access  Private/Admin
export const getInventoryReport = async (req, res) => {
  try {
    const products = await Product.find({});
    
    // Get low stock products (less than 10 items)
    const lowStockProducts = products.filter(product => product.stock < 10);
    
    // Get out of stock products
    const outOfStockProducts = products.filter(product => product.stock === 0);
    
    // Get total inventory value
    const totalInventoryValue = products.reduce((total, product) => {
      return total + (product.stock * product.price);
    }, 0);

    res.json({
      summary: {
        totalProducts: products.length,
        totalInventoryValue,
        lowStockCount: lowStockProducts.length,
        outOfStockCount: outOfStockProducts.length,
      },
      lowStockProducts,
      outOfStockProducts,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get debt report
// @route   GET /api/reports/debt
// @access  Private/Admin
export const getDebtReport = async (req, res) => {
  try {
    // Get all customers with debt
    const customersWithDebt = await Customer.find({ debt: { $gt: 0 } }).sort({ debt: -1 });
    
    // Get total debt
    const totalDebt = customersWithDebt.reduce((total, customer) => total + customer.debt, 0);
    
    // Get customers with empty bottle debt
    const customersWithEmptyDebt = await Customer.find({ empty_debt: { $gt: 0 } }).sort({ empty_debt: -1 });
    
    // Get total empty bottle debt
    const totalEmptyDebt = customersWithEmptyDebt.reduce((total, customer) => total + customer.empty_debt, 0);

    res.json({
      summary: {
        totalDebt,
        customersWithDebtCount: customersWithDebt.length,
        totalEmptyDebt,
        customersWithEmptyDebtCount: customersWithEmptyDebt.length,
      },
      customersWithDebt,
      customersWithEmptyDebt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get customer debt report
// @route   GET /api/reports/customer-debt
// @access  Private/Admin
export const getCustomerDebtReport = async (req, res) => {
  try {
    // Get date parameters or default to current month
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1)); // First day of current month
    const end = endDate ? new Date(endDate) : new Date();
    
    // Set end date to end of day
    end.setHours(23, 59, 59, 999);

    // Get all customers with debt
    const customersWithDebt = await Customer.find({ debt: { $gt: 0 } }).sort({ debt: -1 });
    
    // Get total debt
    const totalDebt = customersWithDebt.reduce((total, customer) => total + customer.debt, 0);
    
    // Get all orders with debt remaining within date range
    const pendingOrders = await Order.find({
      orderDate: { $gte: start, $lte: end },
      debtRemaining: { $gt: 0 }
    }).populate('customerId');

    // Get debt by time (daily aggregation within date range)
    const debtByTime = await Order.aggregate([
      {
        $match: {
          orderDate: { $gte: start, $lte: end },
          debtRemaining: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderDate' } },
          amount: { $sum: '$debtRemaining' }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          amount: 1
        }
      }
    ]);

    // Prepare customer debts with details
    const customerDebts = await Promise.all(customersWithDebt.map(async (customer) => {
      // Find last order date for this customer
      const lastOrder = await Order.findOne({ 
        customerId: customer._id 
      }).sort({ orderDate: -1 });

      // Count pending orders for this customer
      const pendingOrdersCount = await Order.countDocuments({ 
        customerId: customer._id,
        debtRemaining: { $gt: 0 }
      });

      return {
        customerId: customer._id,
        customerName: customer.name,
        customerPhone: customer.phone,
        totalDebt: totalDebt,
        lastOrderDate: lastOrder ? lastOrder.orderDate : null,
        pendingOrders: pendingOrdersCount
      };
    }));

    res.json({
      totalDebt,
      totalCustomers: customersWithDebt.length,
      pendingOrders: pendingOrders.length,
      customerDebts,
      debtByTime
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get supplier debt report
// @route   GET /api/reports/supplier-debt
// @access  Private/Admin
export const getSupplierDebtReport = async (req, res) => {
  try {
    // Get date parameters or default to current month
    const { startDate, endDate } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1)); // First day of current month
    const end = endDate ? new Date(endDate) : new Date();
    
    // Set end date to end of day
    end.setHours(23, 59, 59, 999);

    // Get all suppliers with debt
    const suppliersWithDebt = await Supplier.find({ debt: { $gt: 0 } }).sort({ debt: -1 });
    
    // Get total debt
    const totalDebt = suppliersWithDebt.reduce((total, supplier) => total + supplier.debt, 0);
    
    // Get all purchases with debt remaining within date range
    const pendingPayments = await Purchase.find({
      purchaseDate: { $gte: start, $lte: end },
      debtRemaining: { $gt: 0 }
    }).populate('supplierId');

    // Get debt by time (daily aggregation within date range)
    const debtByTime = await Purchase.aggregate([
      {
        $match: {
          purchaseDate: { $gte: start, $lte: end },
          debtRemaining: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$purchaseDate' } },
          amount: { $sum: '$debtRemaining' }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          amount: 1
        }
      }
    ]);

    // Prepare supplier debts with details
    const supplierDebts = await Promise.all(suppliersWithDebt.map(async (supplier) => {
      // Find last purchase date for this supplier
      const lastPurchase = await Purchase.findOne({ 
        supplierId: supplier._id 
      }).sort({ purchaseDate: -1 });

      // Count pending payments for this supplier
      const pendingPaymentsCount = await Purchase.countDocuments({ 
        supplierId: supplier._id,
        debtRemaining: { $gt: 0 }
      });

      return {
        supplierId: supplier._id,
        supplierName: supplier.name,
        supplierPhone: supplier.phone,
        totalDebt: supplier.debt,
        lastPurchaseDate: lastPurchase ? lastPurchase.purchaseDate : null,
        pendingPayments: pendingPaymentsCount
      };
    }));

    res.json({
      totalDebt,
      totalSuppliers: suppliersWithDebt.length,
      pendingPayments: pendingPayments.length,
      supplierDebts,
      debtByTime
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get dashboard stats
// @route   GET /api/reports/dashboard
// @access  Private
export const getDashboardStats = async (req, res) => {
  try {
    // Get today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get month start
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Get today's orders
    const todayOrders = await Order.find({
      orderDate: { $gte: today },
    });
    
    // Get month's orders
    const monthOrders = await Order.find({
      orderDate: { $gte: monthStart },
    });
    
    // Calculate total sales for today and month
    const todaySales = todayOrders.reduce((acc, order) => acc + order.totalAmount, 0);
    const monthSales = monthOrders.reduce((acc, order) => acc + order.totalAmount, 0);
    
    // Get customer count
    const customerCount = await Customer.countDocuments();
    
    // Get today's transactions
    const todayTransactions = await Transaction.find({
      date: { $gte: today },
    });
    
    // Calculate total payments received today
    const todayPayments = todayTransactions.reduce((acc, transaction) => acc + transaction.amount, 0);
    
    // Get low stock products (less than 10 items)
    const lowStockCount = await Product.countDocuments({ stock: { $lt: 10 } });
    
    // Get total debt
    const totalDebt = (await Customer.aggregate([{ $group: { _id: null, total: { $sum: '$debt' } } }]))[0]?.total || 0;

    res.json({
      sales: {
        today: todaySales,
        month: monthSales,
        todayOrderCount: todayOrders.length,
        monthOrderCount: monthOrders.length,
      },
      customers: {
        total: customerCount,
      },
      payments: {
        today: todayPayments,
      },
      inventory: {
        lowStockCount,
      },
      debt: {
        total: totalDebt,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 