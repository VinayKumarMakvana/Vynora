const imaps = require('imap-simple');
require('dotenv').config();

const config = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASS,
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 3000
  }
};

imaps.connect(config).then(connection => {
  console.log("IMAP Connected Successfully!");
  connection.end();
}).catch(err => {
  console.log("IMAP Error:", err.message);
});
