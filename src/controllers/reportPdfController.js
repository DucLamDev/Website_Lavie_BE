import pdfkit from 'pdfkit';
import PdfTable from 'pdfkit-table';
import path from 'path';
import { fileURLToPath } from 'url';
import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import { reporter } from '../config/jsreport.js';
import { registerHelpers } from '../utils/templateHelpers.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fontPath = path.join(__dirname, '../assets/fonts');

// @desc    Generate PDF invoice for an order
// @route   GET /api/reports/invoice/:orderId
// @access  Private/Admin
export const generateInvoicePdf = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    // Get order items
    const orderItems = await OrderItem.find({ order: orderId })
      .populate('product');
    
    const templateData = {
      order: {
        ...order.toObject(),
        items: orderItems.map(item => ({
          productName: item.product.name,
          unit: item.product.unit,
          quantity: item.quantity,
          price: item.price,
          subTotal: item.quantity * item.price
        }))
      },
      fontPath,
      currentDate: new Date().toLocaleDateString('vi-VN'),
      pageNumber: '{#pageNum}'
    };
    
    // Read the template file directly
    const templatePath = path.join(__dirname, '../templates/invoiceReport.html');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    
    const result = await reporter.render({
      template: {
        content: templateContent,
        engine: 'handlebars',
        recipe: 'chrome-pdf',
        chrome: {
          displayHeaderFooter: true,
          marginTop: '1cm',
          marginBottom: '1cm'
        },
        helpers: registerHelpers()
      },
      data: templateData
    });
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${orderId}.pdf"`,
      'Content-Length': result.content.length
    });
    
    res.send(result.content);
  } catch (error) {
    console.error('Error generating invoice PDF:', error);
    res.status(500).json({ message: 'Error generating invoice PDF', error: error.message });
  }
};

