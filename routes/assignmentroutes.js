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
  getMySubmission
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
router.get('/:assignmentId/my-submission', getMySubmission);
router.put('/:assignmentId/submissions/:submissionId/grade', gradeSubmission);

module.exports = router;