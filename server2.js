const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const multer = require('multer');
const multerS3 = require('multer-s3');

const app = express();
const port = 3000;

// AWS 설정
AWS.config.update({
    region: 'ap-northeast-2',
});

const s3 = new AWS.S3();
const bucketName = 'pado-test-bucket';

// CloudFront 배포 도메인 이름
const cloudFrontUrl = 'https://d3jjkndke92ugp.cloudfront.net'

// CORS 설정
app.use(cors());

// 파일 업로드를 처리할 multer 설정
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: bucketName,
        key: (req, file, cb) => {
            cb(null, Date.now().toString() + '-' + file.originalname);
        }
    })
});

// 파일 업로드를 위한 POST 라우트
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        console.error('File not uploaded'); // Debugging log
        return res.status(400).json({ error: 'File not uploaded' });
    }
    console.log('Uploaded file:', req.file); // Debugging log
    res.status(200).json({ message: 'File uploaded successfully', file: req.file });
});

// S3에서 파일 목록을 가져오는 GET 라우트
app.get('/file-list', async (req, res) => {
    try {
        const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
        const objectLists = data.Contents.map((item) => item.Key);
        console.log('File list:', objectLists); // Debugging log
        res.json(objectLists);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: error.message });
    }
});

// 서명된 URL을 생성하는 GET 라우트
app.get('/file-url/:key(*)', (req, res) => {
    const key = req.params.key;
    const url = `${cloudFrontUrl}/${encodeURIComponent(key)}`;
    console.log('CloudFront URL:', url); // Debugging log
    res.json({ url });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running at http://localhost:${port}`);
});

