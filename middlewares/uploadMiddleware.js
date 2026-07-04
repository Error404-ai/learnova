const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');

// Files are stored in S3 instead of local EC2 disk. Local disk storage does not
// survive instance replacement/rebuild (this happened once already -- every
// previously uploaded file was lost when the instance changed). S3 storage is
// independent of the EC2 instance's lifecycle.
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET;

const fileFilter = function (req, file, cb) {
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf' ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || // docx
    file.mimetype === 'application/msword' // doc
  ) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file format'), false);
  }
};

// Builds a multer-s3 storage engine that writes into a given "folder" prefix
// inside the bucket (e.g. "assignments" or "community"), mirroring the old
// local folder structure.
function makeS3Storage(folder) {
  return multerS3({
    s3,
    bucket: BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    // No ACL is set here on purpose -- buckets created after April 2023 default
    // to "ACLs disabled", and passing an ACL against such a bucket throws.
    // Public read access is granted via a bucket policy instead (see setup notes).
    key: function (req, file, cb) {
      const ext = file.originalname.includes('.') ? '.' + file.originalname.split('.').pop() : '';
      const filename = `${folder}/${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, filename);
    },
  });
}

const upload = multer({
  storage: makeS3Storage('assignments'),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadAssignmentFiles = upload.array('attachments', 5);

const communityUpload = multer({
  storage: makeS3Storage('community'),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadCommunityFiles = communityUpload.array('attachments', 4);

module.exports = { uploadAssignmentFiles, uploadCommunityFiles };