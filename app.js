const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const port = 3000;

// Set EJS as the view engine
app.set('view engine', 'ejs');

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.render('index');
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
