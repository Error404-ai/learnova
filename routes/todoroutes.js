const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  getTodos,
  createTodo,
  updateTodo,
  deleteTodo
} = require('../controllers/todocontrollers');

router.use(protect);

router.get('/', getTodos);
router.post('/', createTodo);
router.patch('/:id', updateTodo);
router.delete('/:id', deleteTodo);

module.exports = router;