const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  createAssignment,
  getClassAssignments,
  updateAssignment,
  deleteAssignment,
  getAssignmentStats,
  submitAssignment,
  getAssignmentSubmissions,
  gradeSubmission,
  getAssignmentsBySubject,
  uploadAssignmentFiles,
} = require('../controllers/assignmentcontrollers');

router.use(protect);

router.post(
  '/',
  uploadAssignmentFiles,
  (error, req, res, next) => {
    if (error) {
      console.error('File upload error:', error);
      return res.status(400).json({
        success: false,
        message: error.message || 'File upload failed'
      });
    }
    next();
  },
  createAssignment
);

router.get('/class/:classId', getClassAssignments);
router.get('/subject/:subject', getAssignmentsBySubject);
router.put('/:assignmentId', updateAssignment);
router.delete('/:assignmentId', deleteAssignment);
router.get('/:assignmentId/stats', getAssignmentStats);
router.post('/:assignmentId/submit', submitAssignment);
router.get('/:assignmentId/submissions', getAssignmentSubmissions);
router.put('/:assignmentId/submissions/:submissionId/grade', gradeSubmission);

module.exports = router;
