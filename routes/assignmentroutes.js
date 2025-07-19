const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createAssignment,
  getAssignmentsByClassId,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  submitAssignment,
  gradeSubmission,
  getSubmissionsForAssignment,
  getMySubmission
} = require('../controllers/assignmentcontrollers');

router.use(protect);

router.post('/', createAssignment);
router.get('/class/:classId', getAssignmentsByClassId);
router.get('/:assignmentId', getAssignmentById);
router.put('/:assignmentId', updateAssignment);
router.delete('/:assignmentId', deleteAssignment);
router.post('/:assignmentId/submit', submitAssignment);
router.post('/:assignmentId/grade/:studentId', gradeSubmission);
router.get('/:assignmentId/submissions', getSubmissionsForAssignment);
router.get('/:assignmentId/my-submission', getMySubmission);

module.exports = router;
