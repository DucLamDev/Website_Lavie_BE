import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private
export const getOrders = async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get order items
// @route   GET /api/orders/:id/items
// @access  Private
export const getOrderItems = async (req, res) => {
  try {
    const orderItems = await OrderItem.find({ orderId: req.params.id });
    res.json(orderItems);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create order
// @route   POST /api/orders
// @access  Private
export const createOrder = async (req, res) => {
  try {
    // Validate request body
    if (!req.body) {
      return res.status(400).json({ message: 'Order data is required' });
    }

    let customerId, orderItems, customerName;

    // Nếu là khách hàng đăng nhập (user role customer)
    if (req.user && req.user.role === 'customer') {
      customerId = req.user._id;
      customerName = req.user.name;
      if (!req.body.orderItems || !Array.isArray(req.body.orderItems)) {
        return res.status(400).json({ message: 'Order items are required and must be an array' });
      }
      orderItems = req.body.orderItems;
    } else if (req.body.customerId) {
      // Admin dashboard format
      if (!req.body.orderItems || !Array.isArray(req.body.orderItems)) {
        return res.status(400).json({ message: 'Order items are required and must be an array' });
      }
      customerId = req.body.customerId;
      orderItems = req.body.orderItems;
      customerName = req.body.customerName || '';
    } else {
      return res.status(400).json({ message: 'Invalid order data format' });
    }

    // Kiểm tra customerId hợp lệ và tồn tại
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: 'Invalid customerId' });
    }
    // Lấy thông tin user để kiểm tra role và agency_level
    const user = await User.findById(customerId);
    if (!user) {
      return res.status(404).json({ message: 'Customer (user) not found' });
    }

    // Validate order items
    if (orderItems.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    // Calculate totals
    let totalAmount = 0;
    let returnableOut = 0;

    // Validate products and calculate totals
    for (const item of orderItems) {
      if (!item.productId || !item.quantity) {
        return res.status(400).json({ message: 'Each order item must have a product ID and quantity' });
      }

      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${item.productId} not found` });
      }
      if (product.stock < item.quantity) {
        return res.status(400).json({ 
          message: `Không đủ hàng trong kho cho sản phẩm ${product.name}`, 
          details: {
            productId: product._id,
            productName: product.name,
            requestedQuantity: item.quantity,
            availableStock: product.stock
          }
        });
      }
      if (typeof product.price !== 'number' || product.price <= 0) {
        return res.status(400).json({ message: `Invalid price for product ${product.name}` });
      }
      totalAmount += product.price * item.quantity;
      if (product.is_returnable) {
        returnableOut += item.quantity;
      }
    }

    // Giảm giá 10% nếu là user role customer và agency_level === 2
    if (user.role === 'customer' && user.agency_level === 2) {
      totalAmount = Math.round(totalAmount * 0.9);
    }

    // Create order
    const order = await Order.create({
      customerId,
      customerName,
      totalAmount,
      returnableOut,
      status: 'pending',
      paidAmount: 0,
      createdBy: req.user ? req.user._id : null,
    });

    // Create order items and update product stock
    for (const item of orderItems) {
      const product = await Product.findById(item.productId);
      await OrderItem.create({
        orderId: order._id,
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        total: item.quantity * product.price,
      });
      // Update product stock
      product.stock -= item.quantity;
      await product.save();
    }

    // Không cập nhật user.debt, user.empty_debt nữa

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (order) {
      order.status = status;
      const updatedOrder = await order.save();
      res.json(updatedOrder);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update returnable items
// @route   PUT /api/orders/:id/returnable
// @access  Private
export const updateReturnable = async (req, res) => {
  try {
    // FE gửi returnedQuantity
    const { returnedQuantity } = req.body;
    const order = await Order.findById(req.params.id);

    if (order) {
      // Calculate new returnable in value (adding to existing value)
      const newReturnableIn = order.returnableIn + returnedQuantity;
      
      if (newReturnableIn > order.returnableOut) {
        return res.status(400).json({ message: 'Returned quantity exceeds returnable quantity' });
      }

      const user = await User.findOne({ _id: order.customerId, role: 'customer' });
      if (!user) {
        return res.status(404).json({ message: 'Customer (user) not found' });
      }

      // Update order returnable count
      order.returnableIn = newReturnableIn;
      await order.save();

      // Update user empty debt
      user.empty_debt -= returnedQuantity;
      await user.save();

      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update payment
// @route   PUT /api/orders/:id/payment
// @access  Private
export const updatePayment = async (req, res) => {
  try {
    const { amount } = req.body;
    const order = await Order.findById(req.params.id);

    if (order) {
      const user = await User.findOne({ _id: order.customerId, role: 'customer' });
      if (!user) {
        return res.status(404).json({ message: 'Customer (user) not found' });
      }

      // Update order payment
      order.paidAmount += amount;
      await order.save();

      // Update user debt
      user.debt -= amount;
      await user.save();

      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 