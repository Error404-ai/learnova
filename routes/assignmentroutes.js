const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const { uploadAssignmentFiles } = require('../middlewares/uploadMiddleware');
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
} = require('../controllers/assignmentcontrollers');

router.use(protect);

// Any authenticated user can create assignments in classes they created or
// coordinate; createAssignment itself checks that (isCreator || isCoordinator).
// There are no fixed account-level roles - permission is scoped per class.
router.post(
  '/',
  uploadAssignmentFiles,
  (error, req, res, next) => {
    if (error) {
      console.error('File upload error:', error);
      return res.status(400).json({ success: false, message: error.message || 'File upload failed' });
    }
    next();
  },
  createAssignment
);
router.put('/:assignmentId', updateAssignment);
router.delete('/:assignmentId', deleteAssignment);
router.get('/:assignmentId/submissions', getAssignmentSubmissions);
router.put('/:assignmentId/submissions/:submissionId/grade', gradeSubmission);

// Any authenticated user enrolled in the class can submit; submitAssignment
// itself checks classId.students membership.
router.post(
  '/:assignmentId/submit',
  uploadAssignmentFiles,
  (error, req, res, next) => {
    if (error) {
      console.error('File upload error:', error);
      return res.status(400).json({ success: false, message: error.message || 'File upload failed' });
    }
    next();
  },
  submitAssignment
);

// Both
router.get('/class/:classId', getClassAssignments);
router.get('/subject/:subject', getAssignmentsBySubject);
router.get('/:assignmentId/stats', getAssignmentStats);

module.exports = router;