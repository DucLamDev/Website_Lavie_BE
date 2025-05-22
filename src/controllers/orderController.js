import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';

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

    let customer, customerId, orderItems, customerName;
    
    // Handle both admin dashboard and customer website formats
    if (req.body.customerId) {
      // Admin dashboard format
      if (!req.body.orderItems || !Array.isArray(req.body.orderItems)) {
        return res.status(400).json({ message: 'Order items are required and must be an array' });
      }

      customerId = req.body.customerId;
      orderItems = req.body.orderItems;
      
      // Get customer
      customer = await Customer.findById(customerId);
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' });
      }
      customerName = customer.name;
    } else if (req.body.customer) {
      // Customer website format
      const { name, phone, email, address } = req.body.customer;
      
      if (!phone) {
        return res.status(400).json({ message: 'Phone number is required' });
      }

      if (!req.body.items || !Array.isArray(req.body.items)) {
        return res.status(400).json({ message: 'Order items are required and must be an array' });
      }
      
      // Find or create customer
      customer = await Customer.findOne({ phone });
      if (!customer) {
        if (!name || !address) {
          return res.status(400).json({ message: 'Name and address are required for new customers' });
        }

        // Create new customer
        customer = await Customer.create({
          name,
          phone,
          email: email || '',
          address,
          type: 'retail',  // Default to retail customer
          debt: 0,
          empty_debt: 0
        });
      }
      
      customerId = customer._id;
      customerName = customer.name;
      
      // Convert items format to orderItems format
      orderItems = req.body.items.map(item => ({
        productId: item.product,
        quantity: parseInt(item.quantity) || 0,
        unitPrice: parseFloat(item.price) || 0
      }));
    } else {
      return res.status(400).json({ message: 'Invalid order data format' });
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
        total: item.quantity * product.price, // Calculate total to fix validation error
      });

      // Update product stock
      product.stock -= item.quantity;
      await product.save();
    }

    // Update customer debt
    customer.debt += totalAmount;
    customer.empty_debt += returnableOut;
    await customer.save();

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
    const { returnableIn } = req.body;
    const order = await Order.findById(req.params.id);

    if (order) {
      // Calculate new returnable in value (adding to existing value)
      const newReturnableIn = order.returnableIn + returnableIn;
      
      if (newReturnableIn > order.returnableOut) {
        return res.status(400).json({ message: 'Returned quantity exceeds returnable quantity' });
      }

      const customer = await Customer.findById(order.customerId);
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' });
      }

      // Update order returnable count
      order.returnableIn = newReturnableIn;
      await order.save();

      // Update customer empty debt
      customer.empty_debt -= returnableIn;
      await customer.save();

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
      const customer = await Customer.findById(order.customerId);
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' });
      }

      // Update order payment
      order.paidAmount += amount;
      await order.save();

      // Update customer debt
      customer.debt -= amount;
      await customer.save();

      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 