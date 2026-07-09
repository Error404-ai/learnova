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

// Any authenticated user can create/join classes in this flexible flow
router.post('/', createClass);
router.delete('/:classId', deleteClass);
router.post('/add-coordinator', addCoordinator);
router.post('/remove-coordinator', removeCoordinator);

router.post('/join-by-code', joinClassByCode);
router.post('/leave', leaveClass);

// Both
router.get('/all', getAllClasses);
router.get('/:classId', getClassById);
router.get('/code/:classCode', getClassByCode);
router.post('/favourite', toggleFavourite);
router.get('/classmates/:classId', getClassmates);

module.exports = router;