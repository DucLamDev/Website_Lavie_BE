import express from 'express';
import {
  getOrders,
  getOrderById,
  getOrderItems,
  createOrder,
  updateOrderStatus,
  updateReturnable,
  updatePayment,
} from '../controllers/orderController.js';
import { protect, sales } from '../middleware/auth.js';

const router = express.Router();

router.route('/')
  .get(protect, getOrders)
  .post(protect, createOrder); // Thêm protect để chỉ cho user đã đăng nhập

router.route('/:id')
  .get(protect, getOrderById);

router.route('/:id/items')
  .get(protect, getOrderItems);

router.route('/:id/status')
  .put(protect, sales, updateOrderStatus);

router.route('/:id/returnable')
  .put(protect, sales, updateReturnable);

router.route('/:id/payment')
  .put(protect, sales, updatePayment);

export default router; 