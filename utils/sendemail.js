const nodemailer = require('nodemailer');

const sendEmail = async (to, content, subject) => {
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.AUTH_EMAIL,
      pass: process.env.AUTH_PASS,
    },
  });

  const mailOptions = {
    from: process.env.AUTH_EMAIL,
    to,
    subject,
    text: content,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
