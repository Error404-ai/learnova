const Class = require('../models/Class');
const User = require('../models/User');

const generateClassCode = () => {
  return Math.random().toString(36).substr(2, 8).toUpperCase(); // Generates 8-character code like "AB12CD34"
};
exports.createClass = async (req, res) => {
  try {
    const { className, subject, privacy, description } = req.body;

    if (!className || !subject) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class name and subject are required' 
      });
    }
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const classCode = generateClassCode();

    // Create new class
    const newClass = new Class({ 
      className, 
      subject, 
      privacy: privacy || 'private',
      createdBy: req.user.id,
      classCode
    });

    // Save the class to DB
    await newClass.save();

    // Populate creator's name and email in response
    await newClass.populate('createdBy', 'name email');

    // Send success response
    res.status(201).json({
      success: true,
      message: 'Class created successfully',
      class: {
        _id: newClass._id,
        className: newClass.className,
        subject: newClass.subject,
        classCode: newClass.classCode,
        privacy: newClass.privacy,
        createdBy: newClass.createdBy,
        studentsCount: newClass.students.length,
        createdAt: newClass.createdAt
      }
    });
  } catch (err) {
    console.error('Error creating class:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create class',
      error: err.message 
    });
  }
};

// Get All Classes (with filter) - User must be authenticated
exports.getAllClasses = async (req, res) => {
  try {
    console.log('req.user:', req.user); // Debug: Check if user exists
    console.log('req.user.id:', req.user?.id); // Debug: Check user ID
    
    const { filter } = req.query;
    
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required - user not found in request' 
      });
    }
    
    const userId = req.user.id;
    console.log('Using userId:', userId); // Debug: Confirm userId
    
    let classes;

    switch (filter) {
      case 'joined':
        classes = await Class.find({ students: userId })
          .populate('createdBy', 'name email')
          .select('className subject classCode privacy studentsCount createdAt');
        break;
      case 'created':
        console.log('Fetching created classes for userId:', userId); // Debug
        classes = await Class.find({ createdBy: userId })
          .populate('createdBy', 'name email')
          .populate('students', 'name email')
          .select('className subject classCode privacy students createdAt');
        console.log('Found created classes:', classes.length); // Debug
        break;
      case 'favourite':
        classes = await Class.find({ favourites: userId })
          .populate('createdBy', 'name email')
          .select('className subject classCode privacy studentsCount createdAt');
        break;
      default:
        classes = await Class.find({
          $or: [
            { privacy: 'public' },
            { students: userId },
            { createdBy: userId },
            { coordinators: userId }
          ]
        })
        .populate('createdBy', 'name email')
        .select('className subject classCode privacy studentsCount createdAt');
    }

    // Add student count to each class
    const classesWithCount = classes.map(classItem => ({
      ...classItem.toObject(),
      studentsCount: classItem.students ? classItem.students.length : 0
    }));

    res.status(200).json({
      success: true,
      classes: classesWithCount,
      count: classesWithCount.length
    });
  } catch (err) {
    console.error('Error fetching classes:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch classes',
      error: err.message 
    });
  }
};
// Join Class using Class Code
exports.joinClassByCode = async (req, res) => {
  try {
    const { classCode } = req.body;
    const userId = req.user.id;

    if (!classCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class code is required' 
      });
    }

    // Find class by code
    const classObj = await Class.findOne({ classCode: classCode.toUpperCase() })
      .populate('createdBy', 'name email');

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid class code' 
      });
    }

    // Check if user is the creator
    if (classObj.createdBy._id.toString() === userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot join your own class' 
      });
    }

    // Check if already joined
    if (classObj.students.includes(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Already joined this class' 
      });
    }

    // Add student to class
    classObj.students.push(userId);
    await classObj.save();

    res.status(200).json({ 
      success: true, 
      message: 'Successfully joined the class',
      class: {
        _id: classObj._id,
        className: classObj.className,
        subject: classObj.subject,
        classCode: classObj.classCode,
        createdBy: classObj.createdBy
      }
    });
  } catch (err) {
    console.error('Error joining class:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to join class',
      error: err.message 
    });
  }
};

// Leave Class
exports.leaveClass = async (req, res) => {
  try {
    const { classId } = req.body;
    const userId = req.user.id;

    if (!classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID is required' 
      });
    }

    const classObj = await Class.findById(classId);

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Check if user is the creator
    if (classObj.createdBy.toString() === userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot leave your own class. Delete it instead.' 
      });
    }

    // Remove student from class
    classObj.students = classObj.students.filter(id => id.toString() !== userId);
    classObj.favourites = classObj.favourites.filter(id => id.toString() !== userId);
    await classObj.save();

    res.status(200).json({ 
      success: true, 
      message: 'Successfully left the class' 
    });
  } catch (err) {
    console.error('Error leaving class:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to leave class',
      error: err.message 
    });
  }
};

