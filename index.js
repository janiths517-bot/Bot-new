const express = require('express');
const cors = require('cors'); // Import cors package
const bodyParser = require("body-parser");
const path = require('path');
const rateLimit = require('express-rate-limit');
const code = require('./pair'); 

const app = express();
const PORT = process.env.PORT || 8000;
const __path = process.cwd();

require('events').EventEmitter.defaultMaxListeners = 500;

// Enable CORS for all domains
app.use(cors());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create a rate limiter to prevent spamming the pair code endpoint
const pairCodeLimiter = rateLimit({
	windowMs: 5 * 60 * 1000, // 5 minutes
	max: 20, // Limit each IP to 20 requests per window
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
        success: false,
        error: 'Too many requests for a pair code from this IP. Please try again after 5 minutes.'
    },
});

// Apply the rate limiter specifically to the routes that generate the pair code
app.use('/code', pairCodeLimiter, code);
// API endpoint to send reactions

app.get("/", (req, res) =>
  res.sendFile(__path + "/fontend/index.html"),
);

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
