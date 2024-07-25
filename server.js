/* server.js */
// 1차 백엔드 기반으로 모델링처리를 하지 않은 백엔드 입니다. 
//결합성이 높아 가용성이 좋지 않아 수정이 필요합니다.
//by.eunji v.1.0 
require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const app = express();
const port = 3001;
const mysql = require("mysql2");
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { createServer } = require('http');

const WebSocket = require('ws');

app.use(express.static(path.join(__dirname, '/public')));

const server = createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', function (ws) {
  const id = setInterval(function () {
    ws.send(JSON.stringify(process.memoryUsage()), function () {
      //
      // Ignoring errors.
      //
    });
  }, 100);
  console.log('started client interval');

  ws.on('close', function () {
    console.log('stopping client interval');
    clearInterval(id);
  });
});

// AWS 설정
AWS.config.update({
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    region: process.env.S3_REGION,
 });
const s3 = new AWS.S3();
const inputBucketName = 'solcast-vod-input';
const outputBucketName = 'solcast-vod-output';
// const bucketName = 'solcast-backend-bucket';


// 커넥션을 정의합니다.
// RDS Console 에서 본인이 설정한 값을 입력해주세요.
const connection = mysql.createConnection({
    host: `rds-public-imsi.ch6kc0iw0q06.ap-northeast-2.rds.amazonaws.com`,
    port: `3306`,
    user: `admin`,
    password: `1q2w3e4r5t6y7u8i9o0p!`,
    default_authentication_plugin:`caching_sha2_password`,
    database: `test_db`
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK')
});
//
//--------------------------------------------------------------- 파일 관련
// 파일 업로드를 처리할 multer 설정
// const filePath =`/vod/dev/mp4/1/solcast-admin/`;
// const filePath =`/vod/dev/mp4/1/solcast-admin/${file.originalname}`;
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: inputBucketName,
        // path: filePath,
        key: (req, file, cb) => {
            cb(null, Date.now().toString() + '-' + file.originalname);
        }
    }) 
});

// 썸네일 생성 함수
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

