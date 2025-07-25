const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createAssignment,
  getClassAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  getAssignmentStats,
  submitAssignment,
  getAssignmentSubmissions,
  gradeSubmission,
} = require('../controllers/assignmentcontrollers');

router.use(protect);

router.post('/', createAssignment);
router.get('/class/:classId', getClassAssignments);
router.get('/:assignmentId', getAssignmentById);
router.put('/:assignmentId', updateAssignment);
router.delete('/:assignmentId', deleteAssignment);
router.get('/:assignmentId/stats', getAssignmentStats);

router.post('/:assignmentId/submit', submitAssignment);
router.get('/:assignmentId/submissions', getAssignmentSubmissions);
router.put('/:assignmentId/submissions/:submissionId/grade', gradeSubmission);

module.exports = router;