// @desc    Generate inventory report PDF
// @route   GET /api/reports/inventory/export
// @access  Private/Admin
export const exportInventoryReport = async (req, res) => {
  try {
    // Fetch inventory data
    const totalProducts = await Product.countDocuments();
    
    // Get low stock products
    const lowStockProducts = await Product.find({
      $and: [
        { inStock: { $gt: 0 } },
        { inStock: { $lte: '$reorderLevel' } }
      ]
    }).sort({ inStock: 1 });
    
    // Get out of stock products
    const outOfStockProducts = await Product.find({ inStock: 0 }).sort({ name: 1 });
    
    // Get most stocked products
    const mostStockedProducts = await Product.find({ inStock: { $gt: 0 } })
      .sort({ inStock: -1 })
      .limit(10);
    
    // Calculate total inventory value
    const allProducts = await Product.find({ inStock: { $gt: 0 } });
    const totalInventoryValue = allProducts.reduce((sum, product) => {
      return sum + (product.inStock * product.price);
    }, 0);
    
    // Count returnable pending
    const returnablePending = 0; // Replace with actual logic if needed
    
    const report = {
      summary: {
        totalProducts,
        totalInventoryValue,
        lowStockCount: lowStockProducts.length,
        outOfStockCount: outOfStockProducts.length,
        returnablePending
      },
      lowStockProducts,
      outOfStockProducts,
      mostStockedProducts
    };
    
    const templateData = {
      report,
      fontPath,
      currentDate: new Date().toLocaleDateString('vi-VN'),
      pageNumber: '{#pageNum}'
    };
    
    // Read the template file directly
    const templatePath = path.join(__dirname, '../templates/inventoryReport.html');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    
    const result = await reporter.render({
      template: {
        content: templateContent,
        engine: 'handlebars',
        recipe: 'chrome-pdf',
        chrome: {
          displayHeaderFooter: true,
          marginTop: '1cm',
          marginBottom: '1cm'
        },
        helpers: registerHelpers()
      },
      data: templateData
    });
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="inventory-report.pdf"`,
      'Content-Length': result.content.length
    });
    
    res.send(result.content);
  } catch (error) {
    console.error('Error generating inventory report PDF:', error);
    res.status(500).json({ message: 'Error generating inventory report PDF', error: error.message });
  }
};

// @desc    Generate customer debt report PDF
// @route   GET /api/reports/customer-debt/export
// @access  Private/Admin
export const exportCustomerDebtReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();
    
    // Ensure end date includes the entire day
    end.setHours(23, 59, 59, 999);
    
    // Find customers with outstanding debt
    const customersWithDebt = await Customer.find({ debt: { $gt: 0 } });
    
    // Get pending orders count
    const pendingOrders = await Order.countDocuments({ 
      status: { $in: ['pending', 'processing'] },
      debtRemaining: { $gt: 0 }
    });
    
    // Calculate total debt
    const totalDebt = customersWithDebt.reduce((sum, customer) => sum + customer.debt, 0);
    
    // Get customer details with extra information
    const customerDebts = await Promise.all(customersWithDebt.map(async (customer) => {
      // Find last order date
      const lastOrder = await Order.findOne({ 
        customer: customer._id 
      }).sort({ orderDate: -1 });
      
      // Count pending orders for this customer
      const pendingOrderCount = await Order.countDocuments({
        customer: customer._id,
        status: { $in: ['pending', 'processing'] },
        debtRemaining: { $gt: 0 }
      });
      
      return {
        customerId: customer._id,
        customerName: customer.name,
        customerPhone: customer.phone,
        totalDebt: customer.debt,
        lastOrderDate: lastOrder ? lastOrder.orderDate : null,
        pendingOrders: pendingOrderCount
      };
    }));
    
    // Sort by highest debt first
    customerDebts.sort((a, b) => b.totalDebt - a.totalDebt);
    
    // Prepare the report data
    const report = {
      totalDebt,
      totalCustomers: customersWithDebt.length,
      pendingOrders,
      customerDebts,
      debtByTime: [] // This would need implementation if required
    };
    
    const templateData = {
      report,
      dateRange: {
        start: start.toLocaleDateString('vi-VN'),
        end: end.toLocaleDateString('vi-VN')
      },
      fontPath,
      currentDate: new Date().toLocaleDateString('vi-VN'),
      pageNumber: '{#pageNum}'
    };
    
    // Read the template file directly
    const templatePath = path.join(__dirname, '../templates/customerDebtReport.html');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    
    const result = await reporter.render({
      template: {
        content: templateContent,
        engine: 'handlebars',
        recipe: 'chrome-pdf',
        chrome: {
          displayHeaderFooter: true,
          marginTop: '1cm',
          marginBottom: '1cm'
        },
        helpers: registerHelpers()
      },
      data: templateData
    });
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="customer-debt-report.pdf"`,
      'Content-Length': result.content.length
    });
    
    res.send(result.content);
  } catch (error) {
    console.error('Error generating customer debt report PDF:', error);
    res.status(500).json({ message: 'Error generating customer debt report PDF', error: error.message });
  }
};