// 파일 업로드를 위한 POST 라우트
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'File not uploaded' });
    }else{

        // 먼저 file_no의 최대값을 가져옵니다
        connection.query('SELECT MAX(file_no) AS maxFileNo FROM tb_files', (error, results) => {
            if (error) {
                console.error('Error querying max file_no:', error);
                return res.status(500).json({ error: error.message });
            }
    
            let maxFileNo = results[0].maxFileNo;
            const fileNo = maxFileNo ? maxFileNo + 1 : 1;
        
            const { originalname, location, key } = req.file;
            const fileCode = "XXXX"+ String(fileNo).padStart(4, "0"); // 파일코드 예시
            const fileUrl = location;
            const fileName = originalname;
            console.log(fileName);
            const thumbnailKey = `thumbnails/${key.split('.')[0]}.png`;
            const thumbnailPath = `/tmp/${thumbnailKey}`;
            console.log(thumbnailPath);
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
                            (err, result) => {
                                if (err) {
                                    return res.status(500).json({ error: err.message });
                                }
                                fs.unlinkSync(thumbnailPath); // 임시 썸네일 파일 삭제
                                res.status(200).json({ message: 'File uploaded and saved successfully', file: req.file, thumbnail: data.Location });
                            }
                        );
                    });
                })
                .catch(err => {
                    res.status(500).json({ error: err.message });
                });
        });
    }
});
// 서명된 URL을 생성하는 GET 라우트
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
// 동영상 URL을 반환하는 라우트
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
// 게시판 저장을 위한 POST 라우트
app.post('/main', (req, res) => {
    const { mainTitle, mainAuthor, mainCtgy } = req.body;
    // const { mainTitle, mainAuthor, mainCtgy, mainCompany } = req.body;
    if (!mainTitle || !mainAuthor || !mainCtgy) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const mainCompany = "testCom";
    // 먼저 mainNo의 최대값을 가져옵니다
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
            mainCompany:mainCompany
        };
        connection.query(`INSERT INTO tb_main (main_no, main_ctgy, main_title, main_author,main_company)
            VALUES (?, ?, ?, ?, ?)`, [mainNo,mainCtgy, mainTitle, mainAuthor, mainCompany], function (error, result) {
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            res.status(200).json({ message: 'main entry created successfully', mainNo:mainNo });
        });
    });
});
// main list API
app.get('/main/list', function (req, res, next) {
    connection.query(`SELECT main_no, main_ctgy, main_title, main_author, main_company
                        FROM tb_main`, function(err, rows, fields) {
    // connection.query(`SELECT M.main_no, M.main_title, M.main_author, M.main_ctgy, M.main_company,
    //                     FROM tb_main M
    //                     LEFT OUTER JOIN tb_user U
    //                       ON U.tb_user = B.main_company`, function(err, rows, fields) {
    //                     LEFT OUTER JOIN tb_board B
    //                       ON M.main_ctgy = B.main_ctgy`, function(err, rows, fields) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows); // 결과를 JSON 형태로 반환합니다.
    });
});
app.get('/main/detail/:mainNo', function (req, res, next) {
    const mainNo = req.query.mainNo;  // req.body 대신 req.query를 사용합니다.
    
    // 데이터베이스 연결을 처리합니다.
    connection.query(`SELECT main_no, main_ctgy, main_title, main_author, main_company
                        FROM tb_main
                       WHERE main_no = ?`, [mainNo], function(err, results, fields) {
            //     connection.query(`SELECT M.main_no, M.main_title, M.main_author, M.main_ctgy, M.main_company
            //                             FROM tb_main M 
            //                     LEFT OUTER JOIN tb_user U
            //                       ON U.main_company = B.main_company
            //                    WHERE main_no = ?`, [mainNo], function(err, results, fields) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results[0]);  // 결과를 JSON 형태로 반환합니다.
    });
});
//--------------------------------------------------------------- 게시물 관련
// 게시판 저장을 위한 POST 라우트
app.post('/board', (req, res) => {
    const { boardTitle, boardTeacher, boardMemo, fileCode } = req.body;

    // 먼저 boardNo의 최대값을 가져옵니다
    connection.query('SELECT MAX(board_no) AS maxBoardNo FROM tb_board', (error, results) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        let maxBoardNo = results[0].maxBoardNo;
        let boardNo = maxBoardNo ? maxBoardNo + 1 : 1;
        const params = {
            boardNo: boardNo,
            boardTitle: boardTitle,
            boardTeacher: boardTeacher,
            boardMemo: boardMemo,
            fileCode: fileCode
        };
        //파일이 있으면 추가 해준다.
        connection.query(`SELECT RIGHT(file_code,4) AS resFileCode,file_no AS resFileNo FROM tb_files WHERE file_code LIKE ?`, ["%XXX%"],(error, results) => {
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            let resFileCode = results[0].resFileCode;
            let resFileNo = results[0].resFileNo;
            let fileCode = null;
            if(!fileCode){
                fileCode = "ENGX"+ resFileCode; // 파일코드 예시
                connection.query(`UPDATE tb_files SET file_code=? WHERE file_no=?`, [fileCode, resFileNo], function (error, result) {
                    if (error) {
                        return res.status(500).json({ error: error.message });
                    }
                });
            }
            console.log(fileCode);
            connection.query(`INSERT INTO tb_board (board_no, board_title, board_teacher, board_memo, file_code,board_CDT)
                              VALUES (?, ?, ?, ?, ?,NOW())`, [boardNo, boardTitle, boardTeacher, boardMemo, fileCode], function (error, result) {
                if (error) {
                    return res.status(500).json({ error: error.message });
                }
                res.status(200).json({ message: 'Board entry created successfully', boardNo:boardNo });
            });
        });

    });
});
// Board list API
app.get('/board/list', function (req, res, next) {
    connection.query(`SELECT B.board_no, B.board_title, B.board_teacher, B.board_memo,
                             F.file_url, F.file_code, F.file_name, F.thumbnail_url
                        FROM tb_board B
                        LEFT OUTER JOIN tb_files F
                          ON B.file_code = F.file_code`, function(err, rows, fields) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows); // 결과를 JSON 형태로 반환합니다.
    });
});
app.get('/board/detail/:boardNo', function (req, res, next) {
    const boardNo = req.query.boardNo;  // req.body 대신 req.query를 사용합니다.
    
    // 데이터베이스 연결을 처리합니다.
    connection.query(`SELECT B.board_no, B.board_title, B.board_teacher, B.board_memo,
		                     F.file_url, F.file_code, F.file_name
                        FROM tb_board B
                        LEFT OUTER JOIN tb_files F
                          ON B.file_code = F.file_code
                       WHERE B.board_no = ?`, [boardNo], function(err, results, fields) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results[0]);  // 결과를 JSON 형태로 반환합니다.
    });
}); 

