const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const passport = require("passport");
const session = require('express-session');
const helmet = require("helmet");
const bodyParser = require('body-parser');
const userRoutes = require("./routes/userroutes");
const classRoutes = require('./routes/classroutes');
const assignmentRoutes = require('./routes/assignmentroutes');


dotenv.config(); 

const app = express();

app.use(
  helmet({
    crossOriginOpenerPolicy: false,
  })
);

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET
}));

require("./config/passport"); 
app.use(passport.initialize());
app.use(passport.session());

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'], 
  allowedHeaders: ['Content-Type', 'Authorization'], 
  credentials: true 
}));

app.use(bodyParser.json());

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected successfully');

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
})();

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
app.use("/user", userRoutes);
app.use('/api/class', classRoutes);
app.use('/api/assign', assignmentRoutes);