// @desc    Generate supplier debt report PDF
// @route   GET /api/reports/supplier-debt/export
// @access  Private/Admin
export const exportSupplierDebtReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();
    
    // Ensure end date includes the entire day
    end.setHours(23, 59, 59, 999);
    
    // Find suppliers with outstanding debt
    const suppliersWithDebt = await Supplier.find({ debt: { $gt: 0 } });
    
    // Get pending payments count
    const pendingPayments = await Purchase.countDocuments({ 
      status: { $in: ['pending', 'processing'] },
      debtRemaining: { $gt: 0 }
    });
    
    // Calculate total debt
    const totalDebt = suppliersWithDebt.reduce((sum, supplier) => sum + supplier.debt, 0);
    
    // Get supplier details with extra information
    const supplierDebts = await Promise.all(suppliersWithDebt.map(async (supplier) => {
      // Find last purchase date
      const lastPurchase = await Purchase.findOne({ 
        supplier: supplier._id 
      }).sort({ purchaseDate: -1 });
      
      // Count pending payments for this supplier
      const pendingPaymentCount = await Purchase.countDocuments({
        supplier: supplier._id,
        status: { $in: ['pending', 'processing'] },
        debtRemaining: { $gt: 0 }
      });
      
      return {
        supplierId: supplier._id,
        supplierName: supplier.name,
        supplierPhone: supplier.phone,
        totalDebt: supplier.debt,
        lastPurchaseDate: lastPurchase ? lastPurchase.purchaseDate : null,
        pendingPayments: pendingPaymentCount
      };
    }));
    
    // Sort by highest debt first
    supplierDebts.sort((a, b) => b.totalDebt - a.totalDebt);
    
    // Prepare the report data
    const report = {
      totalDebt,
      totalSuppliers: suppliersWithDebt.length,
      pendingPayments,
      supplierDebts,
      debtByTime: [] // This would need implementation if required
    };
    
    const templateData = {
      report,
      dateRange: {
        start: start.toLocaleDateString('vi-VN'),
        end: end.toLocaleDateString('vi-VN')
      },
      fontPath,
      currentDate: new Date().toLocaleDateString('vi-VN'),
      pageNumber: '{#pageNum}'
    };
    
    // Read the template file directly
    const templatePath = path.join(__dirname, '../templates/supplierDebtReport.html');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    
    const result = await reporter.render({
      template: {
        content: templateContent,
        engine: 'handlebars',
        recipe: 'chrome-pdf',
        chrome: {
          displayHeaderFooter: true,
          marginTop: '1cm',
          marginBottom: '1cm'
        },
        helpers: registerHelpers()
      },
      data: templateData
    });
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="supplier-debt-report.pdf"`,
      'Content-Length': result.content.length
    });
    
    res.send(result.content);
  } catch (error) {
    console.error('Error generating supplier debt report PDF:', error);
    res.status(500).json({ message: 'Error generating supplier debt report PDF', error: error.message });
  }
};

// @desc    Generate revenue report PDF
// @route   GET /api/reports/revenue/export
// @access  Private/Admin
export const exportRevenueReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate ? new Date(endDate) : new Date();
    
    // Ensure end date includes the entire day
    end.setHours(23, 59, 59, 999);
    
    // Get orders within date range
    const orders = await Order.find({
      orderDate: { $gte: start, $lte: end },
      status: 'completed'
    });
    
    // Calculate total revenue
    const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    
    // Calculate total paid
    const totalPaid = orders.reduce((sum, order) => sum + order.paidAmount, 0);
    
    // Calculate total debt
    const totalDebt = orders.reduce((sum, order) => sum + order.debtRemaining, 0);
    
    // Group by date to get daily stats
    const dailyStats = {};
    orders.forEach(order => {
      const day = new Date(order.orderDate).toISOString().split('T')[0];
      if (!dailyStats[day]) {
        dailyStats[day] = {
          date: day,
          totalRevenue: 0,
          totalOrders: 0,
          totalPaid: 0,
          totalDebt: 0
        };
      }
      
      dailyStats[day].totalRevenue += order.totalAmount;
      dailyStats[day].totalPaid += order.paidAmount;
      dailyStats[day].totalDebt += order.debtRemaining;
      dailyStats[day].totalOrders += 1;
    });
    
    // Convert to array and sort by date
    const dailyStatsArray = Object.values(dailyStats).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );
    
    // Pre-format các dữ liệu để tránh sử dụng helpers phức tạp
    const formattedData = {
      startDate: start.toLocaleDateString('vi-VN'),
      endDate: end.toLocaleDateString('vi-VN'),
      currentDate: new Date().toLocaleDateString('vi-VN'),
      currentYear: new Date().getFullYear(),
      totalRevenueFormatted: new Intl.NumberFormat('vi-VN').format(totalRevenue),
      totalPaidFormatted: new Intl.NumberFormat('vi-VN').format(totalPaid),
      totalDebtFormatted: new Intl.NumberFormat('vi-VN').format(totalDebt),
      totalOrders: orders.length,
      dailyData: dailyStatsArray.map((day, index) => ({
        index: index + 1,
        dateFormatted: new Date(day.date).toLocaleDateString('vi-VN'),
        totalRevenueFormatted: new Intl.NumberFormat('vi-VN').format(day.totalRevenue),
        totalPaidFormatted: new Intl.NumberFormat('vi-VN').format(day.totalPaid),
        totalDebtFormatted: new Intl.NumberFormat('vi-VN').format(day.totalDebt),
        totalOrders: day.totalOrders
      }))
    };
    
    // Tạo template HTML đơn giản hơn để tránh lỗi
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Báo Cáo Doanh Thu</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          color: #333;
        }
        
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        
        .company-name {
          color: #2F5597;
          font-size: 22px;
          font-weight: bold;
          margin-bottom: 5px;
        }
        
        .company-details {
          color: #666;
          font-size: 10px;
          font-weight: 300;
        }
        
        .report-title {
          color: #2F5597;
          font-size: 18px;
          font-weight: bold;
          margin: 20px 0;
          text-align: center;
        }
        
        .report-period {
          font-size: 11px;
          margin-bottom: 20px;
          text-align: center;
        }
        
        .summary-box {
          background-color: #f5f5f5;
          padding: 15px;
          border-radius: 5px;
          margin-bottom: 20px;
        }
        
        .summary-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #eee;
        }
        
        .summary-label {
          font-weight: bold;
        }
        
        .section-title {
          color: #2F5597;
          font-size: 14px;
          font-weight: bold;
          margin: 20px 0 10px 0;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        
        table thead {
          background-color: #2F5597;
          color: white;
        }
        
        table th, table td {
          padding: 8px;
          text-align: left;
          font-size: 10px;
          border: 1px solid #ddd;
        }
        
        table tr:nth-child(even) {
          background-color: #f5f5f5;
        }
        
        .footer {
          text-align: center;
          margin-top: 50px;
          font-size: 10px;
          color: #666;
        }
        
        .page-number {
          text-align: center;
          font-size: 8px;
          color: #999;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-name">W_LAVIE</div>
        <div class="company-details">CÔNG TY TNHH THƯƠNG MẠI W_LAVIE</div>
        <div class="company-details">123 Đường ABC, Phường XYZ, Quận 123, TP.HCM</div>
        <div class="company-details">Điện thoại: 0123.456.789 - Email: contact@wlavie.com</div>
      </div>
      
      <div class="report-title">BÁO CÁO DOANH THU</div>
      <div class="report-period">
        Kỳ báo cáo: ${formattedData.startDate} - ${formattedData.endDate}<br>
        Ngày lập: ${formattedData.currentDate}
      </div>
      
      <div class="summary-box">
        <div class="summary-item">
          <div class="summary-label">TỔNG DOANH THU:</div>
          <div>${formattedData.totalRevenueFormatted} đ</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">ĐÃ THANH TOÁN:</div>
          <div>${formattedData.totalPaidFormatted} đ</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">CÔNG NỢ:</div>
          <div>${formattedData.totalDebtFormatted} đ</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">SỐ ĐƠN HÀNG:</div>
          <div>${formattedData.totalOrders}</div>
        </div>
      </div>
      
      <div class="section-title">CHI TIẾT DOANH THU THEO NGÀY</div>
      <table>
        <thead>
          <tr>
            <th>STT</th>
            <th>Ngày</th>
            <th>Doanh thu</th>
            <th>Đã thanh toán</th>
            <th>Công nợ</th>
            <th>Số đơn hàng</th>
          </tr>
        </thead>
        <tbody>
          ${formattedData.dailyData.map(day => `
            <tr>
              <td>${day.index}</td>
              <td>${day.dateFormatted}</td>
              <td>${day.totalRevenueFormatted} đ</td>
              <td>${day.totalPaidFormatted} đ</td>
              <td>${day.totalDebtFormatted} đ</td>
              <td>${day.totalOrders}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <div class="footer">
        © ${formattedData.currentYear} W_LAVIE. Báo cáo được tạo tự động từ hệ thống.
      </div>
      
      <div class="page-number">
        Trang {#pageNum}
      </div>
    </body>
    </html>
    `;
    
    const result = await reporter.render({
      template: {
        content: html,
        engine: 'handlebars',
        recipe: 'chrome-pdf',
        chrome: {
          displayHeaderFooter: true,
          marginTop: '1cm',
          marginBottom: '1cm'
        }
      }
    });
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="revenue-report.pdf"`,
      'Content-Length': result.content.length
    });
    
    res.send(result.content);
  } catch (error) {
    console.error('Error generating revenue report PDF:', error);
    res.status(500).json({ message: 'Error generating revenue report PDF', error: error.message });
  }
};