// Get Class Details by ID
exports.getClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.id;

    const classObj = await Class.findById(classId)
      .populate('createdBy', 'name email profilePicture')
      .populate('students', 'name email profilePicture')
      .populate('coordinators', 'name email profilePicture');

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Check if user has access to this class
    const hasAccess = classObj.privacy === 'public' || 
                     classObj.createdBy._id.toString() === userId ||
                     classObj.students.some(student => student._id.toString() === userId) ||
                     classObj.coordinators.some(coord => coord._id.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this class' 
      });
    }

    // Check if current user is joined
    const isJoined = classObj.students.some(student => student._id.toString() === userId);
    const isFavourite = classObj.favourites.includes(userId);
    const isCreator = classObj.createdBy._id.toString() === userId;

    res.status(200).json({
      success: true,
      class: {
        ...classObj.toObject(),
        isJoined,
        isFavourite,
        isCreator,
        studentsCount: classObj.students.length
      }
    });
  } catch (err) {
    console.error('Error fetching class details:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch class details',
      error: err.message 
    });
  }
};

// Get Class Details by Class Code
exports.getClassByCode = async (req, res) => {
  try {
    const { classCode } = req.params;
    const userId = req.user.id;

    const classObj = await Class.findOne({ classCode: classCode.toUpperCase() })
      .populate('createdBy', 'name email profilePicture')
      .select('className subject classCode privacy description createdBy studentsCount createdAt');

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found with this code' 
      });
    }

    // Check if already joined
    const isJoined = await Class.findOne({ 
      classCode: classCode.toUpperCase(), 
      students: userId 
    });

    res.status(200).json({
      success: true,
      class: {
        ...classObj.toObject(),
        isJoined: !!isJoined,
        studentsCount: classObj.students ? classObj.students.length : 0
      }
    });
  } catch (err) {
    console.error('Error fetching class by code:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch class details',
      error: err.message 
    });
  }
};

// Toggle Favourite
exports.toggleFavourite = async (req, res) => {
  try {
    const { classId } = req.body;
    const userId = req.user.id;

    if (!classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID is required' 
      });
    }

    const classObj = await Class.findById(classId);

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    const index = classObj.favourites.indexOf(userId);
    let action;

    if (index === -1) {
      classObj.favourites.push(userId);
      action = 'added to';
    } else {
      classObj.favourites.splice(index, 1);
      action = 'removed from';
    }

    await classObj.save();

    res.status(200).json({ 
      success: true, 
      message: `Class ${action} favourites`,
      isFavourite: index === -1
    });
  } catch (err) {
    console.error('Error toggling favourite:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update favourites',
      error: err.message 
    });
  }
};

// Add Coordinator (Only class creator can add coordinators)
exports.addCoordinator = async (req, res) => {
  try {
    const { classId, userEmail } = req.body;
    const userId = req.user.id;

    if (!classId || !userEmail) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID and user email are required' 
      });
    }

    const classObj = await Class.findById(classId);

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Check if current user is the creator
    if (classObj.createdBy.toString() !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only class creator can add coordinators' 
      });
    }

    // Find user by email
    const userToAdd = await User.findOne({ email: userEmail.toLowerCase() });

    if (!userToAdd) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found with this email' 
      });
    }

    // Check if user is already a coordinator
    if (classObj.coordinators.includes(userToAdd._id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'User is already a coordinator' 
      });
    }

    classObj.coordinators.push(userToAdd._id);
    await classObj.save();

    res.status(200).json({ 
      success: true, 
      message: 'Coordinator added successfully',
      coordinator: {
        _id: userToAdd._id,
        name: userToAdd.name,
        email: userToAdd.email
      }
    });
  } catch (err) {
    console.error('Error adding coordinator:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to add coordinator',
      error: err.message 
    });
  }
};

