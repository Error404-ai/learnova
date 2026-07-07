const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const {
  createClass,
  getAllClasses,
  joinClassByCode,
  leaveClass,
  getClassById,
  getClassByCode,
  toggleFavourite,
  addCoordinator,
  removeCoordinator,
  deleteClass,
  getClassmates
} = require('../controllers/classcontrollers');

router.use(protect);

// Teacher-only
router.post('/', restrictTo('teacher'), createClass);
router.delete('/:classId', restrictTo('teacher'), deleteClass);
router.post('/add-coordinator', restrictTo('teacher'), addCoordinator);
router.post('/remove-coordinator', restrictTo('teacher'), removeCoordinator);

// Student-only
router.post('/join-by-code', restrictTo('student'), joinClassByCode);
router.post('/leave', restrictTo('student'), leaveClass);

// Both
router.get('/all', getAllClasses);
router.get('/:classId', getClassById);
router.get('/code/:classCode', getClassByCode);
router.post('/favourite', toggleFavourite);
router.get('/classmates/:classId', getClassmates);

module.exports = router;