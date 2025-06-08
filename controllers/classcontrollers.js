const Class = require('../models/Class');

// Create Class
exports.createClass = async (req, res) => {
  try {
    const { className, subject, privacy, createdBy } = req.body;
    const newClass = new Class({ className, subject, privacy, createdBy });
    await newClass.save();
    res.status(201).json(newClass);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get All Classes (with filter)
exports.getAllClasses = async (req, res) => {
  try {
    const { userId, filter } = req.query;
    let classes;

    switch (filter) {
      case 'joined':
        classes = await Class.find({ students: userId });
        break;
      case 'created':
        classes = await Class.find({ createdBy: userId });
        break;
      case 'favourite':
        classes = await Class.find({ favourites: userId });
        break;
      default:
        classes = await Class.find();
    }

    res.status(200).json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Join Class
exports.joinClass = async (req, res) => {
  try {
    const { classId, userId } = req.body;
    const classObj = await Class.findById(classId);

    if (!classObj.students.includes(userId)) {
      classObj.students.push(userId);
      await classObj.save();
    }

    res.status(200).json({ message: 'Joined class successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get Class Details
exports.getClassById = async (req, res) => {
  try {
    const classId = req.params.classId;
    const classObj = await Class.findById(classId)
      .populate('createdBy', 'name')
      .populate('students', 'name')
      .populate('coordinators', 'name');

    res.status(200).json(classObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Toggle Favourite
exports.toggleFavourite = async (req, res) => {
  try {
    const { classId, userId } = req.body;
    const classObj = await Class.findById(classId);

    const index = classObj.favourites.indexOf(userId);
    if (index === -1) {
      classObj.favourites.push(userId);
    } else {
      classObj.favourites.splice(index, 1);
    }

    await classObj.save();
    res.status(200).json({ message: 'Updated favourites' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add Coordinator
exports.addCoordinator = async (req, res) => {
  try {
    const { classId, userId } = req.body;
    const classObj = await Class.findById(classId);
    if (!classObj.coordinators.includes(userId)) {
      classObj.coordinators.push(userId);
      await classObj.save();
    }
    res.status(200).json({ message: 'Coordinator added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Remove Coordinator
exports.removeCoordinator = async (req, res) => {
  try {
    const { classId, userId } = req.body;
    const classObj = await Class.findById(classId);
    classObj.coordinators = classObj.coordinators.filter(id => id != userId);
    await classObj.save();
    res.status(200).json({ message: 'Coordinator removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
