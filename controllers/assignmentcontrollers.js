const Assignment = require('../models/assignment');
const Class = require('../models/Class');

exports.createAssignment = async (req, res) => {
  try {
    const {
      title,
      description,
      classId,
      dueDate,
      maxMarks,
      attachments,
      instructions,
      allowLateSubmission,
      category
    } = req.body;

    if (!title || !description || !classId) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, and class ID are required'
      });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userId = req.user.id;

    const classObj = await Class.findById(classId);
    if (!classObj) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }

    const hasPermission =
      classObj.createdBy.toString() === userId ||
      classObj.coordinators.includes(userId);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Only class creator or coordinators can create assignments'
      });
    }

    if (dueDate && new Date(dueDate) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Due date cannot be in the past'
      });
    }

    const newAssignment = new Assignment({
      title,
      description,
      classId,
      createdBy: userId,
      dueDate: dueDate || null,
      maxMarks: maxMarks || 100,
      attachments: attachments || [],
      instructions: instructions || '',
      allowLateSubmission: allowLateSubmission || false,
      category: category || 'assignment',
      status: 'active'
    });

    await newAssignment.save();
    await newAssignment.populate('createdBy', 'name email profilePicture');
    await newAssignment.populate('classId', 'className subject');

    res.status(201).json({
      success: true,
      message: 'Assignment created successfully',
      assignment: {
        _id: newAssignment._id,
        title: newAssignment.title,
        description: newAssignment.description,
        classId: newAssignment.classId,
        createdBy: newAssignment.createdBy,
        dueDate: newAssignment.dueDate,
        maxMarks: newAssignment.maxMarks,
        attachments: newAssignment.attachments,
        instructions: newAssignment.instructions,
        allowLateSubmission: newAssignment.allowLateSubmission,
        category: newAssignment.category,
        status: newAssignment.status,
        submissionsCount: 0,
        createdAt: newAssignment.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to create assignment',
      error: err.message
    });
  }
};

exports.getClassAssignments = async (req, res) => {
  try {
    const { classId } = req.params;
    const { status, category } = req.query;
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

    const hasAccess =
      classObj.createdBy.toString() === userId ||
      classObj.students.includes(userId) ||
      classObj.coordinators.includes(userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this class'
      });
    }

    const query = { classId };
    if (status) query.status = status;
    if (category) query.category = category;

    const assignments = await Assignment.find(query)
      .populate('createdBy', 'name email profilePicture')
      .populate('classId', 'className subject')
      .sort({ createdAt: -1 });

    const assignmentsWithStatus = await Promise.all(
      assignments.map(async assignment => {
        const obj = assignment.toObject();
        obj.hasSubmitted = assignment.submissions?.some(
          sub => sub.studentId.toString() === userId
        );
        obj.submissionsCount = assignment.submissions?.length || 0;
        obj.isOverdue = assignment.dueDate && new Date() > new Date(assignment.dueDate);
        return obj;
      })
    );

    res.status(200).json({
      success: true,
      assignments: assignmentsWithStatus,
      count: assignmentsWithStatus.length,
      className: classObj.className
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignments',
      error: err.message
    });
  }
};

exports.getAssignmentById = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user.id;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Assignment ID format'
      });
    }

    const assignment = await Assignment.findById(assignmentId)
      .populate('createdBy', 'name email profilePicture')
      .populate('classId', 'className subject createdBy students coordinators')
      .populate('submissions.studentId', 'name email profilePicture');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    const classObj = assignment.classId;
    const hasAccess =
      classObj.createdBy.toString() === userId ||
      classObj.students.includes(userId) ||
      classObj.coordinators.includes(userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this assignment'
      });
    }

    const assignmentObj = assignment.toObject();
    const userSubmission = assignment.submissions?.find(
      sub => sub.studentId._id.toString() === userId
    );

    assignmentObj.hasSubmitted = !!userSubmission;
    assignmentObj.userSubmission = userSubmission || null;
    assignmentObj.submissionsCount = assignment.submissions?.length || 0;
    assignmentObj.isOverdue = assignment.dueDate && new Date() > new Date(assignment.dueDate);
    assignmentObj.isCreator = assignment.createdBy._id.toString() === userId;

    res.status(200).json({
      success: true,
      assignment: assignmentObj
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment details',
      error: err.message
    });
  }
};

exports.updateAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user.id;
    const updateData = req.body;

    const assignment = await Assignment.findById(assignmentId).populate('classId', 'createdBy coordinators');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    const hasPermission =
      assignment.createdBy.toString() === userId ||
      assignment.classId.coordinators.includes(userId);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Only assignment creator or class coordinators can update assignments'
      });
    }

    if (updateData.dueDate && new Date(updateData.dueDate) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Due date cannot be in the past'
      });
    }

    const updatedAssignment = await Assignment.findByIdAndUpdate(
      assignmentId,
      { ...updateData, updatedAt: new Date() },
      { new: true }
    )
      .populate('createdBy', 'name email profilePicture')
      .populate('classId', 'className subject');

    res.status(200).json({
      success: true,
      message: 'Assignment updated successfully',
      assignment: updatedAssignment
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to update assignment',
      error: err.message
    });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const userId = req.user.id;

    const assignment = await Assignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    if (assignment.createdBy.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only assignment creator can delete the assignment'
      });
    }

    await Assignment.findByIdAndDelete(assignmentId);

    res.status(200).json({
      success: true,
      message: 'Assignment deleted successfully'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete assignment',
      error: err.message
    });
  }
};
