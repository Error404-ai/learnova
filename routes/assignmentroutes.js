const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createAssignment,
  getClassAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment
} = require('../controllers/assignmentcontrollers');

router.use(protect);

router.post('/', createAssignment);
router.get('/class/:classId', getClassAssignments);
router.get('/:assignmentId', getAssignmentById);
router.put('/:assignmentId', updateAssignment);
router.delete('/:assignmentId', deleteAssignment);

module.exports = router;
