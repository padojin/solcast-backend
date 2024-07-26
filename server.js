require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const mysql = require("mysql2");
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { createServer } = require('http'); // 추가
const WebSocket = require('ws'); // 추가

const app = express();
const port = 3001;

// AWS 설정
AWS.config.update({
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION,
});
const s3 = new AWS.S3();
const inputBucketName = process.env.INPUT_BUCKET_NAME;
const outputBucketName = process.env.OUTPUT_BUCKET_NAME;

// 커넥션을 정의합니다.
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});
connection.connect((err) => {
    if (err) {
        console.error('error connecting: ' + err.stack);
        return;
    }
    console.log('connected as id ' + connection.threadId);
});

// CORS 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/public')));

// Health check endpoint
app.get('/health', (req, res) => res.status(200).send('OK'));

//--------------------------------------------------------------- 파일 관련
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: inputBucketName,
        key: (req, file, cb) => {
            cb(null, Date.now().toString() + '-' + file.originalname);
        }
    })
});

const generateThumbnail = (inputPath, outputPath) => {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .screenshots({
                timestamps: ['50%'],
                filename: path.basename(outputPath),
                folder: path.dirname(outputPath),
                size: '320x240'
            });
    });
};

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'File not uploaded' });
    } else {
        connection.query('SELECT MAX(file_no) AS maxFileNo FROM tb_files', (error, results) => {
            if (error) {
                console.error('Error querying max file_no:', error);
                return res.status(500).json({ error: error.message });
            }

            let maxFileNo = results[0].maxFileNo;
            const fileNo = maxFileNo ? maxFileNo + 1 : 1;
            const { originalname, location, key } = req.file;
            const fileCode = "XXXX" + String(fileNo).padStart(4, "0");
            const fileUrl = location;
            const fileName = originalname;
            const thumbnailKey = `thumbnails/${key.split('.')[0]}.png`;
            const thumbnailPath = `/tmp/${thumbnailKey}`;
            
            generateThumbnail(location, thumbnailPath)
                .then(() => {
                    const fileContent = fs.readFileSync(thumbnailPath);
                    s3.upload({
                        Bucket: outputBucketName,
                        Key: thumbnailKey,
                        Body: fileContent,
                        ACL: 'public-read'
                    }, (err, data) => {
                        if (err) {
                            return res.status(500).json({ error: err.message });
                        }

                        connection.query('INSERT INTO tb_files (file_no, file_code, file_url, file_name, file_CDT, thumbnail_url) VALUES (?, ?, ?, ?, NOW(), ?)',
                            [fileNo, fileCode, fileUrl, fileName, data.Location],
                            (err) => {
                                if (err) {
                                    return res.status(500).json({ error: err.message });
                                }
                                fs.unlinkSync(thumbnailPath);
                                res.status(200).json({ message: 'File uploaded and saved successfully', file: req.file, thumbnail: data.Location });
                            }
                        );
                    });
                })
                .catch(err => res.status(500).json({ error: err.message }));
        });
    }
});

app.get('/file-url/:key(*)', (req, res) => {
    const key = req.params.key;
    const params = {
        Bucket: outputBucketName,
        Key: key,
        Expires: 60
    };

    const url = s3.getSignedUrl('getObject', params);
    res.json({ url });
});

app.get('/get-video-url/:fileCode', (req, res) => {
    const fileCode = req.params.fileCode;
    connection.query('SELECT file_url FROM tb_files WHERE file_code = ?', [fileCode], (error, results) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        if (results.length > 0) {
            res.json({ url: results[0].file_url });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    });
});

//--------------------------------------------------------------- 메인게시물 관련
app.post('/main', (req, res) => {
    const { mainTitle, mainAuthor, mainCtgy } = req.body;
    if (!mainTitle || !mainAuthor || !mainCtgy) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const mainCompany = "testCom";
    connection.query('SELECT MAX(main_no) AS maxmainNo FROM tb_main', (error, results) => {
        if (error) {
            console.error('Database query error:', error);
            return res.status(500).json({ error: error.message });
        }
        let maxmainNo = results[0].maxmainNo;
        let mainNo = maxmainNo ? maxmainNo + 1 : 1;
        const params = {
            mainNo: mainNo,
            mainTitle: mainTitle,
            mainAuthor: mainAuthor,
            mainCtgy: mainCtgy,
            mainCompany: mainCompany
        };
        connection.query(`INSERT INTO tb_main (main_no, main_ctgy, main_title, main_author, main_company)
            VALUES (?, ?, ?, ?, ?)`, [mainNo, mainCtgy, mainTitle, mainAuthor, mainCompany], function (error) {
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            res.status(200).json({ message: 'main entry created successfully', mainNo: mainNo });
        });
    });
});

