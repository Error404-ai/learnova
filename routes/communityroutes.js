const express = require('express');
const router = express.Router();
// const { protect } = require('../middlewares/authMiddleware');
const { uploadCommunityFiles } = require('../middlewares/uploadMiddleware');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

const {
  createPost,
  getAllPosts,
  getMyPosts,
  getPostById,
  updatePost,
  deletePost,
  toggleLike,
  addComment,
  deleteComment,
  togglePin
} = require('../controllers/communitycontrollers');

router.use(protect);

router.post('/posts', uploadCommunityFiles, createPost);
router.get('/posts', getAllPosts);
router.get('/posts/my', getMyPosts);
router.get('/posts/:postId', getPostById);
router.put('/posts/:postId', updatePost);
router.delete('/posts/:postId', deletePost);

router.post('/posts/:postId/like', toggleLike);
router.post('/posts/:postId/pin', restrictTo('teacher'), togglePin);
router.post('/posts/:postId/pin', restrictTo('teacher', 'admin'), togglePin);


router.post('/posts/:postId/comments', addComment);
router.delete('/posts/:postId/comments/:commentId', deleteComment);

module.exports = router;
