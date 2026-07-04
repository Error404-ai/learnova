const mongoose = require('mongoose');
const CommunityPost = require('../models/CommunityPost');
const User = require('../models/User');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);
};

const AUTHOR_SELECT = 'name email profilePicture role';

const formatPost = (post, userId) => {
  const obj = post.toObject ? post.toObject() : post;
  return {
    ...obj,
    likesCount: obj.likes ? obj.likes.length : 0,
    commentsCount: obj.comments ? obj.comments.length : 0,
    isLiked: obj.likes ? obj.likes.some((id) => id.toString() === userId.toString()) : false
  };
};

// Create a new community post
exports.createPost = async (req, res) => {
  try {
    const { content, category } = req.body;

    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Post content is required' });
    }

    const allowedCategories = ['Discussion', 'Doubt', 'Resource', 'Announcement', 'Project', 'Achievement'];
    const resolvedCategory = allowedCategories.includes(category) ? category : 'Discussion';

    if (resolvedCategory === 'Announcement' && req.user.role === 'student') {
      return res.status(403).json({
        success: false,
        message: 'Only teachers or admins can post announcements'
      });
    }

    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map((file) => ({
        filename: file.originalname,
        path: file.key,
        url: file.location,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date()
      }));
    }

    const post = new CommunityPost({
      author: req.user.id,
      content: content.trim(),
      category: resolvedCategory,
      attachments
    });

    await post.save();
    await post.populate('author', AUTHOR_SELECT);

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      post: formatPost(post, req.user.id)
    });
  } catch (err) {
    console.error('Error creating community post:', err);
    res.status(500).json({ success: false, message: 'Failed to create post', error: err.message });
  }
};

// Get all posts (paginated, filterable by category, searchable)
exports.getAllPosts = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { category, search, sort } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const query = {};
    if (category && category !== 'All') {
      query.category = category;
    }
    if (search && search.trim()) {
      query.content = { $regex: search.trim(), $options: 'i' };
    }

    let sortStage = { isPinned: -1, createdAt: -1 };
    if (sort === 'mostLiked') {
      sortStage = { isPinned: -1, likesCount: -1, createdAt: -1 };
    }

    const totalPosts = await CommunityPost.countDocuments(query);

    let postsQuery = CommunityPost.find(query)
      .populate('author', AUTHOR_SELECT)
      .populate('comments.author', AUTHOR_SELECT);

    if (sort === 'mostLiked') {
      // likesCount isn't a stored field, so sort in-memory after fetch for this case
      const allMatching = await postsQuery;
      const sorted = allMatching
        .map((p) => formatPost(p, req.user.id))
        .sort((a, b) => {
          if (b.isPinned !== a.isPinned) return b.isPinned ? 1 : -1;
          if (b.likesCount !== a.likesCount) return b.likesCount - a.likesCount;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
      const paginated = sorted.slice(skip, skip + limit);

      return res.status(200).json({
        success: true,
        posts: paginated,
        pagination: {
          page,
          limit,
          totalPosts,
          totalPages: Math.ceil(totalPosts / limit)
        }
      });
    }

    const posts = await postsQuery.sort(sortStage).skip(skip).limit(limit);

    res.status(200).json({
      success: true,
      posts: posts.map((p) => formatPost(p, req.user.id)),
      pagination: {
        page,
        limit,
        totalPosts,
        totalPages: Math.ceil(totalPosts / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching community posts:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch posts', error: err.message });
  }
};

// Get posts created by the logged-in user
exports.getMyPosts = async (req, res) => {
  try {
    const userId = req.user.id;

    const posts = await CommunityPost.find({ author: userId })
      .populate('author', AUTHOR_SELECT)
      .populate('comments.author', AUTHOR_SELECT)
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      posts: posts.map((p) => formatPost(p, userId)),
      count: posts.length
    });
  } catch (err) {
    console.error('Error fetching my posts:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch your posts', error: err.message });
  }
};

// Get single post by ID
exports.getPostById = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    if (!isValidObjectId(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID format' });
    }

    const post = await CommunityPost.findById(postId)
      .populate('author', AUTHOR_SELECT)
      .populate('comments.author', AUTHOR_SELECT);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    res.status(200).json({ success: true, post: formatPost(post, userId) });
  } catch (err) {
    console.error('Error fetching post:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch post', error: err.message });
  }
};

