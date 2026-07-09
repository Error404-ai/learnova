const User = require("../models/User");
const CommunityPost = require('../models/CommunityPost');
const Class = require('../models/Class');
const Assignment = require('../models/assignment');
const Meeting = require('../models/Meeting');

// ---------------------------------------------------------------------------
// GET /api/users/dashboard
// FIX: this used to be defined twice in this file (the second definition
// silently overwrote the first, so `postsCount` never actually made it to the
// frontend). Merged into one function, and added role-specific stats so the
// student dashboard and teacher dashboard get different numbers back from the
// same endpoint.
// ---------------------------------------------------------------------------
exports.getDashboard = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id)
            .populate('classrooms.classroomId', 'className subject classCode')
            .select('-password -refreshToken');

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const unreadNotifications = user.notifications.filter(notif => !notif.isRead).length;
        const postsCount = await CommunityPost.countDocuments({ author: req.user.id });

        const baseData = {
            user: {
                name: user.name,
                email: user.email,
                role: user.role,
                profilePicture: user.profilePicture
            },
            classrooms: user.classrooms,
            postsCount,
            unreadNotifications,
            recentNotifications: user.notifications
                .filter(notif => !notif.isRead)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 5)
        };

        if (user.role === 'teacher') {
            const classes = await Class.find({ createdBy: user._id }).select('_id students');
            const classIds = classes.map(c => c._id);
            const totalStudents = classes.reduce((sum, c) => sum + c.students.length, 0);

            const assignmentsCreated = await Assignment.countDocuments({ createdBy: user._id });

            const assignments = await Assignment.find({ classId: { $in: classIds } })
                .select('submissions');
            const pendingGrading = assignments.reduce(
                (sum, a) => sum + a.submissions.filter(s => s.status === 'submitted').length,
                0
            );

            return res.json({
                ...baseData,
                stats: {
                    classesTaught: classes.length,
                    totalStudents,
                    assignmentsCreated,
                    pendingGrading
                }
            });
        }

        // student
        return res.json({
            ...baseData,
            stats: {
                enrolledClasses: user.classrooms.filter(c => c.role === 'student').length,
                totalAssignments: user.academicStats?.totalAssignments || 0,
                completedAssignments: user.academicStats?.completedAssignments || 0,
                averageGrade: user.academicStats?.averageGrade || 0
            }
        });
    } catch (error) {
        console.error("Error in getDashboard:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// ---------------------------------------------------------------------------
// GET /api/users/assignments/status-summary
// Was declared as a route but never implemented/exported - this is why the
// AssignmentStatusBarChart request was failing.
// Returns { pending, overdue, completed } shaped for that chart, computed
// differently depending on role.
// ---------------------------------------------------------------------------
exports.getAssignmentStatusSummary = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id).select('role classrooms');
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const now = new Date();

        if (user.role === 'teacher') {
            const classes = await Class.find({ createdBy: user._id }).select('_id');
            const classIds = classes.map(c => c._id);
            const assignments = await Assignment.find({ classId: { $in: classIds } });

            let pending = 0;    // submissions awaiting grading
            let completed = 0;  // graded submissions
            let overdue = 0;    // assignments past due date, not yet fully graded

            assignments.forEach(a => {
                a.submissions.forEach(s => {
                    if (s.status === 'submitted') pending += 1;
                    if (s.status === 'graded') completed += 1;
                });
                const hasUngraded = a.submissions.some(s => s.status === 'submitted');
                if (a.dueDate && a.dueDate < now && hasUngraded) overdue += 1;
            });

            return res.json({ pending, overdue, completed });
        }

        // student: look at classes they belong to, and their own submission
        // status for each assignment in those classes
        const classIds = user.classrooms
            .filter(c => c.role === 'student')
            .map(c => c.classroomId);

        const assignments = await Assignment.find({
            classId: { $in: classIds },
            status: 'active'
        });

        let pending = 0;
        let overdue = 0;
        let completed = 0;

        assignments.forEach(a => {
            const mySubmission = a.submissions.find(
                s => s.studentId.toString() === user._id.toString()
            );

            if (mySubmission) {
                completed += 1; // submitted or graded both count as "done" from student's side
            } else if (a.dueDate && a.dueDate < now) {
                overdue += 1;
            } else {
                pending += 1;
            }
        });

        res.json({ pending, overdue, completed });
    } catch (error) {
        console.error("Error in getAssignmentStatusSummary:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

// ---------------------------------------------------------------------------
// GET /api/users/attendance/weekly
// Was also declared but never implemented. There's no dedicated Attendance
// model in this codebase, so this derives attendance from Meeting.attendees
// for the current Mon-Sun week, across classes the user belongs to.
// Returns an array of 7 entries: [{ day: 'Mon', date, attended, minutes }, ...]
// ---------------------------------------------------------------------------
exports.getWeeklyAttendance = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id).select('role classrooms');
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const classIds = user.role === 'teacher'
            ? (await Class.find({ createdBy: user._id }).select('_id')).map(c => c._id)
            : user.classrooms.map(c => c.classroomId);

        // Monday-Sunday range for the current week
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 = Sun
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setHours(0, 0, 0, 0);
        monday.setDate(monday.getDate() + diffToMonday);
        const nextMonday = new Date(monday);
        nextMonday.setDate(monday.getDate() + 7);

        const meetings = await Meeting.find({
            classId: { $in: classIds },
            scheduledDate: { $gte: monday, $lt: nextMonday }
        }).select('scheduledDate attendees');

        const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const week = dayLabels.map((label, i) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            return { day: label, date, attended: false, minutes: 0 };
        });

        meetings.forEach(meeting => {
            const dayIndex = (new Date(meeting.scheduledDate).getDay() + 6) % 7; // Mon=0..Sun=6
            const attendee = meeting.attendees.find(
                a => a.userId.toString() === user._id.toString()
            );
            if (attendee) {
                week[dayIndex].attended = true;
                week[dayIndex].minutes += attendee.duration || 0;
            }
        });

        res.json({ week });
    } catch (error) {
        console.error("Error in getWeeklyAttendance:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { 
            name, 
            bio, 
            phone, 
            grade, 
            subject, 
            school, 
            studentId, 
            teacherId,
            profilePicture,
            message,
            role
        } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (name !== undefined) user.name = name;
        if (bio !== undefined) user.bio = bio;
        if (phone !== undefined) user.phone = phone;
        if (grade !== undefined) user.grade = grade;
        if (subject !== undefined) user.subject = subject;
        if (school !== undefined) user.school = school;
        if (studentId !== undefined) user.studentId = studentId;
        if (teacherId !== undefined) user.teacherId = teacherId;
        if (role !== undefined) {
            if (!['student', 'teacher'].includes(role)) {
                return res.status(400).json({ error: 'Invalid role value' });
            }
            user.role = role;
        }
        if (profilePicture !== undefined) user.profilePicture = profilePicture;
        if (message !== undefined) user.message = message;

        await user.save();

        res.json({ 
            message: "Profile updated successfully", 
            user: {
                name: user.name,
                bio: user.bio,
                phone: user.phone,
                grade: user.grade,
                subject: user.subject,
                school: user.school,
                studentId: user.studentId,
                teacherId: user.teacherId,
                profilePicture: user.profilePicture,
                message: user.message
            }
        });
    } catch (error) {
        console.error("Error in updateProfile:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.updateMessage = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { message } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: "Message is required" });
        }

        if (message.length > 200) {
            return res.status(400).json({ error: "Message must be less than 200 characters" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        user.message = message.trim();
        await user.save();

        res.json({ 
            message: "Status message updated successfully", 
            userMessage: user.message
        });
    } catch (error) {
        console.error("Error in updateMessage:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.updatePreferences = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { emailNotifications, pushNotifications, theme, language } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        user.preferences = user.preferences || {};

        if (emailNotifications !== undefined) user.preferences.emailNotifications = emailNotifications;
        if (pushNotifications !== undefined) user.preferences.pushNotifications = pushNotifications;
        if (theme !== undefined) user.preferences.theme = theme;
        if (language !== undefined) user.preferences.language = language;

        user.markModified("preferences");
        await user.save();

        res.json({ 
            message: "Preferences updated successfully", 
            preferences: user.preferences 
        });
    } catch (error) {
        console.error("Error in updatePreferences:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id)
            .populate('classrooms.classroomId', 'className subject classCode')
            .select('-password -refreshToken');

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ user });
    } catch (error) {
        console.error("Error in getProfile:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.joinClassroom = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { classroomId, role = 'student' } = req.body;

        if (!classroomId) {
            return res.status(400).json({ error: "Classroom ID is required" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const existingClassroom = user.classrooms.find(
            classroom => classroom.classroomId.toString() === classroomId
        );

        if (existingClassroom) {
            return res.status(400).json({ error: "Already joined this classroom" });
        }

        user.classrooms.push({
            classroomId: classroomId,
            role: role,
            joinedAt: new Date()
        });

        await user.save();

        res.json({ 
            message: "Successfully joined classroom",
            classroom: user.classrooms[user.classrooms.length - 1]
        });
    } catch (error) {
        console.error("Error in joinClassroom:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.leaveClassroom = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { classroomId } = req.body;

        if (!classroomId) {
            return res.status(400).json({ error: "Classroom ID is required" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        user.classrooms = user.classrooms.filter(
            classroom => classroom.classroomId.toString() !== classroomId
        );

        await user.save();

        res.json({ message: "Successfully left classroom" });
    } catch (error) {
        console.error("Error in leaveClassroom:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const user = await User.findById(req.user.id).select('notifications');
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const notifications = user.notifications.sort((a, b) => b.createdAt - a.createdAt);

        res.json({ notifications });
    } catch (error) {
        console.error("Error in getNotifications:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

exports.markNotificationRead = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(400).json({ error: "User ID not found in token" });
        }

        const userId = req.user.id;
        const { notificationId } = req.body;

        if (!notificationId) {
            return res.status(400).json({ error: "Notification ID is required" });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const notification = user.notifications.id(notificationId);
        if (!notification) {
            return res.status(404).json({ error: "Notification not found" });
        }

        notification.isRead = true;
        await user.save();

        res.json({ message: "Notification marked as read" });
    } catch (error) {
        console.error("Error in markNotificationRead:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};