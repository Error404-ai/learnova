const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createAssignment,
  getClassAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  getAssignmentStats
} = require('../controllers/assignmentcontrollers');

router.use(protect);

router.post('/', createAssignment);
router.get('/class/:classId', getClassAssignments);
router.get('/:assignmentId', getAssignmentById);
router.put('/:assignmentId', updateAssignment);
router.delete('/:assignmentId', deleteAssignment);
router.get('/:assignmentId/stats', getAssignmentStats);

module.exports = router;
