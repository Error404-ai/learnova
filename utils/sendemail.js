const nodemailer = require('nodemailer');

const sendEmail = async (to, content, subject) => {
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: content,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