app.get('/main/list', function (req, res) {
    connection.query(`SELECT main_no, main_ctgy, main_title, main_author, main_company
                        FROM tb_main`, function (err, rows) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.get('/main/detail/:mainNo', function (req, res) {
    const mainNo = req.query.mainNo;
    connection.query(`SELECT main_no, main_ctgy, main_title, main_author, main_company
                        FROM tb_main
                       WHERE main_no = ?`, [mainNo], function (err, results) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results[0]);
    });
});

//--------------------------------------------------------------- 게시물 관련
app.post('/board', (req, res) => {
    const { boardTitle, boardTeacher, boardMemo, fileCode } = req.body;
    connection.query('SELECT MAX(board_no) AS maxBoardNo FROM tb_board', (error, results) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        let maxBoardNo = results[0].maxBoardNo;
        let boardNo = maxBoardNo ? maxBoardNo + 1 : 1;

        connection.query(`SELECT RIGHT(file_code, 4) AS resFileCode, file_no AS resFileNo FROM tb_files WHERE file_code LIKE ?`, ["%XXX%"], (error, results) => {
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            let resFileCode = results[0].resFileCode;
            let resFileNo = results[0].resFileNo;
            let newFileCode = null;
            if (!fileCode) {
                newFileCode = "ENGX" + resFileCode;
                connection.query(`UPDATE tb_files SET file_code = ? WHERE file_no = ?`, [newFileCode, resFileNo], function (error) {
                    if (error) {
                        return res.status(500).json({ error: error.message });
                    }
                });
            }
            connection.query(`INSERT INTO tb_board (board_no, board_title, board_teacher, board_memo, file_code, board_CDT)
                              VALUES (?, ?, ?, ?, ?, NOW())`, [boardNo, boardTitle, boardTeacher, boardMemo, newFileCode || fileCode], function (error) {
                if (error) {
                    return res.status(500).json({ error: error.message });
                }
                res.status(200).json({ message: 'Board entry created successfully', boardNo: boardNo });
            });
        });
    });
});

app.get('/board/list', function (req, res) {
    connection.query(`SELECT B.board_no, B.board_title, B.board_teacher, B.board_memo,
                             F.file_url, F.file_code, F.file_name, F.thumbnail_url
                        FROM tb_board B
                        LEFT OUTER JOIN tb_files F
                          ON B.file_code = F.file_code`, function (err, rows) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.get('/board/detail/:boardNo', function (req, res) {
    const boardNo = req.query.boardNo;
    connection.query(`SELECT B.board_no, B.board_title, B.board_teacher, B.board_memo,
		                     F.file_url, F.file_code, F.file_name
                        FROM tb_board B
                        LEFT OUTER JOIN tb_files F
                          ON B.file_code = F.file_code
                       WHERE B.board_no = ?`, [boardNo], function (err, results) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results[0]);
    });
});

app.delete('/board/:boardNo', (req, res) => {
    const boardNo = req.params.boardNo;
    connection.query('DELETE FROM tb_board WHERE board_no = ?', [boardNo], (err) => {
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        connection.query(`SELECT file_code FROM tb_board WHERE board_no = ?`, [boardNo], function (err, results) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            const resFileCode = results[0].file_code;
            connection.query('DELETE FROM tb_files WHERE file_code = ?', [resFileCode], (err) => {
                if (err) {
                    return res.status(400).json({ message: err.message });
                }
                res.status(200).json({ message: 'Item deleted successfully' });
            });
        });
    });
});

//--------------------------------------------------------------- 로그인 관련
app.get('/authcheck', (req, res) => {     
    const sendData = { isLogin: "" };
    try {
        if (req.session.is_logined) {
            sendData.isLogin = "True";
        } else {
            sendData.isLogin = "False";
        }
        res.send(sendData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/logout', function (req, res) {
    req.session.destroy(function (err) {
        res.redirect('/');
    });
});

app.get("/login", (req, res) => {
    const userId = req.body.userId;
    const userPsword = req.body.userPsword;
    const sendData = { isLogin: "" };    
    if (userId && userPsword) {
        connection.query('SELECT * FROM tb_user WHERE user_id = ?', [userId], function (error, results) {
            if (error) throw error;
            if (results.length > 0) {
                bcrypt.compare(userPsword, results[0].userPsword, (err, result) => {
                    if (result === true) {
                        req.session.is_logined = true;
                        req.session.user_name = results[0].user_name;
                        req.session.save(function () {
                            sendData.isLogin = "True";
                            res.send(sendData);
                        });
                    } else {
                        sendData.isLogin = "로그인 정보가 일치하지 않습니다.";
                        res.send(sendData);
                    }
                });
            } else {
                sendData.isLogin = "아이디 정보가 일치하지 않습니다.";
                res.send(sendData);
            }
        });
    } else {
        sendData.isLogin = "아이디와 비밀번호를 입력하세요!";
        res.send(sendData);
    }
});

app.post("/signin", (req, res) => {
    const username = req.body.userId;
    const password = req.body.userPassword;
    const password2 = req.body.userPassword2;
    
    const sendData = { isSuccess: "" };

    if (username && password && password2) {
        connection.query('SELECT * FROM userTable WHERE username = ?', [username], function(error, results) {
            if (error) throw error;
            if (results.length <= 0 && password === password2) {
                const hashedPassword = bcrypt.hashSync(password, 10);
                connection.query('INSERT INTO userTable (username, password) VALUES(?,?)', [username, hashedPassword], function (error) {
                    if (error) throw error;
                    req.session.save(function () {                        
                        sendData.isSuccess = "True";
                        res.send(sendData);
                    });
                });
            } else if (password !== password2) {
                sendData.isSuccess = "입력된 비밀번호가 서로 다릅니다.";
                res.send(sendData);
            } else {
                sendData.isSuccess = "이미 존재하는 아이디 입니다!";
                res.send(sendData);  
            }            
        });        
    } else {
        sendData.isSuccess = "아이디와 비밀번호를 입력하세요!";
        res.send(sendData);  
    }
});

app.get('/error', function (req, res) {
    throw new Error('에러 발생');
});

// WebSocket 서버 설정
const server = createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', function (ws) {
    console.log('WebSocket connection established');
    ws.on('message', function (message) {
        console.log('received: %s', message);
    });

    ws.on('close', function () {
        console.log('WebSocket connection closed');
    });

    ws.on('error', function (error) {
        console.error('WebSocket error:', error);
    });
});

server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
