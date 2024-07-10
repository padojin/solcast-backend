const express = require('express');
const app = express();
const port = 3001;
const cors = require('cors');
const bodyParser = require('body-parser');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());
app.use(bodyParser.json());

app.post('/text', (req, res) => {
  const text = req.body.name;
  console.log(text);
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});