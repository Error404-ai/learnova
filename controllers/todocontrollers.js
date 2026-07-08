const Todo = require('../models/Todo');

// GET /api/todos            -> all todos for logged-in user
// GET /api/todos?classId=.. -> todos scoped to one class
exports.getTodos = async (req, res) => {
  try {
    const filter = { user: req.user.id };
    if (req.query.classId) filter.classId = req.query.classId;

    const todos = await Todo.find(filter)
      .populate('classId', 'className subject')
      .sort({ done: 1, createdAt: -1 });

    res.json({ todos });
  } catch (error) {
    console.error('Error in getTodos:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// POST /api/todos
// body: { text, classId?, dueDate? }
exports.createTodo = async (req, res) => {
  try {
    const { text, classId, dueDate } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Todo text is required' });
    }

    const todo = await Todo.create({
      user: req.user.id,
      text: text.trim(),
      classId: classId || null,
      dueDate: dueDate || null
    });

    res.status(201).json({ message: 'Todo created', todo });
  } catch (error) {
    console.error('Error in createTodo:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// PATCH /api/todos/:id
// body: any of { text, done, classId, dueDate }
exports.updateTodo = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, done, classId, dueDate } = req.body;

    const todo = await Todo.findOne({ _id: id, user: req.user.id });
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    if (text !== undefined) todo.text = text.trim();
    if (done !== undefined) todo.done = done;
    if (classId !== undefined) todo.classId = classId || null;
    if (dueDate !== undefined) todo.dueDate = dueDate || null;

    await todo.save();

    res.json({ message: 'Todo updated', todo });
  } catch (error) {
    console.error('Error in updateTodo:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// DELETE /api/todos/:id
exports.deleteTodo = async (req, res) => {
  try {
    const { id } = req.params;

    const todo = await Todo.findOneAndDelete({ _id: id, user: req.user.id });
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.json({ message: 'Todo deleted' });
  } catch (error) {
    console.error('Error in deleteTodo:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};