// Update a post (author only)
exports.updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, category } = req.body;
    const userId = req.user.id;

    if (!isValidObjectId(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID format' });
    }

    const post = await CommunityPost.findById(postId);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (post.author.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Only the author can edit this post' });
    }

    const allowedCategories = ['Discussion', 'Doubt', 'Resource', 'Announcement', 'Project', 'Achievement'];

    if (content && content.trim()) {
      post.content = content.trim();
      post.isEdited = true;
    }
    if (category && allowedCategories.includes(category)) {
      post.category = category;
    }

    await post.save();
    await post.populate('author', AUTHOR_SELECT);
    await post.populate('comments.author', AUTHOR_SELECT);

    res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      post: formatPost(post, userId)
    });
  } catch (err) {
    console.error('Error updating post:', err);
    res.status(500).json({ success: false, message: 'Failed to update post', error: err.message });
  }
};

// Delete a post (author or admin)
exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    if (!isValidObjectId(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID format' });
    }

    const post = await CommunityPost.findById(postId);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const isAuthor = post.author.toString() === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this post' });
    }

    await CommunityPost.findByIdAndDelete(postId);

    res.status(200).json({ success: true, message: 'Post deleted successfully' });
  } catch (err) {
    console.error('Error deleting post:', err);
    res.status(500).json({ success: false, message: 'Failed to delete post', error: err.message });
  }
};

// Like / unlike a post
exports.toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    if (!isValidObjectId(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID format' });
    }

    const post = await CommunityPost.findById(postId);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const alreadyLiked = post.likes.some((id) => id.toString() === userId);

    if (alreadyLiked) {
      post.likes = post.likes.filter((id) => id.toString() !== userId);
    } else {
      post.likes.push(userId);
    }

    await post.save();

    res.status(200).json({
      success: true,
      message: alreadyLiked ? 'Post unliked' : 'Post liked',
      liked: !alreadyLiked,
      likesCount: post.likes.length
    });
  } catch (err) {
    console.error('Error toggling like:', err);
    res.status(500).json({ success: false, message: 'Failed to toggle like', error: err.message });
  }
};

// Add a comment to a post
exports.addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text } = req.body;
    const userId = req.user.id;

    if (!isValidObjectId(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID format' });
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Comment text is required' });
    }

    const post = await CommunityPost.findById(postId);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    post.comments.push({ author: userId, text: text.trim() });
    await post.save();
    await post.populate('comments.author', AUTHOR_SELECT);

    const newComment = post.comments[post.comments.length - 1];

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      comment: newComment,
      commentsCount: post.comments.length
    });
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ success: false, message: 'Failed to add comment', error: err.message });
  }
};

// Delete a comment (comment author, post author, or admin)
exports.deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.id;

    if (!isValidObjectId(postId) || !isValidObjectId(commentId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID format' });
    }

    const post = await CommunityPost.findById(postId);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const comment = post.comments.id(commentId);

    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const isCommentAuthor = comment.author.toString() === userId;
    const isPostAuthor = post.author.toString() === userId;
    const isAdmin = req.user.role === 'admin';

    if (!isCommentAuthor && !isPostAuthor && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this comment' });
    }

    comment.deleteOne();
    await post.save();

    res.status(200).json({
      success: true,
      message: 'Comment deleted successfully',
      commentsCount: post.comments.length
    });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).json({ success: false, message: 'Failed to delete comment', error: err.message });
  }
};

// Pin / unpin a post (teacher or admin only)
exports.togglePin = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    if (!isValidObjectId(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID format' });
    }

    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only teachers or admins can pin posts' });
    }

    const post = await CommunityPost.findById(postId);

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    post.isPinned = !post.isPinned;
    await post.save();

    res.status(200).json({
      success: true,
      message: post.isPinned ? 'Post pinned' : 'Post unpinned',
      isPinned: post.isPinned
    });
  } catch (err) {
    console.error('Error toggling pin:', err);
    res.status(500).json({ success: false, message: 'Failed to toggle pin', error: err.message });
  }
};