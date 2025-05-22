import express from 'express';
import {
  getImports,
  getImportById,
  createImport,
  deleteImport,
} from '../controllers/importController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

router.route('/')
  .get(protect, getImports)
  .post(protect, admin, createImport);

router.route('/:id')
  .get(protect, getImportById)
  .delete(protect, admin, deleteImport);

export default router; 