// 아이템 삭제 API
app.delete('/board/:boardNo', (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM tb_board WHERE board_no = ?';
    db.query(query, [boardNo], (err, result) => {
        if (err) {
            return res.status(400).json({ message: err.message });
        }
        res.status(200).json({ message: 'Item deleted successfully' });
    });
    let resFileCode = null;
    connection.query(`SELECT F.file_code
                        FROM tb_board B
                        LEFT OUTER JOIN tb_files F
                          ON B.file_code = F.file_code
                       WHERE B.board_no = ?`, [boardNo], function(err, results, fields) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
            resFileCode = results[0].resFileCode;// 결과를 FileCode로 변환
            const query = 'DELETE FROM tb_files WHERE file_code = ?';
            db.query(query, [resFileCode], (err, result) => {
                if (err) {
                    return res.status(400).json({ message: err.message });
                }
                res.status(200).json({ message: 'Item deleted successfully' });
            });
        });
});
//--------------------------------------------------------------- 로그인 관련
app.get('/authcheck', (req, res) => {     
    const sendData = { isLogin: "" };
    try{
        if (req.session.is_logined) {
            sendData.isLogin = "True"
            console.log(sendData.isLogin);
        } else {
            sendData.isLogin = "False"
            console.log(sendData.isLogin);
        }
        res.send(sendData);
    } catch (error) {
        console.error('Error listing files:', error);
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
    console.log("userId : "+ userId);
    console.log("userPsword : "+userPsword);
    const sendData = { isLogin: "" };    
    if (userId && userPsword) {             // id와 pw가 입력되었는지 확인
        connection.query('SELECT * FROM tb_user WHERE user_id = ?', [userId], function (error, results, fields) {
            if (error) throw error;
            if (results.length > 0) {       // db에서의 반환값이 있다 = 일치하는 아이디가 있다.      

                bcrypt.compare(userPsword , results[0].userPsword, (err, result) => {    // 입력된 비밀번호가 해시된 저장값과 같은 값인지 비교

                    if (result === true) {                  // 비밀번호가 일치하면
                        req.session.is_logined = true;      // 세션 정보 갱신
                        req.session.user_name = user_name;
                        req.session.save(function () {
                            sendData.isLogin = "True"
                            res.send(sendData);
                        });
                        console.log(req.session.user_name);
                        connection.query(`INSERT INTO tb_log (created, user_name, action, command, actiondetail) VALUES (NOW(), ?, 'login' , ?, ?)`
                            , [req.session.user_name, '-', `React 로그인 테스트`], function (error, result) { });
                    }
                    else{                                   // 비밀번호가 다른 경우
                        sendData.isLogin = "로그인 정보가 일치하지 않습니다."
                        res.send(sendData);
                    }
                })                      
            } else {    // db에 해당 아이디가 없는 경우
                sendData.isLogin = "아이디 정보가 일치하지 않습니다."
                res.send(sendData);
            }
        });
    } else {            // 아이디, 비밀번호 중 입력되지 않은 값이 있는 경우
        sendData.isLogin = "아이디와 비밀번호를 입력하세요!"
        res.send(sendData);
    }
});
app.post("/signin", (req, res) => {  // 데이터 받아서 결과 전송
    const username = req.body.userId;
    const password = req.body.userPassword;
    const password2 = req.body.userPassword2;
    
    const sendData = { isSuccess: "" };

    if (username && password && password2) {
        connection.query('SELECT * FROM userTable WHERE username = ?', [username], function(error, results, fields) { // DB에 같은 이름의 회원아이디가 있는지 확인
            if (error) throw error;
            if (results.length <= 0 && password == password2) {         // DB에 같은 이름의 회원아이디가 없고, 비밀번호가 올바르게 입력된 경우
                const hasedPassword = bcrypt.hashSync(password, 10);    // 입력된 비밀번호를 해시한 값
                connection.query('INSERT INTO userTable (username, password) VALUES(?,?)', [username, hasedPassword], function (error, data) {
                    if (error) throw error;
                    req.session.save(function () {                        
                        sendData.isSuccess = "True"
                        res.send(sendData);
                    });
                });
            } else if (password != password2) {                     // 비밀번호가 올바르게 입력되지 않은 경우                  
                sendData.isSuccess = "입력된 비밀번호가 서로 다릅니다."
                res.send(sendData);
            }
            else {                                                  // DB에 같은 이름의 회원아이디가 있는 경우            
                sendData.isSuccess = "이미 존재하는 아이디 입니다!"
                res.send(sendData);  
            }            
        });        
    } else {
        sendData.isSuccess = "아이디와 비밀번호를 입력하세요!"
        res.send(sendData);  
    }
    
});



app.get('/error', function (req, res, next) {
    // 라우터에서 에러가 발생하면 Express가 알아서 이를 잡아서 처리합니다.
    throw new Error('에러 발생');
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});