// Remove Coordinator (Only class creator can remove coordinators)
exports.removeCoordinator = async (req, res) => {
  try {
    const { classId, coordinatorId } = req.body;
    const userId = req.user.id;

    if (!classId || !coordinatorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID and coordinator ID are required' 
      });
    }

    const classObj = await Class.findById(classId);

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Check if current user is the creator
    if (classObj.createdBy.toString() !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only class creator can remove coordinators' 
      });
    }

    classObj.coordinators = classObj.coordinators.filter(id => id.toString() !== coordinatorId);
    await classObj.save();

    res.status(200).json({ 
      success: true, 
      message: 'Coordinator removed successfully' 
    });
  } catch (err) {
    console.error('Error removing coordinator:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove coordinator',
      error: err.message 
    });
  }
};

// Delete Class (Only creator can delete)
exports.deleteClass = async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.id;

    const classObj = await Class.findById(classId);

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }


    if (classObj.createdBy.toString() !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only class creator can delete the class' 
      });
    }

    await Class.findByIdAndDelete(classId);

    res.status(200).json({ 
      success: true, 
      message: 'Class deleted successfully' 
    });
  } catch (err) {
    console.error('Error deleting class:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete class',
      error: err.message 
    });
  }
};
exports.getClassmates = async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.id;

    if (!classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Class ID is required' 
      });
    }
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid Class ID format' 
      });
    }

    const classObj = await Class.findById(classId)
      .populate('students', 'name email profilePicture bio message lastSeen')
      .populate('createdBy', 'name email profilePicture bio message lastSeen')
      .populate('coordinators', 'name email profilePicture bio message lastSeen');

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    const hasAccess = classObj.privacy === 'public' || 
                     classObj.createdBy._id.toString() === userId ||
                     classObj.students.some(student => student._id.toString() === userId) ||
                     classObj.coordinators.some(coord => coord._id.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this class' 
      });
    }

    let classmates = [...classObj.students];
    

    const creatorIsStudent = classObj.students.some(student => 
      student._id.toString() === classObj.createdBy._id.toString()
    );
    
    if (!creatorIsStudent) {
      classmates.push(classObj.createdBy);
    }

    if (classObj.coordinators && classObj.coordinators.length > 0) {
      classObj.coordinators.forEach(coordinator => {
        const isAlreadyIncluded = classmates.some(mate => 
          mate._id.toString() === coordinator._id.toString()
        );
        if (!isAlreadyIncluded) {
          classmates.push(coordinator);
        }
      });
    }

    classmates = classmates.filter(classmate => 
      classmate._id.toString() !== userId
    );

    const formattedClassmates = classmates.map(classmate => ({
      _id: classmate._id,
      name: classmate.name,
      email: classmate.email,
      profilePicture: classmate.profilePicture || null,
      message: classmate.message || classmate.bio || "Available for study sessions",
      lastSeen: classmate.lastSeen || new Date(),
      isOnline: classmate.lastSeen && (new Date() - new Date(classmate.lastSeen)) < 5 * 60 * 1000 // Online if last seen within 5 minutes
    }));

    res.status(200).json({
      success: true,
      classmates: formattedClassmates,
      count: formattedClassmates.length,
      className: classObj.className
    });

  } catch (err) {
    console.error('Error fetching classmates:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch classmates',
      error: err.message 
    });
  }
};

exports.getClassById = async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user.id;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid Class ID format' 
      });
    }

    const classObj = await Class.findById(classId)
      .populate('createdBy', 'name email profilePicture bio message lastSeen')
      .populate('students', 'name email profilePicture bio message lastSeen')
      .populate('coordinators', 'name email profilePicture bio message lastSeen');

    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    const hasAccess = classObj.privacy === 'public' || 
                     classObj.createdBy._id.toString() === userId ||
                     classObj.students.some(student => student._id.toString() === userId) ||
                     classObj.coordinators.some(coord => coord._id.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied to this class' 
      });
    }

    const isJoined = classObj.students.some(student => student._id.toString() === userId);
    const isFavourite = classObj.favourites.includes(userId);
    const isCreator = classObj.createdBy._id.toString() === userId;

    const formattedStudents = classObj.students.map(student => ({
      _id: student._id,
      name: student.name,
      email: student.email,
      profilePicture: student.profilePicture || null,
      message: student.message || student.bio || "Available for study sessions",
      lastSeen: student.lastSeen || new Date(),
      isOnline: student.lastSeen && (new Date() - new Date(student.lastSeen)) < 5 * 60 * 1000
    }));

    res.status(200).json({
      success: true,
      class: {
        ...classObj.toObject(),
        students: formattedStudents,
        isJoined,
        isFavourite,
        isCreator,
        studentsCount: classObj.students.length
      }
    });
  } catch (err) {
    console.error('Error fetching class details:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch class details',
      error: err.message 
    });
  }
};