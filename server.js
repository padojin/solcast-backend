// 1차 백엔드 기반으로 모델링처리를 하지 않은 백엔드 입니다. 
//결합성이 높아 가용성이 좋지 않아 수정이 필요합니다.
//by.eunji v.1.0 
const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const multer = require('multer');
const multerS3 = require('multer-s3');
const app = express();
const port = 3001;
const mysql = require("mysql"); // mysql 모듈을 불러옵니다.


// AWS 설정
AWS.config.update({
    region: 'ap-northeast-2',
});

const s3 = new AWS.S3();
const bucketName = 'solcast-test-bucket123';

// 커넥션을 정의합니다.
// RDS Console 에서 본인이 설정한 값을 입력해주세요.
const connection = mysql.createConnection({
    host: "rds-public-imsi.ch6kc0iw0q06.ap-northeast-2.rds.amazonaws.com",
    port: '3306',
    user: "user_1",
    password: "1q2w3e4r5t6y7u8i9o0p!",
    database: "test_db"
});

// CORS 설정
// app.use(cors());
app.use(cors({
    origin: 'http://localhost:8080'
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//--------------------------------------------------------------- 파일 관련
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
        return res.status(400).json({ error: 'File not uploaded' });
    }
    res.status(200).json({ message: 'File uploaded successfully', file: req.file });
});
// S3에서 파일 목록을 가져오는 GET 라우트
app.get('/file-list', async (req, res) => {
    try {
        const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
        const objectLists = data.Contents.map((item) => item.Key);
        res.json(objectLists);
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: error.message });
    }
});

// 서명된 URL을 생성하는 GET 라우트
app.get('/file-url/:key(*)', (req, res) => {
    const key = req.params.key;
    const params = {
        Bucket: bucketName,
        Key: key,
        Expires: 60
    };

    const url = s3.getSignedUrl('getObject', params);
    res.json({ url });
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

        connection.query(`INSERT INTO tb_board (board_no, board_title, board_teacher, board_memo, file_code)
            VALUES (?, ?, ?, ?, ?)`, [boardNo, boardTitle, boardTeacher, boardMemo, fileCode], function (error, result) {
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            res.status(200).json({ message: 'Board entry created successfully', boardNo:boardNo });
        });
    });
});
app.get('/board/list', function (req, res, next) {
    // 라우터에서 에러가 발생하면 Express가 알아서 이를 잡아서 처리합니다.
    connection.connect(function(err) {
        if (err) {
            throw err; // 접속에 실패하면 에러를 throw 합니다.
        } else {
            // 접속시 쿼리를 보냅니다.
            connection.query("SELECT * FROM tb_board", function(err, rows, fields) {
            console.log(rows); // 결과를 출력합니다!
            });
        }
    });
});
app.get('/board/detail/:boardNo', function (req, res, next) {
    const boardNo = req.query.boardNo;  // req.body 대신 req.query를 사용합니다.
    
    // 데이터베이스 연결을 처리합니다.
    connection.query(`SELECT * FROM tb_board WHERE board_no = ?`, [boardNo], function(err, results, fields) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results[0]);  // 결과를 JSON 형태로 반환합니다.
    });
});
app.post("/posts", (req, res) => {  // 데이터 받아서 결과 전송
    const title = req.body.title;
    const body = req.body.body;
    console.log(body);
    console.log(title);
    const sendData = { isSuccess: "" };
    
    if (title && body) {
        connection.query('INSERT INTO tb_board (board_no,board_title, board_memo) VALUES(1,?,?)', [title, body], function (error, data) {
            if (error) throw error;
            req.session.save(function () {                        
                sendData.isSuccess = "True"
                res.send(sendData);
            });
        });    
    } else {
        sendData.isSuccess = "게시물을 입력하세요!"
        res.send(sendData);  
    }
    
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