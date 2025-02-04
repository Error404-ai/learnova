const jwt = require('jsonwebtoken');

const authenticateUser = (req, res, next) => {
    console.log("Headers received:", req.headers);  // Debugging log

    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];  // Extract token after "Bearer "
    if (!token) {
        return res.status(401).json({ message: 'Token format incorrect' });
    }

    jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }

        req.user = decoded;
        next();
    });
};

module.exports = {authenticateUser};
